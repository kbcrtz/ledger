#!/usr/bin/env bash
# Run one legacy program over one or more case directories.
# Usage: run_cases.sh CBTRN02C|CBACT04C <case_dir>...
# Each case dir has in/*.dat (fixed-width records, no newlines).
# Writes out/ (dumped outputs, rc, stdout) and out/trace.txt (coverage).
set -uo pipefail
PROG=$1; shift
B=/ledger/harness/build
export COB_CURRENT_DATE="${LEDGER_CURRENT_DATE:-2022/07/18 12:00:00}"
load() { # kind src dst
  DD_LDIN="$2" DD_LDOUT="$3" "$B/bin/LDLOAD" "$1" >> "$LOG" 2>&1 || { echo "load $1 failed" >> "$LOG"; return 1; }
}
dump() { # kind src dst
  DD_LDIN="$2" DD_LDOUT="$3" "$B/bin/LDDUMP" "$1" >> "$LOG" 2>&1
}
run_once() { # case_dir mode(plain|trace)
  local C=$1 MODE=$2
  local W; W=$(mktemp -d /tmp/ledger.XXXXXX)
  local O="$C/out"; [ "$MODE" = trace ] && O="$C/out-trace"
  rm -rf "$O"; mkdir -p "$O"
  LOG="$O/harness.log"; : > "$LOG"
  cd "$W"
  local ok=1
  if [ "$PROG" = CBTRN02C ]; then
    load XREF "$C/in/XREF.dat" "$W/xref.idx" || ok=0
    load ACCT "$C/in/ACCOUNT.dat" "$W/acct.idx" || ok=0
    load TCAT "$C/in/TCATBAL.dat" "$W/tcatbal.idx" || ok=0
    if [ $ok = 1 ]; then
      local BIN="$B/bin/CBTRN02C"; [ "$MODE" = trace ] && BIN="$B/bin/CBTRN02C.trace"
      env COB_LIBRARY_PATH="$B/lib" \
        DD_DALYTRAN="$C/in/DALYTRAN.dat" DD_TRANFILE="$W/transact.idx" \
        DD_XREFFILE="$W/xref.idx" DD_DALYREJS="$O/DALYREJS.dat" \
        DD_ACCTFILE="$W/acct.idx" DD_TCATBALF="$W/tcatbal.idx" \
        $( [ "$MODE" = trace ] && echo "COB_SET_TRACE=Y COB_TRACE_FILE=$O/trace.txt COB_TRACE_FORMAT=%I|%L|%S" ) \
        "$BIN" > "$O/stdout.txt" 2> "$O/stderr.txt"
      echo $? > "$O/rc"
      dump TRAN "$W/transact.idx" "$O/TRANSACT.dat"
      dump ACCT "$W/acct.idx" "$O/ACCOUNT.dat"
      dump TCAT "$W/tcatbal.idx" "$O/TCATBAL.dat"
    else
      echo "LOAD_FAILED" > "$O/rc"
    fi
  else
    load TCAT "$C/in/TCATBAL.dat" "$W/tcatbal.idx" || ok=0
    load XREFALT "$C/in/XREF.dat" "$W/xref.idx" || ok=0
    load ACCT "$C/in/ACCOUNT.dat" "$W/acct.idx" || ok=0
    load DISC "$C/in/DISCGRP.dat" "$W/discgrp.idx" || ok=0
    if [ $ok = 1 ]; then
      local LIB="$B/lib"; [ "$MODE" = trace ] && LIB="$B/lib-trace"
      env COB_LIBRARY_PATH="$LIB" \
        DD_TCATBALF="$W/tcatbal.idx" DD_XREFFILE="$W/xref.idx" \
        DD_ACCTFILE="$W/acct.idx" DD_DISCGRP="$W/discgrp.idx" \
        DD_TRANSACT="$O/TRANSACT.dat" \
        $( [ "$MODE" = trace ] && echo "COB_SET_TRACE=Y COB_TRACE_FILE=$O/trace.txt COB_TRACE_FORMAT=%I|%L|%S" ) \
        "$B/bin/RUN04C" "${LEDGER_PARM:-2022071800}" > "$O/stdout.txt" 2> "$O/stderr.txt"
      echo $? > "$O/rc"
      dump ACCT "$W/acct.idx" "$O/ACCOUNT.dat"
    else
      echo "LOAD_FAILED" > "$O/rc"
    fi
  fi
  cd /; rm -rf "$W"
}
for C in "$@"; do
  run_once "$C" plain
  run_once "$C" trace
  # Keep only the trace file from the traced run; outputs come from the plain binary.
  if [ -f "$C/out-trace/trace.txt" ]; then mv "$C/out-trace/trace.txt" "$C/out/trace.txt"; fi
  cp "$C/out-trace/rc" "$C/out/rc.trace" 2>/dev/null || true
  rm -rf "$C/out-trace"
done
