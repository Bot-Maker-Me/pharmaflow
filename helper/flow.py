"""
flow.py — PharmFlow AI local background agent
Polls Kroll PendingNewRx, enriches with patient/doctor data,
and securely syncs structured payloads to the cloud backend.
Designed to run as a Windows tray / service process alongside kroll_tray_helper.py.
"""

from __future__ import annotations

import configparser
import json
import logging
import logging.handlers
import socket
import sqlite3
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

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

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

def setup_logging(agent_version: str) -> logging.Logger:
    """Configure console + daily rotating file logging. Mask secrets."""
    LOG_DIR.mkdir(parents=True, exist_ok=True)

    logger = logging.getLogger("pharmflow")
    logger.setLevel(logging.INFO)
    logger.handlers.clear()

    fmt = logging.Formatter(
        "%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
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

    logger.info(
        "PharmFlow agent starting | version=%s | host=%s",
        agent_version,
        socket.gethostname(),
    )
    return logger


def mask_secret(value: str, visible: int = 2) -> str:
    if not value or len(value) <= visible * 2:
        return "***"
    return value[:visible] + "***" + value[-visible:]


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

class AgentConfig:
    def __init__(self, path: Path):
        if not path.exists():
            raise FileNotFoundError(f"config.ini not found at {path}")

        cp = configparser.ConfigParser()
        cp.read(path, encoding="utf-8")

        self.mode: str = cp.get("Agent", "MODE", fallback="SHADOW").upper()
        self.poll_interval: int = cp.getint(
            "Agent", "POLL_INTERVAL_SEC", fallback=DEFAULT_POLL_INTERVAL
        )
        self.agent_version: str = cp.get("Agent", "AGENT_VERSION", fallback="1.0.0")

        self.db_server: str = cp.get("Database", "SERVER", fallback="localhost")
        self.db_name: str = cp.get("Database", "DATABASE", fallback="Pharmacy")
        self.db_uid: str = cp.get("Database", "UID", fallback="rx")
        self.db_pwd: str = cp.get("Database", "PWD", fallback="")

        self.api_url: str = cp.get("Cloud", "API_URL", fallback="").rstrip("/")
        self.api_key: str = cp.get("Cloud", "API_KEY", fallback="")

        if self.mode not in ("SHADOW", "LIVE"):
            raise ValueError(f"Invalid MODE: {self.mode}. Use SHADOW or LIVE.")

        if not self.db_pwd:
            raise ValueError("Database PWD is empty in config.ini")

        if not self.api_url or not self.api_key:
            raise ValueError("Cloud API_URL / API_KEY missing in config.ini")


# ---------------------------------------------------------------------------
# SQLite state + offline spool
# ---------------------------------------------------------------------------

class LocalStore:
    """Tracks processed PendingRxIds and spools failed cloud payloads."""

    def __init__(self, db_path: Path, logger: logging.Logger):
        self.db_path = db_path
        self.log = logger
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), timeout=30)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_schema(self) -> None:
        with self._connect() as conn:
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
                    last_error    TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_spool_created ON spool(created_at);
                """
            )
            conn.commit()

    def is_processed(self, pending_rx_id: int) -> bool:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT 1 FROM processed WHERE pending_rx_id = ?",
                (pending_rx_id,),
            ).fetchone()
            return row is not None

    def mark_processed(self, pending_rx_id: int) -> None:
        with self._connect() as conn:
            conn.execute(
                "INSERT OR IGNORE INTO processed (pending_rx_id, processed_at) VALUES (?, ?)",
                (pending_rx_id, datetime.now(timezone.utc).isoformat()),
            )
            conn.commit()

    def spool_payload(
        self, pending_rx_id: int, payload: Dict[str, Any], error: str = ""
    ) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO spool (pending_rx_id, payload_json, created_at, attempts, last_error)
                VALUES (?, ?, ?, 0, ?)
                """,
                (
                    pending_rx_id,
                    json.dumps(payload, default=str),
                    datetime.now(timezone.utc).isoformat(),
                    error[:500] if error else None,
                ),
            )
            conn.commit()
        self.log.warning(
            "Spooled payload for PendingRxId=%s (offline or cloud error)", pending_rx_id
        )

    def load_spool(self, limit: int = 50) -> List[sqlite3.Row]:
        with self._connect() as conn:
            return list(
                conn.execute(
                    "SELECT id, pending_rx_id, payload_json, attempts FROM spool ORDER BY id ASC LIMIT ?",
                    (limit,),
                ).fetchall()
            )

    def delete_spool_item(self, spool_id: int) -> None:
        with self._connect() as conn:
            conn.execute("DELETE FROM spool WHERE id = ?", (spool_id,))
            conn.commit()

    def bump_spool_attempt(self, spool_id: int, error: str) -> None:
        with self._connect() as conn:
            conn.execute(
                "UPDATE spool SET attempts = attempts + 1, last_error = ? WHERE id = ?",
                (error[:500], spool_id),
            )
            conn.commit()


# ---------------------------------------------------------------------------
# Kroll SQL connection
# ---------------------------------------------------------------------------

class KrollDB:
    """Read-only connection to local Kroll Pharmacy database with reconnect."""

    def __init__(self, cfg: AgentConfig, logger: logging.Logger):
        self.cfg = cfg
        self.log = logger
        self._conn: Optional[pyodbc.Connection] = None
        self._backoff = 1.0

    def _connection_string(self) -> str:
        return (
            "DRIVER={ODBC Driver 17 for SQL Server};"
            f"SERVER={self.cfg.db_server};"
            f"DATABASE={self.cfg.db_name};"
            f"UID={self.cfg.db_uid};"
            f"PWD={self.cfg.db_pwd};"
            "TrustServerCertificate=yes;"
            f"Connection Timeout={DB_CONNECT_TIMEOUT_SEC};"
            "ApplicationIntent=ReadOnly;"
        )

    def connect(self) -> None:
        if self._conn is not None:
            try:
                self._conn.close()
            except Exception:
                pass
            self._conn = None

        try:
            self._conn = pyodbc.connect(self._connection_string(), autocommit=True)
            self._conn.timeout = 30
            self._backoff = 1.0
            self.log.info(
                "Connected to Kroll SQL | server=%s | db=%s | user=%s",
                self.cfg.db_server,
                self.cfg.db_name,
                self.cfg.db_uid,
            )
        except pyodbc.Error as exc:
            self.log.error("SQL connect failed: %s", exc)
            raise

    def ensure(self) -> pyodbc.Connection:
        if self._conn is None:
            self.connect()
            return self._conn  # type: ignore

        try:
            cur = self._conn.cursor()
            cur.execute("SELECT 1")
            cur.fetchone()
            cur.close()
            return self._conn
        except pyodbc.Error:
            self.log.warning("SQL connection lost — reconnecting…")
            time.sleep(min(self._backoff, MAX_BACKOFF_SEC))
            self._backoff = min(self._backoff * 2, MAX_BACKOFF_SEC)
            self.connect()
            return self._conn  # type: ignore

    def fetch_pending(self) -> List[Dict[str, Any]]:
        """
        Poll PendingNewRx and join patient / doctor / licence data.
        """
        sql = """
        SELECT TOP 50
            p.PendingRxId,
            p.PatId,
            pt.FirstNm       AS PatientFirstName,
            pt.LastNm        AS PatientLastName,
            pt.BirthDate     AS PatientDOB,
            pa.Address1      AS PatientAddress,
            pp.PlanId        AS PrimaryInsurancePlan,
            p.DocId,
            d.FirstNm        AS DocFirstName,
            d.LastNm         AS DocLastName,
            dl.LicenceNum    AS DoctorLicence,
            p.DrugId,
            p.Qty,
            p.Refills,
            p.SigText,
            p.DateCreated
        FROM dbo.PendingNewRx p WITH (NOLOCK)
        LEFT JOIN dbo.Pat pt WITH (NOLOCK)
            ON p.PatId = pt.PatId
        LEFT JOIN dbo.PatAdd pa WITH (NOLOCK)
            ON pt.PatId = pa.PatId AND pa.IsPrimary = 1
        LEFT JOIN dbo.PatPln pp WITH (NOLOCK)
            ON pt.PatId = pp.PatId AND pp.SeqNum = 1
        LEFT JOIN dbo.Doc d WITH (NOLOCK)
            ON p.DocId = d.DocId
        LEFT JOIN dbo.DocLicence dl WITH (NOLOCK)
            ON d.DocId = dl.DocId
        WHERE p.Status = 'New'
        ORDER BY p.DateCreated ASC;
        """
        conn = self.ensure()
        cur = conn.cursor()
        try:
            cur.execute(sql)
            columns = [col[0] for col in cur.description]
            rows = []
            for row in cur.fetchall():
                item = {}
                for col, val in zip(columns, row):
                    if isinstance(val, datetime):
                        item[col] = val.isoformat()
                    else:
                        item[col] = val
                rows.append(item)
            return rows
        finally:
            cur.close()

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

    def push(self, payload: Dict[str, Any]) -> Tuple[bool, str]:
        try:
            resp = self.session.post(
                self.cfg.api_url,
                json=payload,
                timeout=CLOUD_TIMEOUT_SEC,
            )
            if 200 <= resp.status_code < 300:
                return True, ""
            return False, f"HTTP {resp.status_code}: {resp.text[:300]}"
        except requests.RequestException as exc:
            return False, str(exc)


# ---------------------------------------------------------------------------
# Payload builder
# ---------------------------------------------------------------------------

def build_payload(row: Dict[str, Any], cfg: AgentConfig) -> Dict[str, Any]:
    return {
        "schema_version": "1.0",
        "mode": cfg.mode,
        "agent": {
            "version": cfg.agent_version,
            "hostname": socket.gethostname(),
            "timestamp_utc": datetime.now(timezone.utc).isoformat(),
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
# Main agent loop
# ---------------------------------------------------------------------------

class PharmFlowAgent:
    def __init__(self, cfg: AgentConfig):
        self.cfg = cfg
        self.log = setup_logging(cfg.agent_version)
        self.store = LocalStore(SQLITE_PATH, self.log)
        self.db = KrollDB(cfg, self.log)
        self.cloud = CloudClient(cfg, self.log)
        self._seen: Set[int] = set()
        self._running = True

        self.log.info(
            "Config loaded | mode=%s | poll=%ss | db_user=%s | api=%s",
            cfg.mode,
            cfg.poll_interval,
            cfg.db_uid,
            cfg.api_url,
        )
        self.log.info("DB password (masked)=%s", mask_secret(cfg.db_pwd))

    def _process_row(self, row: Dict[str, Any]) -> None:
        pending_id = row.get("PendingRxId")
        if pending_id is None:
            return

        pending_id = int(pending_id)

        if pending_id in self._seen or self.store.is_processed(pending_id):
            return

        payload = build_payload(row, self.cfg)

        if self.cfg.mode == "SHADOW":
            self.log.info(
                "[SHADOW] PendingRxId=%s | patient=%s %s | doc=%s %s | drug=%s",
                pending_id,
                row.get("PatientFirstName"),
                row.get("PatientLastName"),
                row.get("DocFirstName"),
                row.get("DocLastName"),
                row.get("DrugId"),
            )
            self.store.mark_processed(pending_id)
            self._seen.add(pending_id)
            return

        ok, err = self.cloud.push(payload)
        if ok:
            self.log.info("Synced PendingRxId=%s to cloud", pending_id)
            self.store.mark_processed(pending_id)
            self._seen.add(pending_id)
        else:
            self.log.error("Cloud push failed for PendingRxId=%s: %s", pending_id, err)
            self.store.spool_payload(pending_id, payload, err)
            self.store.mark_processed(pending_id)
            self._seen.add(pending_id)

    def _flush_spool(self) -> None:
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

            ok, err = self.cloud.push(payload)
            if ok:
                self.store.delete_spool_item(item["id"])
                self.log.info(
                    "Spool item id=%s (PendingRxId=%s) uploaded",
                    item["id"],
                    item["pending_rx_id"],
                )
            else:
                self.store.bump_spool_attempt(item["id"], err)
                self.log.warning("Spool retry failed id=%s: %s", item["id"], err)
                break

    def run_once(self) -> None:
        try:
            rows = self.db.fetch_pending()
            if rows:
                self.log.info("Polled %d pending row(s)", len(rows))
            for row in rows:
                self._process_row(row)
            self._flush_spool()
        except pyodbc.Error as exc:
            self.log.error("SQL error during poll: %s", exc)
            self.db.close()
        except Exception:
            self.log.error("Unexpected error in run_once:\n%s", traceback.format_exc())

    def run(self) -> None:
        self.log.info("Entering poll loop (Ctrl+C to stop)")
        try:
            while self._running:
                started = time.monotonic()
                self.run_once()
                elapsed = time.monotonic() - started
                sleep_for = max(0.5, self.cfg.poll_interval - elapsed)
                time.sleep(sleep_for)
        except KeyboardInterrupt:
            self.log.info("Shutdown requested")
        finally:
            self.db.close()
            self.log.info("Agent stopped")


def main() -> int:
    try:
        cfg = AgentConfig(CONFIG_PATH)
    except Exception as exc:
        print(f"FATAL config error: {exc}", file=sys.stderr)
        return 1

    agent = PharmFlowAgent(cfg)
    agent.run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
