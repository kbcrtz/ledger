from decimal import Decimal

from ledger.codec import decode_number, encode_number, layout
from ledger.agents.verifier import check_clause


def test_overpunch_roundtrip():
    assert decode_number("00000001940{", 12, 2, True) == Decimal("194.00")
    assert decode_number("0000009190}", 11, 2, True) == Decimal("-919.00")
    assert decode_number("0000005047G", 11, 2, True) == Decimal("504.77")
    assert encode_number(Decimal("-919.00"), 11, 2, True) == "0000009190}"
    assert encode_number(Decimal("504.77"), 11, 2, True) == "0000005047G"


def test_encode_truncates_like_cobol_move():
    # high-order truncation to PIC size and truncation toward zero of extra decimals
    assert encode_number(Decimal("12345678901.239"), 11, 2, True) == "3456789012C"  # 9 integer digits kept
    assert encode_number(Decimal("-0.009"), 4, 2, True) == "000{"


def test_copybook_record_sizes_match_spec():
    sizes = {cb: layout(cb)["size"] for cb in ["CVACT01Y", "CVACT03Y", "CVTRA01Y", "CVTRA02Y", "CVTRA05Y", "CVTRA06Y"]}
    assert sizes == {"CVACT01Y": 300, "CVACT03Y": 50, "CVTRA01Y": 50, "CVTRA02Y": 50, "CVTRA05Y": 350, "CVTRA06Y": 350}


def test_deterministic_citation_check():
    ok = {"text": "", "source": {"file": "CBTRN02C.cbl", "lines": [410, 412]},
          "fields": ["WS-VALIDATION-FAIL-REASON"], "literals": ["102", "OVERLIMIT TRANSACTION"]}
    assert check_clause("CBTRN02C", ok) == []
    wrong = dict(ok, source={"file": "CBTRN02C.cbl", "lines": [417, 419]})
    errs = check_clause("CBTRN02C", wrong)
    assert any("102" in e for e in errs) and any("OVERLIMIT" in e for e in errs)
    comment_only = {"text": "", "source": {"file": "CBTRN02C.cbl", "lines": [401, 402]},
                    "fields": ["ACCT-CREDIT-LIMIT"], "literals": []}
    assert check_clause("CBTRN02C", comment_only)  # commented-out code cannot support a claim
