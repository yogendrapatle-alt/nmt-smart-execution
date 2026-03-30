#!/usr/bin/env python3
"""One-off helper: migrate hardcoded localhost:5000 to getApiBase(). Not run at build time."""
import re
import sys
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "src"


def import_path_for(path: Path) -> str:
    rel = path.relative_to(SRC)
    depth = len(rel.parts) - 1
    prefix = "../" * depth if depth else "./"
    return f"{prefix}utils/backendUrl"


def add_getapi_import(content: str, path: Path) -> str:
    if "getApiBase" not in content:
        return content
    if re.search(r"import\s*\{[^}]*\bgetApiBase\b", content):
        return content
    m = re.search(
        r"(import\s*\{)([^}]+)(\}\s*from\s*['\"]([^'\"]+)['\"])",
        content,
    )
    if m and "utils/backendUrl" in m.group(4):
        inner = m.group(2).strip()
        if "getApiBase" in inner:
            return content
        new_block = f"{m.group(1)} {inner}, getApiBase {m.group(3)}"
        return content.replace(m.group(0), new_block, 1)
    line = f"import {{ getApiBase }} from '{import_path_for(path)}';\n"
    lines = content.splitlines(keepends=True)
    last_import = -1
    for i, line in enumerate(lines):
        if line.startswith("import "):
            last_import = i
    if last_import >= 0:
        lines.insert(last_import + 1, line)
        return "".join(lines)
    return line + content


def transform_line(line: str) -> str:
    stripped = line.lstrip()
    if stripped.startswith("//") or stripped.startswith("*"):
        return line

    line = re.sub(
        r"const\s+(backendUrl\d*)\s*=\s*'http://localhost:5000'\s*;",
        r"const \1 = getApiBase();",
        line,
    )
    line = re.sub(
        r"const\s+API_BASE\s*=\s*'http://localhost:5000'\s*;",
        r"const API_BASE = getApiBase();",
        line,
    )

    def repl_quoted(m: re.Match) -> str:
        return f"`${{getApiBase()}}{m.group(1)}`"

    line = re.sub(r"'http://localhost:5000([^']*)'", repl_quoted, line)
    line = re.sub(r'"http://localhost:5000([^"]*)"', repl_quoted, line)
    line = re.sub(r"`http://localhost:5000", r"`${getApiBase()}", line)
    return line


def transform(content: str) -> str:
    lines = content.splitlines(keepends=True)
    return "".join(transform_line(line) for line in lines)


def main() -> None:
    paths = list(SRC.rglob("*.tsx")) + list(SRC.rglob("*.ts"))
    for path in sorted(paths):
        if path.name in ("backendUrl.ts", "vite-env.d.ts"):
            continue
        text = path.read_text(encoding="utf-8")
        if "localhost:5000" not in text:
            continue
        new = transform(text)
        new = add_getapi_import(new, path)
        if new != text:
            path.write_text(new, encoding="utf-8")
            print("updated:", path.relative_to(SRC.parent))


if __name__ == "__main__":
    main()
