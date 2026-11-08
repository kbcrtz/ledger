"""Fixed-width record codec driven by copybook layouts.

Numeric display fields use trailing EBCDIC-style overpunch signs in ASCII, matching
CardDemo's sample data and GnuCOBOL -fsign=EBCDIC:
  '{ABCDEFGHI' = +0..+9   '}JKLMNOPQR' = -0..-9
"""
from __future__ import annotations

from decimal import Decimal
from functools import lru_cache

from .cobol.layout import parse_copybook, flat_fields
from .paths import CPY_DIR

POS = "{ABCDEFGHI"
NEG = "}JKLMNOPQR"


class Invalid(str):
    """Raw text of a numeric field whose bytes are not valid digits (kept verbatim)."""


def decode_number(raw: str, digits: int, scale: int, signed: bool):
    s = raw
    neg = False
    if signed and s:
        last = s[-1]
        if last in POS:
            s = s[:-1] + str(POS.index(last))
        elif last in NEG:
            s = s[:-1] + str(NEG.index(last))
            neg = True
    if not s.isdigit():
        return Invalid(raw)
    if not scale:
        return -int(s) if neg else int(s)
    v = Decimal(int(s)).scaleb(-scale).quantize(Decimal(1).scaleb(-scale))
    return -v if neg else v


def encode_number(value, digits: int, scale: int, signed: bool) -> str:
    """Encode with COBOL MOVE semantics: truncate toward zero to `scale`, drop high-order digits."""
    if isinstance(value, Invalid):
        return str(value)[:digits].ljust(digits)
    d = Decimal(str(value)) if not isinstance(value, Decimal) else value
    neg = d < 0
    units = int((abs(d) * (Decimal(10) ** scale)).to_integral_value(rounding="ROUND_DOWN"))
    units %= 10 ** digits                     # high-order truncation to the PIC size
    s = str(units).zfill(digits)
    if not signed:
        return s
    last = int(s[-1])
    if neg and units != 0:
        return s[:-1] + NEG[last]
    return s[:-1] + POS[last]


@lru_cache(maxsize=None)
def layout(copybook: str) -> dict:
    """{'record': name, 'size': n, 'fields': [elementary field dicts]} for a copybook."""
    recs = parse_copybook(CPY_DIR / f"{copybook}.cpy")
    rec = recs[0]
    return {"copybook": copybook, "record": rec.name, "size": rec.size, "fields": flat_fields(rec)}


# Reject record of CBTRN02C: 350-byte daily transaction + 80-byte validation trailer
# (WS-VALIDATION-TRAILER in CBTRN02C working storage).
REJECT_TRAILER = {
    "record": "WS-VALIDATION-TRAILER", "size": 80,
    "fields": [
        {"name": "WS-VALIDATION-FAIL-REASON", "offset": 0, "size": 4, "kind": "9", "digits": 4, "scale": 0, "signed": False, "pic": "9(04)"},
        {"name": "WS-VALIDATION-FAIL-REASON-DESC", "offset": 4, "size": 76, "kind": "X", "digits": 76, "scale": 0, "signed": False, "pic": "X(76)"},
    ],
}


def decode(rec: str, lay: dict) -> dict:
    out = {}
    for f in lay["fields"]:
        if f["name"] == "FILLER":
            continue
        raw = rec[f["offset"]:f["offset"] + f["size"]]
        if f["kind"] == "X":
            out[f["name"]] = raw
        else:
            out[f["name"]] = decode_number(raw, f["digits"], f["scale"], f["signed"])
    return out


def encode(values: dict, lay: dict) -> str:
    buf = [" "] * lay["size"]
    for f in lay["fields"]:
        name = f["name"]
        if name == "FILLER" or name not in values:
            if f["kind"] == "9" and name != "FILLER" and name not in values:
                txt = encode_number(0, f["digits"], f["scale"], f["signed"])
            else:
                continue
        else:
            v = values[name]
            if f["kind"] == "X":
                txt = ("" if v is None else str(v))[:f["size"]].ljust(f["size"])
            else:
                txt = encode_number(v if v not in (None, "") else 0, f["digits"], f["scale"], f["signed"])
        buf[f["offset"]:f["offset"] + f["size"]] = list(txt)
    return "".join(buf)


def split_records(data: bytes, size: int) -> list[str]:
    text = data.decode("latin-1")
    return [text[i:i + size] for i in range(0, len(text), size) if text[i:i + size]]


def to_jsonable(rec: dict) -> dict:
    out = {}
    for k, v in rec.items():
        if isinstance(v, Invalid):
            out[k] = {"invalid": str(v)}
        elif isinstance(v, Decimal):
            out[k] = str(v)
        else:
            out[k] = v
    return out
