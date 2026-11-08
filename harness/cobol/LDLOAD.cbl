      *> Ledger harness loader: fixed-width record file -> indexed
      *> (Berkeley DB) file. Key definitions mirror the SELECT
      *> clauses of CBTRN02C / CBACT04C exactly.
      *> Usage: LDLOAD ACCT|XREF|XREFALT|TCAT|DISC
      *>   DD_LDIN  = input record-sequential file
      *>   DD_LDOUT = output indexed file
       IDENTIFICATION DIVISION.
       PROGRAM-ID. LDLOAD.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT IN-300 ASSIGN TO LDIN
                  ORGANIZATION IS SEQUENTIAL
                  FILE STATUS IS WS-IN-STATUS.
           SELECT IN-50 ASSIGN TO LDIN
                  ORGANIZATION IS SEQUENTIAL
                  FILE STATUS IS WS-IN-STATUS.
           SELECT ACCT-OUT ASSIGN TO LDOUT
                  ORGANIZATION IS INDEXED
                  ACCESS MODE  IS RANDOM
                  RECORD KEY   IS ACCT-KEY
                  FILE STATUS  IS WS-OUT-STATUS.
           SELECT XREF-OUT ASSIGN TO LDOUT
                  ORGANIZATION IS INDEXED
                  ACCESS MODE  IS RANDOM
                  RECORD KEY   IS XREF-KEY
                  FILE STATUS  IS WS-OUT-STATUS.
           SELECT XREFALT-OUT ASSIGN TO LDOUT
                  ORGANIZATION IS INDEXED
                  ACCESS MODE  IS RANDOM
                  RECORD KEY   IS XALT-CARD-NUM
                  ALTERNATE RECORD KEY IS XALT-ACCT-ID
                  FILE STATUS  IS WS-OUT-STATUS.
           SELECT TCAT-OUT ASSIGN TO LDOUT
                  ORGANIZATION IS INDEXED
                  ACCESS MODE  IS RANDOM
                  RECORD KEY   IS TCAT-KEY
                  FILE STATUS  IS WS-OUT-STATUS.
           SELECT DISC-OUT ASSIGN TO LDOUT
                  ORGANIZATION IS INDEXED
                  ACCESS MODE  IS RANDOM
                  RECORD KEY   IS DISC-KEY
                  FILE STATUS  IS WS-OUT-STATUS.
       DATA DIVISION.
       FILE SECTION.
       FD  IN-300.
       01  IN-300-REC              PIC X(300).
       FD  IN-50.
       01  IN-50-REC               PIC X(50).
       FD  ACCT-OUT.
       01  ACCT-OUT-REC.
           05 ACCT-KEY             PIC 9(11).
           05 FILLER               PIC X(289).
       FD  XREF-OUT.
       01  XREF-OUT-REC.
           05 XREF-KEY             PIC X(16).
           05 FILLER               PIC X(34).
       FD  XREFALT-OUT.
       01  XREFALT-OUT-REC.
           05 XALT-CARD-NUM        PIC X(16).
           05 XALT-CUST-NUM        PIC 9(09).
           05 XALT-ACCT-ID         PIC 9(11).
           05 FILLER               PIC X(14).
       FD  TCAT-OUT.
       01  TCAT-OUT-REC.
           05 TCAT-KEY.
              10 TCAT-ACCT-ID      PIC 9(11).
              10 TCAT-TYPE-CD      PIC X(02).
              10 TCAT-CD           PIC 9(04).
           05 FILLER               PIC X(33).
       FD  DISC-OUT.
       01  DISC-OUT-REC.
           05 DISC-KEY.
              10 DISC-GROUP-ID     PIC X(10).
              10 DISC-TYPE-CD      PIC X(02).
              10 DISC-CAT-CD       PIC 9(04).
           05 FILLER               PIC X(34).
       WORKING-STORAGE SECTION.
       01  WS-KIND                 PIC X(10) VALUE SPACES.
       01  WS-IN-STATUS            PIC X(02).
       01  WS-OUT-STATUS           PIC X(02).
       01  WS-EOF                  PIC X VALUE 'N'.
       01  WS-COUNT                PIC 9(9) VALUE 0.
       01  WS-ERRORS               PIC 9(9) VALUE 0.
       PROCEDURE DIVISION.
           ACCEPT WS-KIND FROM COMMAND-LINE
           EVALUATE WS-KIND
             WHEN 'ACCT'
               OPEN INPUT IN-300  OUTPUT ACCT-OUT
               PERFORM UNTIL WS-EOF = 'Y'
                 READ IN-300 AT END MOVE 'Y' TO WS-EOF
                 NOT AT END
                   WRITE ACCT-OUT-REC FROM IN-300-REC
                   PERFORM CHECK-WRITE
                 END-READ
               END-PERFORM
               CLOSE IN-300 ACCT-OUT
             WHEN 'XREF'
               OPEN INPUT IN-50  OUTPUT XREF-OUT
               PERFORM UNTIL WS-EOF = 'Y'
                 READ IN-50 AT END MOVE 'Y' TO WS-EOF
                 NOT AT END
                   WRITE XREF-OUT-REC FROM IN-50-REC
                   PERFORM CHECK-WRITE
                 END-READ
               END-PERFORM
               CLOSE IN-50 XREF-OUT
             WHEN 'XREFALT'
               OPEN INPUT IN-50  OUTPUT XREFALT-OUT
               PERFORM UNTIL WS-EOF = 'Y'
                 READ IN-50 AT END MOVE 'Y' TO WS-EOF
                 NOT AT END
                   WRITE XREFALT-OUT-REC FROM IN-50-REC
                   PERFORM CHECK-WRITE
                 END-READ
               END-PERFORM
               CLOSE IN-50 XREFALT-OUT
             WHEN 'TCAT'
               OPEN INPUT IN-50  OUTPUT TCAT-OUT
               PERFORM UNTIL WS-EOF = 'Y'
                 READ IN-50 AT END MOVE 'Y' TO WS-EOF
                 NOT AT END
                   WRITE TCAT-OUT-REC FROM IN-50-REC
                   PERFORM CHECK-WRITE
                 END-READ
               END-PERFORM
               CLOSE IN-50 TCAT-OUT
             WHEN 'DISC'
               OPEN INPUT IN-50  OUTPUT DISC-OUT
               PERFORM UNTIL WS-EOF = 'Y'
                 READ IN-50 AT END MOVE 'Y' TO WS-EOF
                 NOT AT END
                   WRITE DISC-OUT-REC FROM IN-50-REC
                   PERFORM CHECK-WRITE
                 END-READ
               END-PERFORM
               CLOSE IN-50 DISC-OUT
             WHEN OTHER
               DISPLAY 'LDLOAD: UNKNOWN KIND ' WS-KIND
               MOVE 16 TO RETURN-CODE
               STOP RUN
           END-EVALUATE
           DISPLAY 'LDLOAD ' WS-KIND ' LOADED=' WS-COUNT
                   ' ERRORS=' WS-ERRORS
           IF WS-ERRORS > 0
              MOVE 8 TO RETURN-CODE
           END-IF
           STOP RUN.
       CHECK-WRITE.
           IF WS-OUT-STATUS = '00' OR '02'
              ADD 1 TO WS-COUNT
           ELSE
              ADD 1 TO WS-ERRORS
              DISPLAY 'LDLOAD WRITE STATUS ' WS-OUT-STATUS
           END-IF.
