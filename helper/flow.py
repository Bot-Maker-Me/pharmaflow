"""
flow.py - PharmFlow AI: the ONE program that runs on the pharmacy server PC.

Everything the server side needs lives in this file:
  * Kroll SQL poller (READ-ONLY): PendingNewRx + patient / prescriber / drug / plan details
  * Fax image reader: Kroll ScriptImage -> compressed JPEG -> cloud OCR (Vercel /api/agent-rx)
  * Cloud sync: offline spool, heartbeat, shadow comparison, DIN hints
  * Learning (permanent, see learning.db):
      1. background  - learns the usual sig per drug / prescriber from finished Rx rows in Kroll SQL
      2. corrections - when staff change what PharmFlow planned (e.g. a wrong sig), the right value is
                       remembered and used next time; if staff undo an applied lesson it is dropped

Commands
--------
  python flow.py                    run the agent (SHADOW or LIVE per config.ini)
  python flow.py --test             one connection + one poll, then exit
  python flow.py --gen-key          print a new random agent API key
  python flow.py --learning-report  show what has been learned so far
  python flow.py --discover         list tables/columns in the Kroll DB (fix [Schema] mapping)
  python flow.py --schema-report    write schema_report.txt (columns only, no PHI)
  python flow.py --find-images      find which table holds the fax images
  python flow.py --profile TABLE    per-column fill counts (no values)
  python flow.py --shadow-report    compare what the agent WOULD have done with what staff entered
  python flow.py --skip-backlog     ignore rows already pending; process only new ones

Design notes
------------
* Only SELECT statements are ever issued against Kroll.
* A watermark (highest PendingRxId seen) is kept in SQLite (shadow_queue.db).
* Patient names / DOBs / addresses are NEVER written to the log file.
* Cloud pushes are idempotent (server de-duplicates on pending_rx_id + store), so retries are safe.
* Learning never rewrites quantity, refills, drug or DIN - only a sig, only for the same drug, and only
  after SIG_APPLY_MIN_HITS identical staff fixes (0 = hints only).
"""

from __future__ import annotations

import argparse
import base64
import configparser
import datetime as dt
import decimal
import gzip
import io
import json
import logging
import logging.handlers
import re
import secrets
import socket
import sqlite3
import sys
import time
import traceback
import zlib
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
LEARN_PATH = BASE_DIR / "learning.db"      # permanent memory: never reset with the queue
LOG_DIR = BASE_DIR / "logs"

DEFAULT_POLL_INTERVAL = 5
MAX_BACKOFF_SEC = 60
CLOUD_TIMEOUT_SEC = 15
OCR_TIMEOUT_SEC = 90               # fax OCR runs server-side and can take a while
DB_CONNECT_TIMEOUT_SEC = 10
BATCH_SIZE = 50
HEARTBEAT_EVERY_SEC = 300
AGENT_CODE_VERSION = "1.3.0"     # reported in heartbeats so the dashboard shows which code is running
RECHECK_EVERY_SEC = 60            # how often rows still being filled in by staff are re-read
COMPARE_EVERY_SEC = 600          # how often SHADOW looks for staff entries
COMPARE_GIVE_UP_DAYS = 3         # an AUTO decision never entered by staff after this long is reported as such
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
    "plan_deleted_col": "",           # e.g. Deleted -> only plans where Deleted = 0; empty = no filter
    "doc_table": "dbo.Doc",
    "doc_id": "DocId",
    "doc_first": "FirstNm",
    "doc_last": "LastNm",
    "lic_table": "dbo.DocLicence",
    "lic_doc_id": "DocId",
    "lic_num": "LicenceNum",
    "pending_script_image_id": "",     # e.g. ScriptImageId; empty = no fax image / OCR
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
        # NEW_ONLY: on the very first run, ignore everything already in the pending table.
        self.start_mode: str = cp.get("Agent", "START_MODE", fallback="NEW_ONLY").strip().upper()
        # Self-pay patients legitimately have no plan; only treat it as an exception if you ask for that.
        self.require_plan: bool = cp.getboolean("Agent", "REQUIRE_PLAN", fallback=False)
        # Kroll creates a pending row first and fills patient / prescriber / drug / quantity later
        # (or never). Rows missing any of those are tracked as "incomplete" and re-read until they are
        # filled in, for at most this many hours; then they are judged as they are. 0 = judge at once.
        self.wait_hours: float = max(0.0, cp.getfloat("Agent", "WAIT_HOURS", fallback=24.0))

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

        self.auto_learn: bool = cp.getboolean("Shadow", "AUTO_LEARN", fallback=True)

        # [Learning] two modes, both stored permanently in learning.db (and mirrored to the cloud):
        #   1. SQL history   - reads finished Rx rows in the background to learn the usual sig per drug / prescriber
        #   2. staff fixes   - when staff change what PharmFlow planned, remember the right value
        self.learn_enabled: bool = cp.getboolean("Learning", "ENABLED", fallback=True)
        # A learned sig correction is applied automatically only after staff made the SAME fix this many times
        # for the SAME drug. 0 = never rewrite, only show it as a hint.
        self.sig_apply_min_hits: int = cp.getint("Learning", "SIG_APPLY_MIN_HITS", fallback=2)
        self.learn_sql_every: int = cp.getint("Learning", "SQL_LEARN_EVERY_SEC", fallback=900)
        self.learn_backfill_days: int = cp.getint("Learning", "SQL_BACKFILL_DAYS", fallback=365)
        self.suggest_min_samples: int = cp.getint("Learning", "SUGGEST_MIN_SAMPLES", fallback=5)
        self.suggest_min_share: float = cp.getfloat("Learning", "SUGGEST_MIN_SHARE", fallback=0.6)

        # Where Kroll keeps the fax image bytes (auto-detected when blank).
        self.image_schema: Dict[str, str] = {"image_table": "", "image_id": "", "image_data": ""}
        if cp.has_section("Schema"):
            for key in self.image_schema:
                self.image_schema[key] = cp.get("Schema", key, fallback="").strip()
        for key, value in self.image_schema.items():
            if value and not IDENT_RE.match(value):
                raise ValueError(f"[Schema] {key}={value!r} is not a valid SQL identifier")

        # Kroll's drug table (DIN lookup). Blank = auto-detect dbo.Drg / dbo.Drug on first use.
        self.drug_schema: Dict[str, str] = {"drug_table": "", "drug_id": "", "drug_din": "", "drug_name": "", "drug_name2": "", "drug_strength": ""}
        if cp.has_section("Schema"):
            for key in self.drug_schema:
                self.drug_schema[key] = cp.get("Schema", key, fallback="").strip()
        for key, value in self.drug_schema.items():
            if value and not IDENT_RE.match(value):
                raise ValueError(f"[Schema] {key}={value!r} is not a valid SQL identifier")

        # SHADOW also records to Supabase (decisions + comparisons) when the cloud is configured.
        self.cloud_enabled: bool = bool(self.api_url and self.api_key and "CHANGE_ME" not in self.api_key)

        if self.start_mode not in ("NEW_ONLY", "ALL"):
            raise ValueError("START_MODE must be NEW_ONLY or ALL")
        if self.mode not in ("SHADOW", "LIVE"):
            raise ValueError(f"Invalid MODE: {self.mode}. Use SHADOW or LIVE.")
        if self.poll_interval < 1:
            raise ValueError("POLL_INTERVAL_SEC must be >= 1")
        if not self.db_pwd or "CHANGE_ME" in self.db_pwd:
            raise ValueError("Database PWD is empty / still the placeholder in config.ini")
        if self.mode == "LIVE":
            if not self.api_url or not self.api_key or "CHANGE_ME" in self.api_key:
                raise ValueError("LIVE mode needs Cloud API_URL and a real API_KEY in config.ini")
        if self.cloud_enabled and not self.api_url.lower().startswith("https://"):
            raise ValueError("Cloud API_URL must be https:// (patient data is sent over it)")

        for key, value in self.rx_schema.items():
            if value and not IDENT_RE.match(value):
                raise ValueError(f"[RxSchema] {key}={value!r} is not a valid SQL identifier")

        for key, value in self.schema.items():
            is_optional = key.endswith("_col") or key in ("pending_status_value", "pending_script_image_id")
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
                CREATE TABLE IF NOT EXISTS shadow_compared (
                    pending_rx_id INTEGER PRIMARY KEY,
                    compared_at   TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS incomplete (
                    pending_rx_id INTEGER PRIMARY KEY,
                    first_seen    TEXT NOT NULL
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

    def has_watermark(self) -> bool:
        conn = self._connect()
        try:
            return conn.execute("SELECT 1 FROM meta WHERE key='watermark'").fetchone() is not None
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

    # -- incomplete rows (waiting for Kroll staff to fill them in) -----------
    def add_incomplete(self, pending_rx_id: int) -> None:
        conn = self._connect()
        try:
            conn.execute("INSERT OR IGNORE INTO incomplete(pending_rx_id, first_seen) VALUES (?, ?)",
                         (pending_rx_id, dt.datetime.now(dt.timezone.utc).isoformat()))
            conn.commit()
        finally:
            conn.close()

    def load_incomplete(self, limit: int = 100) -> List[Tuple[int, str]]:
        conn = self._connect()
        try:
            return [(int(r["pending_rx_id"]), r["first_seen"]) for r in conn.execute(
                "SELECT pending_rx_id, first_seen FROM incomplete ORDER BY first_seen ASC LIMIT ?", (limit,))]
        finally:
            conn.close()

    def drop_incomplete(self, pending_rx_id: int) -> None:
        conn = self._connect()
        try:
            conn.execute("DELETE FROM incomplete WHERE pending_rx_id = ?", (pending_rx_id,))
            conn.commit()
        finally:
            conn.close()

    def count_incomplete(self) -> int:
        conn = self._connect()
        try:
            return int(conn.execute("SELECT COUNT(*) FROM incomplete").fetchone()[0])
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

    def load_uncompared(self, limit: int = 100) -> List[sqlite3.Row]:
        conn = self._connect()
        try:
            return list(conn.execute(
                "SELECT d.* FROM shadow_decisions d "
                "LEFT JOIN shadow_compared c ON c.pending_rx_id = d.pending_rx_id "
                "WHERE d.action = 'AUTO' AND c.pending_rx_id IS NULL ORDER BY d.pending_rx_id LIMIT ?",
                (limit,),
            ).fetchall())
        finally:
            conn.close()

    def mark_compared(self, pending_rx_id: int) -> None:
        conn = self._connect()
        try:
            conn.execute("INSERT OR IGNORE INTO shadow_compared VALUES (?, ?)",
                         (pending_rx_id, dt.datetime.now(dt.timezone.utc).isoformat()))
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


def validate_row(row: Dict[str, Any], require_plan: bool = False) -> List[str]:
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
    if require_plan and not row.get("PrimaryInsurancePlan"):
        issues.append("no insurance plan on file")
    return issues


def _present(value: Any) -> bool:
    return value not in (None, "", 0, "0")


def core_complete(row: Dict[str, Any]) -> bool:
    """Patient, prescriber, drug and a positive quantity are all filled in."""
    try:
        qty_ok = float(row.get("Qty") or 0) > 0
    except (TypeError, ValueError):
        qty_ok = False
    return _present(row.get("PatId")) and _present(row.get("DocId")) and _present(row.get("DrugId")) and qty_ok


def is_blank_stub(row: Dict[str, Any]) -> bool:
    """No patient and no drug at all: an empty placeholder, not a prescription."""
    return not _present(row.get("PatId")) and not _present(row.get("DrugId"))


def planned_entry(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "pat_id": row.get("PatId"),
        "doc_id": row.get("DocId"),
        "drug_id": row.get("DrugId"),
        "qty": row.get("Qty"),
        "refills": row.get("Refills"),
        "sig": row.get("SigText"),
        "sig_raw": row.get("_sig_raw", row.get("SigText")),
        "learned_applied": bool(row.get("_learned_applied")),
        "plan_id": row.get("PrimaryInsurancePlan"),
        "date_created": row.get("DateCreated"),
    }



# ---------------------------------------------------------------------------
# Fax image reader (Kroll ScriptImage / ScriptImageContent -> compressed JPEG)
# ---------------------------------------------------------------------------

img_log = logging.getLogger("pharmflow.images")

IMAGE_TABLE_CANDIDATES = [
    ("dbo.RxScriptImage", "Id", "ImageData"),
    ("dbo.RxScriptImage", "ID", "ImageData"),
    ("dbo.ScriptImage", "Id", "ImageData"),
    ("dbo.ScriptImage", "ID", "Data"),
    ("dbo.PendingRxImage", "Id", "ImageData"),
    ("dbo.Image", "Id", "ImageData"),
]


def _pdf_first_page(raw: bytes):
    """Kroll sometimes stores the fax as a PDF blob. Needs `pip install pypdfium2` (optional)."""
    try:
        import pypdfium2 as pdfium  # type: ignore
    except ImportError:
        img_log.warning("Script image is a PDF; install pypdfium2 (pip install pypdfium2) to read it")
        return None
    try:
        pdf = pdfium.PdfDocument(raw)
        return pdf[0].render(scale=2.2).to_pil()
    except Exception as exc:
        img_log.warning("PDF render failed: %s", exc)
        return None


def _try_pil_jpeg(raw: bytes, max_side: int = 1600, quality: int = 72) -> Optional[bytes]:
    try:
        from PIL import Image  # type: ignore
    except ImportError:
        return None
    try:
        if raw[:4] == b"%PDF":
            img = _pdf_first_page(raw)
            if img is None:
                return None
        else:
            img = Image.open(io.BytesIO(raw))  # multi-page TIFF: first page
        img = img.convert("RGB")
        w, h = img.size
        scale = min(1.0, max_side / max(w, h))
        if scale < 1.0:
            img = img.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=quality, optimize=True)
        return out.getvalue()
    except Exception as exc:
        img_log.warning("PIL compress failed: %s", exc)
        return None


def bytes_to_data_url(raw: bytes, max_b64_chars: int = 2_800_000) -> Optional[str]:
    if not raw:
        return None
    jpeg = _try_pil_jpeg(raw)
    if jpeg is None:
        if raw[:3] == b"\xff\xd8\xff":
            jpeg = raw
        else:
            img_log.warning("No PIL and not JPEG — cannot attach ScriptImage (%d bytes)", len(raw))
            return None
    b64 = base64.b64encode(jpeg).decode("ascii")
    if len(b64) > max_b64_chars:
        jpeg2 = _try_pil_jpeg(raw, max_side=1200, quality=55)
        if jpeg2:
            b64 = base64.b64encode(jpeg2).decode("ascii")
        if len(b64) > max_b64_chars:
            img_log.warning("ScriptImage still too large after compress (%d b64 chars) — skip", len(b64))
            return None
    return f"data:image/jpeg;base64,{b64}"


_AUTO: Dict[str, Any] = {"hit": None, "warned": False}
_MAGIC = (b"\xff\xd8\xff", b"\x89PNG", b"II*\x00", b"MM\x00*", b"%PDF", b"GIF8")
_GOOD = ("image", "scan", "script", "fax")
_OK = ("doc", "pic", "attach", "rx")
_BAD = ("sign", "logo", "photo", "audit", "log", "thumb", "icon", "label", "avatar")


def _q(name: str) -> str:
    return "[" + str(name).replace("]", "]]") + "]"


def _score(*names: str) -> int:
    text = " ".join(names).lower()
    return 3 * sum(k in text for k in _GOOD) + sum(k in text for k in _OK) - 4 * sum(k in text for k in _BAD)


def _looks_like_image(blob: bytes) -> bool:
    return len(blob) >= 200 and any(blob.startswith(m) for m in _MAGIC)


def binary_candidates(conn):
    """[(score, table, data_col, [id cols])] for every base table with a binary column, best first."""
    cur = conn.cursor()
    try:
        cur.execute("SELECT c.TABLE_SCHEMA, c.TABLE_NAME, c.COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS c "
                    "JOIN INFORMATION_SCHEMA.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME "
                    "AND t.TABLE_TYPE = 'BASE TABLE' WHERE c.DATA_TYPE IN ('varbinary', 'binary', 'image')")
        bins = cur.fetchall()
        out = []
        for schema, table, col in bins:
            cur.execute("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? "
                        "ORDER BY ORDINAL_POSITION", (schema, table))
            cols = [r[0] for r in cur.fetchall()]
            upper = {c.upper(): c for c in cols}
            ids = [upper[k] for k in ("ID", f"{table}ID".upper(), "SCRIPTIMAGEID", "IMAGEID", "DOCUMENTID", "DOCID") if k in upper]
            if cols and cols[0] not in ids:
                ids.append(cols[0])
            out.append((_score(table, col), f"{schema}.{table}", col, ids[:3]))
        out.sort(key=lambda x: (-x[0], x[1]))
        return out
    finally:
        cur.close()


def _probe(conn, table: str, id_col: str, data_col: str, image_id: Any) -> Optional[bytes]:
    schema, _, name = table.partition(".")
    cur = conn.cursor()
    try:
        cur.execute(f"SELECT TOP 1 {_q(data_col)} FROM {_q(schema)}.{_q(name)} WITH (NOLOCK) WHERE {_q(id_col)} = ?", (image_id,))
        row = cur.fetchone()
        if not row or row[0] is None:
            return None
        blob = bytes(row[0].tobytes() if isinstance(row[0], memoryview) else row[0])
        return blob if _looks_like_image(blob) else None
    except Exception:
        return None
    finally:
        cur.close()


def auto_find(conn, image_id: Any):
    """Find the table holding this ScriptImageId. Only returns a result when exactly ONE plausible table
    (name mentions image/scan/script/fax) has it: a wrong guess would attach another patient's image."""
    hits = []
    for score, table, data_col, ids in binary_candidates(conn):
        if score < 3:
            continue
        for id_col in ids:
            blob = _probe(conn, table, id_col, data_col, image_id)
            if blob:
                hits.append((table, id_col, data_col, blob))
                break
    if len(hits) == 1:
        return hits[0]
    if hits and not _AUTO["warned"]:
        _AUTO["warned"] = True
        img_log.warning("Several tables hold ScriptImageId=%s (%s): set image_table/image_id/image_data in [Schema]. "
                    "Run: python flow.py --find-images", image_id, ", ".join(h[0] for h in hits))
    return None


def find_image_source(conn, image_ids):
    """Diagnostic for `flow.py --find-images`: test real ids against every binary column and report."""
    print("\nBinary columns in this database (best match first):")
    cands = binary_candidates(conn)
    for score, table, col, ids in cands:
        print(f"  score {score:>2}  {table}.{col}   id columns tried: {', '.join(ids)}")
    print()
    found = False
    for image_id in image_ids:
        for score, table, data_col, ids in cands:
            for id_col in ids:
                blob = _probe(conn, table, id_col, data_col, image_id)
                if blob:
                    kind = "JPEG" if blob[:3] == b"\xff\xd8\xff" else "PNG" if blob[:4] == b"\x89PNG" else \
                        "TIFF" if blob[:2] in (b"II", b"MM") else "PDF" if blob[:4] == b"%PDF" else "image"
                    print(f"  ScriptImageId {image_id}: FOUND in {table}  id={id_col}  data={data_col}  ({len(blob):,} bytes, {kind}, score {score})")
                    found = True
                    break
    if found:
        print("\nPut the best match in config.ini under [Schema]:\n  image_table = <table>\n  image_id = <id>\n  image_data = <data>")
    else:
        print("  None of the ids matched an image. The fax may be stored under a different key; send me the list above.")


def _decode_content(blob: bytes, compression: Any = None) -> bytes:
    """ScriptImageContent.Content may be compressed (ContentCompressionType). Sniff the real format."""
    import gzip
    import zlib
    if blob[:4] in _MAGIC or blob[:3] == b"\xff\xd8\xff":
        return blob
    for fn in (zlib.decompress, gzip.decompress, lambda b: zlib.decompress(b, -15), lambda b: zlib.decompress(b[4:])):
        try:
            out = fn(blob)
            if out[:4] in _MAGIC or out[:3] == b"\xff\xd8\xff":
                return out
        except Exception:
            continue
    img_log.warning("ScriptImageContent not recognised (compression=%s, first bytes=%s)", compression, blob[:8].hex())
    return blob


def _kroll_native(conn, image_id: Any) -> Optional[bytes]:
    """Kroll layout: PendingNewRx.ScriptImageId -> dbo.ScriptImage.Id -> ScriptImageContentId -> dbo.ScriptImageContent."""
    queries = (
        "SELECT TOP 1 c.Content, c.ContentCompressionType FROM dbo.ScriptImage s WITH (NOLOCK) "
        "JOIN dbo.ScriptImageContent c WITH (NOLOCK) ON c.ID = s.ScriptImageContentId WHERE s.Id = ?",
        "SELECT TOP 1 Content, ContentCompressionType FROM dbo.ScriptImageContent WITH (NOLOCK) WHERE ID = ?",
    )
    for sql in queries:
        try:
            cur = conn.cursor()
            try:
                cur.execute(sql, (image_id,))
                row = cur.fetchone()
            finally:
                cur.close()
        except Exception as exc:
            img_log.debug("Kroll native image query failed: %s", exc)
            continue
        if row and row[0] is not None:
            blob = bytes(row[0])
            if len(blob) >= 32:
                out = _decode_content(blob, row[1])
                img_log.info("Loaded script image id=%s from dbo.ScriptImageContent (%d bytes, compression=%s)",
                         image_id, len(out), row[1])
                return out
    return None


def fetch_image_bytes(conn, image_id: Any, schema: Dict[str, str]) -> Optional[bytes]:
    if image_id is None or image_id == "" or image_id == 0:
        return None
    if not (schema.get("image_table") or "").strip():
        native = _kroll_native(conn, image_id)
        if native:
            return native
    table = (schema.get("image_table") or "").strip()
    id_col = (schema.get("image_id") or "Id").strip()
    data_col = (schema.get("image_data") or "ImageData").strip()
    candidates = []
    if table:
        candidates.append((table, id_col, data_col))
    elif _AUTO["hit"]:
        candidates.append(_AUTO["hit"])
    candidates.extend(IMAGE_TABLE_CANDIDATES)
    cur = conn.cursor()
    for tbl, ic, dc in candidates:
        sql = f"SELECT TOP 1 {dc} FROM {tbl} WITH (NOLOCK) WHERE {ic} = ?"
        try:
            cur.execute(sql, (image_id,))
            row = cur.fetchone()
            if not row or row[0] is None:
                continue
            blob = row[0]
            if isinstance(blob, memoryview):
                blob = blob.tobytes()
            elif not isinstance(blob, (bytes, bytearray)):
                blob = bytes(blob)
            if len(blob) < 32:
                continue
            img_log.info("Loaded script image id=%s from %s (%d bytes)", image_id, tbl, len(blob))
            return bytes(blob)
        except Exception as exc:
            img_log.debug("Image probe %s failed: %s", tbl, exc)
            continue
    if not table and not _AUTO["hit"]:
        found = auto_find(conn, image_id)
        if found:
            _AUTO["hit"] = found[:3]
            img_log.info("Auto-detected the fax image table: %s (id=%s, data=%s). Put these in [Schema] "
                     "(image_table / image_id / image_data) to make it permanent.", *found[:3])
            return found[3]
    img_log.info("No script image bytes for id=%s (table missing or empty)", image_id)
    return None


def attach_page_image(row: Dict[str, Any], conn, schema: Dict[str, str]) -> Dict[str, Any]:
    image_id = row.get("ScriptImageId") or row.get("script_image_id")
    raw = fetch_image_bytes(conn, image_id, schema)
    if not raw:
        return row
    url = bytes_to_data_url(raw)
    if not url:
        return row
    out = dict(row)
    out["page_image_data_url"] = url
    out["script_image_id"] = image_id
    return out


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

    def _build_query(self, where: Optional[str] = None, top: int = BATCH_SIZE, with_status: bool = True) -> str:
        s = self.cfg.schema

        primary = f"AND a.{s['addr_primary_col']} = 1" if s["addr_primary_col"] else ""
        plan_order = f"ORDER BY pp.{s['plan_seq_col']} ASC" if s["plan_seq_col"] else ""
        plan_live = f"AND (pp.{s['plan_deleted_col']} = 0 OR pp.{s['plan_deleted_col']} IS NULL)" if s["plan_deleted_col"] else ""
        status = (
            f"AND p.{s['pending_status']} = ?"
            if with_status and s["pending_status"] and s["pending_status_value"]
            else ""
        )
        where = where or f"p.{s['pending_id']} > ?"
        image_col = (f",\n            p.{s['pending_script_image_id']} AS ScriptImageId"
                     if s.get('pending_script_image_id') else "")

        # OUTER APPLY TOP 1: exactly one row per pending Rx even if a patient has
        # several addresses / plans or a doctor several licences (a plain LEFT JOIN
        # would duplicate rows and break de-duplication).
        return f"""
        SELECT TOP {top}
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
            p.{s['pending_created']} AS DateCreated{image_col}
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
            {plan_live}
            {plan_order}
        ) pp
        LEFT JOIN {s['doc_table']} d
            ON p.{s['pending_doc_id']} = d.{s['doc_id']}
        OUTER APPLY (
            SELECT TOP 1 l.{s['lic_num']}
            FROM {s['lic_table']} l
            WHERE l.{s['lic_doc_id']} = d.{s['doc_id']}
        ) dl
        WHERE {where}
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
            try:
                cur.execute(self._sql, params)
            except pyodbc.Error as exc:
                if s.get("pending_script_image_id") and "invalid column name" in str(exc).lower():
                    self.log.warning("Column %s not found in %s - fax OCR disabled (SQL data still syncs)",
                                     s["pending_script_image_id"], s["pending_table"])
                    s["pending_script_image_id"] = ""
                    self._sql = self._build_query()
                    cur.execute(self._sql, params)
                else:
                    raise
            columns = [col[0] for col in cur.description]
            return [
                {col: jsonable(val) for col, val in zip(columns, row)}
                for row in cur.fetchall()
            ]
        finally:
            cur.close()

    # ---- DIN lookup in Kroll's own drug table (read-only SELECTs, parameterised) ----------------------

    _DRUG_TABLES = ("Drg", "Drug", "DrugMaster", "Drugs")
    _NOISE = {"mg", "mcg", "ml", "oral", "capsule", "capsules", "cap", "caps", "tablet", "tablets", "tab", "tabs",
              "hcl", "hydrochloride", "sodium", "potassium", "calcium", "sulfate", "sulphate", "maleate",
              "tartrate", "besylate", "succinate", "and", "the", "of"}

    @staticmethod
    def _din8(value: Any) -> str:
        digits = re.sub(r"\D", "", str(value or ""))
        if len(digits) == 7:
            digits = digits.zfill(8)
        return digits if len(digits) == 8 and digits != "00000000" else ""

    def _resolve_drug_schema(self) -> Optional[Dict[str, str]]:
        cached = getattr(self, "_drug", None)
        if cached is not None:
            return cached or None
        self._drug = False
        ds = dict(self.cfg.drug_schema)
        try:
            cur = self.ensure().cursor()
            try:
                if not (ds["drug_table"] and ds["drug_id"] and ds["drug_din"]):
                    for cand in self._DRUG_TABLES:
                        cur.execute("SELECT TABLE_SCHEMA, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = ?", (cand,))
                        found = cur.fetchall()
                        if not found:
                            continue
                        cols = {r[1].upper(): r[1] for r in found}
                        idc = next((cols[c] for c in ("ID", "DRGID", "DRUGID") if c in cols), None)
                        dinc = next((cols[c] for c in ("DIN", "DINNUM", "DINNUMBER", "DRUGDIN") if c in cols), None) \
                            or next((v for k, v in cols.items() if k.startswith("DIN")), None)
                        namec = next((cols[c] for c in ("NAME", "DRUGNAME", "DRGNAME", "DESCRIPTION", "DESCR", "BRANDNAME", "LABELNAME") if c in cols), None)
                        name2 = cols.get("GENERICNAME", "") if (namec or "").upper() == "BRANDNAME" else ""
                        if idc and dinc:
                            ds = {"drug_table": f"{found[0][0]}.{cand}", "drug_id": idc, "drug_din": dinc,
                                  "drug_name": ds["drug_name"] or namec or "",
                                  "drug_name2": ds.get("drug_name2") or name2,
                                  "drug_strength": ds.get("drug_strength") or cols.get("STRENGTH", "")}
                            self.log.info("Kroll drug table detected: %s (id=%s, din=%s, name=%s)",
                                          ds["drug_table"], idc, dinc, ds["drug_name"] or "-")
                            break
            finally:
                cur.close()
        except Exception as exc:
            self.log.warning("Drug table detection failed: %s", exc)
        if ds["drug_table"] and ds["drug_id"] and ds["drug_din"] and all(
            IDENT_RE.match(v) or not v for v in ds.values()
        ):
            self._drug = ds
            return ds
        self.log.info("No Kroll drug table with a DIN column found - set drug_table/drug_id/drug_din in [Schema] "
                      "(python flow.py --discover). Health Canada lookup still runs in the cloud.")
        return None

    def drug_by_id(self, drug_id: Any) -> Optional[Dict[str, str]]:
        """DIN + name of the drug Kroll has on this pending Rx (DrugId), or None."""
        ds = self._resolve_drug_schema()
        if not ds or drug_id in (None, "", 0):
            return None
        if ds["drug_name"] and ds.get("drug_name2"):
            name_sel = f", COALESCE(NULLIF([{ds['drug_name2']}], ''), [{ds['drug_name']}])"
        else:
            name_sel = f", [{ds['drug_name']}]" if ds["drug_name"] else ", NULL"
        try:
            cur = self.ensure().cursor()
            try:
                cur.execute(f"SELECT TOP 1 [{ds['drug_din']}]{name_sel} FROM {ds['drug_table']} WITH (NOLOCK) "
                            f"WHERE [{ds['drug_id']}] = ?", (drug_id,))
                row = cur.fetchone()
            finally:
                cur.close()
        except Exception as exc:
            self.log.debug("drug_by_id failed: %s", exc)
            return None
        if not row:
            return None
        din = self._din8(row[0])
        return {"din": din, "name": str(row[1] or "").strip()} if (din or row[1]) else None

    def search_drugs(self, drug_name: str, strength: str = "") -> List[Dict[str, Any]]:
        """Kroll drugs matching name + strength, most-dispensed first. Empty list if unavailable."""
        ds = self._resolve_drug_schema()
        if not ds or not ds["drug_name"]:
            return []
        words = [w for w in re.split(r"[^a-z\-]+", (drug_name or "").lower()) if len(w) > 2 and w not in self._NOISE]
        if not words:
            return []
        num = re.search(r"(\d+(?:\.\d+)?)\s*(mg|mcg|ug|g|ml|iu|%)", f"{strength} {drug_name}".lower())
        nc = [ds["drug_name"]] + ([ds["drug_name2"]] if ds.get("drug_name2") else [])
        name_cond = "(" + " OR ".join(f"[{c}] LIKE ?" for c in nc) + ")"
        full = "COALESCE(NULLIF([%s], ''), [%s])" % (nc[-1], nc[0]) if len(nc) > 1 else f"[{nc[0]}]"
        sql = (f"SELECT TOP 60 [{ds['drug_id']}], [{ds['drug_din']}], {full} "
               f"FROM {ds['drug_table']} WITH (NOLOCK) WHERE {name_cond} AND [{ds['drug_din']}] IS NOT NULL")
        params: List[Any] = [f"%{words[0]}%"] * (2 if ds.get("drug_name2") else 1)
        if num:
            sc = [ds["drug_name"]] + ([ds["drug_strength"]] if ds.get("drug_strength") else [])
            sql += " AND (" + " OR ".join(f"[{c}] LIKE ? OR [{c}] LIKE ?" for c in sc) + ")"
            for _ in sc:
                params += [f"%{num.group(1)} {num.group(2)}%", f"%{num.group(1)}{num.group(2)}%"]
        found: List[Dict[str, Any]] = []
        try:
            cur = self.ensure().cursor()
            try:
                cur.execute(sql, params)
                for drg_id, din, name in cur.fetchall():
                    d = self._din8(din)
                    if d:
                        found.append({"drug_id": drg_id, "din": d, "name": str(name or "").strip(), "uses": 0})
            finally:
                cur.close()
        except Exception as exc:
            self.log.debug("search_drugs failed: %s", exc)
            return []
        # Rank by how often this pharmacy dispenses each product (last 12 months when a date column is known).
        r = self.cfg.rx_schema
        if r.get("rx_table") and r.get("rx_drug_id"):
            when = f" AND [{r['rx_created']}] >= DATEADD(month, -12, GETDATE())" if r.get("rx_created") else ""
            try:
                cur = self.ensure().cursor()
                try:
                    for item in found[:25]:
                        cur.execute(f"SELECT COUNT(*) FROM {r['rx_table']} WITH (NOLOCK) WHERE [{r['rx_drug_id']}] = ?{when}",
                                    (item["drug_id"],))
                        item["uses"] = int(cur.fetchone()[0])
                finally:
                    cur.close()
            except Exception as exc:
                self.log.debug("dispense ranking skipped: %s", exc)
        found.sort(key=lambda x: (-x["uses"], x["name"]))
        return found[:5]

    def attach_image(self, row: Dict[str, Any]) -> Dict[str, Any]:
        """Load the fax image for this pending row (ScriptImageId) as a JPEG data URL. Never raises."""
        if not row.get("ScriptImageId"):
            return row
        try:
            return attach_page_image(row, self.ensure(), self.cfg.image_schema)
        except Exception as exc:  # image problems must never block the SQL sync
            self.log.warning("Fax image unavailable for PendingRxId=%s: %s", row.get("PendingRxId"), exc)
            return row

    def fetch_rx_history(self, since: dt.datetime, top: int = 500) -> List[Dict[str, Any]]:
        """Finished Rx rows newer than `since` (read-only) for background learning."""
        r = self.cfg.rx_schema
        if not (r["rx_table"] and r["rx_drug_id"] and r["rx_sig"] and r["rx_created"]):
            return []
        cols = [("drug", r["rx_drug_id"]), ("sig", r["rx_sig"]), ("created", r["rx_created"]),
                ("doc", r["rx_doc_id"]), ("qty", r["rx_qty"]), ("refills", r["rx_refills"])]
        select = ", ".join(f"{c} AS {a}" for a, c in cols if c)
        cur = self.ensure().cursor()
        try:
            cur.execute(f"SELECT TOP {int(top)} {select} FROM {r['rx_table']} WITH (NOLOCK) "
                        f"WHERE {r['rx_created']} > ? AND {r['rx_sig']} IS NOT NULL ORDER BY {r['rx_created']} ASC",
                        [since])
            names = [c[0] for c in cur.description]
            return [dict(zip(names, row)) for row in cur.fetchall()]
        finally:
            cur.close()

    def fetch_by_ids(self, ids: List[int]) -> List[Dict[str, Any]]:
        """Re-read specific pending rows (no status filter: a row may have changed status)."""
        if not ids:
            return []
        s = self.cfg.schema
        sql = self._build_query(where=f"p.{s['pending_id']} IN ({','.join('?' * len(ids))})",
                                top=len(ids), with_status=False)
        conn = self.ensure()
        cur = conn.cursor()
        try:
            cur.execute(sql, list(ids))
            columns = [col[0] for col in cur.description]
            return [{col: jsonable(val) for col, val in zip(columns, row)} for row in cur.fetchall()]
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


    def max_pending_id(self) -> int:
        s = self.cfg.schema
        conn = self.ensure()
        cur = conn.cursor()
        try:
            cur.execute(f"SELECT MAX({s['pending_id']}) FROM {s['pending_table']}")
            value = cur.fetchone()[0]
            return int(value) if value is not None else 0
        finally:
            cur.close()

    def profile_table(self, table: str) -> None:
        """Print per-column non-empty counts for one table. Shows NO row values."""
        if not IDENT_RE.match(table):
            raise ValueError(f"{table!r} is not a valid table name")
        schema, _, name = table.rpartition(".")
        schema = schema or "dbo"
        conn = self.ensure()
        cur = conn.cursor()
        try:
            cur.execute(
                "SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS "
                "WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
                [schema, name],
            )
            cols = [(c, t) for c, t in cur.fetchall()]
            if not cols:
                print(f"Table {schema}.{name} not found.")
                return
            quote = lambda c: "[" + c.replace("]", "]]") + "]"
            # DATALENGTH works on text/ntext/image columns, where COUNT(col) is illegal.
            counts = ", ".join(
                f"SUM(CASE WHEN DATALENGTH({quote(c)}) > 0 THEN 1 ELSE 0 END)" for c, _ in cols
            )
            cur.execute(f"SELECT COUNT(*), {counts} FROM [{schema}].[{name}] WITH (NOLOCK)")
            row = cur.fetchone()
        finally:
            cur.close()
        total = int(row[0])
        print(f"\n{schema}.{name}: {total} rows\n")
        print(f"  {'column':<30} {'type':<14} {'non-empty':>10}")
        for (col, dtype), n in zip(cols, row[1:]):
            n = int(n or 0)
            pct = f"{100.0 * n / total:5.1f}%" if total else "   n/a"
            print(f"  {col:<30} {dtype:<14} {n:>10}  {pct}")
        print("\nA column that should hold real data but is ~0% filled is the wrong column.")

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


    def _sibling(self, name: str) -> str:
        base = self.cfg.api_url
        return base[: base.rfind("/")] + "/" + name if "/" in base.split("://", 1)[-1] else base

    def push_rx(self, payload: Dict[str, Any]) -> Tuple[bool, str, bool]:
        """POST to /api/agent-rx: cloud OCR reads the fax image and merges it with the SQL fields."""
        try:
            resp = self.session.post(self._sibling("agent-rx"), json=payload, timeout=OCR_TIMEOUT_SEC)
        except requests.RequestException as exc:
            return False, str(exc), False
        if 200 <= resp.status_code < 300:
            try:
                body = resp.json()
                self.last_body = body
                if body.get("ocr_error"):
                    self.log.warning("Cloud OCR note: %s", body["ocr_error"])
            except ValueError:
                pass
            return True, "", False
        return False, f"HTTP {resp.status_code}: {resp.text[:200]}", False

    def push_learn(self, payload: Dict[str, Any]) -> bool:
        try:
            resp = self.session.post(self._sibling("learn"), json=payload, timeout=CLOUD_TIMEOUT_SEC)
            return 200 <= resp.status_code < 300
        except requests.RequestException:
            return False


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
# Learning: permanent memory (learning.db). Nothing here is ever deleted automatically.
# ---------------------------------------------------------------------------

def norm_sig(value: Any) -> str:
    return " ".join(str(value or "").upper().replace(";", " ").split()).rstrip(".")


class Learner:
    """Two learning modes sharing one permanent store.

    Mode 1  learn_from_sql   background: reads finished Rx rows from Kroll and counts which sig each drug
                              (and each prescriber + drug) is normally given. Used only to SUGGEST a sig when a
                              pending Rx has none - never to overwrite one.
    Mode 2  learn_from_staff when staff change what PharmFlow planned, the fix is stored as a rule
                              (drug + wrong sig -> right sig). After SIG_APPLY_MIN_HITS identical fixes for the same
                              drug the rule is applied automatically next time. If staff then undo it, the rule is
                              dropped / replaced, so a wrong lesson corrects itself.
    Quantity / refill / drug changes are recorded in full history (corrections) and never auto-applied.
    """

    def __init__(self, cfg: AgentConfig, path: Path, logger: logging.Logger):
        self.cfg = cfg
        self.path = path
        self.log = logger
        self._warned = False
        self._backlog = False
        self._init()

    def _conn(self) -> sqlite3.Connection:
        c = sqlite3.connect(str(self.path), timeout=30)
        c.row_factory = sqlite3.Row
        return c

    def _init(self) -> None:
        c = self._conn()
        try:
            c.executescript("""
                CREATE TABLE IF NOT EXISTS corrections (      -- full history, one row per field staff changed
                    pending_rx_id INTEGER NOT NULL,
                    field         TEXT NOT NULL,
                    drug_id       TEXT,
                    doc_id        TEXT,
                    original      TEXT,
                    corrected     TEXT,
                    created_at    TEXT NOT NULL,
                    PRIMARY KEY (pending_rx_id, field)
                );
                CREATE TABLE IF NOT EXISTS rules (            -- sig_fix (drug-specific) | sig_fix_any (hint only)
                    kind       TEXT NOT NULL,
                    key        TEXT NOT NULL,
                    target     TEXT NOT NULL,
                    hits       INTEGER NOT NULL DEFAULT 1,
                    last_seen  TEXT NOT NULL,
                    PRIMARY KEY (kind, key)
                );
                CREATE TABLE IF NOT EXISTS usage (            -- mode 1: what the pharmacy normally writes
                    drug_id  TEXT NOT NULL,
                    doc_id   TEXT NOT NULL,
                    sig_norm TEXT NOT NULL,
                    sig_raw  TEXT NOT NULL,
                    n        INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY (drug_id, doc_id, sig_norm)
                );
                CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            """)
            c.commit()
        finally:
            c.close()

    def _meta(self, key: str, default: str = "") -> str:
        c = self._conn()
        try:
            r = c.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
            return r["value"] if r else default
        finally:
            c.close()

    def _set_meta(self, key: str, value: str) -> None:
        c = self._conn()
        try:
            c.execute("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))
            c.commit()
        finally:
            c.close()

    # ---- rules -------------------------------------------------------------------------------
    def _get_rule(self, kind: str, key: str) -> Optional[sqlite3.Row]:
        c = self._conn()
        try:
            return c.execute("SELECT target, hits FROM rules WHERE kind=? AND key=?", (kind, key)).fetchone()
        finally:
            c.close()

    def _bump_rule(self, kind: str, key: str, target: str, hits: Optional[int] = None) -> None:
        now = dt.datetime.now(dt.timezone.utc).isoformat()
        c = self._conn()
        try:
            row = c.execute("SELECT target, hits FROM rules WHERE kind=? AND key=?", (kind, key)).fetchone()
            if row is None:
                c.execute("INSERT INTO rules(kind,key,target,hits,last_seen) VALUES(?,?,?,?,?)",
                          (kind, key, target, hits or 1, now))
            else:
                same = norm_sig(row["target"]) == norm_sig(target)
                new_hits = (hits if hits is not None else row["hits"] + 1) if same else (hits or 1)  # different fix: latest wins
                c.execute("UPDATE rules SET target=?, hits=?, last_seen=? WHERE kind=? AND key=?",
                          (target, new_hits, now, kind, key))
            c.commit()
        finally:
            c.close()

    def _drop_rule(self, kind: str, key: str) -> None:
        c = self._conn()
        try:
            c.execute("DELETE FROM rules WHERE kind=? AND key=?", (kind, key))
            c.commit()
        finally:
            c.close()

    @staticmethod
    def _keys(drug_id: Any, raw_sig: Any) -> List[Tuple[str, str]]:
        nr = norm_sig(raw_sig)
        keys = [("sig_fix_any", nr)]
        if drug_id not in (None, ""):
            keys.insert(0, ("sig_fix", f"{drug_id}|{nr}"))
        return keys

    def _record(self, pending_id: int, field: str, drug_id: Any, doc_id: Any, original: Any, corrected: Any) -> None:
        c = self._conn()
        try:
            c.execute("INSERT OR REPLACE INTO corrections VALUES (?,?,?,?,?,?,?)",
                      (pending_id, field, None if drug_id is None else str(drug_id), None if doc_id is None else str(doc_id),
                       "" if original is None else str(original), "" if corrected is None else str(corrected),
                       dt.datetime.now(dt.timezone.utc).isoformat()))
            c.commit()
        finally:
            c.close()

    # ---- mode 2: learn from what staff changed after PharmFlow's entry ------------------------
    def learn_from_staff(self, planned: Dict[str, Any], actual: Dict[str, Any]) -> int:
        pid = int(planned.get("pending_rx_id") or 0)
        drug, doc = planned.get("drug_id"), planned.get("doc_id")
        learned = 0

        raw = planned.get("sig_raw", planned.get("sig"))
        planned_sig = planned.get("sig")
        applied = bool(planned.get("learned_applied"))
        final = actual.get("rx_sig")
        if final not in (None, "") and norm_sig(raw):
            a, nraw = norm_sig(final), norm_sig(raw)
            keys = self._keys(drug, raw)
            if a == nraw:
                if applied:                      # we rewrote it, staff put the original back: the lesson was wrong
                    for kind, key in keys:
                        self._drop_rule(kind, key)
                    self._record(pid, "sig", drug, doc, planned_sig, final)
                    self.log.info("Learning: staff reverted an applied sig rule for PendingRxId=%s - rule removed", pid)
                    learned += 1
            elif applied and a == norm_sig(planned_sig):
                for kind, key in keys:           # staff accepted what we applied: confirm it
                    self._bump_rule(kind, key, str(final))
            else:
                self._record(pid, "sig", drug, doc, raw, final)
                for kind, key in keys:
                    self._bump_rule(kind, key, str(final))
                learned += 1

        for field, pcol, acol in (("qty", "qty", "rx_qty"), ("refills", "refills", "rx_refills"), ("drug_id", "drug_id", "rx_drug_id")):
            if actual.get(acol) in (None, ""):
                continue
            if _norm(field, planned.get(pcol)) != _norm(field, actual.get(acol)):
                self._record(pid, field, drug, doc, planned.get(pcol), actual.get(acol))
                learned += 1
        return learned

    # ---- applying what was learned to a new pending row -----------------------------------------
    def apply(self, row: Dict[str, Any]) -> None:
        sig = row.get("SigText")
        row["_sig_raw"] = sig
        learned: Dict[str, Any] = {}
        drug = row.get("DrugId")
        if str(sig or "").strip():
            for kind, key in self._keys(drug, sig):
                rule = self._get_rule(kind, key)
                if not rule or norm_sig(rule["target"]) == norm_sig(sig):
                    continue
                info = {"from": str(sig), "to": rule["target"], "hits": rule["hits"]}
                if kind == "sig_fix" and self.cfg.sig_apply_min_hits > 0 and rule["hits"] >= self.cfg.sig_apply_min_hits:
                    row["SigText"] = rule["target"]
                    row["_learned_applied"] = True
                    learned["sig_applied"] = info
                else:
                    learned["sig_hint"] = info
                break
        else:
            sug = self.suggest_sig(drug, row.get("DocId"))
            if sug:
                learned["suggested_sig"] = sug
        if learned:
            row["_learned"] = learned

    # ---- mode 1: learn from finished prescriptions in Kroll SQL ------------------------------------
    def learn_from_sql(self, db: "KrollDB") -> None:
        r = self.cfg.rx_schema
        if not (r["rx_table"] and r["rx_drug_id"] and r["rx_sig"] and r["rx_created"]):
            if not self._warned:
                self._warned = True
                self.log.info("SQL learning off: set rx_table, rx_drug_id, rx_sig and rx_created in [RxSchema]")
            return
        wm_text = self._meta("sql_wm")
        wm = dt.datetime.fromisoformat(wm_text) if wm_text else dt.datetime.now() - dt.timedelta(days=self.cfg.learn_backfill_days)
        seen = 0
        for _ in range(20):                       # up to 10k rows per cycle, then continue next cycle
            rows = db.fetch_rx_history(wm, 500)
            if not rows:
                self._backlog = False
                break
            c = self._conn()
            try:
                for x in rows:
                    ns = norm_sig(x.get("sig"))
                    created = x.get("created")
                    if isinstance(created, dt.datetime) and created > wm:
                        wm = created
                    if not ns or x.get("drug") in (None, ""):
                        continue
                    c.execute("""INSERT INTO usage(drug_id,doc_id,sig_norm,sig_raw,n) VALUES(?,?,?,?,1)
                                 ON CONFLICT(drug_id,doc_id,sig_norm) DO UPDATE SET n=n+1, sig_raw=excluded.sig_raw""",
                              (str(x["drug"]), str(x.get("doc") or ""), ns, str(x["sig"]).strip()))
                    seen += 1
                c.commit()
            finally:
                c.close()
            self._set_meta("sql_wm", wm.isoformat())
            self._backlog = len(rows) >= 500
            if len(rows) < 500:
                break
        if seen:
            self.log.info("SQL learning: absorbed %d finished prescription(s)", seen)

    def suggest_sig(self, drug_id: Any, doc_id: Any) -> Optional[Dict[str, Any]]:
        if drug_id in (None, ""):
            return None
        c = self._conn()
        try:
            scopes = ([("prescriber", "AND doc_id=?", (str(drug_id), str(doc_id)))] if doc_id not in (None, "") else []) + \
                     [("drug", "", (str(drug_id),))]
            for scope, extra, params in scopes:
                rows = c.execute(f"SELECT sig_raw, SUM(n) AS n FROM usage WHERE drug_id=? {extra} "
                                 "GROUP BY sig_norm ORDER BY n DESC LIMIT 2", params).fetchall()
                total = sum(int(x["n"]) for x in c.execute(f"SELECT n FROM usage WHERE drug_id=? {extra}", params).fetchall())
                if rows and total >= self.cfg.suggest_min_samples and rows[0]["n"] / total >= self.cfg.suggest_min_share:
                    return {"sig": rows[0]["sig_raw"], "scope": scope, "samples": total, "share": round(rows[0]["n"] / total, 2)}
        finally:
            c.close()
        return None

    # ---- restore from the cloud copy (e.g. after reinstalling this PC) ------------------------------
    def restore_from_cloud(self, cloud: "CloudClient") -> None:
        if self._meta("cloud_restored"):
            return
        c = self._conn()
        try:
            has_rules = c.execute("SELECT 1 FROM rules LIMIT 1").fetchone() is not None
        finally:
            c.close()
        if has_rules:
            self._set_meta("cloud_restored", "1")
            return
        try:
            resp = cloud.session.get(cloud._sibling("learn"), params={"store_id": self.cfg.store_id, "limit": 200},
                                     timeout=CLOUD_TIMEOUT_SEC)
            if resp.status_code != 200:
                return
            n = 0
            for m in resp.json().get("mappings", []):
                if m.get("kind") == "text_replace" and str(m.get("source_key", "")).startswith("medications[0].sig::"):
                    self._bump_rule("sig_fix_any", norm_sig(m["source_key"].split("::", 1)[1]), m["target_value"],
                                    hits=int(m.get("hit_count") or 1))
                    n += 1
            self._set_meta("cloud_restored", "1")
            if n:
                self.log.info("Learning restored from the cloud copy: %d sig rule(s)", n)
        except Exception as exc:
            self.log.debug("Cloud learning restore skipped: %s", exc)

    def report(self) -> str:
        c = self._conn()
        try:
            one = lambda q: c.execute(q).fetchone()[0]
            n_corr = one("SELECT COUNT(*) FROM corrections")
            n_fix = one("SELECT COUNT(*) FROM rules WHERE kind='sig_fix'")
            n_any = one("SELECT COUNT(*) FROM rules WHERE kind='sig_fix_any'")
            n_rx = one("SELECT COALESCE(SUM(n),0) FROM usage")
            n_drugs = one("SELECT COUNT(DISTINCT drug_id) FROM usage")
            lines = [
                f"PharmFlow learning report | {self.path.name}",
                f"  corrections remembered   : {n_corr}",
                f"  sig rules (drug-specific): {n_fix}",
                f"  sig rules (hint only)    : {n_any}",
                f"  finished Rx absorbed     : {n_rx} ({n_drugs} drugs)",
                f"  auto-apply after {self.cfg.sig_apply_min_hits} identical fixes "
                f"({'OFF - hints only' if self.cfg.sig_apply_min_hits <= 0 else 'on'})",
                "", "Strongest sig rules (drug id | wrong sig -> right sig):",
            ]
            for r in c.execute("SELECT key, target, hits FROM rules WHERE kind='sig_fix' ORDER BY hits DESC LIMIT 15"):
                lines.append(f"  x{r['hits']}  {r['key']}  ->  {r['target']}")
            return "\n".join(lines) + "\n"
        finally:
            c.close()

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
        self.learner: Optional[Learner] = Learner(cfg, LEARN_PATH, self.log) if cfg.learn_enabled else None
        self._last_learn = -cfg.learn_sql_every
        self._last_heartbeat = 0.0
        self._last_compare = -COMPARE_EVERY_SEC
        self._last_recheck = -RECHECK_EVERY_SEC
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

        if self.learner:
            try:
                self.learner.apply(row)       # fixes the agent learned from staff earlier (never blocks the sync)
            except Exception as exc:
                self.log.warning("Learning apply skipped for PendingRxId=%s: %s", pending_id, exc)

        issues = validate_row(row, self.cfg.require_plan)
        self.store.record_decision(
            pending_id, "EXCEPTION" if issues else "AUTO", issues, planned_entry(row)
        )

        if self.cfg.mode == "SHADOW" and not self.cfg.cloud_enabled:
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
        if row.get("_learned"):
            payload["learning"] = row["_learned"]
        payload["decision"] = {
            "action": "EXCEPTION" if issues else "AUTO",
            "issues": issues,
            "planned": planned_entry(row),
        }
        if self.cfg.cloud_enabled:
            drug = self.db.drug_by_id(row.get("DrugId"))
            if drug:
                payload["pending_rx"]["drug_din"] = drug["din"]
                payload["pending_rx"]["drug_name"] = drug["name"]

        if self.cfg.cloud_enabled and row.get("ScriptImageId"):
            with_img = self.db.attach_image(row)
            if with_img.get("page_image_data_url"):
                ocr_payload = dict(payload)
                ocr_payload["page_images"] = [with_img["page_image_data_url"]]
                ok, err, _ = self.cloud.push_rx(ocr_payload)
                if ok:
                    self.log.info("Synced PendingRxId=%s to cloud with fax OCR", pending_id)
                    try:
                        self._hint_din_from_kroll(pending_id)
                    except Exception as exc:  # a DIN hint must never stop the sync loop
                        self.log.warning("DIN hint skipped for PendingRxId=%s: %s", pending_id, exc)
                    self.store.mark_processed(pending_id)
                    return
                self.log.warning("Fax OCR upload failed for PendingRxId=%s (%s) - syncing SQL fields only",
                                 pending_id, err)

        ok, err, permanent = self.cloud.push(payload)
        if ok:
            self.log.info("Synced PendingRxId=%s to cloud", pending_id)
        else:
            self.log.error("Cloud push failed for PendingRxId=%s: %s", pending_id, err)
            if not permanent:
                self.store.spool_payload(pending_id, payload, err)
        self.store.mark_processed(pending_id)

    def _hint_din_from_kroll(self, pending_id: int) -> None:
        """Fax had no DIN? Look the drug up in Kroll's own drug table and tell the cloud what we found."""
        body = getattr(self.cloud, "last_body", None) or {}
        med = ((body.get("merged") or {}).get("medications") or [{}])[0]
        if med.get("din") or med.get("is_compound") or not med.get("drug_name"):
            return
        cands = self.db.search_drugs(med.get("drug_name", ""), med.get("strength", ""))
        if not cands:
            return
        top = cands[0]
        # Fill only when it is clear-cut: a single product, or one the pharmacy dispenses far more than the rest.
        clear = len(cands) == 1 or (top["uses"] >= 5 and top["uses"] >= 3 * max(1, cands[1]["uses"]))
        self.cloud.session.post(
            self.cloud._sibling("agent-rx"),
            json={"type": "din_hint", "store_id": self.cfg.store_id, "pending_rx_id": pending_id,
                  "din": top["din"] if clear else "", "source": "kroll_sql",
                  "candidates": [{"din": c["din"], "name": c["name"], "uses": c["uses"]} for c in cands]},
            timeout=CLOUD_TIMEOUT_SEC,
        )
        self.log.info("DIN hint sent for PendingRxId=%s (%d candidate(s), auto-fill=%s)", pending_id, len(cands), clear)

    def _flush_spool(self) -> None:
        if not self.cfg.cloud_enabled:
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

    def _compare_with_staff(self) -> None:
        """SHADOW: look up what staff actually entered in Kroll and report the match to the cloud."""
        r = self.cfg.rx_schema
        if not r["rx_table"] or not (self.cfg.cloud_enabled or self.learner):
            return
        if time.monotonic() - self._last_compare < COMPARE_EVERY_SEC:
            return
        self._last_compare = time.monotonic()

        now = dt.datetime.now(dt.timezone.utc)
        for d in self.store.load_uncompared(limit=100):
            planned = json.loads(d["planned"])
            planned["pending_rx_id"] = d["pending_rx_id"]
            # Pending rows rarely carry a usable date, so only accept staff entries filled on or after
            # the day the agent first saw this pending Rx (local server time).
            seen = dt.datetime.fromisoformat(d["decided_at"])
            if seen.tzinfo is not None:
                seen = seen.astimezone()
            planned["date_created"] = seen.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=None).strftime("%Y-%m-%d %H:%M:%S")
            actual = self.db.fetch_actual_rx(planned)
            if actual is None:
                return                                   # [RxSchema] incomplete
            age = now - dt.datetime.fromisoformat(d["decided_at"])
            if not actual and age < dt.timedelta(days=COMPARE_GIVE_UP_DAYS):
                continue                                 # staff have not entered it yet
            if actual and self.learner:
                try:
                    fixes = self.learner.learn_from_staff(planned, actual)
                    if fixes:
                        self.log.info("Learned %d staff correction(s) for PendingRxId=%s", fixes, d["pending_rx_id"])
                except Exception as exc:
                    self.log.warning("Learning from staff skipped for PendingRxId=%s: %s", d["pending_rx_id"], exc)
            if self.cfg.cloud_enabled:
                # the cloud keeps its own copy of the corrections (extraction_feedback / learned_mappings)
                result = {
                    "type": "shadow_result",
                    "store_id": self.cfg.store_id,
                    "pending_rx_id": d["pending_rx_id"],
                    "actual": actual or None,
                    "field_match": field_matches(planned, actual, r) if actual else None,
                }
                ok, err, _ = self.cloud.push(result)
                if not ok:
                    self.log.warning("Could not upload comparison for PendingRxId=%s: %s", d["pending_rx_id"], err)
                    return
            self.store.mark_compared(d["pending_rx_id"])

    def _learn_background(self) -> None:
        """Mode 1: quietly absorb finished prescriptions from Kroll SQL (read-only)."""
        if not self.learner:
            return
        gap = 5 if self.learner._backlog else self.cfg.learn_sql_every
        if time.monotonic() - self._last_learn < gap:
            return
        self._last_learn = time.monotonic()
        try:
            self.learner.learn_from_sql(self.db)
            if self.cfg.cloud_enabled:
                self.learner.restore_from_cloud(self.cloud)
        except pyodbc.Error as exc:
            self.log.warning("SQL learning paused (database): %s", exc)
        except Exception as exc:
            self.log.warning("SQL learning skipped: %s", exc)

    def _heartbeat(self) -> None:
        if not self.cfg.cloud_enabled or time.monotonic() - self._last_heartbeat < HEARTBEAT_EVERY_SEC:
            return
        self._last_heartbeat = time.monotonic()
        ok, err, _ = self.cloud.push(
            {
                "type": "heartbeat",
                "mode": self.cfg.mode,
                "store_id": self.cfg.store_id,
                "incomplete": self.store.count_incomplete(),
                "agent": {
                    "version": AGENT_CODE_VERSION,
                    "hostname": socket.gethostname(),
                    "timestamp_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
                },
            }
        )
        if not ok:
            self.log.warning("Heartbeat failed: %s", err)

    def apply_start_mode(self) -> None:
        """First ever run in NEW_ONLY mode: skip everything already in the pending table."""
        if self.cfg.start_mode == "NEW_ONLY" and not self.store.has_watermark():
            top = self.db.max_pending_id()
            self.store.set_watermark(top)
            self.log.info("First run (START_MODE=NEW_ONLY): ignoring existing rows up to PendingRxId=%s", top)

    def _recheck_incomplete(self) -> None:
        if time.monotonic() - self._last_recheck < RECHECK_EVERY_SEC:
            return
        self._last_recheck = time.monotonic()
        items = self.store.load_incomplete(100)
        if not items:
            return
        rows = {int(r["PendingRxId"]): r for r in self.db.fetch_by_ids([i for i, _ in items])}
        now = dt.datetime.now(dt.timezone.utc)
        limit = dt.timedelta(hours=self.cfg.wait_hours)
        for pid, first_seen in items:
            row = rows.get(pid)
            if row is None:                                   # deleted in Kroll
                self.store.drop_incomplete(pid)
                self.log.info("PendingRxId=%s no longer exists in Kroll; dropped", pid)
            elif core_complete(row):
                self._process_row(row)
                self.store.drop_incomplete(pid)
            elif now - dt.datetime.fromisoformat(first_seen) > limit:
                if is_blank_stub(row):
                    self.store.mark_processed(pid)            # never filled in: ignore, do not report
                    self.log.info("Ignored empty placeholder PendingRxId=%s", pid)
                else:
                    self._process_row(row)                    # judged as it is -> EXCEPTION
                self.store.drop_incomplete(pid)

    def run_once(self) -> int:
        try:
            watermark = self.store.get_watermark()
            rows = self.db.fetch_pending(watermark)
            if rows:
                self.log.info("Polled %d new pending row(s)", len(rows))
            for row in rows:
                rid = row.get("PendingRxId")
                if rid is None or self.store.is_processed(int(rid)):
                    continue
                if self.cfg.wait_hours and not core_complete(row):
                    self.store.add_incomplete(int(rid))     # staff are still filling it in: re-read later
                    continue
                self._process_row(row)
            if rows:
                top = max(int(r["PendingRxId"]) for r in rows if r.get("PendingRxId") is not None)
                self.store.set_watermark(max(top, watermark))
            self._recheck_incomplete()
            self._flush_spool()
            self._compare_with_staff()
            self._learn_background()
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
            try:
                self.apply_start_mode()
            except Exception as exc:  # DB down at boot: the loop retries normally, baseline is retried next start
                self.log.error("Could not set the start baseline yet: %s", exc)
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


FIELD_COLUMNS = [("pat_id", "rx_pat_id"), ("doc_id", "rx_doc_id"), ("drug_id", "rx_drug_id"),
                 ("qty", "rx_qty"), ("refills", "rx_refills"), ("sig", "rx_sig")]


def field_matches(planned: Dict[str, Any], actual: Dict[str, Any], rx_schema: Dict[str, str]) -> Dict[str, bool]:
    return {p: _norm(p, planned.get(p)) == _norm(p, actual.get(a))
            for p, a in FIELD_COLUMNS if rx_schema.get(a)}


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
    parser.add_argument("--skip-backlog", action="store_true",
                        help="ignore every row already in the pending table; process only new ones")
    parser.add_argument("--profile", metavar="TABLE", help="print per-column fill counts (no values) and exit")
    parser.add_argument("--shadow-report", action="store_true",
                        help="compare shadow decisions with what staff entered; prints go-live verdict")
    parser.add_argument("--schema-report", action="store_true",
                        help="write schema_report.txt (columns of your Kroll tables, no data) and exit")
    parser.add_argument("--find-images", action="store_true",
                        help="find which table holds the fax images for recent pending Rx and exit")
    parser.add_argument("--gen-key", action="store_true",
                        help="print a new random agent API key (put it in config.ini [Cloud] API_KEY and Vercel AGENT_API_KEY)")
    parser.add_argument("--learning-report", action="store_true",
                        help="show what the agent has learned so far (no patient data) and exit")
    parser.add_argument("--test", action="store_true", help="connect, poll once, print counts, exit")
    args = parser.parse_args(argv)

    if args.gen_key:
        print(secrets.token_urlsafe(32))
        return 0

    try:
        cfg = AgentConfig(CONFIG_PATH)
    except Exception as exc:
        print(f"FATAL config error: {exc}", file=sys.stderr)
        return 1

    if args.profile:
        logger = setup_logging(cfg.agent_version)
        KrollDB(cfg, logger).profile_table(args.profile)
        return 0

    if args.skip_backlog:
        logger = setup_logging(cfg.agent_version)
        top = KrollDB(cfg, logger).max_pending_id()
        LocalStore(SQLITE_PATH, logger).set_watermark(top)
        print(f"Done: rows up to PendingRxId={top} will be ignored. Restart the agent (and press "
              "'Start shadow week' on the Live dashboard).")
        return 0

    if args.learning_report:
        print(Learner(cfg, LEARN_PATH, setup_logging(cfg.agent_version)).report())
        return 0

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

    if args.find_images:
        logger = setup_logging(cfg.agent_version)
        db = KrollDB(cfg, logger)
        sc = cfg.schema
        col = sc.get("pending_script_image_id") or "ScriptImageId"
        conn = db.ensure()
        cur = conn.cursor()
        try:
            cur.execute(f"SELECT TOP 5 [{col}] FROM {sc['pending_table']} WITH (NOLOCK) "
                        f"WHERE [{col}] IS NOT NULL ORDER BY [{sc['pending_id']}] DESC")
            ids = [r[0] for r in cur.fetchall()]
        except Exception as exc:
            print(f"Could not read {col} from {sc['pending_table']}: {exc}")
            print("That column may not exist. Run find_kroll_tables.sql (in this folder) and look for the fax image link.")
            return 1
        finally:
            cur.close()
        if not ids:
            print(f"No pending prescriptions have a {col} yet. Receive a fax in Kroll first, then run this again.")
            return 1
        print(f"Testing recent {col} values: {ids}")
        find_image_source(conn, ids)
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
