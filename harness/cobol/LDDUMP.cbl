      *> Ledger harness dumper: indexed file -> fixed-width records,
      *> in key order, so outputs can be compared field by field.
      *> Usage: LDDUMP ACCT|TCAT|TRAN
      *>   DD_LDIN  = input indexed file
      *>   DD_LDOUT = output record-sequential file
       IDENTIFICATION DIVISION.
       PROGRAM-ID. LDDUMP.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT ACCT-IN ASSIGN TO LDIN
                  ORGANIZATION IS INDEXED
                  ACCESS MODE  IS SEQUENTIAL
                  RECORD KEY   IS ACCT-KEY
                  FILE STATUS  IS WS-IN-STATUS.
           SELECT TCAT-IN ASSIGN TO LDIN
                  ORGANIZATION IS INDEXED
                  ACCESS MODE  IS SEQUENTIAL
                  RECORD KEY   IS TCAT-KEY
                  FILE STATUS  IS WS-IN-STATUS.
           SELECT TRAN-IN ASSIGN TO LDIN
                  ORGANIZATION IS INDEXED
                  ACCESS MODE  IS SEQUENTIAL
                  RECORD KEY   IS TRAN-KEY
                  FILE STATUS  IS WS-IN-STATUS.
           SELECT OUT-300 ASSIGN TO LDOUT
                  ORGANIZATION IS SEQUENTIAL
                  FILE STATUS IS WS-OUT-STATUS.
           SELECT OUT-50 ASSIGN TO LDOUT
                  ORGANIZATION IS SEQUENTIAL
                  FILE STATUS IS WS-OUT-STATUS.
           SELECT OUT-350 ASSIGN TO LDOUT
                  ORGANIZATION IS SEQUENTIAL
                  FILE STATUS IS WS-OUT-STATUS.
       DATA DIVISION.
       FILE SECTION.
       FD  ACCT-IN.
       01  ACCT-IN-REC.
           05 ACCT-KEY             PIC 9(11).
           05 FILLER               PIC X(289).
       FD  TCAT-IN.
       01  TCAT-IN-REC.
           05 TCAT-KEY.
              10 TCAT-ACCT-ID      PIC 9(11).
              10 TCAT-TYPE-CD      PIC X(02).
              10 TCAT-CD           PIC 9(04).
           05 FILLER               PIC X(33).
       FD  TRAN-IN.
       01  TRAN-IN-REC.
           05 TRAN-KEY             PIC X(16).
           05 FILLER               PIC X(334).
       FD  OUT-300.
       01  OUT-300-REC             PIC X(300).
       FD  OUT-50.
       01  OUT-50-REC              PIC X(50).
       FD  OUT-350.
       01  OUT-350-REC             PIC X(350).
       WORKING-STORAGE SECTION.
       01  WS-KIND                 PIC X(10) VALUE SPACES.
       01  WS-IN-STATUS            PIC X(02).
       01  WS-OUT-STATUS           PIC X(02).
       01  WS-EOF                  PIC X VALUE 'N'.
       01  WS-COUNT                PIC 9(9) VALUE 0.
       PROCEDURE DIVISION.
           ACCEPT WS-KIND FROM COMMAND-LINE
           EVALUATE WS-KIND
             WHEN 'ACCT'
               OPEN INPUT ACCT-IN  OUTPUT OUT-300
               PERFORM UNTIL WS-EOF = 'Y'
                 READ ACCT-IN NEXT AT END MOVE 'Y' TO WS-EOF
                 NOT AT END
                   WRITE OUT-300-REC FROM ACCT-IN-REC
                   ADD 1 TO WS-COUNT
                 END-READ
               END-PERFORM
               CLOSE ACCT-IN OUT-300
             WHEN 'TCAT'
               OPEN INPUT TCAT-IN  OUTPUT OUT-50
               PERFORM UNTIL WS-EOF = 'Y'
                 READ TCAT-IN NEXT AT END MOVE 'Y' TO WS-EOF
                 NOT AT END
                   WRITE OUT-50-REC FROM TCAT-IN-REC
                   ADD 1 TO WS-COUNT
                 END-READ
               END-PERFORM
               CLOSE TCAT-IN OUT-50
             WHEN 'TRAN'
               OPEN INPUT TRAN-IN  OUTPUT OUT-350
               PERFORM UNTIL WS-EOF = 'Y'
                 READ TRAN-IN NEXT AT END MOVE 'Y' TO WS-EOF
                 NOT AT END
                   WRITE OUT-350-REC FROM TRAN-IN-REC
                   ADD 1 TO WS-COUNT
                 END-READ
               END-PERFORM
               CLOSE TRAN-IN OUT-350
             WHEN OTHER
               DISPLAY 'LDDUMP: UNKNOWN KIND ' WS-KIND
               MOVE 16 TO RETURN-CODE
               STOP RUN
           END-EVALUATE
           DISPLAY 'LDDUMP ' WS-KIND ' DUMPED=' WS-COUNT
                   ' STATUS=' WS-IN-STATUS
           STOP RUN.
