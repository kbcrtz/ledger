"""Per-program file specs: which copybook layout each input/output file uses."""
from ..codec import layout, REJECT_TRAILER

# input name -> copybook ; outputs: name -> (copybook or 'REJECT', key fields for ordering)
PROGRAM_FILES = {
    "CBTRN02C": {
        "inputs": {"DALYTRAN": "CVTRA06Y", "XREF": "CVACT03Y", "ACCOUNT": "CVACT01Y", "TCATBAL": "CVTRA01Y"},
        "outputs": {"DALYREJS": "REJECT", "TRANSACT": "CVTRA05Y", "ACCOUNT": "CVACT01Y", "TCATBAL": "CVTRA01Y"},
    },
    "CBACT04C": {
        "inputs": {"TCATBAL": "CVTRA01Y", "XREF": "CVACT03Y", "ACCOUNT": "CVACT01Y", "DISCGRP": "CVTRA02Y"},
        "outputs": {"TRANSACT": "CVTRA05Y", "ACCOUNT": "CVACT01Y"},
    },
}

# Fields masked in comparisons: wall-clock timestamps whose hundredths vary between runs.
MASKED_FIELDS = {"TRAN-PROC-TS"}
MASKED_BY_FILE = {("CBACT04C", "TRANSACT"): {"TRAN-ORIG-TS", "TRAN-PROC-TS"},
                  ("CBTRN02C", "TRANSACT"): {"TRAN-PROC-TS"}}


def reject_layout() -> dict:
    """430-byte DALYREJS record = DALYTRAN-RECORD (350) + WS-VALIDATION-TRAILER (80)."""
    base = layout("CVTRA06Y")
    fields = list(base["fields"]) + [dict(f, offset=f["offset"] + 350) for f in REJECT_TRAILER["fields"]]
    return {"record": "REJECT-RECORD", "size": 430, "fields": fields}


def output_layout(copybook: str) -> dict:
    return reject_layout() if copybook == "REJECT" else layout(copybook)
