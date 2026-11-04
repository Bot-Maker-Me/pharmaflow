"""
PharmFlow agent entrypoint.

1) Ensures the last good flow body is present (downloads from GitHub if missing/corrupt).
2) Injects SHADOW auto-learn hooks (staff Rx = ground truth on mismatch).
3) Runs the agent.
"""
from __future__ import annotations

import importlib.util
import pathlib
import sys
import urllib.request

BASE = pathlib.Path(__file__).resolve().parent
BODY = BASE / "flow_body.py"
GOOD_URL = (
    "https://raw.githubusercontent.com/Bot-Maker-Me/pharmaflow/"
    "0200207ed8a34df20745798e85433eddcaf03acd/helper/flow.py"
)


def ensure_body() -> None:
    need = True
    if BODY.exists() and BODY.stat().st_size > 20000:
        text = BODY.read_text(encoding="utf-8", errors="replace")
        if "class AgentConfig" in text and "def main" in text and "PLACEHOLDER" not in text:
            need = False
    if not need:
        return
    print("Downloading last good flow_body.py from GitHub…")
    with urllib.request.urlopen(GOOD_URL, timeout=60) as resp:
        data = resp.read()
    BODY.write_bytes(data)
    print(f"Wrote {BODY} ({len(data)} bytes)")


def load_module():
    ensure_body()
    spec = importlib.util.spec_from_file_location("flow_body", BODY)
    if spec is None or spec.loader is None:
        raise RuntimeError("Cannot load flow_body.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["flow_body"] = mod
    spec.loader.exec_module(mod)
    return mod


def patch_auto_learn(mod) -> None:
    """Monkey-patch SHADOW compare to POST mismatches to /api/learn."""
    # Config flag
    AgentConfig = getattr(mod, "AgentConfig", None)
    if AgentConfig is not None:
        _orig_init = AgentConfig.__init__

        def _init(self, path):
            _orig_init(self, path)
            try:
                import configparser

                cp = configparser.ConfigParser(interpolation=None)
                cp.read(path, encoding="utf-8")
                self.auto_learn = cp.getboolean("Shadow", "AUTO_LEARN", fallback=True)
            except Exception:
                self.auto_learn = True

        AgentConfig.__init__ = _init

    # CloudClient.post_learn
    CloudClient = getattr(mod, "CloudClient", None)
    if CloudClient is not None and not hasattr(CloudClient, "post_learn"):

        def learn_url(self):
            url = self.cfg.api_url
            if url.endswith("/api/sync-queue"):
                return url[: -len("/api/sync-queue")] + "/api/learn"
            if "/api/" in url:
                return url.rsplit("/api/", 1)[0] + "/api/learn"
            return url.rstrip("/") + "/api/learn"

        def post_learn(self, store_id, pending_rx_id, corrections):
            if not corrections:
                return True, ""
            import requests as _rq

            body = {
                "store_id": store_id,
                "script_id": f"shadow-{pending_rx_id}",
                "document_name": f"kroll-staff-rx/{pending_rx_id}",
                "source": "shadow_staff",
                "corrections": corrections,
            }
            try:
                resp = self.session.post(learn_url(self), json=body, timeout=getattr(mod, "CLOUD_TIMEOUT_SEC", 15))
            except Exception as exc:
                return False, str(exc)
            if 200 <= resp.status_code < 300:
                return True, ""
            return False, f"HTTP {resp.status_code}: {resp.text[:200]}"

        CloudClient.learn_url = learn_url
        CloudClient.post_learn = post_learn

    # Wrap _compare_with_staff
    runner = None
    for name in dir(mod):
        obj = getattr(mod, name)
        if isinstance(obj, type) and hasattr(obj, "_compare_with_staff"):
            runner = obj
            break
    if runner is None:
        return

    _orig = runner._compare_with_staff

    def _compare_with_staff(self):
        _orig(self)
        # After original compare, walk recent comparisons is hard; instead patch inside by
        # re-running learn on last decisions that just got compared is not available.
        # So we replace the method fully with original source behavior + learn.
        pass

    # Full replacement using original method's logic + learn (copy from flow_body).
    def _compare_with_staff_v2(self):
        r = self.cfg.rx_schema
        if not self.cfg.cloud_enabled or not r.get("rx_table"):
            return
        import time as _time
        import datetime as dt
        import json

        if _time.monotonic() - getattr(self, "_last_compare", -1e9) < getattr(mod, "COMPARE_EVERY_SEC", 600):
            return
        self._last_compare = _time.monotonic()

        now = dt.datetime.now(dt.timezone.utc)
        field_matches = getattr(mod, "field_matches")
        for d in self.store.load_uncompared(limit=100):
            planned = json.loads(d["planned"])
            planned["pending_rx_id"] = d["pending_rx_id"]
            seen = dt.datetime.fromisoformat(d["decided_at"])
            if seen.tzinfo is not None:
                seen = seen.astimezone()
            planned["date_created"] = seen.replace(
                hour=0, minute=0, second=0, microsecond=0, tzinfo=None
            ).strftime("%Y-%m-%d %H:%M:%S")
            actual = self.db.fetch_actual_rx(planned)
            if actual is None:
                return
            age = now - dt.datetime.fromisoformat(d["decided_at"])
            if not actual and age < dt.timedelta(days=getattr(mod, "COMPARE_GIVE_UP_DAYS", 3)):
                continue
            matches = field_matches(planned, actual, r) if actual else None
            result = {
                "type": "shadow_result",
                "store_id": self.cfg.store_id,
                "pending_rx_id": d["pending_rx_id"],
                "actual": actual or None,
                "field_match": matches,
            }
            ok, err, _ = self.cloud.push(result)
            if not ok:
                self.log.warning(
                    "Could not upload comparison for PendingRxId=%s: %s", d["pending_rx_id"], err
                )
                return
            if getattr(self.cfg, "auto_learn", True) and actual and matches:
                try:
                    from shadow_learn import staff_corrections

                    corrections = staff_corrections(planned, actual, r, matches)
                except Exception as exc:
                    self.log.warning("Auto-learn build failed: %s", exc)
                    corrections = []
                if corrections and hasattr(self.cloud, "post_learn"):
                    lok, lerr = self.cloud.post_learn(
                        self.cfg.store_id, int(d["pending_rx_id"]), corrections
                    )
                    if lok:
                        self.log.info(
                            "Auto-learned %d field(s) from staff PendingRxId=%s",
                            len(corrections),
                            d["pending_rx_id"],
                        )
                    else:
                        self.log.warning(
                            "Auto-learn failed PendingRxId=%s: %s", d["pending_rx_id"], lerr
                        )
            self.store.mark_compared(d["pending_rx_id"])

    runner._compare_with_staff = _compare_with_staff_v2
    if hasattr(mod, "AGENT_CODE_VERSION"):
        try:
            mod.AGENT_CODE_VERSION = "1.3.0"
        except Exception:
            pass


def main(argv=None):
    mod = load_module()
    patch_auto_learn(mod)
    return mod.main(argv)


if __name__ == "__main__":
    raise SystemExit(main())
