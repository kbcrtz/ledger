      *> Ledger harness stub for IBM LE abend routine CEE3ABD.
      *> CardDemo calls it only on error paths (9999-ABEND-PROGRAM).
      *> We print a marker and end the run unit with RC 12 so the
      *> harness records an abend instead of hanging or crashing.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. CEE3ABD.
       DATA DIVISION.
       LINKAGE SECTION.
       01  LK-ABCODE               PIC S9(9) BINARY.
       01  LK-TIMING               PIC S9(9) BINARY.
       PROCEDURE DIVISION USING LK-ABCODE LK-TIMING.
           DISPLAY 'LEDGER-ABEND CEE3ABD ABCODE=' LK-ABCODE
           MOVE 12 TO RETURN-CODE
           STOP RUN.
