"""Auto-learn helpers: staff Kroll Rx is ground truth on SHADOW mismatch."""

from __future__ import annotations

from typing import Any, Dict, List

FIELD_COLUMNS = [
    ("pat_id", "rx_pat_id"),
    ("doc_id", "rx_doc_id"),
    ("drug_id", "rx_drug_id"),
    ("qty", "rx_qty"),
    ("refills", "rx_refills"),
    ("sig", "rx_sig"),
]

LEARN_FIELD_PATH = {
    "pat_id": "patient.pat_id",
    "doc_id": "doctor.doc_id",
    "drug_id": "medications[0].drug_id",
    "qty": "medications[0].qty",
    "refills": "medications[0].refills",
    "sig": "medications[0].sig",
}


def norm(field: str, value: Any) -> str:
    text = "" if value is None else str(value).strip()
    if field in ("qty", "refills"):
        try:
            return f"{float(text):g}"
        except ValueError:
            return text
    return " ".join(text.upper().split())


def field_matches(
    planned: Dict[str, Any], actual: Dict[str, Any], rx_schema: Dict[str, str]
) -> Dict[str, bool]:
    return {
        p: norm(p, planned.get(p)) == norm(p, actual.get(a))
        for p, a in FIELD_COLUMNS
        if rx_schema.get(a)
    }


def staff_corrections(
    planned: Dict[str, Any],
    actual: Dict[str, Any],
    rx_schema: Dict[str, str],
    matches: Dict[str, bool],
) -> List[Dict[str, Any]]:
    """Build /api/learn correction rows from agent plan vs staff-filled Rx."""
    out: List[Dict[str, Any]] = []
    for planned_key, rx_key in FIELD_COLUMNS:
        if not rx_schema.get(rx_key):
            continue
        if matches.get(planned_key, True):
            continue
        original = planned.get(planned_key)
        corrected = actual.get(rx_key)
        if corrected is None or corrected == "":
            continue
        orig_s = "" if original is None else str(original).strip()
        corr_s = str(corrected).strip()
        if not corr_s or orig_s == corr_s:
            continue
        if norm(planned_key, original) == norm(planned_key, corrected):
            continue
        path = LEARN_FIELD_PATH.get(planned_key, f"kroll.{planned_key}")
        out.append(
            {
                "field_path": path,
                "original_value": orig_s,
                "corrected_value": corr_s,
                "context": {
                    "source": "shadow_staff",
                    "planned_pat_id": planned.get("pat_id"),
                    "planned_drug_id": planned.get("drug_id"),
                    "pending_rx_id": planned.get("pending_rx_id"),
                },
            }
        )
    return out
