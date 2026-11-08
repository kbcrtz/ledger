# Ledger legacy runtime: GnuCOBOL 3.1.2 (Debian bookworm gnucobol3) with Berkeley DB indexed files.
FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends gnucobol3 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /work
