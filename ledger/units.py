"""Extraction units: one root paragraph (plus its callees) per extractor call.

Hard cap from the spec: 2 programs, 12 rules. max_rules per unit sums to 12.
The focus notes only say which part of the program a unit covers; they carry no
knowledge of what the code does.
"""
UNITS = [
    {"id": "CBTRN02C-validate", "program": "CBTRN02C", "roots": ["1500-VALIDATE-TRAN"], "max_rules": 4,
     "focus": "Validation of each daily transaction before posting (card cross-reference lookup, account lookup, and the checks made on the account)."},
    {"id": "CBTRN02C-main", "program": "CBTRN02C", "roots": ["(main)", "2500-WRITE-REJECT-REC"], "max_rules": 1,
     "focus": "The top-level flow: what happens to a transaction depending on the validation outcome, what a reject record contains, and the program's return code. Validation details and posting details are covered by other units."},
    {"id": "CBTRN02C-post", "program": "CBTRN02C", "roots": ["2000-POST-TRANSACTION"], "max_rules": 2,
     "focus": "Posting a validated transaction: the transaction record written, the category balance update and the account balance update."},
    {"id": "CBACT04C-main", "program": "CBACT04C", "roots": ["(main)", "1050-UPDATE-ACCOUNT"], "max_rules": 2,
     "focus": "The top-level loop over category balance records grouped by account, and when and how each account record is updated with accumulated interest. Rate lookup and the interest computation itself are covered by other units."},
    {"id": "CBACT04C-rate", "program": "CBACT04C", "roots": ["1200-GET-INTEREST-RATE"], "max_rules": 1,
     "focus": "How the interest rate for a category balance is found in the disclosure group file."},
    {"id": "CBACT04C-interest", "program": "CBACT04C", "roots": ["1300-COMPUTE-INTEREST", "1400-COMPUTE-FEES"], "max_rules": 2,
     "focus": "Computing monthly interest for one category balance and the interest transaction record that is written."},
]
PLUMBING_PREFIXES = ("0000-", "0100-", "0200-", "0300-", "0400-", "0500-", "9000-", "9100-", "9200-", "9300-",
                     "9400-", "9500-", "9910-", "9999-")
