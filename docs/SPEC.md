# Legibol: CardDemo Rule Extraction & Verification Spec

Nov 7, 2026 · @Kobe

## Overview

Legibol reads the AWS CardDemo COBOL app, extracts its business rules as plain-English Given/When/Then specs traced to exact source lines, and checks that a modern Python port behaves identically by running both on the same inputs.

**Problem.** In legacy systems the code is the only accurate spec, the people who wrote it are gone, and rewrites stall because no one can show the new system matches the old one.

**Why it fits 8090.** It mirrors 8090's business-rule extraction work for CMS's ClaimsCore program ([customer story](https://8090.ai/customer-stories/cms-claimscore)): Given/When/Then rules in plain English, traced to exact lines, and "if a statement cannot be sourced, it does not go in the record." It adds the piece coding agents skip, which is verification. Every rule is either checked against the running legacy code or flagged for a human. 8090's own words are the pitch hook: "Ask a vendor to show you this loop closed, live on a real system."

**One-line pitch.** Nothing unsourced, nothing unverified.

## Goals and non-goals

Ship a narrow pipeline that is fully verified on two programs, not a broad one that is verified on none. If the test generator slips past 11 PM, cut to CBTRN02C alone and keep CBACT04C only for the last-account bug demo.

**Must ship**

- [ ] Extract 8 to 12 rules from 2 CardDemo batch programs, every clause citing source lines
- [ ] Verifier rejects any clause whose citation does not hold up
- [ ] Differential harness runs the original COBOL and the Python port on generated cases plus CardDemo's own sample data, pass or fail per rule
- [ ] Review UI: rule list, rule beside its highlighted source, test results, approve or reject
- [ ] Change impact: edit a rule and see its linked lines, tests and port code marked stale; an approved edit becomes an intended divergence, not a red failure

**Stretch**

- [ ] Cross-program view: one policy implemented in two programs, matched into one rule
- [ ] Coverage report: COBOL lines that no rule cites and no test executes
- [ ] Drift report: where the code disagrees with its evident intent (seeded by the findings below)

**Non-goals**

- Full app coverage, CICS online screens, JCL execution, deployment
- A chat-with-your-codebase interface
- Rewriting code without showing the rewrite matches

## Input system: AWS CardDemo

Target two CardDemo batch programs, because batch COBOL runs under GnuCOBOL without a CICS runtime. [CardDemo](https://github.com/aws-samples/aws-mainframe-modernization-carddemo) is AWS's open-source COBOL credit card app, written in deliberately mixed styles to exercise modernization tooling.

| Program | What it does | Why it is a good target |
| --- | --- | --- |
| CBTRN02C | Posts daily transactions; checks card (xref exists), account exists, credit limit and account expiration; writes rejects with reason codes 100 to 103; updates account and category balances | Many branching validation rules, each with a clear observable outcome |
| CBACT04C | Computes monthly interest per account by transaction category, using disclosure group rates with a `DEFAULT` group fallback | Money arithmetic, where an exact output match is convincing |

Copybooks to ingest: `CVACT01Y` (account, 300 bytes), `CVACT03Y` (card xref, 50), `CVTRA01Y` (category balance, 50), `CVTRA02Y` (disclosure group, 50), `CVTRA05Y` (transaction, 350), `CVTRA06Y` (daily transaction, 350). All numeric fields are display format (`9(n)`, `S9(n)V99`); none use `COMP-3`.

**Confirmed Nov 7, 5:45 PM.** Both programs compile and run under GnuCOBOL 3.1.2 (Debian `gnucobol3`) on CardDemo's sample data. Posting 300 transactions gives 38 rejects, and the output matched an independent Python model on all 50 accounts.

**Findings in the code (use these in the demo):**

| Finding | Where |
| --- | --- |
| The last account in the category-balance file never gets its interest applied. Account 50's $18.77 interest transaction is written, but its balance never changes and its cycle totals never reset. The `ELSE PERFORM 1050-UPDATE-ACCOUNT` branch can't run under `PERFORM UNTIL`. | `CBACT04C.cbl:188-222` |
| Reason 103 (expired) silently overwrites 102 (over limit); a reject carries only one reason | `CBTRN02C.cbl:407-420` |
| Payments are stored as negative debits, so `credits - debits + amount` adds them: a payment makes the limit check stricter. The check also ignores the prior balance. | `CBTRN02C.cbl:403-405`, `548-552` |
| Reason 109 is set after posting and never acted on; `1400-COMPUTE-FEES` is an empty stub | `CBTRN02C.cbl:556`, `CBACT04C.cbl:518` |
| `WS-TEMP-BAL` is `S9(09)V99` but the account fields are `S9(10)V99`, so very large exposures lose high-order digits silently | `CBTRN02C.cbl:187` |

CardDemo's sample data only triggers reason 102. Reasons 100, 101, 103 and the 102-to-103 overwrite need generated cases.

## Architecture

Four agents sit between two deterministic ends: a parser that structures the COBOL and a harness that runs it, so every LLM claim is checked by something that is not an LLM.

&#91;embedded content: Legibol pipeline · 4 agents, 1 deterministic parser, 1 harness\]

Rules flow down from the source. The verifier sends uncited clauses back for one retry; only `traced` rules reach the port, the tests and the reviewer.

- **Structural parser (deterministic).** Splits divisions and paragraphs, builds the `PERFORM` call graph, and parses copybook `PIC` layouts into field names, offsets and widths.
- **Extractor agent.** Gets one paragraph plus its callees and copybooks; returns rules as JSON with a line range, field names and literals on every clause. It separates business logic from file plumbing, and balance updates (`2700-*`, `2800-*`, `1050-*`) count as business logic: the account comparison fails without them.
- **Verifier agent.** First a deterministic check that the cited lines contain the fields and literals the clause lists, then an LLM judge on meaning. A clause that fails, is retried once and fails again marks the rule `flagged`.
- **Modernizer agent.** Writes the Python port from the `traced` rules only, never from the COBOL, one function per rule, each linked back to its rule id. A small hand-written shell does the file loop and record parsing.
- **Test generator agent.** Turns each rule's conditions into branch and boundary cases. Each case is a full fixture (xref, account, category balance, disclosure group records with consistent keys), encoded as fixed-width records.
- **Differential harness (deterministic).** Runs the original and the port on the same inputs and compares the outputs.

## Data model

One rule record carries its clauses, the source span, fields and literals behind each clause, and the tests and port code that depend on it.

```json
{
  "id": "BR-CBTRN02C-003",
  "title": "Reject transactions over the credit limit",
  "program": "CBTRN02C",
  "paragraph": "1500-B-LOOKUP-ACCT",
  "scenario": {
    "given": [{ "text": "the account exists for the card", "source": { "file": "CBTRN02C.cbl", "lines": [394, 400] }, "fields": ["XREF-ACCT-ID", "FD-ACCT-ID"], "literals": [] }],
    "when":  [{ "text": "cycle credits minus cycle debits plus the amount exceeds the credit limit", "source": { "file": "CBTRN02C.cbl", "lines": [403, 407] }, "fields": ["ACCT-CURR-CYC-CREDIT", "ACCT-CURR-CYC-DEBIT", "DALYTRAN-AMT", "ACCT-CREDIT-LIMIT"], "literals": [] }],
    "then":  [{ "text": "the transaction is written to rejects with reason 102, unless a later check overwrites it", "source": { "file": "CBTRN02C.cbl", "lines": [410, 412] }, "fields": ["WS-VALIDATION-FAIL-REASON"], "literals": ["102", "OVERLIMIT TRANSACTION"] }]
  },
  "status": "verified",
  "port_function": "posting.check_credit_limit",
  "tests": ["T-017", "T-018", "T-019"],
  "review": { "by": null, "decision": null, "note": null }
}
```

**Trace graph.** Nodes are rules, clauses, source spans, copybook fields, test cases and port functions. Edges run both ways, so a changed line finds its rules and a changed rule finds its lines, tests and port code.

**Test result.** Each case stores the input fixture, legacy output, port output, the differing fields if any, a match flag, and the COBOL lines the case executed.

**Rule status, in order:**

1. `extracted`: drafted by the extractor
2. `traced`: every clause passed the verifier (one retry, then `flagged`)
3. `verified`: every test case matches between legacy and port (any mismatch, `flagged`)
4. `approved` or `rejected`: a human decision in the review UI
5. `stale`: a linked rule, line or port function changed since verification
6. `diverged`: a human-approved edit that intentionally differs from legacy; the affected cases are expected mismatches, recorded with who approved them and why

## Equivalence verification

Because the port is written only from the traced rules, a port that matches legacy output is strong evidence the spec captured the behavior. It is evidence, not proof: tests generated from the same rules can't catch behavior the extractor missed. Two checks cover that gap: CardDemo's own sample data, which the rules didn't produce, and line coverage, which shows COBOL no test executed.

1. **Environment.** `debian:bookworm-slim` plus `apt-get install gnucobol3` gives GnuCOBOL 3.1.2 with Berkeley DB indexed files. Indexed (VSAM-style) files work as-is, so the `SELECT` clauses stay unchanged.
2. **Compile.** Always pass `-fsign=EBCDIC`. CardDemo's ASCII data uses `{`/`}` overpunch signs, and without the flag GnuCOBOL silently misreads negative amounts (43 rejects instead of 38, all 50 balances wrong). Build CBTRN02C with `cobc -x -fsign=EBCDIC -I app/cpy`. CBACT04C has `PROCEDURE DIVISION USING`, so `cobc -x` fails: build it with `cobc -m` and run it through a driver that passes `PARM '2022071800'` (from `INTCALC.jcl`). Stub `CEE3ABD`, the IBM abend routine called on error paths.
3. **Load data.** A small COBOL loader turns line-sequential data into indexed files, defining the xref alternate key on account id (CBACT04C reads by it). Daily transactions are fixed 350-byte records with no newlines. File names map through `DD_<ASSIGN-NAME>` environment variables.
4. **Generate inputs.** The test generator reads each rule's Given/When clauses plus the copybook `PIC` layouts and writes one fixture per branch, plus boundaries: amount exactly at the limit, one cent over, transaction on the expiration date and the day after, and both over the limit and expired (expect 103).
5. **Encode records.** A small encoder turns fixture JSON into fixed-width records from the copybook layouts (`X(n)`, `9(n)`, signed `S9(n)V99` with EBCDIC-style overpunch: `{ABCDEFGHI` for +0 to +9, `}JKLMNOPQR` for -0 to -9).
6. **Run both.** Same input files through the compiled COBOL and the Python port, one run per fixture, plus one run on the full sample data. Set `COB_CURRENT_DATE` to freeze the clock to the second.
7. **Compare.** Dump every output to records: the rejects file, the new transactions file, the updated account and category-balance files (indexed, so dump them with a small COBOL program), and the return code (4 when there are rejects). Compare field by field, masking `TRAN-ORIG-TS` and `TRAN-PROC-TS` because their hundredths still change. A rule is `verified` only when every one of its cases matches.
8. **Coverage.** Compile a second binary with `-ftraceall` and run it with `COB_SET_TRACE=Y COB_TRACE_FILE=...` to record executed lines. Report lines no rule cites and no test executes. The sample data alone executes 251 lines of CBTRN02C.

**Money math.** The port uses Python `Decimal` and copies COBOL semantics: truncation toward zero by default (`ROUND_DOWN`), rounding only where the source says `ROUNDED`, and high-order truncation to each field's `PIC` size. Interest is `(TRAN-CAT-BAL * DIS-INT-RATE) / 1200` truncated to cents. This is the most likely source of real mismatches, which makes it a good demo moment rather than a bug to hide.

## Review UI

The rule detail screen is the demo; build it first and make it excellent.

| Screen | What it shows | Key interactions |
| --- | --- | --- |
| Rule detail (main) | Given/When/Then on the left, COBOL on the right with cited lines highlighted, test cases below with legacy vs port output | Click a clause to jump to its lines; expand a failing case to see the differing field; approve or reject with a note |
| Rule catalog | All rules with program, status and test pass count; totals at the top (verified, flagged, approved, diverged) | Filter by program and status; open a rule |
| Change impact | A rule being edited, with its linked lines, tests and port function marked stale | Edit a clause, see what goes stale, press Re-verify; approve the expected mismatches as an intended divergence with a note |
| Pipeline log | Per-program agent steps, verifier rejections, retries | Read only; keep it secondary |

Keep the pipeline log in a side panel. 8090 calls agent dashboards "supervision tools" rather than the product, so the hero is the verified rule, not the agents.

## Tech stack

Pick boring, debuggable tools; the novelty is the verification loop, not the stack.

| Layer | Choice | Why |
| --- | --- | --- |
| LLM | Claude via API, long context | Reads whole programs plus copybooks in one call |
| Agent orchestration | Plain Python with tool calls, no framework | Easy to debug at 4 AM |
| Parser | Custom splitter: divisions, paragraphs, `PERFORM` graph, copybook `PIC` layouts | Deterministic, and enough for two programs |
| Legacy runtime | GnuCOBOL 3.1.2 (`debian:bookworm-slim` + `gnucobol3`) in Docker | Runs the original unchanged, indexed files included |
| Port | Python 3 with `Decimal` | Readable, exact money math |
| Backend | FastAPI, rules and results in SQLite or JSON files | Fast to stand up |
| Frontend | Next.js, Tailwind, read-only Monaco editor | Line highlighting comes built in |

Cache every LLM output to disk so the demo replays deterministically, including the port regenerated after the scripted change-impact edit.

## Build plan

About 18 hours remain as of 6 PM Saturday. The initial Devpost deadline is 11:00 PM Saturday (have a draft project submitted) and the final submission is 12:00 PM Sunday (CST).

| Owner | Workstream |
| --- | --- |
| Person A | Harness: loader, dumper, CBACT04C driver, record encoder, compare, coverage |
| Person B | Agents and prompts: extractor, verifier, test generator, modernizer |
| Person C | Review UI: rule detail first, then catalog and impact |
| Person D | Python port shell and review, demo data, Devpost write-up, video, pitch; floats to blockers |

**Checkpoints (Saturday into Sunday)**

- [x] 3:30 PM: repo cloned, both programs compile and run under GnuCOBOL on sample data (done 5:45 PM); rule JSON agreed by everyone
- [ ] 6:00 PM: parser emits paragraphs and layouts; extractor drafts 3 rules; UI renders mock JSON
- [ ] 11:00 PM: Devpost draft submitted; verifier live; one rule runs end to end through the harness; decide whether to cut to CBTRN02C only
- [ ] 3:00 AM: 8 rules traced; port generated; real diff results show in the UI
- [ ] 7:00 AM: change impact view works; feature freeze
- [ ] 9:00 AM: record the 2-minute demo video; write the Devpost description
- [ ] 11:30 AM: submit, with 30 minutes of margin before noon

Sleep in two shifts so the harness and the UI each always have an owner awake.

## Who needs this

Any organization still running decades-old core systems, where an error costs money or breaks a regulation. The approach works anywhere batch code applies business rules to records.

| Sector | Typical legacy systems | Why proof matters here |
| --- | --- | --- |
| Banking and payments | Account posting, interest, card authorization, end-of-day batch | Every cent has to reconcile, and regulators audit changes. CardDemo is this exact case. |
| Insurance | Policy admin, premium rating, claims decisions | Rating and eligibility rules are the product, and they're often decades old and undocumented |
| Government / public sector | Benefits, tax, unemployment, Medicare/Medicaid claims | 8090's own CMS work; improper payments and the 2020 unemployment-system failures |
| Aviation / travel | Reservations, fares, loyalty, crew scheduling | Fare and loyalty rules are dense, and outages are public |
| Manufacturing / supply chain | ERP batch jobs, inventory, pricing, billing | Pricing and inventory logic buried in custom code nobody owns anymore |

**Say:** "Everyone who runs code their current team didn't write, and can't afford to get a rewrite wrong. We started with credit cards because that's where the strictest proof is needed: every cent has to match."

**Scale (check before using on a slide):** Reuters (2017) cites about 220 billion lines of COBOL in use, 43% of banking systems built on it, and 95% of ATM swipes running through it. Don't invent a dollar figure for the market.

## Why not just ask an AI to translate it

The judges' first question will be how this differs from "Claude, turn this COBOL into Python."

| "Claude, translate this" | Legibol |
| --- | --- |
| Produces code and nothing to check it against | Produces code plus evidence: every rule tested against the running original |
| Copies bugs silently; CBACT04C's last-account bug would come straight across | Surfaces the bug as a rule a human can read, then lets them keep or fix it |
| Output is Python the business can't read | Output is plain-English rules a policy owner can approve |
| No link from new code back to old lines | Every rule, test and function traced to exact source lines, in both directions |
| Change one thing and you don't know what else broke | Change a rule and see every line, test and function affected |
| "The model wrote it" | A named person approved every rule and every intentional change |

**Say:** "Translation moves the mystery to a new language. Legibol writes down what the system does, shows it's right, and lets a human decide what to change."

**For a technical judge:** "If you ask an AI to translate, the only test is whether you trust the AI. We write the new code without the old code, so the only way it can match is if the rules are right."

## Demo script and pitch

The demo doesn't need to be live. Record the three moments that make the case (60 to 75 seconds total) and narrate over them; spend the rest of the talk on the problem, the differentiator and who needs it. The Devpost video stays under 2 minutes (confirm the cap on the Devpost page).

**Recorded demo**

| Moment | On screen | Say |
| --- | --- | --- |
| Rule with source (~20s) | Rule detail: click a clause, its COBOL lines highlight; the 103-overwrites-102 rule | Every sentence cites its source. If it can't be sourced, it doesn't go in. |
| Old vs. new (~20s) | Legacy output beside port output, all matching; one caught mismatch | The new code was written only from the rules, and it matches the original, including CardDemo's own data. |
| The bug (~25s) | Account 50 never gets its interest; reviewer edits the rule; affected tests and port code flagged; Re-verify; approved divergence | The code never posts interest to the last account. A human decided to fix it, and the system shows what changed and who approved it. |

**Talk order**

| Section | Time | Content |
| --- | --- | --- |
| Problem | ~15s | Medicare made $28.8B in improper payments last year, through claims systems built on decades-old code. Rewrites stall because no one can show the new system matches. |
| What Legibol does | ~20s | Reads COBOL, writes plain-English rules traced to the line, rebuilds from the rules alone, and checks the rebuild against the original |
| Recorded demo | 60 to 75s | The three moments above |
| Why not just translate | ~30s | The differentiator line and table above |
| Who needs this | ~20s | Banking, insurance, government, travel, manufacturing |
| Close | ~5s | Nothing unsourced, nothing unverified. |

**Words to use with 8090 judges:** business intent, traceability in both directions, verification, human-led review, institutional knowledge, audit trail. Avoid leading with "AI rewrites COBOL"; lead with the closed loop. Don't say Medicare "lost" $28.8B or that code caused it: it is FY2025 Medicare fee-for-service only, and CMS says improper payments are not a measure of fraud.

## Risks and fallbacks

The biggest risk was the COBOL harness. It now runs both programs, so the remaining risk is the test generator building consistent fixtures.

| Risk | Fallback |
| --- | --- |
| Fixture generation (consistent xref, account and balance records) is slow | Cut to CBTRN02C only; keep CBACT04C for the last-account bug on sample data |
| Sign encoding silently wrong | Always compile with `-fsign=EBCDIC`; check the sample-data run gives 38 rejects |
| LLM citations point at the wrong lines | Deterministic check first (cited lines must mention the clause's fields and literals), then an LLM judge |
| A port mismatch can't be fixed in time | Show it as flagged for a human; catching it is the product working |
| Wall-clock timestamps differ between runs | `COB_CURRENT_DATE` plus masking the timestamp fields |
| Scope creep | Hard cap of 2 programs and 12 rules until 7 AM |
| Live demo flakiness | Replay cached LLM outputs and harness results; run one rule live |
