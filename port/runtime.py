"""Hand-written runtime helpers available to the generated port (no business logic).

COBOL numeric semantics the port may need:
  fit(value, digits, scale, signed)  store a value into a PIC 9(n)V9(m) field: truncate
                                     toward zero to `scale` decimals and drop high-order
                                     digits beyond `digits` total digits (no ROUNDED).
  fit_rounded(...)                   same, but rounds half away from zero (COBOL ROUNDED).
  Abend                              raise to end the run abnormally (like CEE3ABD).
  rule(id)                           decorator linking a function to the rule it implements.
"""
from __future__ import annotations

from decimal import Decimal, ROUND_DOWN, ROUND_HALF_UP, getcontext

getcontext().prec = 40

RULE_FUNCTIONS: dict[str, list[str]] = {}


def rule(*rule_ids: str):
    def deco(fn):
        fn.__ledger_rules__ = rule_ids
        for r in rule_ids:
            RULE_FUNCTIONS.setdefault(r, []).append(f"{fn.__module__.rsplit('.', 1)[-1]}.{fn.__name__}")
        return fn
    return deco


class Abend(Exception):
    pass


def _fit(value, digits: int, scale: int, signed: bool, rounding) -> Decimal | int:
    d = value if isinstance(value, Decimal) else Decimal(str(value))
    q = Decimal(1).scaleb(-scale) if scale else Decimal(1)
    d = d.quantize(q, rounding=rounding)
    neg = d < 0
    mag = abs(d) % (Decimal(10) ** (digits - scale))
    if not signed:
        neg = False
    out = -mag if neg else mag
    return int(out) if scale == 0 else out.quantize(q)


def fit(value, digits: int, scale: int = 0, signed: bool = True):
    return _fit(value, digits, scale, signed, ROUND_DOWN)


def fit_rounded(value, digits: int, scale: int = 0, signed: bool = True):
    return _fit(value, digits, scale, signed, ROUND_HALF_UP)
