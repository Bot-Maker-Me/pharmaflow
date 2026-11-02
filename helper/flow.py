"""
flow.py — PharmFlow AI local background agent

Polls Kroll's PendingNewRx table (READ-ONLY), enriches each row with
patient / doctor data and syncs structured payloads to the cloud backend.

Modes
-----
  python flow.py              run the poll loop (SHADOW or LIVE per config.ini)
  python flow.py --schema-report  write schema_report.txt (columns only, no PHI)
  python flow.py --discover   list tables/columns in the Kroll DB so you can
                              verify / fix the [Schema] mapping in config.ini
  python flow.py --shadow-report
                              compare what the agent WOULD have done with what staff actually
                              entered in Kroll; prints match rates and a go-live verdict
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

# Tables present in your Kroll database that PharmFlow cares about
# (taken from your own table extract).
KNOWN_TABLES: List[str] = [
    "PendingNewRx", "ERx", "ERxOrder", "RxToDo",
    "Pat", "PatAdd", "PatPhone", "PatPln", "PatAlg",
    "Doc", "DocLicence", "DocPhone", "DocAdd",
    "Rx", "RxWorkflow", "RxWorkflowDetail", "RxPln", "RxPlnAdj", "RxScriptImage",
]

# [RxSchema] keys (all optional; --shadow-report needs the table + the compared columns).
RX_SCHEMA_KEYS = [
    "rx_table", "rx_link_col",       # rx_link_col = column holding the PendingRxId, if Kroll keeps one
    "rx_pat_id", "rx_doc_id", "rx_drug_id", "rx_qty", "rx_refills", "rx_sig", "rx_created",
]

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

        # Where the finished prescriptions live (used only by --shadow-report, read-only).
        self.rx_schema: Dict[str, str] = {k: "" for k in RX_SCHEMA_KEYS}
        if cp.has_section("RxSchema"):
            for key in RX_SCHEMA_KEYS:
                self.rx_schema[key] = cp.get("RxSchema", key, fallback="").strip()
        self.go_live_min_match: float = cp.getfloat("Shadow", "GO_LIVE_MIN_MATCH", fallback=0.995)
        self.go_live_min_samples: int = cp.getint("Shadow", "GO_LIVE_MIN_SAMPLES", fallback=200)
        self.go_live_min_auto: float = cp.getfloat("Shadow", "GO_LIVE_MIN_AUTO_RATE", fallback=0.80)

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

        for key, value in self.rx_schema.items():
            if value and not IDENT_RE.match(value):
                raise ValueError(f"[RxSchema] {key}={value!r} is not a valid SQL identifier")

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
                CREATE TABLE IF NOT EXISTS shadow_decisions (
                    pending_rx_id INTEGER PRIMARY KEY,
                    decided_at    TEXT NOT NULL,
                    action        TEXT NOT NULL,       -- AUTO | EXCEPTION
                    issues        TEXT NOT NULL,       -- JSON list
                    planned       TEXT NOT NULL        -- JSON: what would be entered
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

    # -- shadow decisions ----------------------------------------------------
    def record_decision(self, pending_rx_id: int, action: str, issues: List[str], planned: Dict[str, Any]) -> None:
        conn = self._connect()
        try:
            conn.execute(
                "INSERT OR IGNORE INTO shadow_decisions(pending_rx_id, decided_at, action, issues, planned) "
                "VALUES (?, ?, ?, ?, ?)",
                (pending_rx_id, dt.datetime.now(dt.timezone.utc).isoformat(), action,
                 json.dumps(issues), json.dumps(planned, default=str)),
            )
            conn.commit()
        finally:
            conn.close()

    def load_decisions(self) -> List[sqlite3.Row]:
        conn = self._connect()
        try:
            return list(conn.execute("SELECT * FROM shadow_decisions ORDER BY pending_rx_id").fetchall())
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
# Automation rules: a row is AUTO only if nothing needed a human judgement call
# ---------------------------------------------------------------------------

def din_check_ok(din: str) -> bool:
    """Health Canada DINs are 8 digits (no public check digit), so only format is checked."""
    return din.isdigit() and len(din) == 8


def validate_row(row: Dict[str, Any]) -> List[str]:
    """Return the reasons this prescription must go to a human (empty list = AUTO)."""
    issues: List[str] = []
    if not row.get("PatientLastName"):
        issues.append("patient not found")
    if not row.get("DocLastName"):
        issues.append("prescriber not found")
    elif not row.get("DoctorLicence"):
        issues.append("prescriber has no licence number")
    if row.get("DrugId") in (None, ""):
        issues.append("no drug")
    try:
        if float(row.get("Qty") or 0) <= 0:
            issues.append("quantity missing or zero")
    except (TypeError, ValueError):
        issues.append("quantity not a number")
    if not str(row.get("SigText") or "").strip():
        issues.append("no sig / directions")
    if not row.get("PrimaryInsurancePlan"):
        issues.append("no insurance plan on file")
    return issues


def planned_entry(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "pat_id": row.get("PatId"),
        "doc_id": row.get("DocId"),
        "drug_id": row.get("DrugId"),
        "qty": row.get("Qty"),
        "refills": row.get("Refills"),
        "sig": row.get("SigText"),
        "plan_id": row.get("PrimaryInsurancePlan"),
        "date_created": row.get("DateCreated"),
    }


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


    def fetch_actual_rx(self, planned: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Find the prescription staff actually entered for a pending Rx (read-only)."""
        r = self.cfg.rx_schema
        cols = ["rx_pat_id", "rx_doc_id", "rx_drug_id", "rx_qty", "rx_refills", "rx_sig"]
        select = ", ".join(f"{r[c]} AS {c}" for c in cols if r[c])
        if not r["rx_table"] or not select:
            return None
        conn = self.ensure()
        cur = conn.cursor()
        try:
            if r["rx_link_col"]:
                cur.execute(f"SELECT TOP 1 {select} FROM {r['rx_table']} WHERE {r['rx_link_col']} = ?",
                            [planned["pending_rx_id"]])
            elif r["rx_pat_id"] and r["rx_drug_id"] and r["rx_created"]:
                cur.execute(
                    f"SELECT TOP 1 {select} FROM {r['rx_table']} "
                    f"WHERE {r['rx_pat_id']} = ? AND {r['rx_drug_id']} = ? AND {r['rx_created']} >= ? "
                    f"ORDER BY {r['rx_created']} ASC",
                    [planned["pat_id"], planned["drug_id"], planned["date_created"]],
                )
            else:
                return None
            row = cur.fetchone()
            if row is None:
                return {}
            return {col[0]: jsonable(val) for col, val in zip(cur.description, row)}
        finally:
            cur.close()

    def schema_report(self, out_path: Path) -> None:
        """Write column names + types (NO row data, so no PHI) for KNOWN_TABLES and
        print a proposed [Schema] block. Safe to share with your developer."""
        conn = self.ensure()
        cur = conn.cursor()
        try:
            cur.execute(
                "SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE "
                "FROM INFORMATION_SCHEMA.COLUMNS ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION"
            )
            cols: Dict[str, List[Tuple[str, str, str]]] = {}
            full: Dict[str, str] = {}
            for schema, table, column, dtype, nullable in cur.fetchall():
                key = table.lower()
                full[key] = f"{schema}.{table}"
                cols.setdefault(key, []).append((column, dtype, nullable))
            cur.execute(
                "SELECT k.TABLE_NAME, k.COLUMN_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS t "
                "JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE k ON t.CONSTRAINT_NAME = k.CONSTRAINT_NAME "
                "WHERE t.CONSTRAINT_TYPE = 'PRIMARY KEY'"
            )
            pks: Dict[str, List[str]] = {}
            for table, column in cur.fetchall():
                pks.setdefault(table.lower(), []).append(column)
        finally:
            cur.close()

        lines: List[str] = [f"PharmFlow schema report | database={self.cfg.db_name} | host={socket.gethostname()}", ""]
        for name in KNOWN_TABLES:
            key = name.lower()
            if key not in cols:
                lines += [f"== {name}: NOT FOUND", ""]
                continue
            pk = ", ".join(pks.get(key, [])) or "(none)"
            lines.append(f"== {full[key]}   PK: {pk}")
            lines += [f"   {c:<28} {t}{'' if n == 'YES' else '  NOT NULL'}" for c, t, n in cols[key]]
            lines.append("")

        def names(table: str) -> List[str]:
            return [c for c, _, _ in cols.get(table.lower(), [])]

        def pick(table: str, *needles: str) -> str:
            cands = names(table)
            # exact matches first (in needle order), then substring matches; very short
            # needles (e.g. "din", "id") only count as exact to avoid false hits like "Pending".
            found = [c for n in needles for c in cands if c.lower() == n]
            found += [c for c in cands if c not in found and any(len(n) > 3 and n in c.lower() for n in needles)]
            if not found:
                return "?"
            return found[0] + ("   # CHECK, also: " + ", ".join(found[1:4]) if len(found) > 1 else "")

        def tbl(name: str) -> str:
            return full.get(name.lower(), f"dbo.{name}")

        pend_pk = pks.get("pendingnewrx", [])
        lines += [
            "---- PROPOSED [Schema] (heuristic - verify every line marked CHECK or ?) ----",
            "[Schema]",
            f"pending_table = {tbl('PendingNewRx')}",
            f"pending_id = {pend_pk[0] if len(pend_pk) == 1 else pick('PendingNewRx', 'pendingrxid', 'id')}",
            f"pending_pat_id = {pick('PendingNewRx', 'patid', 'patientid')}",
            f"pending_doc_id = {pick('PendingNewRx', 'docid', 'doctorid', 'prescriber')}",
            f"pending_drug_id = {pick('PendingNewRx', 'drugid', 'drug', 'din')}",
            f"pending_qty = {pick('PendingNewRx', 'qty', 'quantity')}",
            f"pending_refills = {pick('PendingNewRx', 'refill')}",
            f"pending_sig = {pick('PendingNewRx', 'sig')}",
            f"pending_created = {pick('PendingNewRx', 'datecreated', 'created', 'date')}",
            f"pending_status = {pick('PendingNewRx', 'status')}",
            f"pat_table = {tbl('Pat')}",
            f"pat_id = {pick('Pat', 'patid', 'id')}",
            f"pat_first = {pick('Pat', 'first', 'fname')}",
            f"pat_last = {pick('Pat', 'last', 'lname')}",
            f"pat_dob = {pick('Pat', 'birth', 'dob')}",
            f"addr_table = {tbl('PatAdd')}",
            f"addr_pat_id = {pick('PatAdd', 'patid')}",
            f"addr_line = {pick('PatAdd', 'address1', 'addr1', 'street', 'address')}",
            f"plan_table = {tbl('PatPln')}",
            f"plan_pat_id = {pick('PatPln', 'patid')}",
            f"plan_id = {pick('PatPln', 'planid', 'plan')}",
            f"doc_table = {tbl('Doc')}",
            f"doc_id = {pick('Doc', 'docid', 'id')}",
            f"doc_first = {pick('Doc', 'first', 'fname')}",
            f"doc_last = {pick('Doc', 'last', 'lname')}",
            f"lic_table = {tbl('DocLicence')}",
            f"lic_doc_id = {pick('DocLicence', 'docid')}",
            f"lic_num = {pick('DocLicence', 'licen', 'number', 'num')}",
        ]
        out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        print("\n".join(lines))
        print(f"\nSaved to {out_path}  (column names only - contains no patient data)")

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

        issues = validate_row(row)
        self.store.record_decision(
            pending_id, "EXCEPTION" if issues else "AUTO", issues, planned_entry(row)
        )

        if self.cfg.mode == "SHADOW":
            # IDs only — no patient / doctor names in logs.
            self.log.info(
                "[SHADOW] PendingRxId=%s | would=%s | issues=%s",
                pending_id,
                "EXCEPTION" if issues else "AUTO",
                "; ".join(issues) or "-",
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


def _norm(field: str, value: Any) -> str:
    text = "" if value is None else str(value).strip()
    if field in ("qty", "refills"):
        try:
            return f"{float(text):g}"
        except ValueError:
            return text
    return " ".join(text.upper().split())


def shadow_report(cfg: AgentConfig, out_path: Path) -> int:
    log = setup_logging(cfg.agent_version)
    store = LocalStore(SQLITE_PATH, log)
    decisions = store.load_decisions()
    if not decisions:
        print("No shadow decisions recorded yet. Run `python flow.py` in SHADOW mode first.")
        return 1

    auto = [d for d in decisions if d["action"] == "AUTO"]
    reasons: Dict[str, int] = {}
    for d in decisions:
        for issue in json.loads(d["issues"]):
            reasons[issue] = reasons.get(issue, 0) + 1

    lines = [
        f"PharmFlow shadow report | {dt.datetime.now():%Y-%m-%d %H:%M} | host={socket.gethostname()}",
        "",
        f"Pending prescriptions seen : {len(decisions)}",
        f"  would be AUTOMATIC       : {len(auto)}  ({len(auto) / len(decisions):.1%})",
        f"  would go to a human      : {len(decisions) - len(auto)}",
    ]
    for reason, n in sorted(reasons.items(), key=lambda kv: -kv[1]):
        lines.append(f"      - {reason}: {n}")

    fields = [("pat_id", "rx_pat_id"), ("doc_id", "rx_doc_id"), ("drug_id", "rx_drug_id"),
              ("qty", "rx_qty"), ("refills", "rx_refills"), ("sig", "rx_sig")]
    usable = [(p, a) for p, a in fields if cfg.rx_schema.get(a)]
    verdict_ok = False

    if not cfg.rx_schema["rx_table"] or not usable:
        lines += ["", "No [RxSchema] configured: cannot compare with what staff entered.",
                  "Add rx_table and the rx_* columns (see config.ini.example), then re-run."]
    else:
        db = KrollDB(cfg, log)
        compared = missing = 0
        stats = {p: [0, 0] for p, _ in usable}   # field -> [matches, total]
        examples: List[str] = []
        for d in auto:
            planned = json.loads(d["planned"])
            planned["pending_rx_id"] = d["pending_rx_id"]
            actual = db.fetch_actual_rx(planned)
            if actual is None:
                break
            if not actual:
                missing += 1
                continue
            compared += 1
            for p, a in usable:
                stats[p][1] += 1
                if _norm(p, planned.get(p)) == _norm(p, actual.get(a)):
                    stats[p][0] += 1
                elif len(examples) < 25:
                    examples.append(f"PendingRxId={d['pending_rx_id']} field={p} planned={planned.get(p)!r} actual={actual.get(a)!r}")
        db.close()

        lines += ["", f"Compared against staff entries : {compared} (not yet entered in Kroll: {missing})", "",
                  "Field match rate (automatic decisions only):"]
        worst = 1.0
        for p, _ in usable:
            m, t = stats[p]
            rate = m / t if t else 0.0
            worst = min(worst, rate) if t else worst
            lines.append(f"  {p:<9} {rate:>7.2%}   ({m}/{t})")
        if examples:
            lines += ["", "Mismatch examples (IDs/values only, no names):"] + [f"  {e}" for e in examples]

        auto_rate = len(auto) / len(decisions)
        checks = [
            (compared >= cfg.go_live_min_samples, f"at least {cfg.go_live_min_samples} compared (have {compared})"),
            (worst >= cfg.go_live_min_match, f"every field >= {cfg.go_live_min_match:.1%} (worst {worst:.2%})"),
            (auto_rate >= cfg.go_live_min_auto, f"automatic rate >= {cfg.go_live_min_auto:.0%} (have {auto_rate:.1%})"),
        ]
        verdict_ok = all(ok for ok, _ in checks)
        lines += ["", "GO-LIVE CHECKS"] + [f"  [{'PASS' if ok else 'FAIL'}] {text}" for ok, text in checks]
        lines += ["", "VERDICT: " + ("READY for a supervised pilot" if verdict_ok else "NOT READY - keep shadowing / tweak rules")]
        lines += ["Note: 'sig' differences are often legitimate staff edits - review the examples before tuning."]

    text = "\n".join(lines) + "\n"
    out_path.write_text(text, encoding="utf-8")
    print(text)
    print(f"Saved to {out_path} (no patient names)")
    return 0 if verdict_ok else 3


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="PharmFlow Kroll poller")
    parser.add_argument("--discover", action="store_true", help="list DB tables/columns and exit")
    parser.add_argument("--shadow-report", action="store_true",
                        help="compare shadow decisions with what staff entered; prints go-live verdict")
    parser.add_argument("--schema-report", action="store_true",
                        help="write schema_report.txt (columns of your Kroll tables, no data) and exit")
    parser.add_argument("--test", action="store_true", help="connect, poll once, print counts, exit")
    args = parser.parse_args(argv)

    try:
        cfg = AgentConfig(CONFIG_PATH)
    except Exception as exc:
        print(f"FATAL config error: {exc}", file=sys.stderr)
        return 1

    if args.shadow_report:
        return shadow_report(cfg, BASE_DIR / "shadow_report.txt")

    if args.schema_report:
        logger = setup_logging(cfg.agent_version)
        KrollDB(cfg, logger).schema_report(BASE_DIR / "schema_report.txt")
        return 0

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
