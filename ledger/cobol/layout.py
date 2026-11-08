"""Copybook / data-division layout parsing: PIC clauses -> fields with offsets and widths.

Deterministic. Handles the subset CardDemo batch programs use: levels, PIC X/9/S/V,
repeat counts, REDEFINES, COMP/BINARY, VALUE, FILLER. No OCCURS in the targets.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field, asdict
from pathlib import Path

PIC_RE = re.compile(r"\bPIC(?:TURE)?\s+(?:IS\s+)?(\S+)", re.I)


def source_lines(path: Path) -> list[str]:
    """Return the program area (cols 1-72) of each physical line, trailing blanks stripped."""
    text = path.read_text(encoding="latin-1")
    return [ln.rstrip("\r\n")[:72].rstrip() for ln in text.split("\n")]


def is_comment(line: str) -> bool:
    return len(line) > 6 and line[6] in "*/"


@dataclass
class Pic:
    kind: str          # "X" alphanumeric, "9" numeric display
    digits: int        # total digits (numeric) or chars (alnum)
    scale: int = 0     # digits after implied decimal point
    signed: bool = False
    usage: str = "DISPLAY"  # DISPLAY | BINARY

    @property
    def size(self) -> int:
        if self.kind == "9" and self.usage == "BINARY":
            return 2 if self.digits <= 4 else 4 if self.digits <= 9 else 8
        return self.digits

    @property
    def text(self) -> str:
        if self.kind == "X":
            return f"X({self.digits})"
        s = "S" if self.signed else ""
        intd = self.digits - self.scale
        t = f"{s}9({intd})" + (f"V9({self.scale})" if self.scale else "")
        return t + (" COMP" if self.usage == "BINARY" else "")


def parse_pic(pic: str, usage: str = "DISPLAY") -> Pic:
    p = pic.upper().rstrip(".")
    expanded = ""
    for m in re.finditer(r"([SXV9A])(?:\((\d+)\))?", p):
        ch, n = m.group(1), int(m.group(2) or 1)
        expanded += ch * n
    signed = expanded.startswith("S")
    body = expanded.lstrip("S")
    if "X" in body or "A" in body:
        return Pic("X", len(body))
    if "V" in body:
        intpart, frac = body.split("V", 1)
    else:
        intpart, frac = body, ""
    return Pic("9", len(intpart) + len(frac), len(frac), signed, usage)


@dataclass
class Field:
    level: int
    name: str
    offset: int = 0
    size: int = 0
    pic: Pic | None = None
    redefines: str | None = None
    line: int = 0            # 1-based physical line in its source file
    file: str = ""
    children: list["Field"] = field(default_factory=list)

    @property
    def is_group(self) -> bool:
        return self.pic is None

    def walk(self):
        yield self
        for c in self.children:
            yield from c.walk()

    def to_dict(self) -> dict:
        d = {"level": self.level, "name": self.name, "offset": self.offset, "size": self.size,
             "line": self.line, "file": self.file}
        if self.pic:
            d.update(pic=self.pic.text, kind=self.pic.kind, digits=self.pic.digits,
                     scale=self.pic.scale, signed=self.pic.signed, usage=self.pic.usage)
        if self.redefines:
            d["redefines"] = self.redefines
        return d


def _statements(lines: list[str], start: int, end: int):
    """Yield (first_line_no, statement_text) for data entries between line indices."""
    buf, first = [], None
    for i in range(start, end):
        ln = lines[i]
        if not ln.strip() or is_comment(ln):
            continue
        area = ln[7:] if len(ln) > 7 else ""
        if first is None:
            first = i + 1
        buf.append(area.strip())
        if area.rstrip().endswith("."):
            yield first, " ".join(buf)
            buf, first = [], None
    if buf:
        yield first, " ".join(buf)


ENTRY_RE = re.compile(r"^(\d{1,2})\s+([A-Z0-9-]+)(.*)$", re.I)


def parse_entries(entries: list[tuple[int, str, str]]) -> list[Field]:
    """entries: (line_no, file, statement). Returns 01-level records with computed offsets."""
    records: list[Field] = []
    stack: list[Field] = []
    for line_no, fname, stmt in entries:
        m = ENTRY_RE.match(stmt.strip().rstrip("."))
        if not m:
            continue
        level, name, rest = int(m.group(1)), m.group(2).upper(), m.group(3)
        if level == 88 or level == 66 or level == 77 and False:
            continue
        usage = "BINARY" if re.search(r"\b(COMP|COMP-4|COMP-5|BINARY)\b", rest, re.I) else "DISPLAY"
        pm = PIC_RE.search(rest)
        pic = parse_pic(pm.group(1), usage) if pm else None
        rm = re.search(r"\bREDEFINES\s+([A-Z0-9-]+)", rest, re.I)
        f = Field(level=level, name=name, pic=pic, redefines=rm.group(1).upper() if rm else None,
                  line=line_no, file=fname)
        if level in (1, 77):
            records.append(f)
            stack = [f]
            continue
        while stack and stack[-1].level >= level:
            stack.pop()
        if not stack:
            continue
        stack[-1].children.append(f)
        stack.append(f)
    for r in records:
        _assign(r, 0)
    return records


def _assign(f: Field, offset: int) -> int:
    f.offset = offset
    if f.pic is not None:
        f.size = f.pic.size
        return f.size
    pos = offset
    sizes: dict[str, tuple[int, int]] = {}
    for c in f.children:
        if c.redefines and c.redefines in sizes:
            o, _ = sizes[c.redefines]
            _assign(c, o)
        else:
            n = _assign(c, pos)
            sizes[c.name] = (pos, n)
            pos += n
    f.size = pos - offset
    return f.size


def parse_copybook(path: Path) -> list[Field]:
    lines = source_lines(path)
    entries = [(ln, path.name, s) for ln, s in _statements(lines, 0, len(lines))]
    return parse_entries(entries)


def flat_fields(record: Field) -> list[dict]:
    """Elementary fields of a record in offset order (FILLER included)."""
    out = []
    for f in record.walk():
        if f.pic is not None and not f.redefines:
            out.append(f.to_dict())
    return out
