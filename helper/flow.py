"""
flow.py — PharmFlow AI local background agent

Polls Kroll's PendingNewRx table (READ-ONLY), enriches each row with
patient / doctor data and syncs structured payloads to the cloud backend.

Modes
-----
  python flow.py              run the poll loop (SHADOW or LIVE per config.ini)
  python flow.py --discover   list tables/columns in the Kroll DB so you can
                              verify / fix the [Schema] mapping in config.ini
  python flow.py --test       one connection + one poll, print counts, exit

Design notes
------------
* Only SELECT statements are ever issued.
* A watermark (highest PendingRxId seen) is kept in SQLite, so the agent never
  starves when more than TOP-N rows are already processed.
* Patient names / DOBs / addresses are NEVER written to the log file.
* Cloud pushes are idempotent (server de-duplicates on pending_rx_id+hostname),
  so retries after a timeout cannot create duplicates.
"""

from __future__ import annotations

import argparse
import configparser
import datetime as dt
import decimal
import json
import logging
import logging.handlers
import re
import socket
import sqlite3
import sys
import time
import traceback
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pyodbc
import requests

# ---------------------------------------------------------------------------
# Paths & constants
# ---------------------------------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = BASE_DIR / "config.ini"
SQLITE_PATH = BASE_DIR / "shadow_queue.db"
LOG_DIR = BASE_DIR / "logs"

DEFAULT_POLL_INTERVAL = 5
MAX_BACKOFF_SEC = 60
CLOUD_TIMEOUT_SEC = 15
DB_CONNECT_TIMEOUT_SEC = 10
BATCH_SIZE = 50
HEARTBEAT_EVERY_SEC = 300
SPOOL_MAX_ATTEMPTS = 20          # then the item is parked as dead-letter
SPOOL_MAX_ROWS = 5000            # safety cap for a long outage

# Identifiers (table / column names) are interpolated into SQL, so they are
# validated against this pattern. Values are never interpolated.
IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$")

# Default Kroll schema mapping. These are best guesses — run `--discover` on the
# real server and override anything that differs in the [Schema] section.
DEFAULT_SCHEMA: Dict[str, str] = {
    "pending_table": "dbo.PendingNewRx",
    "pending_id": "PendingRxId",
    "pending_pat_id": "PatId",
    "pending_doc_id": "DocId",
    "pending_drug_id": "DrugId",
    "pending_qty": "Qty",
    "pending_refills": "Refills",
    "pending_sig": "SigText",
    "pending_created": "DateCreated",
    "pending_status": "Status",
    "pending_status_value": "New",      # leave empty to skip the status filter
    "pat_table": "dbo.Pat",
    "pat_id": "PatId",
    "pat_first": "FirstNm",
    "pat_last": "LastNm",
    "pat_dob": "BirthDate",
    "addr_table": "dbo.PatAdd",
    "addr_pat_id": "PatId",
    "addr_line": "Address1",
    "addr_primary_col": "IsPrimary",   # leave empty if there is no such column
    "plan_table": "dbo.PatPln",
    "plan_pat_id": "PatId",
    "plan_id": "PlanId",
    "plan_seq_col": "SeqNum",         # leave empty if there is no such column
    "doc_table": "dbo.Doc",
    "doc_id": "DocId",
    "doc_first": "FirstNm",
    "doc_last": "LastNm",
    "lic_table": "dbo.DocLicence",
    "lic_doc_id": "DocId",
    "lic_num": "LicenceNum",
}


# ---------------------------------------------------------------------------
# Logging (no PHI, no secrets)
# ---------------------------------------------------------------------------

def setup_logging(agent_version: str) -> logging.Logger:
    LOG_DIR.mkdir(parents=True, exist_ok=True)

    logger = logging.getLogger("pharmflow")
    logger.setLevel(logging.INFO)
    logger.handlers.clear()

    fmt = logging.Formatter(
        "%(asctime)s | %(levelname)-7s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    ch = logging.StreamHandler(sys.stdout)
    ch.setFormatter(fmt)
    logger.addHandler(ch)

    fh = logging.handlers.TimedRotatingFileHandler(
        filename=str(LOG_DIR / "pharmflow.log"),
        when="midnight",
        interval=1,
        backupCount=30,
        encoding="utf-8",
        utc=False,
    )
    fh.suffix = "%Y-%m-%d"
    fh.setFormatter(fmt)
    logger.addHandler(fh)

    logger.info("PharmFlow agent starting | version=%s | host=%s", agent_version, socket.gethostname())
    return logger


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

class AgentConfig:
    def __init__(self, path: Path):
        if not path.exists():
            raise FileNotFoundError(
                f"config.ini not found at {path}. Copy config.ini.example to config.ini first."
            )

        cp = configparser.ConfigParser(interpolation=None)  # passwords may contain '%'
        cp.read(path, encoding="utf-8")

        self.mode: str = cp.get("Agent", "MODE", fallback="SHADOW").strip().upper()
        self.poll_interval: int = cp.getint("Agent", "POLL_INTERVAL_SEC", fallback=DEFAULT_POLL_INTERVAL)
        self.agent_version: str = cp.get("Agent", "AGENT_VERSION", fallback="1.1.0")
        # Same value on every PC of one pharmacy: all PCs that read the same Kroll DB
        # then de-duplicate to a single row per prescription in the cloud.
        self.store_id: str = cp.get("Agent", "STORE_ID", fallback="default").strip() or "default"

        self.db_server: str = cp.get("Database", "SERVER", fallback="localhost").strip()
        self.db_name: str = cp.get("Database", "DATABASE", fallback="Pharmacy").strip()
        self.db_uid: str = cp.get("Database", "UID", fallback="rx").strip()
        self.db_pwd: str = cp.get("Database", "PWD", fallback="")
        self.db_driver: str = cp.get("Database", "DRIVER", fallback="ODBC Driver 17 for SQL Server").strip()
        self.db_trust_cert: bool = cp.getboolean("Database", "TRUST_SERVER_CERTIFICATE", fallback=True)

        self.api_url: str = cp.get("Cloud", "API_URL", fallback="").strip().rstrip("/")
        self.api_key: str = cp.get("Cloud", "API_KEY", fallback="").strip()
        # Only needed if Vercel Deployment Protection is on for the API URL
        self.bypass_token: str = cp.get("Cloud", "VERCEL_BYPASS_TOKEN", fallback="").strip()

        self.schema: Dict[str, str] = dict(DEFAULT_SCHEMA)
        if cp.has_section("Schema"):
            for key in DEFAULT_SCHEMA:
                if cp.has_option("Schema", key):
                    self.schema[key] = cp.get("Schema", key).strip()

        if self.mode not in ("SHADOW", "LIVE"):
            raise ValueError(f"Invalid MODE: {self.mode}. Use SHADOW or LIVE.")
        if self.poll_interval < 1:
            raise ValueError("POLL_INTERVAL_SEC must be >= 1")
        if not self.db_pwd or "CHANGE_ME" in self.db_pwd:
            raise ValueError("Database PWD is empty / still the placeholder in config.ini")
        if self.mode == "LIVE":
            if not self.api_url or not self.api_key or "CHANGE_ME" in self.api_key:
                raise ValueError("LIVE mode needs Cloud API_URL and a real API_KEY in config.ini")
            if not self.api_url.lower().startswith("https://"):
                raise ValueError("Cloud API_URL must be https:// (patient data is sent over it)")

        for key, value in self.schema.items():
            is_optional = key.endswith("_col") or key == "pending_status_value"
            if not value:
                if is_optional or key == "pending_status":
                    continue
                raise ValueError(f"[Schema] {key} must not be empty")
            if key != "pending_status_value" and not IDENT_RE.match(value):
                raise ValueError(f"[Schema] {key}={value!r} is not a valid SQL identifier")


# ---------------------------------------------------------------------------
# JSON-safe conversion (pyodbc returns Decimal / date / bytes)
# ---------------------------------------------------------------------------

def jsonable(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, decimal.Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, (dt.datetime, dt.date, dt.time)):
        return value.isoformat()
    if isinstance(value, (bytes, bytearray)):
        return value.decode("utf-8", errors="replace")
    return str(value)


# ---------------------------------------------------------------------------
# SQLite state + offline spool
# ---------------------------------------------------------------------------

class LocalStore:
    """Tracks the watermark / processed ids and spools failed cloud payloads."""

    def __init__(self, db_path: Path, logger: logging.Logger):
        self.db_path = db_path
        self.log = logger
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), timeout=30)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_schema(self) -> None:
        conn = self._connect()
        try:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS processed (
                    pending_rx_id INTEGER PRIMARY KEY,
                    processed_at  TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS spool (
                    id            INTEGER PRIMARY KEY AUTOINCREMENT,
                    pending_rx_id INTEGER,
                    payload_json  TEXT NOT NULL,
                    created_at    TEXT NOT NULL,
                    attempts      INTEGER NOT NULL DEFAULT 0,
                    last_error    TEXT,
                    dead          INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS meta (
                    key   TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_spool_created ON spool(created_at);
                """
            )
            conn.commit()
        finally:
            conn.close()

    # -- watermark ---------------------------------------------------------
    def get_watermark(self) -> int:
        conn = self._connect()
        try:
            row = conn.execute("SELECT value FROM meta WHERE key='watermark'").fetchone()
            return int(row["value"]) if row else 0
        finally:
            conn.close()

    def set_watermark(self, value: int) -> None:
        conn = self._connect()
        try:
            conn.execute(
                "INSERT INTO meta(key, value) VALUES('watermark', ?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (str(value),),
            )
            conn.commit()
        finally:
            conn.close()

    # -- processed ---------------------------------------------------------
    def is_processed(self, pending_rx_id: int) -> bool:
        conn = self._connect()
        try:
            return conn.execute(
                "SELECT 1 FROM processed WHERE pending_rx_id = ?", (pending_rx_id,)
            ).fetchone() is not None
        finally:
            conn.close()

    def mark_processed(self, pending_rx_id: int) -> None:
        conn = self._connect()
        try:
            conn.execute(
                "INSERT OR IGNORE INTO processed (pending_rx_id, processed_at) VALUES (?, ?)",
                (pending_rx_id, dt.datetime.now(dt.timezone.utc).isoformat()),
            )
            conn.commit()
        finally:
            conn.close()

    # -- spool -------------------------------------------------------------
    def spool_payload(self, pending_rx_id: int, payload: Dict[str, Any], error: str = "") -> None:
        conn = self._connect()
        try:
            count = conn.execute("SELECT COUNT(*) FROM spool WHERE dead = 0").fetchone()[0]
            if count >= SPOOL_MAX_ROWS:
                self.log.error("Spool full (%d) — dropping PendingRxId=%s", count, pending_rx_id)
                return
            conn.execute(
                "INSERT INTO spool (pending_rx_id, payload_json, created_at, attempts, last_error) "
                "VALUES (?, ?, ?, 0, ?)",
                (
                    pending_rx_id,
                    json.dumps(payload, default=str),
                    dt.datetime.now(dt.timezone.utc).isoformat(),
                    error[:500] if error else None,
                ),
            )
            conn.commit()
        finally:
            conn.close()
        self.log.warning("Spooled PendingRxId=%s for retry", pending_rx_id)

    def load_spool(self, limit: int = 30) -> List[sqlite3.Row]:
        conn = self._connect()
        try:
            return list(
                conn.execute(
                    "SELECT id, pending_rx_id, payload_json, attempts FROM spool "
                    "WHERE dead = 0 ORDER BY id ASC LIMIT ?",
                    (limit,),
                ).fetchall()
            )
        finally:
            conn.close()

    def delete_spool_item(self, spool_id: int) -> None:
        conn = self._connect()
        try:
            conn.execute("DELETE FROM spool WHERE id = ?", (spool_id,))
            conn.commit()
        finally:
            conn.close()

    def bump_spool_attempt(self, spool_id: int, error: str, permanent: bool) -> bool:
        """Returns True if the item was parked as dead-letter."""
        conn = self._connect()
        try:
            row = conn.execute("SELECT attempts FROM spool WHERE id = ?", (spool_id,)).fetchone()
            attempts = (row["attempts"] if row else 0) + 1
            dead = 1 if (permanent or attempts >= SPOOL_MAX_ATTEMPTS) else 0
            conn.execute(
                "UPDATE spool SET attempts = ?, last_error = ?, dead = ? WHERE id = ?",
                (attempts, error[:500], dead, spool_id),
            )
            conn.commit()
            return bool(dead)
        finally:
            conn.close()


# ---------------------------------------------------------------------------
# Kroll SQL connection (read-only)
# ---------------------------------------------------------------------------

class KrollDB:
    def __init__(self, cfg: AgentConfig, logger: logging.Logger):
        self.cfg = cfg
        self.log = logger
        self._conn: Optional[pyodbc.Connection] = None
        self._backoff = 1.0
        self._sql = self._build_query()

    # PWD is wrapped in {} so ';' or '=' in the password cannot break the string.
    def _connection_string(self) -> str:
        pwd = self.cfg.db_pwd.replace("}", "}}")
        return (
            f"DRIVER={{{self.cfg.db_driver}}};"
            f"SERVER={self.cfg.db_server};"
            f"DATABASE={self.cfg.db_name};"
            f"UID={self.cfg.db_uid};"
            f"PWD={{{pwd}}};"
            f"TrustServerCertificate={'yes' if self.cfg.db_trust_cert else 'no'};"
            f"Connection Timeout={DB_CONNECT_TIMEOUT_SEC};"
            "ApplicationIntent=ReadOnly;"
        )

    def _build_query(self) -> str:
        s = self.cfg.schema

        primary = f"AND a.{s['addr_primary_col']} = 1" if s["addr_primary_col"] else ""
        plan_order = f"ORDER BY pp.{s['plan_seq_col']} ASC" if s["plan_seq_col"] else ""
        status = (
            f"AND p.{s['pending_status']} = ?"
            if s["pending_status"] and s["pending_status_value"]
            else ""
        )

        # OUTER APPLY TOP 1: exactly one row per pending Rx even if a patient has
        # several addresses / plans or a doctor several licences (a plain LEFT JOIN
        # would duplicate rows and break de-duplication).
        return f"""
        SELECT TOP {BATCH_SIZE}
            p.{s['pending_id']}      AS PendingRxId,
            p.{s['pending_pat_id']}  AS PatId,
            pt.{s['pat_first']}      AS PatientFirstName,
            pt.{s['pat_last']}       AS PatientLastName,
            pt.{s['pat_dob']}        AS PatientDOB,
            pa.{s['addr_line']}      AS PatientAddress,
            pp.{s['plan_id']}        AS PrimaryInsurancePlan,
            p.{s['pending_doc_id']}  AS DocId,
            d.{s['doc_first']}       AS DocFirstName,
            d.{s['doc_last']}        AS DocLastName,
            dl.{s['lic_num']}        AS DoctorLicence,
            p.{s['pending_drug_id']} AS DrugId,
            p.{s['pending_qty']}     AS Qty,
            p.{s['pending_refills']} AS Refills,
            p.{s['pending_sig']}     AS SigText,
            p.{s['pending_created']} AS DateCreated
        FROM {s['pending_table']} p
        LEFT JOIN {s['pat_table']} pt
            ON p.{s['pending_pat_id']} = pt.{s['pat_id']}
        OUTER APPLY (
            SELECT TOP 1 a.{s['addr_line']}
            FROM {s['addr_table']} a
            WHERE a.{s['addr_pat_id']} = pt.{s['pat_id']}
            {primary}
        ) pa
        OUTER APPLY (
            SELECT TOP 1 pp.{s['plan_id']}
            FROM {s['plan_table']} pp
            WHERE pp.{s['plan_pat_id']} = pt.{s['pat_id']}
            {plan_order}
        ) pp
        LEFT JOIN {s['doc_table']} d
            ON p.{s['pending_doc_id']} = d.{s['doc_id']}
        OUTER APPLY (
            SELECT TOP 1 l.{s['lic_num']}
            FROM {s['lic_table']} l
            WHERE l.{s['lic_doc_id']} = d.{s['doc_id']}
        ) dl
        WHERE p.{s['pending_id']} > ?
        {status}
        ORDER BY p.{s['pending_id']} ASC
        """

    def connect(self) -> None:
        self.close()
        try:
            self._conn = pyodbc.connect(self._connection_string(), autocommit=True)
            self._conn.timeout = 30
            self._backoff = 1.0
            self.log.info(
                "Connected to Kroll SQL | server=%s | db=%s | user=%s",
                self.cfg.db_server, self.cfg.db_name, self.cfg.db_uid,
            )
        except pyodbc.Error as exc:
            self.log.error("SQL connect failed: %s", exc)
            raise

    def ensure(self) -> pyodbc.Connection:
        if self._conn is None:
            self.connect()
            return self._conn  # type: ignore[return-value]
        try:
            cur = self._conn.cursor()
            cur.execute("SELECT 1")
            cur.fetchone()
            cur.close()
            return self._conn
        except pyodbc.Error:
            self.log.warning("SQL connection lost — reconnecting in %.0fs", self._backoff)
            time.sleep(min(self._backoff, MAX_BACKOFF_SEC))
            self._backoff = min(self._backoff * 2, MAX_BACKOFF_SEC)
            self.connect()
            return self._conn  # type: ignore[return-value]

    def fetch_pending(self, after_id: int) -> List[Dict[str, Any]]:
        conn = self.ensure()
        cur = conn.cursor()
        try:
            params: List[Any] = [after_id]
            s = self.cfg.schema
            if s["pending_status"] and s["pending_status_value"]:
                params.append(s["pending_status_value"])
            cur.execute(self._sql, params)
            columns = [col[0] for col in cur.description]
            return [
                {col: jsonable(val) for col, val in zip(columns, row)}
                for row in cur.fetchall()
            ]
        finally:
            cur.close()

    def discover(self) -> None:
        """Print tables + columns that look relevant, to help fill [Schema]."""
        conn = self.ensure()
        cur = conn.cursor()
        try:
            cur.execute(
                "SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE "
                "FROM INFORMATION_SCHEMA.COLUMNS "
                "ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION"
            )
            tables: Dict[str, List[str]] = {}
            for schema, table, column, dtype in cur.fetchall():
                tables.setdefault(f"{schema}.{table}", []).append(f"{column} ({dtype})")
        finally:
            cur.close()

        keywords = ("pend", "pat", "doc", "presc", "rx", "plan", "licen", "addr")
        print(f"\n{len(tables)} tables in database '{self.cfg.db_name}'. Relevant ones:\n")
        for name, cols in sorted(tables.items()):
            if any(k in name.lower() for k in keywords):
                print(f"== {name}")
                print("   " + ", ".join(cols))
        print("\nAll table names:\n  " + "\n  ".join(sorted(tables)))
        print("\nCopy the right names into the [Schema] section of config.ini.")

    def close(self) -> None:
        if self._conn is not None:
            try:
                self._conn.close()
            except Exception:
                pass
            self._conn = None


# ---------------------------------------------------------------------------
# Cloud sync
# ---------------------------------------------------------------------------

class CloudClient:
    def __init__(self, cfg: AgentConfig, logger: logging.Logger):
        self.cfg = cfg
        self.log = logger
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Content-Type": "application/json",
                "x-api-key": cfg.api_key,
                "User-Agent": f"PharmFlow-Agent/{cfg.agent_version}",
            }
        )
        if cfg.bypass_token:
            self.session.headers["x-vercel-protection-bypass"] = cfg.bypass_token

    def push(self, payload: Dict[str, Any]) -> Tuple[bool, str, bool]:
        """Returns (ok, error, permanent). permanent=True for 4xx (retry is pointless)."""
        try:
            resp = self.session.post(self.cfg.api_url, json=payload, timeout=CLOUD_TIMEOUT_SEC)
        except requests.RequestException as exc:
            return False, str(exc), False
        if 200 <= resp.status_code < 300:
            return True, "", False
        permanent = 400 <= resp.status_code < 500 and resp.status_code not in (401, 408, 429)
        return False, f"HTTP {resp.status_code}: {resp.text[:200]}", permanent


def build_payload(row: Dict[str, Any], cfg: AgentConfig) -> Dict[str, Any]:
    return {
        "schema_version": "1.1",
        "mode": cfg.mode,
        "store_id": cfg.store_id,
        "agent": {
            "version": cfg.agent_version,
            "hostname": socket.gethostname(),
            "timestamp_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
        },
        "pending_rx": {
            "pending_rx_id": row.get("PendingRxId"),
            "pat_id": row.get("PatId"),
            "doc_id": row.get("DocId"),
            "drug_id": row.get("DrugId"),
            "qty": row.get("Qty"),
            "refills": row.get("Refills"),
            "sig_text": row.get("SigText"),
            "date_created": row.get("DateCreated"),
        },
        "patient": {
            "first_name": row.get("PatientFirstName"),
            "last_name": row.get("PatientLastName"),
            "dob": row.get("PatientDOB"),
            "address": row.get("PatientAddress"),
            "primary_plan_id": row.get("PrimaryInsurancePlan"),
        },
        "doctor": {
            "first_name": row.get("DocFirstName"),
            "last_name": row.get("DocLastName"),
            "licence": row.get("DoctorLicence"),
        },
    }


# ---------------------------------------------------------------------------
# Main agent
# ---------------------------------------------------------------------------

class PharmFlowAgent:
    def __init__(self, cfg: AgentConfig):
        self.cfg = cfg
        self.log = setup_logging(cfg.agent_version)
        self.store = LocalStore(SQLITE_PATH, self.log)
        self.db = KrollDB(cfg, self.log)
        self.cloud = CloudClient(cfg, self.log)
        self._last_heartbeat = 0.0
        self._running = True
        self.log.info(
            "Config loaded | mode=%s | poll=%ss | db_user=%s | api=%s",
            cfg.mode, cfg.poll_interval, cfg.db_uid, cfg.api_url or "(none)",
        )

    def _process_row(self, row: Dict[str, Any]) -> None:
        raw_id = row.get("PendingRxId")
        if raw_id is None:
            return
        pending_id = int(raw_id)

        if self.store.is_processed(pending_id):
            return

        if self.cfg.mode == "SHADOW":
            # IDs only — no patient / doctor names in logs.
            self.log.info(
                "[SHADOW] PendingRxId=%s | has_patient=%s | has_doctor=%s | drug=%s",
                pending_id,
                bool(row.get("PatientLastName")),
                bool(row.get("DocLastName")),
                row.get("DrugId"),
            )
            self.store.mark_processed(pending_id)
            return

        payload = build_payload(row, self.cfg)
        ok, err, permanent = self.cloud.push(payload)
        if ok:
            self.log.info("Synced PendingRxId=%s to cloud", pending_id)
        else:
            self.log.error("Cloud push failed for PendingRxId=%s: %s", pending_id, err)
            if not permanent:
                self.store.spool_payload(pending_id, payload, err)
        self.store.mark_processed(pending_id)

    def _flush_spool(self) -> None:
        if self.cfg.mode != "LIVE":
            return
        items = self.store.load_spool(limit=30)
        if not items:
            return

        self.log.info("Flushing %d spooled payload(s)…", len(items))
        for item in items:
            try:
                payload = json.loads(item["payload_json"])
            except json.JSONDecodeError:
                self.store.delete_spool_item(item["id"])
                continue

            ok, err, permanent = self.cloud.push(payload)
            if ok:
                self.store.delete_spool_item(item["id"])
                self.log.info("Spool item %s (PendingRxId=%s) uploaded", item["id"], item["pending_rx_id"])
                continue

            dead = self.store.bump_spool_attempt(item["id"], err, permanent)
            if dead:
                self.log.error("Spool item %s parked as dead-letter: %s", item["id"], err)
                continue          # a bad item must not block the ones behind it
            self.log.warning("Spool retry failed id=%s: %s", item["id"], err)
            break                 # network/server down — try again next cycle

    def _heartbeat(self) -> None:
        if self.cfg.mode != "LIVE" or time.monotonic() - self._last_heartbeat < HEARTBEAT_EVERY_SEC:
            return
        self._last_heartbeat = time.monotonic()
        ok, err, _ = self.cloud.push(
            {
                "type": "heartbeat",
                "mode": self.cfg.mode,
                "store_id": self.cfg.store_id,
                "agent": {
                    "version": self.cfg.agent_version,
                    "hostname": socket.gethostname(),
                    "timestamp_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
                },
            }
        )
        if not ok:
            self.log.warning("Heartbeat failed: %s", err)

    def run_once(self) -> int:
        try:
            watermark = self.store.get_watermark()
            rows = self.db.fetch_pending(watermark)
            if rows:
                self.log.info("Polled %d new pending row(s)", len(rows))
            for row in rows:
                self._process_row(row)
            if rows:
                top = max(int(r["PendingRxId"]) for r in rows if r.get("PendingRxId") is not None)
                self.store.set_watermark(max(top, watermark))
            self._flush_spool()
            self._heartbeat()
            return len(rows)
        except pyodbc.Error as exc:
            self.log.error("SQL error during poll: %s", exc)
            self.db.close()
        except Exception:
            self.log.error("Unexpected error in run_once:\n%s", traceback.format_exc())
        return 0

    def run(self) -> None:
        self.log.info("Entering poll loop (Ctrl+C to stop)")
        try:
            while self._running:
                started = time.monotonic()
                fetched = self.run_once()
                if fetched >= BATCH_SIZE:
                    continue  # backlog — drain it without sleeping
                elapsed = time.monotonic() - started
                time.sleep(max(0.5, self.cfg.poll_interval - elapsed))
        except KeyboardInterrupt:
            self.log.info("Shutdown requested")
        finally:
            self.db.close()
            self.log.info("Agent stopped")


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="PharmFlow Kroll poller")
    parser.add_argument("--discover", action="store_true", help="list DB tables/columns and exit")
    parser.add_argument("--test", action="store_true", help="connect, poll once, print counts, exit")
    args = parser.parse_args(argv)

    try:
        cfg = AgentConfig(CONFIG_PATH)
    except Exception as exc:
        print(f"FATAL config error: {exc}", file=sys.stderr)
        return 1

    if args.discover:
        logger = setup_logging(cfg.agent_version)
        KrollDB(cfg, logger).discover()
        return 0

    agent = PharmFlowAgent(cfg)

    if args.test:
        try:
            rows = agent.db.fetch_pending(0)
        except Exception as exc:
            print(f"TEST FAILED: {exc}", file=sys.stderr)
            return 2
        print(f"TEST OK: connected, query ran, {len(rows)} pending row(s) visible (batch cap {BATCH_SIZE}).")
        return 0

    agent.run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
