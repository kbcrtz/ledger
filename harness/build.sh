#!/usr/bin/env bash
# Compile CardDemo programs (unchanged) plus Ledger harness helpers.
# Runs inside the ledger-cobol container with the repo mounted at /ledger.
set -euo pipefail
SRC=/ledger/vendor/carddemo/app/cbl
CPY=/ledger/vendor/carddemo/app/cpy
H=/ledger/harness/cobol
B=/ledger/harness/build
rm -rf "$B"; mkdir -p "$B/bin" "$B/lib" "$B/lib-trace"
cd "$B"
# -fsign=EBCDIC: CardDemo ASCII data uses {ABCDEFGHI / }JKLMNOPQR overpunch signs.
cobc -m -o lib/CEE3ABD.so "$H/CEE3ABD.cbl"
cp lib/CEE3ABD.so lib-trace/CEE3ABD.so
cobc -x -fsign=EBCDIC -I "$CPY" -o bin/CBTRN02C "$SRC/CBTRN02C.cbl"
cobc -x -fsign=EBCDIC -I "$CPY" -ftraceall -o bin/CBTRN02C.trace "$SRC/CBTRN02C.cbl"
# CBACT04C has PROCEDURE DIVISION USING, so build it as a module + driver.
cobc -m -fsign=EBCDIC -I "$CPY" -o lib/CBACT04C.so "$SRC/CBACT04C.cbl"
cobc -m -fsign=EBCDIC -I "$CPY" -ftraceall -o lib-trace/CBACT04C.so "$SRC/CBACT04C.cbl"
cobc -x -o bin/RUN04C "$H/RUN04C.cbl"
cobc -x -o bin/LDLOAD "$H/LDLOAD.cbl"
cobc -x -o bin/LDDUMP "$H/LDDUMP.cbl"
cobc --version | head -1 > VERSION
echo "build ok: $(ls bin lib | tr '\n' ' ')"
