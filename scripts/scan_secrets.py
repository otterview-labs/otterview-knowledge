"""Redacted, dependency-free credential guard. Supplement with Gitleaks before release.

Default: tracked + nonignored new files. --history: every reachable blob in local refs.
No credential values or matched source lines are printed.
"""
from __future__ import annotations

import argparse
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RULES = {
    "private-key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----"),
    "provider-token": re.compile(r"\b(?:sk-[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[A-Z0-9]{16})\b"),
    "credential-url": re.compile(r"\b(?:postgres(?:ql)?(?:\+\w+)?|mysql(?:\+\w+)?|redis|https?)://[^\s:/@]+:([^\s/@]+)@"),
    "literal-credential": re.compile(r'''(?i)(?:[\w]*(?:password|passwd|api_key|access_key|secret_key)[\w]*["']?\s*[:=]\s*["'])([^"'\n]{6,})["']'''),
    "redis-cli-password": re.compile(r"redis-cli[^\n]*?\s-a\s+([^\s\"';]+)"),
}
# Only obviously nonsecret examples are exempt. Never baseline real historical credentials.
PLACEHOLDER = re.compile(r"(?i)^(?:your[_-]|test[_-]|example|dummy|placeholder|redacted|change[_-]|dev-secret|\$|\{|<|os\.|settings\.|getenv|env\(|process\.|none$|empty$|postgres$|password$|redis$|neo4j$)")


def findings(data: str):
    for kind, pattern in RULES.items():
        for match in pattern.finditer(data):
            value = match.group(1) if match.lastindex else match.group()
            if PLACEHOLDER.search(value) or value in {"bearer", "disabled", "*" * len(value)}:
                continue
            yield data.count("\n", 0, match.start()) + 1, kind


def git(*args: str) -> bytes:
    return subprocess.check_output(["git", "-C", str(ROOT), *args])


def scan(history: bool = False) -> list[tuple[str, int, str]]:
    issues = []
    if history:
        objects = git("rev-list", "--objects", "--all").decode().splitlines()
        process = subprocess.Popen(["git", "-C", str(ROOT), "cat-file", "--batch"], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
        try:
            for item in objects:
                sha, _, name = item.partition(" ")
                process.stdin.write((sha + "\n").encode())
                process.stdin.flush()
                header = process.stdout.readline().decode().split()
                if len(header) != 3:
                    continue
                data = process.stdout.read(int(header[2]))
                process.stdout.read(1)
                if header[1] == "blob":
                    label = f"{sha[:12]}:{name or '(unnamed blob)'}"
                    issues.extend((label, line, kind) for line, kind in findings(data.decode("utf-8", errors="replace")))
        finally:
            process.stdin.close()
            process.stdout.close()
            process.wait()
    else:
        names = set(git("ls-files", "-z").split(b"\0")) | set(git("ls-files", "--others", "--exclude-standard", "-z").split(b"\0"))
        for raw_name in sorted(names):
            if not raw_name:
                continue
            name = raw_name.decode()
            path = ROOT / name
            if path.is_symlink():
                issues.append((name, 1, "symlink-requires-review"))
            elif path.is_file():
                issues.extend((name, line, kind) for line, kind in findings(path.read_text(errors="replace")))
    return issues


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--history", action="store_true")
    args = parser.parse_args()
    issues = scan(args.history)
    for path, line, kind in issues:
        print(f"{path}:{line}: {kind} [REDACTED]")
    print(f"{'History' if args.history else 'Working tree'} scan: {len(issues)} finding(s)")
    raise SystemExit(bool(issues))


if __name__ == "__main__":
    main()
