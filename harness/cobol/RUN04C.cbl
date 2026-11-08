      *> Ledger harness driver for CBACT04C, which has
      *> PROCEDURE DIVISION USING EXTERNAL-PARMS and so cannot be
      *> built with cobc -x. Passes PARM '2022071800' (INTCALC.jcl)
      *> in the IBM layout: halfword length + parm text.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. RUN04C.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-PARMS.
           05  WS-PARM-LENGTH      PIC S9(04) COMP VALUE 10.
           05  WS-PARM-DATE        PIC X(10) VALUE '2022071800'.
       01  WS-ARG                  PIC X(10) VALUE SPACES.
       PROCEDURE DIVISION.
           ACCEPT WS-ARG FROM COMMAND-LINE
           IF WS-ARG NOT = SPACES
              MOVE WS-ARG TO WS-PARM-DATE
           END-IF
           CALL 'CBACT04C' USING WS-PARMS
           STOP RUN.
