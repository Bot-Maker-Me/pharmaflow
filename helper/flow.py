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
  python flow.py --requeue-dead N   retry payloads parked after failed uploads (PendingRxId >= N)
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
INBOUND_FAX_EVERY_SEC = 60        # how often Kroll's Inbound Docs (faxes) are checked
INBOUND_FAX_PER_CYCLE = 5         # at most this many faxes are read per check (keeps OCR cost / time bounded)
INBOUND_FAX_MAX_TRIES = 3
FAX_LEARN_EVERY_SEC = 120         # how often faxes pushed to Kroll are compared with the Rx staff finished
FAX_LEARN_GIVE_UP_HOURS = 24      # a pushed fax with no matching Rx after this long is closed without learning
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
    "rx_table", "rx_id", "rx_link_col",       # rx_link_col = column holding the PendingRxId, if Kroll keeps one
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

        try:
            path.open("rb").close()          # configparser.read() silently skips unreadable files
        except PermissionError as exc:
            raise PermissionError(
                f"Access denied reading {path}. This file is protected: run as Administrator "
                "(right-click, Run as administrator)."
            ) from exc
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
        # Read faxes sitting in Kroll's Inbound Docs (before staff create a pending Rx) and OCR them in the cloud.
        # Only faxes received in the last INBOUND_FAX_HOURS are read; INBOUND_FAX_IGNORE = comma list of sender
        # numbers to skip (e.g. your own fax number). Needs the cloud connection.
        self.inbound_fax: bool = cp.getboolean("Agent", "INBOUND_FAX", fallback=True)
        self.inbound_fax_hours: float = max(1.0, cp.getfloat("Agent", "INBOUND_FAX_HOURS", fallback=24.0))
        self.inbound_fax_ignore: List[str] = [x.strip() for x in cp.get("Agent", "INBOUND_FAX_IGNORE", fallback="").split(",") if x.strip()]

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
        self.sig_apply_safe_only: bool = cp.getboolean("Learning", "SIG_APPLY_SAFE_ONLY", fallback=True)
        self.learn_sql_every: int = cp.getint("Learning", "SQL_LEARN_EVERY_SEC", fallback=900)
        self.learn_backfill_days: int = cp.getint("Learning", "SQL_BACKFILL_DAYS", fallback=365)   # only if rx_id is not set
        # With rx_id set, learning starts this many Rx rows back from the newest one (index seek, light on the server).
        self.learn_backfill_rows: int = cp.getint("Learning", "SQL_BACKFILL_ROWS", fallback=300000)
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
                CREATE TABLE IF NOT EXISTS learned_local (    -- staff fixes already counted: a retry must never count twice
                    pending_rx_id INTEGER PRIMARY KEY
                );
                CREATE TABLE IF NOT EXISTS early_ocr (       -- fax already sent to the waiting list before staff filled it in
                    pending_rx_id INTEGER PRIMARY KEY,
                    pushed_at     TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS inbound_fax (     -- inbound fax (Kroll Mail id) already read, or given up on
                    mail_id  INTEGER PRIMARY KEY,
                    done     INTEGER NOT NULL DEFAULT 0,
                    attempts INTEGER NOT NULL DEFAULT 0
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

    def has_learned(self, pending_rx_id: int) -> bool:
        conn = self._connect()
        try:
            return conn.execute("SELECT 1 FROM learned_local WHERE pending_rx_id = ?", (pending_rx_id,)).fetchone() is not None
        finally:
            conn.close()

    def mark_learned(self, pending_rx_id: int) -> None:
        conn = self._connect()
        try:
            conn.execute("INSERT OR IGNORE INTO learned_local(pending_rx_id) VALUES (?)", (pending_rx_id,))
            conn.commit()
        finally:
            conn.close()

    # -- inbound faxes (Kroll Inbound Docs) -------------------------------------
    def fax_done(self, mail_id: int) -> bool:
        conn = self._connect()
        try:
            return conn.execute("SELECT 1 FROM inbound_fax WHERE mail_id = ? AND done = 1", (mail_id,)).fetchone() is not None
        finally:
            conn.close()

    def fax_mark_done(self, mail_id: int) -> None:
        conn = self._connect()
        try:
            conn.execute("INSERT INTO inbound_fax(mail_id, done, attempts) VALUES (?, 1, 0) "
                         "ON CONFLICT(mail_id) DO UPDATE SET done = 1", (mail_id,))
            conn.commit()
        finally:
            conn.close()

    def fax_bump(self, mail_id: int) -> int:
        """Count a failed attempt; returns the new number of attempts."""
        conn = self._connect()
        try:
            conn.execute("INSERT INTO inbound_fax(mail_id, done, attempts) VALUES (?, 0, 1) "
                         "ON CONFLICT(mail_id) DO UPDATE SET attempts = attempts + 1", (mail_id,))
            conn.commit()
            return conn.execute("SELECT attempts FROM inbound_fax WHERE mail_id = ?", (mail_id,)).fetchone()[0]
        finally:
            conn.close()

    # -- early fax push -------------------------------------------------------
    def has_early(self, pending_rx_id: int) -> bool:
        conn = self._connect()
        try:
            return conn.execute("SELECT 1 FROM early_ocr WHERE pending_rx_id = ?", (pending_rx_id,)).fetchone() is not None
        finally:
            conn.close()

    def mark_early(self, pending_rx_id: int) -> None:
        conn = self._connect()
        try:
            conn.execute("INSERT OR IGNORE INTO early_ocr(pending_rx_id, pushed_at) VALUES (?, ?)",
                         (pending_rx_id, dt.datetime.now(dt.timezone.utc).isoformat()))
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

    def has_spooled(self, pending_rx_id: int) -> bool:
        """True while a live (not dead-lettered) payload for this Rx still waits to reach the cloud."""
        conn = self._connect()
        try:
            return conn.execute("SELECT 1 FROM spool WHERE pending_rx_id = ? AND dead = 0 LIMIT 1",
                                (pending_rx_id,)).fetchone() is not None
        finally:
            conn.close()

    def requeue_dead(self, from_id: int) -> Tuple[int, int]:
        """Give parked payloads (PendingRxId >= from_id) another chance and let their staff comparison run again.
        Learning is never repeated: has_learned() still guards every Rx. Returns (revived, comparisons_reset)."""
        conn = self._connect()
        try:
            ids = [r[0] for r in conn.execute(
                "SELECT DISTINCT pending_rx_id FROM spool WHERE dead = 1 AND pending_rx_id >= ?", (from_id,))]
            conn.execute("UPDATE spool SET dead = 0, attempts = 0 WHERE dead = 1 AND pending_rx_id >= ?", (from_id,))
            revived = conn.total_changes
            reset = 0
            for rid in ids:
                reset += conn.execute("DELETE FROM shadow_compared WHERE pending_rx_id = ?", (rid,)).rowcount
            conn.commit()
            return revived, reset
        finally:
            conn.close()

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


def native_check(conn, image_ids):
    """Test Kroll's own image path (ScriptImage -> ScriptImageContent) and print columns / errors."""
    print("Kroll native image path (what the agent really uses):")
    cur = conn.cursor()
    try:
        for t in ("ScriptImage", "ScriptImageContent"):
            cur.execute("SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = ? "
                        "ORDER BY ORDINAL_POSITION", (t,))
            cols = [f"{a} ({b})" for a, b in cur.fetchall()]
            print(f"  dbo.{t}: " + (", ".join(cols) if cols else "TABLE NOT FOUND"))
        for image_id in image_ids:
            try:
                cur.execute("SELECT TOP 1 c.Content, c.ContentCompressionType FROM dbo.ScriptImage s WITH (NOLOCK) "
                            "JOIN dbo.ScriptImageContent c WITH (NOLOCK) ON c.ID = s.ScriptImageContentId WHERE s.Id = ?",
                            (image_id,))
                row = cur.fetchone()
            except Exception as exc:
                print(f"  ScriptImageId {image_id}: QUERY FAILED -> {exc}")
                continue
            if not row or row[0] is None:
                print(f"  ScriptImageId {image_id}: no row / empty content")
                continue
            out = _decode_content(bytes(row[0]), row[1])
            kind = ("JPEG" if out[:3] == b"\xff\xd8\xff" else "PNG" if out[:4] == b"\x89PNG" else
                    "TIFF" if out[:2] in (b"II", b"MM") else "PDF" if out[:4] == b"%PDF" else "UNKNOWN")
            print(f"  ScriptImageId {image_id}: OK  {len(out):,} bytes, {kind} (compression={row[1]})")
    finally:
        cur.close()
    print()


def find_image_source(conn, image_ids):
    """Diagnostic for `flow.py --find-images`: test real ids against every binary column and report."""
    native_check(conn, image_ids)
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
    _MAKERS = {"jamp", "apo", "teva", "sandoz", "mylan", "auro", "pms", "ratio", "riva", "sivem", "taro", "act", "mint",
               "sanis", "pro", "dom", "novo", "gen", "van", "zym", "bio", "mar", "nat", "pharma", "ran", "med"}
    _NOISE = {"mg", "mcg", "ml", "oral", "capsule", "capsules", "cap", "caps", "tablet", "tablets", "tab", "tabs",
              "hcl", "hydrochloride", "sodium", "potassium", "calcium", "sulfate", "sulphate", "maleate",
              "tartrate", "besylate", "succinate", "and", "the", "of", "actuation", "inhalation", "inhaler",
              "puff", "dose", "extended", "release", "delayed", "film", "coated", "solution", "suspension", "cream",
              "ointment", "drops", "injection", "powder", "disintegrating", "chewable"}

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
                        if "BRANDNAME" in cols and "GENERICNAME" in cols:   # Description there = how the pill looks, not its name
                            namec = cols["BRANDNAME"]
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

    def columns(self, table: str) -> Dict[str, str]:
        """{UPPER: real name} of a table's columns (cached). Empty dict if it can't be read."""
        cache = self.__dict__.setdefault("_cols", {})
        tn = str(table or "").split(".")[-1]
        if tn in cache:
            return cache[tn]
        cols: Dict[str, str] = {}
        try:
            cur = self.ensure().cursor()
            try:
                cur.execute("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = ?", (tn,))
                cols = {str(r[0]).upper(): str(r[0]) for r in cur.fetchall()}
            finally:
                cur.close()
        except Exception as exc:  # noqa: BLE001
            self.log.debug("columns(%s) failed: %s", tn, exc)
        cache[tn] = cols
        return cols

    def active_clause(self, table: str, alias: str = "") -> str:
        """' AND (...)' that keeps only ACTIVE, un-merged rows of a Kroll table (patients, doctors, drugs); '' if the
        table has no such columns. Inactive / merged-away profiles must never be matched."""
        cols = self.columns(table)
        pre = f"{alias}." if alias else ""
        parts = []
        if "ACTIVE" in cols:
            parts.append(f"({pre}[{cols['ACTIVE']}] = 1 OR {pre}[{cols['ACTIVE']}] IS NULL)")
        if "INACTIVE" in cols:
            parts.append(f"({pre}[{cols['INACTIVE']}] = 0 OR {pre}[{cols['INACTIVE']}] IS NULL)")
        if "DISCONTINUED" in cols:
            parts.append(f"({pre}[{cols['DISCONTINUED']}] = 0 OR {pre}[{cols['DISCONTINUED']}] IS NULL)")
        if "MERGEDTOID" in cols:
            parts.append(f"({pre}[{cols['MERGEDTOID']}] IS NULL OR {pre}[{cols['MERGEDTOID']}] = 0)")
        return (" AND " + " AND ".join(parts)) if parts else ""

    def doc_contact_table(self) -> Optional[Dict[str, str]]:
        """Kroll's doctor address / phone table: a table with a doctor-id column plus address, postal, phone or fax columns.
        Found once from INFORMATION_SCHEMA and cached. None if there isn't one."""
        if "_doc_contact" in self.__dict__:
            return self.__dict__["_doc_contact"]
        found: Optional[Dict[str, str]] = None
        try:
            cur = self.ensure().cursor()
            try:
                cur.execute("SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME LIKE 'Doc%'")
                tabs: Dict[str, Dict[str, str]] = {}
                for sch, tn, cn in cur.fetchall():
                    tabs.setdefault(f"{sch}.{tn}", {})[str(cn).upper()] = str(cn)
                best = -1
                for tn, c in tabs.items():
                    if "HID" in c:                                    # history copies
                        continue
                    idc = c.get("DOCID")
                    if not idc:
                        continue
                    n = sum(1 for k in ("ADDRESS1", "POSTAL", "PHONE", "FAX") if k in c)
                    if n > best and n >= 2:
                        best = n
                        found = {"table": tn, "doc_id": idc, "address": c.get("ADDRESS1", ""), "postal": c.get("POSTAL", ""),
                                 "phone": c.get("PHONE", ""), "fax": c.get("FAX", "")}
            finally:
                cur.close()
        except Exception as exc:  # noqa: BLE001
            self.log.debug("doc_contact_table failed: %s", exc)
        self.__dict__["_doc_contact"] = found
        return found

    def search_drugs(self, drug_name: str, strength: str = "") -> List[Dict[str, Any]]:
        """Kroll drugs matching name + strength, most-dispensed first. Empty list if unavailable."""
        ds = self._resolve_drug_schema()
        if not ds or not ds["drug_name"]:
            return []
        words = [w for w in re.split(r"[^a-z]+", (drug_name or "").lower()) if len(w) > 3 and w not in self._NOISE]
        words = [w for w in words if w not in self._MAKERS] or words
        if not words:
            return []
        words.sort(key=len, reverse=True)     # the longest word is nearly always the drug itself
        num = re.search(r"(\d+(?:\.\d+)?)\s*(mg|mcg|ug|g|ml|iu|%)", f"{strength} {drug_name}".lower())
        nc = [ds["drug_name"]] + ([ds["drug_name2"]] if ds.get("drug_name2") else [])
        name_cond = "(" + " OR ".join(f"[{c}] LIKE ?" for c in nc) + ")"
        full = "COALESCE(NULLIF([%s], ''), [%s])" % (nc[-1], nc[0]) if len(nc) > 1 else f"[{nc[0]}]"
        scol = ds.get("drug_strength") or ""
        found: List[Dict[str, Any]] = []
        try:
            cur = self.ensure().cursor()
            try:
                act = self.active_clause(ds["drug_table"])
                for use_active in ((True, False) if act else (False,)):   # active products first; all only if none
                  for word in words[:3]:                  # try the longest word first, then the next ones
                    sql = (f"SELECT TOP 200 [{ds['drug_id']}], [{ds['drug_din']}], {full}, "
                           f"{'[' + scol + ']' if scol else 'NULL'} FROM {ds['drug_table']} WITH (NOLOCK) "
                           f"WHERE {name_cond} AND [{ds['drug_din']}] IS NOT NULL" + (act if use_active else ""))
                    params: List[Any] = [f"%{word}%"] * len(nc)
                    if num and scol:
                        sql += f" AND [{scol}] LIKE ?"
                        params.append(f"%{num.group(1)}%")
                    cur.execute(sql, params)
                    for drg_id, din, name, strg in cur.fetchall():
                        d = self._din8(din)
                        if not d:
                            continue
                        if num:     # the exact number, not just a longer one (4 must not match 40)
                            if not re.search(r"(?<![\d.])" + re.escape(num.group(1)) + r"(?![\d])", f"{strg or ''} {name or ''}"):
                                continue
                        label = " ".join(x for x in (str(name or "").strip(), str(strg or "").strip()) if x)
                        found.append({"drug_id": drg_id, "din": d, "name": label, "uses": 0})
                    if found:
                        break
                  if found:
                    break
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

    def max_rx_id(self) -> int:
        r = self.cfg.rx_schema
        cur = self.ensure().cursor()
        try:
            cur.execute(f"SELECT MAX({r['rx_id']}) FROM {r['rx_table']} WITH (NOLOCK)")
            v = cur.fetchone()[0]
            return int(v) if v is not None else 0
        finally:
            cur.close()

    def fetch_rx_by_id(self, after_id: int, top: int = 500) -> List[Dict[str, Any]]:
        """Finished Rx rows with id > after_id, oldest first (primary-key seek: cheap even on millions of rows)."""
        r = self.cfg.rx_schema
        cols = [("id", r["rx_id"]), ("drug", r["rx_drug_id"]), ("sig", r["rx_sig"]),
                ("doc", r["rx_doc_id"]), ("qty", r["rx_qty"]), ("refills", r["rx_refills"])]
        select = ", ".join(f"{c} AS {a}" for a, c in cols if c)
        cur = self.ensure().cursor()
        try:
            cur.execute(f"SELECT TOP {int(top)} {select} FROM {r['rx_table']} WITH (NOLOCK) "
                        f"WHERE {r['rx_id']} > ? AND {r['rx_sig']} IS NOT NULL ORDER BY {r['rx_id']} ASC", [after_id])
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

    def push_fax(self, payload: Dict[str, Any]) -> Tuple[bool, str, Dict[str, Any]]:
        """POST to /api/agent-fax: the cloud reads one inbound fax and says whether it is a prescription."""
        try:
            resp = self.session.post(self._sibling("agent-fax"), json=payload, timeout=OCR_TIMEOUT_SEC)
        except requests.RequestException as exc:
            return False, str(exc), {}
        if not 200 <= resp.status_code < 300:
            return False, f"HTTP {resp.status_code}: {resp.text[:200]}", {}
        try:
            body = resp.json()
        except ValueError:
            return False, "bad response", {}
        if not body.get("ok"):
            return False, str(body.get("ocr_error") or "cloud could not read the fax"), body
        return True, "", body

    def push_kroll_pending(self, ids: List[int], since_label: str) -> bool:
        """Tell the cloud which faxes are still pending in Kroll so Intake mirrors Kroll's Pending list."""
        try:
            resp = self.session.post(self._sibling("agent-fax"), json={
                "type": "kroll_pending", "store_id": self.cfg.store_id, "ids": ids, "since_label": since_label},
                timeout=CLOUD_TIMEOUT_SEC)
            return 200 <= resp.status_code < 300
        except requests.RequestException:
            return False

    def get_pushed_faxes(self) -> List[Dict[str, Any]]:
        """Faxes staff pushed to Kroll that have not been compared with Kroll's final Rx yet."""
        try:
            resp = self.session.get(self._sibling("agent-fax"), params={"pending_learn": 1, "store_id": self.cfg.store_id},
                                    timeout=CLOUD_TIMEOUT_SEC)
            if resp.status_code != 200:
                self.log.warning("Could not list pushed faxes: HTTP %s", resp.status_code)
                return []
            return list(resp.json().get("items") or [])
        except (requests.RequestException, ValueError) as exc:
            self.log.warning("Could not list pushed faxes: %s", exc)
            return []

    def get_recent_fax_scripts(self, n: int) -> List[Dict[str, Any]]:
        try:
            resp = self.session.get(self._sibling("agent-fax"), params={"recent": int(n), "store_id": self.cfg.store_id},
                                    timeout=CLOUD_TIMEOUT_SEC)
            return list(resp.json().get("items") or []) if resp.status_code == 200 else []
        except (requests.RequestException, ValueError):
            return []

    def get_unresolved_faxes(self, n: int = 10) -> List[Dict[str, Any]]:
        try:
            resp = self.session.get(self._sibling("agent-fax"), params={"unresolved": int(n), "store_id": self.cfg.store_id},
                                    timeout=CLOUD_TIMEOUT_SEC)
            return list(resp.json().get("items") or []) if resp.status_code == 200 else []
        except (requests.RequestException, ValueError):
            return []

    def push_kroll_patient(self, mail_id: int, kp: Dict[str, Any]) -> bool:
        try:
            resp = self.session.post(self._sibling("agent-fax"), json={
                "type": "kroll_patient", "store_id": self.cfg.store_id, "mail_id": int(mail_id), "kroll_patient": kp},
                timeout=CLOUD_TIMEOUT_SEC)
            return 200 <= resp.status_code < 300
        except requests.RequestException:
            return False

    def push_kroll_enrich(self, mail_id: int, enrich: Dict[str, Any]) -> bool:
        try:
            resp = self.session.post(self._sibling("agent-fax"), json={
                "type": "kroll_enrich", "store_id": self.cfg.store_id, "mail_id": int(mail_id), "kroll_enrich": enrich},
                timeout=CLOUD_TIMEOUT_SEC)
            return 200 <= resp.status_code < 300
        except requests.RequestException:
            return False

    def push_fax_result(self, payload: Dict[str, Any]) -> bool:
        try:
            resp = self.session.post(self._sibling("agent-fax"), json=payload, timeout=CLOUD_TIMEOUT_SEC)
            return 200 <= resp.status_code < 300
        except requests.RequestException:
            return False

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


_SIG_NOTE_RE = re.compile(
    r"[\(\[]\s*LU[^\)\]]*[\)\]]"        # (LU CODE: 293)  [LU 383]
    r"|\bLU\s*[:=]?\s*(?:CODE\s*[:=]?\s*)?\d+"  # LU=385
    r"|\*\s*NOT COVERED[^*]*\*?"          # *NOT COVERED BY ODB*
    r"|\bUNWRAP\s*&"
)
_SIG_FREQ = {"PRN", "QD", "BID", "TID", "QID", "HS", "QHS", "AM", "PM", "OD", "STAT"}


def _sig_risk_tokens(sig: Any) -> List[str]:
    """Tokens that carry dose / quantity / frequency meaning (anything with a digit, plus frequency words)."""
    text = _SIG_NOTE_RE.sub(" ", norm_sig(sig))
    toks = re.findall(r"[A-Z0-9]+", text)
    return sorted(t for t in toks if any(ch.isdigit() for ch in t) or t in _SIG_FREQ)


def sig_fix_is_safe(old: Any, new: Any) -> bool:
    """True when a sig fix only changes wording / adds a note (LU code, NOT COVERED, UNWRAP...). Any change to a
    dose, number, duration or frequency is NOT safe to auto-apply: it depends on the prescriber and patient."""
    return _sig_risk_tokens(old) == _sig_risk_tokens(new)


class Learner:
    """Two learning modes sharing one permanent store.

    Mode 1  learn_from_sql   background: reads finished Rx rows from Kroll and counts which sig each drug
                              (and each prescriber + drug) is normally given. Used only to SUGGEST a sig when a
                              pending Rx has none - never to overwrite one.
    Mode 2  learn_from_staff when staff change what PharmFlow planned, the fix is stored as a rule
                              (drug + wrong sig -> right sig). After SIG_APPLY_MIN_HITS identical fixes for the same
                              drug the rule is applied automatically next time. If staff then undo it, the rule is
                              dropped / replaced, so a wrong lesson corrects itself.
    Only wording / note fixes are auto-applied (SIG_APPLY_SAFE_ONLY=true): a fix that changes a dose, number or
    frequency stays a hint for staff. Quantity / refill / drug changes are recorded and never auto-applied.
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
                ready = kind == "sig_fix" and self.cfg.sig_apply_min_hits > 0 and rule["hits"] >= self.cfg.sig_apply_min_hits
                if ready and self.cfg.sig_apply_safe_only and not sig_fix_is_safe(sig, rule["target"]):
                    info["note"] = "changes dose/number/frequency - shown to staff, not applied"
                    ready = False
                if ready:
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
        by_id = bool(r["rx_id"])
        if not (r["rx_table"] and r["rx_drug_id"] and r["rx_sig"] and (by_id or r["rx_created"])):
            if not self._warned:
                self._warned = True
                self.log.info("SQL learning off: set rx_table, rx_drug_id, rx_sig and rx_id (or rx_created) in [RxSchema]")
            return
        if by_id:
            text = self._meta("sql_id_wm")
            wm: Any = int(text) if text else max(0, db.max_rx_id() - self.cfg.learn_backfill_rows)
            fetch = lambda w: db.fetch_rx_by_id(w, 500)
        else:
            text = self._meta("sql_wm")
            wm = dt.datetime.fromisoformat(text) if text else dt.datetime.now() - dt.timedelta(days=self.cfg.learn_backfill_days)
            fetch = lambda w: db.fetch_rx_history(w, 500)
        seen = 0
        for _ in range(20):                       # up to 10k rows per cycle, then continue next cycle
            rows = fetch(wm)
            if not rows:
                self._backlog = False
                break
            c = self._conn()
            try:
                for x in rows:
                    marker = x.get("id") if by_id else x.get("created")
                    if marker is not None and marker > wm:
                        wm = marker
                    ns = norm_sig(x.get("sig"))
                    if not ns or x.get("drug") in (None, ""):
                        continue
                    c.execute("""INSERT INTO usage(drug_id,doc_id,sig_norm,sig_raw,n) VALUES(?,?,?,?,1)
                                 ON CONFLICT(drug_id,doc_id,sig_norm) DO UPDATE SET n=n+1, sig_raw=excluded.sig_raw""",
                              (str(x["drug"]), str(x.get("doc") or ""), ns, str(x["sig"]).strip()))
                    seen += 1
                c.commit()
            finally:
                c.close()
            self._set_meta("sql_id_wm" if by_id else "sql_wm", str(wm) if by_id else wm.isoformat())
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
        self._last_inbound = -INBOUND_FAX_EVERY_SEC
        self._last_fax_learn = -FAX_LEARN_EVERY_SEC
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

    def _early_ocr(self, row: Dict[str, Any]) -> None:
        """A fax just arrived and staff have not filled the pending Rx in yet: read the fax image now and put it
        on the waiting list. When staff finish, the normal push updates the same entry (no duplicate) and the
        comparison / learning loop runs as usual. Never raises."""
        try:
            raw_id = row.get("PendingRxId")
            if raw_id is None or not self.cfg.cloud_enabled or not row.get("ScriptImageId"):
                return
            pid = int(raw_id)
            if self.store.has_early(pid) or self.store.is_processed(pid):
                return
            with_img = self.db.attach_image(row)
            if not with_img.get("page_image_data_url"):
                return
            payload = build_payload(row, self.cfg)          # no decision yet: staff have not entered it
            payload["page_images"] = [with_img["page_image_data_url"]]
            ok, err, _ = self.cloud.push_rx(payload)
            if ok:
                self.store.mark_early(pid)
                self.log.info("Fax for PendingRxId=%s read and placed on the waiting list (staff have not filled it in yet)", pid)
            else:
                self.log.warning("Early fax read failed for PendingRxId=%s (%s) - will retry", pid, err)
        except Exception as exc:
            self.log.warning("Early fax read skipped for PendingRxId=%s: %s", row.get("PendingRxId"), exc)

    def _poll_inbound_faxes(self) -> None:
        """Read faxes in Kroll's Inbound Docs (before staff make a pending Rx) and let the cloud OCR them.
        Read-only on Kroll. Every fax is tried at most INBOUND_FAX_MAX_TRIES times. Never raises."""
        if not (self.cfg.inbound_fax and self.cfg.cloud_enabled):
            return
        if time.monotonic() - self._last_inbound < INBOUND_FAX_EVERY_SEC:
            return
        self._last_inbound = time.monotonic()
        try:
            faxes = fetch_inbound_faxes(self.db.ensure(), 0, 50, self.cfg.inbound_fax_hours)
        except Exception as exc:
            self.log.warning("Could not list inbound faxes: %s", exc)
            return
        try:
            days = 60
            ids = fetch_kroll_pending_ids(self.db.ensure(), days)
            since = (dt.datetime.now() - dt.timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")
            if not self.cloud.push_kroll_pending(ids, since):
                self.log.warning("Could not tell the cloud which faxes are pending in Kroll")
            else:
                self.log.info("Kroll Pending list: %d fax(es)", len(ids))
        except Exception as exc:                                 # never block fax reading on this
            self.log.warning("Could not read Kroll's pending list: %s", str(exc)[:120])
        try:                                                     # who is the real Kroll patient on each new fax?
            for item in self.cloud.get_unresolved_faxes(10):
                script = ((item.get("ocr") or {}).get("scripts") or [{}])[0]
                kp = resolve_patient(self.db, script)
                self.cloud.push_kroll_enrich(int(item["mail_id"]), enrich_fax(self.db, script, kp))
                if self.cloud.push_kroll_patient(int(item["mail_id"]), kp):
                    self.log.info("Fax Mail=%s patient lookup by date of birth: %s (name fit %.2f, %d with that DOB)",
                                  item["mail_id"], kp["status"], kp["score"], kp["n_dob"])
        except Exception as exc:
            self.log.warning("Patient lookup by date of birth failed: %s", str(exc)[:120])
        done = 0
        for fax in reversed(faxes):                              # oldest first
            if done >= INBOUND_FAX_PER_CYCLE:
                break
            mid = int(fax["mail_id"])
            if self.store.fax_done(mid):
                continue
            sender = str(fax["from"] or "")
            if any(n and n in sender for n in self.cfg.inbound_fax_ignore):
                self.store.fax_mark_done(mid)
                continue
            done += 1
            try:
                raw = load_mail_attachment_bytes(self.db.ensure(), fax["content_id"])
                url = bytes_to_data_url(raw) if raw else None
                if not url:
                    self.log.warning("Inbound fax Mail=%s has no readable image; skipped", mid)
                    self.store.fax_mark_done(mid)
                    continue
                ok, err, body = self.cloud.push_fax({
                    "store_id": self.cfg.store_id, "mail_id": mid, "received": str(fax["received"]),
                    "from": sender[:80], "page_images": [url],
                    "agent": {"version": AGENT_CODE_VERSION, "hostname": socket.gethostname()},
                })
            except Exception as exc:
                ok, err, body = False, str(exc), {}
            if ok:
                self.store.fax_mark_done(mid)
                self.log.info("Inbound fax Mail=%s from %s read: %s%s", mid, sender[:30],
                              "PRESCRIPTION" if body.get("is_prescription") else "not a prescription",
                              f" ({body.get('summary')})" if body.get("summary") else "")
            else:
                tries = self.store.fax_bump(mid)
                self.log.warning("Inbound fax Mail=%s read failed (%s) - try %d of %d", mid, err, tries, INBOUND_FAX_MAX_TRIES)
                if tries >= INBOUND_FAX_MAX_TRIES:
                    self.store.fax_mark_done(mid)

    def _learn_from_pushed_faxes(self) -> None:
        """After staff push a fax to Kroll they may still change the sig there. Find the finished Rx, compare, and let
        the cloud store the correction (a wording fix is applied to the next fax automatically, a dose / frequency
        change only becomes a hint). Read-only on Kroll. Never raises."""
        r = self.cfg.rx_schema
        if not (self.cfg.cloud_enabled and r.get("rx_table")):
            return
        if time.monotonic() - self._last_fax_learn < FAX_LEARN_EVERY_SEC:
            return
        self._last_fax_learn = time.monotonic()
        try:
            items = self.cloud.get_pushed_faxes()
            now = dt.datetime.now(dt.timezone.utc)
            for item in items:
                pushed = item.get("pushed") or {}
                raw_at = str(item.get("pushed_at") or "")
                try:
                    at = dt.datetime.fromisoformat(raw_at.replace("Z", "+00:00"))
                except ValueError:
                    at = now
                # Kroll stores local server time: compare from the start of the day the fax was pushed
                since = at.astimezone().replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=None)
                found = find_finished_rx(self.db.ensure(), r, pushed, since, self.cfg.schema)
                if found is None and now - at < dt.timedelta(hours=FAX_LEARN_GIVE_UP_HOURS):
                    continue                                       # staff have not finished it in Kroll yet
                payload = {"type": "fax_result", "store_id": self.cfg.store_id, "mail_id": item.get("mail_id"),
                           "found": found is not None,
                           "final": ({"sig": found.get("rx_sig"), "qty": found.get("rx_qty"), "refills": found.get("rx_refills")}
                                     if found else None)}
                if self.cloud.push_fax_result(payload):
                    self.log.info("Pushed fax Mail=%s %s", item.get("mail_id"),
                                  "compared with Kroll's final Rx" if found else "closed (no matching Rx found)")
        except Exception as exc:
            self.log.warning("Learning from pushed faxes skipped: %s", exc)

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

            if err.startswith("HTTP 401"):
                # wrong/rotated agent key: the whole queue is fine, so keep it intact and wait for the key to be fixed
                self.log.warning("Cloud rejected the agent key (401) - keeping %d spooled payload(s); fix API_KEY / AGENT_API_KEY", len(items))
                break
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
        skipped = 0
        for d in self.store.load_uncompared(limit=100):
            if self.cfg.cloud_enabled and self.store.has_spooled(d["pending_rx_id"]):
                continue                                 # the cloud does not have this Rx yet; compare after it uploads
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
            if actual and self.learner and not self.store.has_learned(d["pending_rx_id"]):
                self.store.mark_learned(d["pending_rx_id"])   # first, so a failed upload below can never count it twice
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
                ok, err, permanent = self.cloud.push(result)
                if not ok:
                    if not permanent:                  # network / server trouble: try again next cycle
                        self.log.warning("Could not upload comparison for PendingRxId=%s: %s", d["pending_rx_id"], err)
                        return
                    skipped += 1                       # e.g. 404: the cloud has no waiting-list entry for this old Rx
            self.store.mark_compared(d["pending_rx_id"])
        if skipped:
            self.log.info("Skipped %d comparison(s) the cloud has no entry for (old prescriptions); learning from them was kept locally", skipped)

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
            elif now - dt.datetime.fromisoformat(first_seen) <= limit and not self.store.has_early(pid):
                self._early_ocr(row)                              # first attempt failed (cloud / image): try again
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
                    self._early_ocr(row)                    # ...but read the fax now and show it on the waiting list
                    continue
                self._process_row(row)
            if rows:
                top = max(int(r["PendingRxId"]) for r in rows if r.get("PendingRxId") is not None)
                self.store.set_watermark(max(top, watermark))
            self._recheck_incomplete()
            self._poll_inbound_faxes()
            self._learn_from_pushed_faxes()
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


def split_patient_name(full: str) -> Tuple[str, str]:
    """'Last, First' or 'First Middle Last' -> (first, last). Empty strings when it cannot be split."""
    text = " ".join(str(full or "").replace(".", " ").split())
    if not text:
        return "", ""
    if "," in text:
        last, _, first = text.partition(",")
        return first.strip().split(" ")[0] if first.strip() else "", last.strip()
    parts = text.split(" ")
    return (parts[0], parts[-1]) if len(parts) > 1 else ("", parts[0])


def find_finished_rx(conn, rx: Dict[str, str], pushed: Dict[str, Any], since: dt.datetime,
                     schema: Optional[Dict[str, str]] = None) -> Optional[Dict[str, Any]]:
    """Find the Rx staff finished in Kroll for a fax that was pushed (read-only SELECTs).
    Patient = name + date of birth in dbo.Pat; Rx = that patient + the pushed DIN, filled on/after `since`.
    Returns None when nothing matches yet, else {rx_sig, rx_qty, rx_refills}."""
    first, last = split_patient_name(pushed.get("patient"))
    dob = str(pushed.get("dob") or "")[:10]
    din = "".join(ch for ch in str(pushed.get("din") or "") if ch.isdigit())
    if not (last and dob and din and rx.get("rx_table") and rx.get("rx_pat_id") and rx.get("rx_sig") and rx.get("rx_created")):
        return None
    cur = conn.cursor()
    try:
        sc = schema or {}
        cur.execute(f"SELECT TOP 5 {sc.get('pat_id', 'ID')} FROM {sc.get('pat_table', 'dbo.Pat')} WITH (NOLOCK) "
                    f"WHERE {sc.get('pat_last', 'LastName')} = ? AND {sc.get('pat_first', 'FirstName')} LIKE ? "
                    f"AND CAST({sc.get('pat_dob', 'Birthday')} AS date) = ?", (last, (first or "") + "%", dob))
        pat_ids = [r[0] for r in cur.fetchall()]
        if not pat_ids:
            return None
        cols = [f"{rx[k]} AS {k}" for k in ("rx_sig", "rx_qty", "rx_refills") if rx.get(k)]
        marks = ",".join("?" for _ in pat_ids)
        cur.execute(f"SELECT TOP 1 {', '.join(cols)} FROM {rx['rx_table']} WITH (NOLOCK) "
                    f"WHERE {rx['rx_pat_id']} IN ({marks}) AND LTRIM(RTRIM(DIN)) = ? AND {rx['rx_created']} >= ? "
                    f"ORDER BY {rx['rx_created']} DESC", (*pat_ids, din.zfill(8), since))
        row = cur.fetchone()
        if row is None:
            return None
        return {c[0]: jsonable(v) for c, v in zip(cur.description, row)}
    finally:
        cur.close()


def _iso_date(text: Any) -> str:
    """'1943-01-14', '14/01/1943', 'Jan 14, 1943' ... -> '1943-01-14' ('' if unreadable)."""
    raw = str(text or "").strip()[:20]
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%d/%m/%Y", "%d-%m-%Y", "%b %d, %Y", "%B %d, %Y", "%d %b %Y", "%d %B %Y"):
        try:
            return dt.datetime.strptime(raw, fmt).date().isoformat()
        except ValueError:
            continue
    return ""


def _name_key(text: str) -> str:
    import unicodedata
    t = unicodedata.normalize("NFKD", str(text or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z ]+", " ", t)).strip()


def name_score(fax_name: str, first: str, last: str) -> float:
    """0..1 how well the name read from the fax fits a Kroll patient (handles typos, swapped order, nicknames in brackets)."""
    import difflib
    a = _name_key(fax_name)
    f, l = _name_key(first), _name_key(last)
    if not a or not (f or l):
        return 0.0
    seq = max(difflib.SequenceMatcher(None, a, f"{f} {l}").ratio(), difflib.SequenceMatcher(None, a, f"{l} {f}").ratio())
    toks = a.split()
    parts = [x for x in (f, l) if x]
    cover = sum(max(difflib.SequenceMatcher(None, p, t).ratio() for t in toks) for p in parts) / len(parts)
    return round(max(seq, cover), 3)


def _name_parts_score(fax_name: str, first: str, last: str) -> float:
    """Tie-breaker: how exactly the whole Kroll name appears in the fax name (extra middle names on the fax are fine)."""
    import difflib
    toks = _name_key(fax_name).split()
    f, l = _name_key(first), _name_key(last)
    if not toks or not l:
        return 0.0
    lb = max(difflib.SequenceMatcher(None, l, t).ratio() for t in toks)
    fb = max((difflib.SequenceMatcher(None, f, t).ratio() for t in toks), default=0.0) if f else 0.5
    return round(0.6 * lb + 0.4 * fb, 3)


def _postal(text: Any) -> str:
    m = re.search(r"[A-Za-z]\d[A-Za-z]\s*-?\s*\d[A-Za-z]\d", str(text or ""))
    return re.sub(r"[^A-Z0-9]", "", m.group(0).upper()) if m else ""


def _phone10(text: Any) -> str:
    d = re.sub(r"\D", "", str(text or ""))
    return d[-10:] if len(d) >= 10 else ""


def addr_score(fax_addr: Any, street: Any, city: Any = "", postal: Any = "") -> float:
    """0..1 how well an address read from the fax fits a Kroll address: postal code, street number, street name."""
    import difflib
    fa = str(fax_addr or "")
    if not fa.strip():
        return 0.0
    score = 0.0
    fp, kp_ = _postal(fa), _postal(postal) or _postal(street)
    if fp and kp_:
        score += 0.5 if fp == kp_ else (0.15 if fp[:3] == kp_[:3] else 0.0)
    fnum = re.search(r"\b(\d+[A-Za-z]?)\b", re.sub(_POSTAL_RE, " ", fa))
    knum = re.search(r"\b(\d+[A-Za-z]?)\b", str(street or ""))
    fwords = [w for w in _name_key(re.sub(_POSTAL_RE, " ", fa)).split() if len(w) > 2 and w not in ("street", "avenue", "road", "drive", "unit", "apt", "suite", "ontario", "canada")]
    kwords = [w for w in _name_key(street).split() if len(w) > 2 and w not in ("street", "avenue", "road", "drive", "unit", "apt", "suite")]
    if fnum and knum and fnum.group(1).lower() == knum.group(1).lower():
        score += 0.25
    if fwords and kwords:
        score += 0.25 * max(difflib.SequenceMatcher(None, a, b).ratio() for a in fwords for b in kwords)
    return round(min(score, 1.0), 3)


_POSTAL_RE = r"[A-Za-z]\d[A-Za-z]\s*-?\s*\d[A-Za-z]\d"


def _pat_extra(db: "KrollDB", cur, ids: List[Any]) -> Dict[Any, Tuple[str, str, str, str]]:
    """{pat_id: (address1, city, postal, birthday ISO)} for a few patients (read-only)."""
    s = db.cfg.schema
    cols = db.columns(s["pat_table"]) if hasattr(db, "columns") else {}
    sel = [f"[{cols[c]}]" if c in cols else "NULL" for c in ("ADDRESS1", "CITY", "POSTAL")]
    out: Dict[Any, Tuple[str, str, str, str]] = {}
    if not ids:
        return out
    marks = ",".join("?" for _ in ids)
    cur.execute(f"SELECT {s['pat_id']}, {', '.join(sel)}, {s['pat_dob']} FROM {s['pat_table']} WITH (NOLOCK) WHERE {s['pat_id']} IN ({marks})", tuple(ids))
    for r in cur.fetchall():
        b = r[4]
        out[r[0]] = (str(r[1] or ""), str(r[2] or ""), str(r[3] or ""), b.date().isoformat() if hasattr(b, "date") else str(b or "")[:10])
    return out


def _resolve_without_dob(db: "KrollDB", script: Dict[str, Any], out: Dict[str, Any]) -> Dict[str, Any]:
    """No (usable) date of birth on the fax: find the patient from the NAME and the ADDRESS together, active profiles only.
    Family members share an address, so an address alone is never enough: the name has to fit too."""
    s = db.cfg.schema
    patient = script.get("patient") or {}
    fax_name = str(patient.get("full_name") or "")
    fax_addr = str(patient.get("address") or "")
    if not (fax_name.strip() or fax_addr.strip()) or not s.get("pat_table"):
        return out
    act = db.active_clause(s["pat_table"]) if hasattr(db, "active_clause") else ""
    cols = db.columns(s["pat_table"]) if hasattr(db, "columns") else {}
    ids: List[Any] = []
    cur = db.ensure().cursor()
    try:
        first, last = split_patient_name(fax_name)
        if last:
            cur.execute(f"SELECT TOP 60 {s['pat_id']} FROM {s['pat_table']} WITH (NOLOCK) WHERE {s['pat_last']} LIKE ?{act}", (last[:3] + "%",))
            ids += [r[0] for r in cur.fetchall()]
        fp = _postal(fax_addr)
        if fp and "POSTAL" in cols:
            cur.execute(f"SELECT TOP 60 {s['pat_id']} FROM {s['pat_table']} WITH (NOLOCK) WHERE REPLACE([{cols['POSTAL']}], ' ', '') = ?{act}", (fp,))
            ids += [r[0] for r in cur.fetchall()]
        ids = list(dict.fromkeys(ids))[:100]
        if not ids:
            return out
        marks = ",".join("?" for _ in ids)
        cur.execute(f"SELECT {s['pat_id']}, {s['pat_first']}, {s['pat_last']} FROM {s['pat_table']} WITH (NOLOCK) WHERE {s['pat_id']} IN ({marks})", tuple(ids))
        people = cur.fetchall()
        extra = _pat_extra(db, cur, [r[0] for r in people])
    finally:
        cur.close()
    scored = []
    for r in people:
        a1, city, postal, bday = extra.get(r[0], ("", "", "", ""))
        ns = name_score(fax_name, str(r[1] or ""), str(r[2] or "")) if fax_name.strip() else 0.0
        ad = addr_score(fax_addr, a1, city, postal) if fax_addr.strip() else 0.0
        scored.append((ns, ad, r, bday))
    # accepted only when the name fits AND (the address fits, or there is no address on the fax and the name is near exact)
    def ok(x):
        ns, ad, _, _ = x
        if ad >= 0.7 and ns >= 0.5:
            return True
        if ns >= 0.9 and (ad >= 0.4 or not fax_addr.strip()):
            return True
        return False
    good = sorted([x for x in scored if ok(x)], key=lambda x: -(x[0] + x[1]))
    if not good:
        best = sorted(scored, key=lambda x: -(x[0] + x[1]))[:3]
        if best and best[0][0] >= 0.4 and best[0][0] + best[0][1] >= 0.9:
            ns, ad, r, bday = best[0]
            out.update({"status": "ambiguous", "pat_id": r[0], "first": str(r[1] or "").strip().title(), "last": str(r[2] or "").strip().title(),
                        "score": round(max(ns, ad), 3), "n_dob": 0, "dob": bday, "matched_by": "name+address",
                        "candidates": [{"first": str(x[2][1] or "").strip().title(), "last": str(x[2][2] or "").strip().title(), "score": round(x[0], 3)} for x in best]})
        return out
    ns, ad, r, bday = good[0]
    gap = ns - good[1][0] if len(good) > 1 else 1.0       # does the NAME tell the candidates apart (family at one address)?
    status = "exact" if (ns >= 0.95 and gap >= 0.1) else ("corrected" if gap >= 0.1 else "ambiguous")
    by = "address" if (ns < 0.9 and ad >= 0.7) else ("name+address" if ad >= 0.4 else "name")
    out.update({"status": status, "pat_id": r[0], "first": str(r[1] or "").strip().title(), "last": str(r[2] or "").strip().title(),
                "score": round(max(ns, ad), 3), "n_dob": 0, "dob": bday, "matched_by": by,
                "candidates": [{"first": str(x[2][1] or "").strip().title(), "last": str(x[2][2] or "").strip().title(), "score": round(x[0], 3)} for x in good[:3]]})
    return out


def resolve_patient(db: "KrollDB", script: Dict[str, Any]) -> Dict[str, Any]:
    """Find the REAL Kroll patient for a fax when the name on it may be misspelt: everyone with that date of birth,
    best name fit wins. status: exact | corrected | ambiguous | none. Read-only. Never raises."""
    out: Dict[str, Any] = {"status": "none", "pat_id": None, "first": "", "last": "", "score": 0.0, "n_dob": 0, "dob_swapped": False}
    try:
        s = db.cfg.schema
        patient = script.get("patient") or {}
        fax_name = str(patient.get("full_name") or "")
        dob = _iso_date(patient.get("dob"))
        if not (s.get("pat_table") and s.get("pat_dob")):
            return out
        if not dob:
            return _resolve_without_dob(db, script, out)
        dates = [(dob, False)]
        y, m, d = dob.split("-")
        if int(d) <= 12 and m != d:                       # day and month may be read the wrong way round
            dates.append((f"{y}-{d}-{m}", True))
        cur = db.ensure().cursor()
        try:
            for iso, swapped in dates:
                act = db.active_clause(s["pat_table"]) if hasattr(db, "active_clause") else ""   # active profiles only
                cur.execute(f"SELECT TOP 50 {s['pat_id']}, {s['pat_first']}, {s['pat_last']} FROM {s['pat_table']} WITH (NOLOCK) "
                            f"WHERE CAST({s['pat_dob']} AS date) = ?{act}", (iso,))
                rows = cur.fetchall()
                if not rows:
                    continue
                scored = sorted(((name_score(fax_name, str(r[1] or ""), str(r[2] or "")), r) for r in rows), key=lambda x: -x[0])
                best, row = scored[0]
                second = scored[1][0] if len(scored) > 1 else 0.0
                tie_broken = False
                if len(scored) > 1 and best - second < 0.05 and best >= 0.85:
                    # Several patients fit equally: prefer the one whose WHOLE name is on the fax, then the one the
                    # pharmacy has actually been dispensing for (duplicate / old records have no recent Rx).
                    tied = [x for x in scored if best - x[0] < 0.05]
                    tied.sort(key=lambda x: -_name_parts_score(fax_name, str(x[1][1] or ""), str(x[1][2] or "")))
                    top, nxt = tied[0], tied[1]
                    if _name_parts_score(fax_name, str(top[1][1] or ""), str(top[1][2] or "")) - \
                            _name_parts_score(fax_name, str(nxt[1][1] or ""), str(nxt[1][2] or "")) >= 0.1:
                        row, best, second, tie_broken = top[1], top[0], 0.0, True
                    elif str(patient.get("address") or "").strip() and hasattr(db, "columns"):
                        # same DOB, near-identical names: the address on the fax decides
                        ex = _pat_extra(db, cur, [x[1][0] for x in tied[:4]])
                        ads = sorted(((addr_score(patient.get("address"), *ex.get(x[1][0], ("", "", ""))[:3]), x) for x in tied[:4]), key=lambda a: -a[0])
                        if ads[0][0] >= 0.6 and ads[0][0] - (ads[1][0] if len(ads) > 1 else 0) >= 0.3:
                            row, best, second, tie_broken = ads[0][1][1], ads[0][1][0], 0.0, True
                    if not tie_broken:
                        r = db.cfg.rx_schema
                        if r.get("rx_table") and r.get("rx_pat_id"):
                            counts = []
                            for sc, cand in tied[:4]:
                                cur.execute(f"SELECT COUNT(*) FROM {r['rx_table']} WITH (NOLOCK) WHERE [{r['rx_pat_id']}] = ?"
                                            + (f" AND [{r['rx_created']}] >= DATEADD(month, -18, GETDATE())" if r.get("rx_created") else ""),
                                            (cand[0],))
                                counts.append((int(cur.fetchone()[0]), sc, cand))
                            counts.sort(key=lambda x: -x[0])
                            if counts[0][0] > 0 and counts[0][0] >= 2 * max(counts[1][0], 1) - 1 and counts[0][0] > counts[1][0]:
                                row, best, second, tie_broken = counts[0][2], counts[0][1], 0.0, True
                out.update({"n_dob": len(rows), "dob_swapped": swapped, "score": best, "tie_broken": tie_broken, "dob": iso, "matched_by": "dob",
                            "pat_id": row[0], "first": str(row[1] or "").strip().title(), "last": str(row[2] or "").strip().title(),
                            "candidates": [{"first": str(x[1][1] or "").strip().title(), "last": str(x[1][2] or "").strip().title(),
                                            "score": x[0]} for x in scored[:3]]})
                if swapped and best < 0.6:                # a swapped date needs a clearly matching name
                    out.update({"status": "none", "pat_id": None, "first": "", "last": ""})
                    continue
                if best >= 0.85 and best - second >= 0.05:
                    out["status"] = "exact"
                elif (len(rows) == 1 and best >= 0.4) or (best >= 0.6 and best - second >= 0.15):
                    out["status"] = "corrected"
                else:
                    out["status"] = "ambiguous"
                break
            if out["status"] == "none":              # nobody with that date of birth fits: try the name + address
                return _resolve_without_dob(db, script, out)
            return out
        finally:
            cur.close()
    except Exception:  # noqa: BLE001
        pass
    return out


def enrich_fax(db: "KrollDB", script: Dict[str, Any], kp: Dict[str, Any]) -> Dict[str, Any]:
    """Check one OCR'd prescription against Kroll and say what Kroll knows: the doctor (by licence, else by name), the
    drug products (DIN candidates, which one this patient had before), and the patient's last Rx of it. Read-only.
    `fills` holds only the SAFE gap-fills (a missing licence found by name, a missing DIN with one clear product).
    Dose / quantity / refills are never changed: the last Rx is only shown as a suggestion. Never raises."""
    out: Dict[str, Any] = {"doctor": {"status": "none"}, "drug": {"candidates": [], "pick": None, "reason": ""},
                           "last_rx": None, "fills": {}}
    try:
        s, rx = db.cfg.schema, db.cfg.rx_schema
        doc = script.get("prescriber") or {}
        med = (script.get("medications") or [{}])[0]
        cur = db.ensure().cursor()
        try:
            # ---- doctor
            lic = "".join(ch for ch in str(doc.get("license_number") or "") if ch.isalnum())
            fax_first, fax_last = split_patient_name(re.sub(r"\b(dr|md|doctor|m\.d)\b\.?", " ", str(doc.get("name") or ""), flags=re.I))
            ids: List[Any] = []
            how = ""
            dact = db.active_clause(s["doc_table"]) if (hasattr(db, "active_clause") and s.get("doc_table")) else ""
            dcols = db.columns(s["doc_table"]) if (hasattr(db, "columns") and s.get("doc_table")) else {}
            lic_cols = [dcols[c] for c in ("LICENCE1", "LICENCE2", "LICENSE1", "LICENSE2") if c in dcols]
            if lic and s.get("doc_table"):
                conds, params = [], []
                if s.get("lic_table") and s.get("lic_num"):
                    conds.append(f"{s['doc_id']} IN (SELECT {s['lic_doc_id']} FROM {s['lic_table']} WITH (NOLOCK) WHERE {s['lic_num']} = ?)")
                    params.append(lic)
                for c in lic_cols:
                    conds.append(f"[{c}] = ?")
                    params.append(lic)
                if conds:
                    cur.execute(f"SELECT TOP 3 {s['doc_id']} FROM {s['doc_table']} WITH (NOLOCK) WHERE ({' OR '.join(conds)}){dact}", tuple(params))
                    ids = [r[0] for r in cur.fetchall()]
                    how = "licence"
            if not ids and fax_last and s.get("doc_table") and s.get("doc_last"):
                order = f" ORDER BY [{dcols['LASTUSED']}] DESC" if "LASTUSED" in dcols else ""
                for exact in (True, False):          # exact last name first, then "starts with" (spelling slips)
                    op, val = ("= ?", fax_last) if exact else ("LIKE ?", fax_last[:5] + "%")
                    if not exact and len(fax_last) < 5:
                        break
                    q = f"SELECT TOP 6 {s['doc_id']} FROM {s['doc_table']} WITH (NOLOCK) WHERE {s['doc_last']} {op}"
                    prm: Tuple[Any, ...] = (val,)
                    if fax_first and s.get("doc_first"):
                        q += f" AND LEFT({s['doc_first']}, 1) = ?"
                        prm = (val, fax_first[:1])
                    cur.execute(q + dact + order, prm)
                    ids = [r[0] for r in cur.fetchall()]
                    how = "name"
                    if ids:
                        break
            # Name wrong / not found, or several doctors share it: the clinic's phone, fax and address on the fax decide.
            dc = db.doc_contact_table() if (hasattr(db, "doc_contact_table") and s.get("doc_table")) else None
            fax_phones = [x for x in (_phone10(doc.get("phone")), _phone10(doc.get("fax"))) if x]
            fax_addr = str(doc.get("address") or "")
            by_addr = False
            if dc and (fax_phones or _postal(fax_addr)) and not (how == "licence" and ids) and (not ids or len(ids) > 1):
                conds, prm2 = [], []
                for ph in fax_phones:
                    for col in (dc["phone"], dc["fax"]):
                        if col:
                            conds.append("REPLACE(REPLACE(REPLACE(REPLACE(REPLACE([%s], '-', ''), ' ', ''), '(', ''), ')', ''), '.', '') LIKE ?" % col)
                            prm2.append("%" + ph)
                if _postal(fax_addr) and dc["postal"]:
                    conds.append("REPLACE([%s], ' ', '') = ?" % dc["postal"])
                    prm2.append(_postal(fax_addr))
                if conds:
                    q = (f"SELECT TOP 8 {s['doc_id']} FROM {s['doc_table']} WITH (NOLOCK) WHERE {s['doc_id']} IN "
                         f"(SELECT [{dc['doc_id']}] FROM {dc['table']} WITH (NOLOCK) WHERE {' OR '.join(conds)}){dact}")
                    if ids:                                   # narrow the name matches
                        q += f" AND {s['doc_id']} IN ({','.join('?' for _ in ids)})"
                        prm2 += list(ids)
                    cur.execute(q, tuple(prm2))
                    cand = [r[0] for r in cur.fetchall()]
                    if cand and ids and len(cand) < len(ids):
                        ids, how, by_addr = cand, "name", True
                    elif cand and not ids:
                        # nothing matched by name: take the clinic's doctors, best name fit first (a wrong name still resembles)
                        scored_d = []
                        for did in cand:
                            cur.execute(f"SELECT TOP 1 {s['doc_first']}, {s['doc_last']} FROM {s['doc_table']} WITH (NOLOCK) WHERE {s['doc_id']} = ?", (did,))
                            rr = cur.fetchone()
                            scored_d.append((name_score(fax_last or str(doc.get("name") or ""), "", str(rr[1] or "")) if rr else 0.0, did))
                        scored_d.sort(reverse=True)
                        if len(cand) == 1 and (scored_d[0][0] >= 0.4 or not fax_last):
                            ids, how, by_addr = [scored_d[0][1]], "address", True
                        elif scored_d[0][0] >= 0.5 and (len(scored_d) == 1 or scored_d[0][0] - scored_d[1][0] >= 0.15):
                            ids, how, by_addr = [scored_d[0][1]], "address", True
            if len(ids) >= 1 and s.get("doc_table"):
                cur.execute(f"SELECT TOP 1 {s['doc_first']}, {s['doc_last']} FROM {s['doc_table']} WITH (NOLOCK) WHERE {s['doc_id']} = ?", (ids[0],))
                r = cur.fetchone()
                dfirst, dlast = (str(r[0] or "").strip().title(), str(r[1] or "").strip().title()) if r else ("", "")
                kroll_lic = lic if how == "licence" else ""
                if how in ("name", "address") and len(ids) == 1:
                    if s.get("lic_table") and s.get("lic_num"):
                        cur.execute(f"SELECT TOP 1 {s['lic_num']} FROM {s['lic_table']} WITH (NOLOCK) WHERE {s['lic_doc_id']} = ?", (ids[0],))
                        r2 = cur.fetchone()
                        kroll_lic = str(r2[0] or "").strip() if r2 else ""
                    if not kroll_lic and lic_cols:
                        cur.execute(f"SELECT TOP 1 {', '.join('[' + c + ']' for c in lic_cols)} FROM {s['doc_table']} WITH (NOLOCK) WHERE {s['doc_id']} = ?", (ids[0],))
                        r3 = cur.fetchone()
                        kroll_lic = next((str(v).strip() for v in (r3 or ()) if v and str(v).strip()), "")
                name_ok = None
                if fax_last and dlast:
                    name_ok = name_score(fax_last, "", dlast) >= 0.8
                status = "found" if how == "licence" else ("by_address" if (how == "address" or by_addr) and len(ids) == 1 else ("by_name" if len(ids) == 1 else "several"))
                out["doctor"] = {"status": status, "doc_id": ids[0] if len(ids) == 1 or how == "licence" else None,
                                 "first": dfirst, "last": dlast, "licence": kroll_lic, "name_ok": name_ok}
                if how in ("name", "address") and len(ids) == 1 and kroll_lic and not lic:
                    out["fills"]["licence"] = kroll_lic
                if status == "by_address" and dlast and _name_key(fax_last) != _name_key(dlast):     # the name on the fax is wrong: Kroll's is right
                    out["fills"]["doctor_name"] = f"{dfirst} {dlast}".strip()
            # ---- drugs: every medication on the fax, not just the first
            meds_out = []
            for m_ in (script.get("medications") or []):
                try:
                    d_, lr_, fd_ = _enrich_drug(db, cur, m_, kp)
                except Exception as exc:  # noqa: BLE001
                    d_, lr_, fd_ = {"candidates": [], "pick": None, "reason": ""}, None, ""
                meds_out.append({"drug": d_, "last_rx": lr_, "din_fill": fd_})
            out["meds"] = meds_out
            if meds_out:
                out["drug"], out["last_rx"] = meds_out[0]["drug"], meds_out[0]["last_rx"]
                if meds_out[0]["din_fill"]:
                    out["fills"]["din"] = meds_out[0]["din_fill"]
        finally:
            cur.close()
    except Exception as exc:  # noqa: BLE001
        out["error"] = str(exc)[:80]
    return out


def _enrich_drug(db: "KrollDB", cur, med: Dict[str, Any], kp: Dict[str, Any]) -> Tuple[Dict[str, Any], Optional[Dict[str, Any]], str]:
    """DIN candidates for one medication on the fax, the pick (if clear), the patient's last Rx of it, and the DIN to auto-fill."""
    rx = db.cfg.rx_schema
    empty = {"candidates": [], "pick": None, "reason": ""}
    if not med.get("drug_name") or med.get("is_compound"):
        return empty, None, ""
    last_rx = None
    fill_din = ""
    cands = db.search_drugs(med.get("drug_name", ""), med.get("strength", ""))
    pat_id = kp.get("pat_id") if kp and kp.get("status") in ("exact", "corrected", "ambiguous") else None
    hist: Dict[Any, Dict[str, Any]] = {}
    if cands and pat_id is not None and rx.get("rx_table") and rx.get("rx_pat_id") and rx.get("rx_drug_id"):
        marks = ",".join("?" for _ in cands)
        cols = ", ".join(f"{rx[k]} AS {k}" for k in ("rx_drug_id", "rx_sig", "rx_qty", "rx_refills", "rx_created") if rx.get(k))
        cur.execute(f"SELECT TOP 5 {cols} FROM {rx['rx_table']} WITH (NOLOCK) "
                    f"WHERE {rx['rx_pat_id']} = ? AND {rx['rx_drug_id']} IN ({marks}) "
                    f"ORDER BY {rx.get('rx_created') or rx['rx_id']} DESC", (pat_id, *[c["drug_id"] for c in cands]))
        for row in cur.fetchall():
            got = {c[0]: jsonable(v) for c, v in zip(cur.description, row)}
            hist.setdefault(got.get("rx_drug_id"), got)
    out_c = []
    for c in cands[:5]:
        h = hist.get(c["drug_id"])
        out_c.append({"din": c["din"], "name": c["name"], "uses": c.get("uses", 0), "in_history": bool(h)})
    fax_din = re.sub(r"\D", "", str(med.get("din") or ""))
    pick, reason = None, ""
    in_hist = [c for c in out_c if c["in_history"]]
    if fax_din and any(c["din"].lstrip("0") == fax_din.lstrip("0") for c in out_c):
        pick, reason = next(c["din"] for c in out_c if c["din"].lstrip("0") == fax_din.lstrip("0")), "DIN on the fax is a Kroll product"
    elif len(out_c) == 1:
        pick, reason = out_c[0]["din"], "only matching product in Kroll"
    elif len(in_hist) == 1:
        pick, reason = in_hist[0]["din"], "this patient got this product before"
    elif len(in_hist) > 1:
        recent = next(iter(hist))
        pick, reason = next(c["din"] for c in cands if c["drug_id"] == recent), "the product this patient got most recently"
    elif len(out_c) > 1 and out_c[0]["uses"] >= 3 and out_c[0]["uses"] >= 3 * max(out_c[1]["uses"], 1):
        pick, reason = out_c[0]["din"], f"the product this pharmacy dispenses most ({out_c[0]['uses']} in 12 months)"
    drug = {"candidates": out_c, "pick": pick, "reason": reason}
    fill_din = pick if (pick and not fax_din) else ""
    if hist:
        best = next(iter(hist.values()))
        last_rx = {"din": next((c["din"] for c in cands if c["drug_id"] == best.get("rx_drug_id")), ""),
                          "sig": best.get("rx_sig"), "qty": best.get("rx_qty"), "refills": best.get("rx_refills"),
                          "filled": str(best.get("rx_created") or "")[:10]}
    return drug, last_rx, fill_din


def kroll_match(db: "KrollDB", script: Dict[str, Any]) -> Dict[str, Any]:
    """Read-only check of one OCR'd prescription against Kroll. Never writes.
    patient: none | one | several (name + date of birth). drug_in_history: did that patient get this drug before.
    doctor: found | none (licence number). Returns plain facts, the cloud/app decides what is 'ready'."""
    cfg = db.cfg
    s, rx = cfg.schema, cfg.rx_schema
    out: Dict[str, Any] = {"patient": "none", "patient_id": None, "dob_ok": False, "drug_candidates": 0,
                           "drug_in_history": False, "last": None, "doctor": "none", "doctor_name_ok": None}
    patient = script.get("patient") or {}
    med = (script.get("medications") or [{}])[0]
    doc = script.get("prescriber") or {}
    first, last = split_patient_name(patient.get("full_name"))
    dob = _iso_date(patient.get("dob"))
    cur = db.ensure().cursor()
    try:
        if last and dob:
            cur.execute(f"SELECT TOP 10 {s['pat_id']}, {s['pat_first']} FROM {s['pat_table']} WITH (NOLOCK) "
                        f"WHERE {s['pat_last']} = ? AND CAST({s['pat_dob']} AS date) = ?", (last, dob))
            rows = [(r[0], str(r[1] or "").strip().lower()) for r in cur.fetchall()]
            want = (first or "").strip().lower()
            # same last name + same birth date; narrow by first name: exact, then starts-with, then same initial
            pick = [r for r in rows if want and r[1] == want]
            fuzzy = False
            if not pick and want:
                pick = [r for r in rows if r[1].startswith(want) or want.startswith(r[1]) and r[1]]
            if not pick and want:
                pick = [r for r in rows if r[1][:1] == want[:1]]
                fuzzy = bool(pick)
            if not pick and not want:
                pick = rows
            ids = [r[0] for r in pick]
            out["patient"] = "none" if not ids else "one" if len(ids) == 1 else "several"
            out["dob_ok"] = bool(ids)
            out["patient_fuzzy"] = fuzzy
            if len(ids) == 1:
                out["patient_id"] = ids[0]
        cands = db.search_drugs(med.get("drug_name", ""), med.get("strength", "")) if med.get("drug_name") else []
        out["drug_candidates"] = len(cands)
        if out["patient_id"] is not None and cands and rx.get("rx_table") and rx.get("rx_pat_id") and rx.get("rx_drug_id"):
            marks = ",".join("?" for _ in cands)
            cols = ", ".join(f"{rx[k]} AS {k}" for k in ("rx_drug_id", "rx_sig", "rx_qty", "rx_doc_id", "rx_created") if rx.get(k))
            cur.execute(f"SELECT TOP 1 {cols} FROM {rx['rx_table']} WITH (NOLOCK) "
                        f"WHERE {rx['rx_pat_id']} = ? AND {rx['rx_drug_id']} IN ({marks}) "
                        f"ORDER BY {rx.get('rx_created') or rx['rx_id']} DESC",
                        (out["patient_id"], *[c["drug_id"] for c in cands]))
            row = cur.fetchone()
            if row is not None:
                got = {c[0]: jsonable(v) for c, v in zip(cur.description, row)}
                out["drug_in_history"] = True
                din = next((c["din"] for c in cands if c["drug_id"] == got.get("rx_drug_id")), "")
                out["last"] = {"din": din, "sig": got.get("rx_sig"), "qty": got.get("rx_qty"),
                               "filled": got.get("rx_created")}
        lic = "".join(ch for ch in str(doc.get("license_number") or "") if ch.isalnum())
        if lic and s.get("lic_table") and s.get("lic_num"):
            cur.execute(f"SELECT TOP 3 {s['lic_doc_id']} FROM {s['lic_table']} WITH (NOLOCK) WHERE {s['lic_num']} = ?", (lic,))
            doc_ids = [r[0] for r in cur.fetchall()]
            if doc_ids:
                out["doctor"] = "found"
                dlast = split_patient_name(doc.get("name"))[1].lower()
                if dlast and s.get("doc_table") and s.get("doc_last"):
                    cur.execute(f"SELECT TOP 1 {s['doc_last']} FROM {s['doc_table']} WITH (NOLOCK) WHERE {s['doc_id']} = ?",
                                (doc_ids[0],))
                    r = cur.fetchone()
                    out["doctor_name_ok"] = bool(r and str(r[0] or "").strip().lower() == dlast)
    finally:
        cur.close()
    return out


def fetch_inbound_faxes(conn, after_mail_id: int = 0, limit: int = 50,
                        since_hours: Optional[float] = None) -> List[Dict[str, Any]]:
    """Inbound fax list (Kroll "Inbound Docs"): dbo.Mail rows with MessageType 19 from the fax service (SRFax),
    each with its image in dbo.MailAttachment -> MailAttachmentContent. SELECT only, newest first."""
    sql = (
        "SELECT TOP (?) m.Id, m.DateCreated, m.MailFrom, a.Id, a.MailAttachmentContentId, a.ContentMimeType "
        "FROM dbo.Mail m WITH (NOLOCK) JOIN dbo.MailAttachment a WITH (NOLOCK) ON a.MailId = m.Id "
        "WHERE m.MessageType = 19 AND m.MessageId LIKE 'SRFax.%' AND m.Id > ? "
        + ("AND m.DateCreated >= DATEADD(minute, -?, GETDATE()) " if since_hours else "")
        + "ORDER BY m.Id DESC"
    )
    params: List[Any] = [int(limit), int(after_mail_id)]
    if since_hours:
        params.append(int(since_hours * 60))
    cur = conn.cursor()
    try:
        cur.execute(sql, tuple(params))
        rows = cur.fetchall()
    finally:
        cur.close()
    return [{"mail_id": r[0], "received": r[1], "from": (r[2] or ""), "attachment_id": r[3],
             "content_id": r[4], "mime": r[5]} for r in rows]


def fetch_kroll_pending_ids(conn, days: int = 60) -> List[int]:
    """Mail ids of inbound faxes still in Kroll's Inbound Docs 'Pending' list: unread and not deleted for the recipient
    (checked against Kroll's own count: 7 in the list = 7 here). SELECT only."""
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT DISTINCT m.Id FROM dbo.Mail m WITH (NOLOCK) JOIN dbo.MailRecipient r WITH (NOLOCK) ON r.MailId = m.Id "
            "WHERE m.MessageType = 19 AND m.MessageId LIKE 'SRFax.%' AND r.DateRead IS NULL AND r.DateDeleted IS NULL "
            "AND m.DateCreated >= DATEADD(day, -?, GETDATE())", (int(days),))
        return [int(r[0]) for r in cur.fetchall()]
    finally:
        cur.close()


def load_mail_attachment_bytes(conn, content_id: Any) -> Optional[bytes]:
    """Image bytes of one inbound fax from dbo.MailAttachmentContent (the binary column is found by itself)."""
    if not content_id:
        return None
    cur = conn.cursor()
    try:
        cur.execute("SELECT TOP 1 * FROM dbo.MailAttachmentContent WITH (NOLOCK) WHERE Id = ?", (content_id,))
        row = cur.fetchone()
        if not row:
            return None
        cols = [c[0] for c in cur.description]
    finally:
        cur.close()
    best, comp = None, None
    for name, val in zip(cols, row):
        if isinstance(val, (bytes, bytearray, memoryview)):
            b = bytes(val)
            if best is None or len(b) > len(best):
                best = b
        elif "compression" in name.lower():
            comp = val
    if best is None or len(best) < 32:
        return None
    return _decode_content(best, comp)


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
    parser.add_argument("--requeue-dead", type=int, metavar="FROM_ID",
                        help="retry payloads that were parked after failed uploads (PendingRxId >= FROM_ID), then exit")
    parser.add_argument("--learning-report", action="store_true",
                        help="show what the agent has learned so far (no patient data) and exit")
    parser.add_argument("--inbound-test", type=int, nargs="?", const=10, metavar="N",
                        help="list the newest N inbound faxes (Kroll Inbound Docs) and check their images load, then exit")
    parser.add_argument("--match-test", type=int, nargs="?", const=10, metavar="N",
                        help="check the newest N prescription faxes against Kroll (patient, drug history, doctor) and "
                             "print yes/no results only (no names), then exit")
    parser.add_argument("--pending-test", action="store_true",
                        help="count inbound faxes by processed/pending markers (no patient data) and exit")
    parser.add_argument("--drug-test", nargs="+", metavar="TEXT",
                        help="show how Kroll's drug table names a drug, e.g. --drug-test candesartan 4 mg (drug names only)")
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

    if args.drug_test:
        logger = setup_logging(cfg.agent_version)
        db = KrollDB(cfg, logger)
        text = " ".join(args.drug_test)
        ds = db._resolve_drug_schema() or {}
        print("drug schema:", ds)
        found = db.search_drugs(text)
        print(f"search_drugs({text!r}) -> {len(found)} product(s)")
        for f in found[:8]:
            print("  ", f)
        word = max((w for w in re.split(r"[^a-z]+", text.lower()) if w not in KrollDB._NOISE), key=len, default="")
        if ds and word:
            cur = db.ensure().cursor()
            cur.execute(f"SELECT TOP 10 [{ds['drug_id']}], [{ds['drug_din']}], [{ds['drug_name']}] FROM {ds['drug_table']} "
                        f"WITH (NOLOCK) WHERE [{ds['drug_name']}] LIKE ?", (f"%{word}%",))
            print(f"raw rows containing {word!r}:")
            for row in cur.fetchall():
                print("  ", " | ".join(str(v) for v in row))
            # Which column of the drug table holds the generic name? Columns and sample drug names only (no patient data).
            tbl = ds["drug_table"].split(".")[-1]
            cur.execute("SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = ?", (tbl,))
            cols = cur.fetchall()
            print(f"columns of {tbl}:", ", ".join(f"{c[0]}:{c[1]}" for c in cols))
            for c in cols:
                if c[1] in ("varchar", "nvarchar", "char") and IDENT_RE.match(c[0]):
                    try:
                        cur.execute(f"SELECT COUNT(*) FROM {ds['drug_table']} WITH (NOLOCK) WHERE [{c[0]}] LIKE ?", (f"%{word[:6]}%",))
                        print(f"  column {c[0]}: {cur.fetchone()[0]} row(s) containing {word[:6]!r}")
                    except Exception as exc:  # noqa: BLE001
                        print(f"  column {c[0]}: error {str(exc)[:60]}")
            cur.execute(f"SELECT COUNT(*) FROM {ds['drug_table']} WITH (NOLOCK)")
            print("rows in drug table:", cur.fetchone()[0])
            cur.execute(f"SELECT TOP 12 [{ds['drug_id']}], [{ds['drug_din']}], [{ds['drug_name']}] FROM {ds['drug_table']} WITH (NOLOCK) "
                        f"WHERE [{ds['drug_name']}] LIKE ? ORDER BY [{ds['drug_id']}] DESC", (f"{word[:1].upper()}%",))
            print(f"sample drug names starting with {word[:1].upper()!r}:")
            for row in cur.fetchall():
                print("  ", " | ".join(str(v) for v in row))
        return 0

    if args.pending_test:
        logger = setup_logging(cfg.agent_version)
        cur = KrollDB(cfg, logger).ensure().cursor()
        cur.execute(
            "SELECT CASE WHEN a.ScriptImageId IS NULL THEN 'no' ELSE 'yes' END AS script_image, "
            "CASE WHEN m.SenderDateDeleted IS NULL THEN 'no' ELSE 'yes' END AS deleted, "
            "CASE WHEN m.PatId IS NULL THEN 'no' ELSE 'yes' END AS patient_linked, "
            "CASE WHEN m.RxNum IS NULL THEN 'no' ELSE 'yes' END AS rx_linked, "
            "CASE WHEN m.DateCreated >= DATEADD(day,-7,GETDATE()) THEN 'last 7 days' ELSE 'older' END AS age, "
            "COUNT(*) AS n FROM dbo.Mail m WITH (NOLOCK) JOIN dbo.MailAttachment a WITH (NOLOCK) ON a.MailId = m.Id "
            "WHERE m.MessageType = 19 AND m.MessageId LIKE 'SRFax.%' "
            "GROUP BY CASE WHEN a.ScriptImageId IS NULL THEN 'no' ELSE 'yes' END, "
            "CASE WHEN m.SenderDateDeleted IS NULL THEN 'no' ELSE 'yes' END, "
            "CASE WHEN m.PatId IS NULL THEN 'no' ELSE 'yes' END, CASE WHEN m.RxNum IS NULL THEN 'no' ELSE 'yes' END, "
            "CASE WHEN m.DateCreated >= DATEADD(day,-7,GETDATE()) THEN 'last 7 days' ELSE 'older' END "
            "ORDER BY 6 DESC")
        print("script_image | deleted | patient_linked | rx_linked | age | count")
        for row in cur.fetchall():
            print(" | ".join(str(v) for v in row))
        print("\n-- last 7 days, by recipient markers (folder / read / deleted / flagged) --")
        try:
            cur.execute(
                "SELECT r.FolderId, CASE WHEN r.DateRead IS NULL THEN 'unread' ELSE 'read' END, "
                "CASE WHEN r.DateDeleted IS NULL THEN 'not deleted' ELSE 'deleted' END, r.Flagged, COUNT(*) "
                "FROM dbo.Mail m WITH (NOLOCK) JOIN dbo.MailRecipient r WITH (NOLOCK) ON r.MailId = m.Id "
                "WHERE m.MessageType = 19 AND m.MessageId LIKE 'SRFax.%' AND m.DateCreated >= DATEADD(day,-7,GETDATE()) "
                "GROUP BY r.FolderId, CASE WHEN r.DateRead IS NULL THEN 'unread' ELSE 'read' END, "
                "CASE WHEN r.DateDeleted IS NULL THEN 'not deleted' ELSE 'deleted' END, r.Flagged ORDER BY 5 DESC")
            print("folder | read | deleted | flagged | count")
            for row in cur.fetchall():
                print(" | ".join(str(v) for v in row))
        except Exception as exc:  # noqa: BLE001
            print("recipient query failed:", str(exc)[:150])
        print("\nCompare with Kroll: Inbound Docs badge / the 'Pending' list count shown right now.")
        return 0

    if args.match_test:
        logger = setup_logging(cfg.agent_version)
        db = KrollDB(cfg, logger)
        items = CloudClient(cfg, logger).get_recent_fax_scripts(args.match_test)
        print(f"{len(items)} recent prescription fax(es) from the cloud\n")
        tally = {"patient_one": 0, "drug_in_history": 0, "doctor_found": 0}
        for i, item in enumerate(items, 1):
            script = ((item.get("ocr") or {}).get("scripts") or [{}])[0]
            try:
                m = kroll_match(db, script)
            except Exception as exc:  # noqa: BLE001
                print(f"{i:>2}. FAILED: {str(exc)[:120]}")
                continue
            tally["patient_one"] += m["patient"] == "one"
            tally["drug_in_history"] += bool(m["drug_in_history"])
            tally["doctor_found"] += m["doctor"] == "found"
            print(f"{i:>2}. patient={m['patient']:<7} dob_match={'yes' if m['dob_ok'] else 'no ':<3} "
                  f"drug_products_in_kroll={m['drug_candidates']:<3} drug_in_patient_history={'yes' if m['drug_in_history'] else 'no ':<3} "
                  f"doctor={m['doctor']:<5} doctor_name_matches={m['doctor_name_ok']}")
        print(f"\nSummary of {len(items)}: patient found exactly once {tally['patient_one']}, "
              f"drug already in history {tally['drug_in_history']}, doctor found by licence {tally['doctor_found']}")
        return 0

    if args.inbound_test:
        logger = setup_logging(cfg.agent_version)
        conn = KrollDB(cfg, logger).ensure()
        for f in fetch_inbound_faxes(conn, 0, args.inbound_test):
            raw = load_mail_attachment_bytes(conn, f["content_id"])
            kind = "no image"
            if raw:
                kind = ("TIFF" if raw[:4] in (b"II*\x00", b"MM\x00*") else "PDF" if raw[:4] == b"%PDF"
                        else "PNG" if raw[:4] == b"\x89PNG" else "JPEG" if raw[:3] == b"\xff\xd8\xff" else raw[:4].hex())
                kind += f" {len(raw):,} bytes"
            print(f"Mail {f['mail_id']} | {f['received']} | {f['from'][:40]} | {kind}")
        return 0

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

    if args.requeue_dead is not None:
        logger = setup_logging(cfg.agent_version)
        revived, reset = LocalStore(SQLITE_PATH, logger).requeue_dead(args.requeue_dead)
        print(f"Re-queued {revived} parked payload(s); {reset} staff comparison(s) will run again once they upload. "
              "The running agent picks them up within a minute; no restart needed.")
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
