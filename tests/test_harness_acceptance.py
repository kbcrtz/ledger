"""Spec acceptance checks for the legacy harness (needs Docker)."""
import shutil
from collections import Counter

import pytest

from ledger.harness.legacy import run_cases
from ledger.harness.outputs import read_outputs
from ledger.paths import RUNS
from ledger.sample import write_sample_inputs

docker = shutil.which("docker")


@pytest.mark.skipif(not docker, reason="docker not available")
def test_sample_posting_and_interest():
    base = RUNS / "acceptance"
    shutil.rmtree(base, ignore_errors=True)
    post = base / "CBTRN02C"
    write_sample_inputs("CBTRN02C", post / "in")
    run_cases("CBTRN02C", [post])
    out = read_outputs("CBTRN02C", post / "out")
    reasons = Counter(int(r["WS-VALIDATION-FAIL-REASON"]) for r in out["files"]["DALYREJS"])
    assert reasons == {102: 38}
    assert out["rc"] == 4

    intr = base / "CBACT04C"
    write_sample_inputs("CBACT04C", intr / "in")
    shutil.copy(post / "out" / "TCATBAL.dat", intr / "in" / "TCATBAL.dat")
    shutil.copy(post / "out" / "ACCOUNT.dat", intr / "in" / "ACCOUNT.dat")
    run_cases("CBACT04C", [intr])
    res = read_outputs("CBACT04C", intr / "out")
    before = {a["ACCT-ID"]: a for a in out["files"]["ACCOUNT"]}
    after = {a["ACCT-ID"]: a for a in res["files"]["ACCOUNT"]}
    tx50 = [t for t in res["files"]["TRANSACT"] if t["TRAN-DESC"].startswith("Int. for a/c 00000000050")]
    assert len(tx50) == 1 and str(tx50[0]["TRAN-AMT"]) == "18.77"
    assert after[50] == before[50]                      # last account: never updated
    assert after[49]["ACCT-CURR-BAL"] != before[49]["ACCT-CURR-BAL"]
