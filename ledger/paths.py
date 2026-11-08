"""Filesystem locations used across Legibol."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CARDDEMO = ROOT / "vendor" / "carddemo" / "app"
CBL_DIR = CARDDEMO / "cbl"
CPY_DIR = CARDDEMO / "cpy"
SAMPLE_DIR = CARDDEMO / "data" / "ASCII"
DATA = ROOT / "data"            # pipeline outputs (never hand-edited)
RUNS = DATA / "runs"            # harness case directories
CACHE = ROOT / "cache" / "llm"  # LLM request/response cache
PORT_DIR = ROOT / "port"
GENERATED = PORT_DIR / "generated"

PROGRAMS = ["CBTRN02C", "CBACT04C"]
COPYBOOKS = ["CVACT01Y", "CVACT03Y", "CVTRA01Y", "CVTRA02Y", "CVTRA05Y", "CVTRA06Y"]
