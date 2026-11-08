"""Hand-written port shell: file loop plumbing and record parsing only.

It reads a case's fixed-width input files, exposes them to the generated module as
plain dicts keyed by copybook field names, calls `run(ctx)`, and writes the outputs
back in the legacy file formats. It contains no business rules.
"""
from __future__ import annotations

import datetime as _dt
import importlib
import io
import contextlib
import traceback
from pathlib import Path

from ledger.codec import decode, encode, layout, split_records, REJECT_TRAILER
from port.runtime import Abend

FROZEN_NOW = _dt.datetime(2022, 7, 18, 12, 0, 0)
DEFAULT_PARM = "2022071800"


def _read(case_dir: Path, name: str, copybook: str) -> list[dict]:
    lay = layout(copybook)
    p = case_dir / "in" / f"{name}.dat"
    if not p.exists():
        return []
    return [decode(r, lay) for r in split_records(p.read_bytes(), lay["size"])]


class DuplicateKey(Abend):
    pass


class PostingContext:
    """CBTRN02C files.

    daily_transactions  list[dict]  DALYTRAN-RECORD (CVTRA06Y), in input file order
    xref_by_card        dict[str, dict]  CARD-XREF-RECORD (CVACT03Y) by XREF-CARD-NUM
    accounts            dict[int, dict]  ACCOUNT-RECORD (CVACT01Y) by ACCT-ID; update in place
    category_balances   dict[(int, str, int), dict]  TRAN-CAT-BAL-RECORD (CVTRA01Y) by
                        (TRANCAT-ACCT-ID, TRANCAT-TYPE-CD, TRANCAT-CD); update in place or insert
    write_reject(transaction, reason_code, reason_description)  append to the rejects file
    write_transaction(tran_record)  write a TRAN-RECORD (CVTRA05Y) to the indexed
                        transaction file (key TRAN-ID; a duplicate key is an I/O error -> Abend)
    now()               current date-time (frozen for tests)
    return_code         int, initially 0
    """

    def __init__(self, case_dir: Path):
        self.daily_transactions = _read(case_dir, "DALYTRAN", "CVTRA06Y")
        self.xref_by_card = {r["XREF-CARD-NUM"]: r for r in _read(case_dir, "XREF", "CVACT03Y")}
        self.accounts = {r["ACCT-ID"]: r for r in _read(case_dir, "ACCOUNT", "CVACT01Y")}
        self.category_balances = {(r["TRANCAT-ACCT-ID"], r["TRANCAT-TYPE-CD"], r["TRANCAT-CD"]): r
                                  for r in _read(case_dir, "TCATBAL", "CVTRA01Y")}
        self.rejects: list[str] = []
        self.transactions: dict[str, str] = {}
        self.return_code = 0

    def now(self):
        return FROZEN_NOW

    def write_reject(self, transaction: dict, reason_code: int, reason_description: str) -> None:
        trailer = encode({"WS-VALIDATION-FAIL-REASON": reason_code,
                          "WS-VALIDATION-FAIL-REASON-DESC": reason_description}, REJECT_TRAILER)
        self.rejects.append(encode(transaction, layout("CVTRA06Y")) + trailer)

    def write_transaction(self, tran_record: dict) -> None:
        rec = encode(tran_record, layout("CVTRA05Y"))
        key = rec[:16]
        if key in self.transactions:
            raise DuplicateKey(f"duplicate TRAN-ID {key!r}")
        self.transactions[key] = rec

    def write_outputs(self, out: Path) -> None:
        (out / "DALYREJS.dat").write_bytes("".join(self.rejects).encode("latin-1"))
        (out / "TRANSACT.dat").write_bytes("".join(self.transactions[k] for k in sorted(self.transactions)).encode("latin-1"))
        accts = [encode(a, layout("CVACT01Y")) for a in self.accounts.values()]
        (out / "ACCOUNT.dat").write_bytes("".join(sorted(accts, key=lambda r: r[:11])).encode("latin-1"))
        tcat = [encode(t, layout("CVTRA01Y")) for t in self.category_balances.values()]
        (out / "TCATBAL.dat").write_bytes("".join(sorted(tcat, key=lambda r: r[:17])).encode("latin-1"))


class InterestContext:
    """CBACT04C files.

    category_balances   list[dict]  TRAN-CAT-BAL-RECORD (CVTRA01Y) in ascending key order
                        (TRANCAT-ACCT-ID, TRANCAT-TYPE-CD, TRANCAT-CD), i.e. the order a
                        sequential read of the indexed file returns
    accounts            dict[int, dict]  ACCOUNT-RECORD (CVACT01Y) by ACCT-ID; update in place
    xref_by_card        dict[str, dict]  CARD-XREF-RECORD (CVACT03Y) by XREF-CARD-NUM
    xref_by_account     dict[int, dict]  CARD-XREF-RECORD by XREF-ACCT-ID (alternate key)
    disclosure_groups   dict[(str, str, int), dict]  DIS-GROUP-RECORD (CVTRA02Y) by
                        (DIS-ACCT-GROUP-ID as 10 chars, DIS-TRAN-TYPE-CD, DIS-TRAN-CAT-CD)
    write_transaction(tran_record)  append a TRAN-RECORD (CVTRA05Y) to the sequential
                        transaction output file, in call order
    parm_date           str, the job PARM (10 chars, e.g. '2022071800')
    now()               current date-time (frozen for tests)
    return_code         int, initially 0
    """

    def __init__(self, case_dir: Path, parm: str = DEFAULT_PARM):
        tc = _read(case_dir, "TCATBAL", "CVTRA01Y")
        lay = layout("CVTRA01Y")
        self.category_balances = sorted(tc, key=lambda r: encode(r, lay)[:17])
        self.accounts = {r["ACCT-ID"]: r for r in _read(case_dir, "ACCOUNT", "CVACT01Y")}
        xr = _read(case_dir, "XREF", "CVACT03Y")
        self.xref_by_card = {r["XREF-CARD-NUM"]: r for r in xr}
        self.xref_by_account = {}
        for r in xr:
            self.xref_by_account.setdefault(r["XREF-ACCT-ID"], r)
        self.disclosure_groups = {(r["DIS-ACCT-GROUP-ID"], r["DIS-TRAN-TYPE-CD"], r["DIS-TRAN-CAT-CD"]): r
                                  for r in _read(case_dir, "DISCGRP", "CVTRA02Y")}
        self.parm_date = parm
        self.transactions: list[str] = []
        self.return_code = 0

    def now(self):
        return FROZEN_NOW

    def write_transaction(self, tran_record: dict) -> None:
        self.transactions.append(encode(tran_record, layout("CVTRA05Y")))

    def write_outputs(self, out: Path) -> None:
        (out / "TRANSACT.dat").write_bytes("".join(self.transactions).encode("latin-1"))
        accts = [encode(a, layout("CVACT01Y")) for a in self.accounts.values()]
        (out / "ACCOUNT.dat").write_bytes("".join(sorted(accts, key=lambda r: r[:11])).encode("latin-1"))


CONTEXTS = {"CBTRN02C": PostingContext, "CBACT04C": InterestContext}


def load_module(program: str, module_name: str | None = None):
    name = module_name or f"port.generated.{program.lower()}"
    mod = importlib.import_module(name)
    return importlib.reload(mod)


def run_case(program: str, case_dir: Path, module, out_name: str = "port-out") -> Path:
    out = case_dir / out_name
    out.mkdir(parents=True, exist_ok=True)
    for f in out.iterdir():
        f.unlink()
    ctx = CONTEXTS[program](case_dir)
    buf = io.StringIO()
    status = None
    try:
        with contextlib.redirect_stdout(buf):
            module.run(ctx)
        status = str(int(ctx.return_code))
    except Abend as e:
        buf.write(f"\nLEDGER-ABEND port: {e}\n")
        status = "12"
    except Exception:
        buf.write("\nPORT-CRASH\n" + traceback.format_exc())
        status = "PORT_CRASH"
    ctx.write_outputs(out)
    (out / "rc").write_text(status + "\n")
    (out / "stdout.txt").write_text(buf.getvalue())
    return out
