#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION = (ROOT / "VERSION").read_text("utf-8").strip()
DIST = ROOT / "dist"
DIST.mkdir(exist_ok=True)
OUT = DIST / f"zelux-studio-{VERSION}.zip"
SKIP = {".git", ".github", "dist", "tools", "__pycache__"}
with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(ROOT.rglob("*")):
        rel = path.relative_to(ROOT)
        if path.is_file() and not any(part in SKIP for part in rel.parts):
            archive.write(path, rel.as_posix())
digest = hashlib.sha256(OUT.read_bytes()).hexdigest()
OUT.with_suffix(OUT.suffix + ".sha256").write_text(f"{digest}  {OUT.name}\n", "ascii")
print(OUT)
