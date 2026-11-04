"""Create a scanned, history-free review archive. Does not publish or change Git refs."""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import subprocess
import tarfile
from pathlib import Path

from scan_secrets import ROOT, scan


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path, help='New .tar.gz path outside the repository')
    args = parser.parse_args()
    output = args.output.expanduser().resolve()
    if output.is_relative_to(ROOT) or output.exists():
        parser.error('Output must be a new file outside the repository')
    issues = scan()
    if issues:
        for path, line, kind in issues:
            print(f'{path}:{line}: {kind} [REDACTED]')
        raise SystemExit('Credential guard failed; snapshot not created')
    tracked = subprocess.check_output(['git', '-C', str(ROOT), 'ls-files', '-z'])
    new = subprocess.check_output(['git', '-C', str(ROOT), 'ls-files', '--others', '--exclude-standard', '-z'])
    files = []
    for raw in sorted(set(tracked.split(b'\0')) | set(new.split(b'\0'))):
        if not raw:
            continue
        relative = Path(raw.decode())
        if any(part in {'.git', '.venv', '__pycache__', 'private-backups', 'logs', 'temp', 'dist'} for part in relative.parts):
            continue
        if relative.name.startswith('.env') and relative.name != '.env.example':
            continue
        if relative.parts[:2] == ('storage', 'static'):
            if any(part in {'uploads', 'images'} for part in relative.parts[2:]):
                continue
        elif relative.parts[0] == 'storage':
            continue
        source = ROOT / relative
        if source.is_symlink():
            raise SystemExit(f'Symlink requires review: {relative}')
        if source.is_file():
            files.append((relative.as_posix(), source.read_bytes(), source.stat().st_mode & 0o111 != 0))
    manifest = {'format': 1, 'contains_git_history': False,
                'release_status': 'source snapshot: scan and review before redistribution',
                'files': {name: hashlib.sha256(data).hexdigest() for name, data, _ in files}}
    files.append(('SOURCE_MANIFEST.json', (json.dumps(manifest, indent=2) + '\n').encode(), False))
    output.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(output, 'w:gz') as archive:
        for name, data, executable in files:
            info = tarfile.TarInfo('otterview-knowledge/' + name)
            info.size, info.mode, info.mtime = len(data), 0o755 if executable else 0o644, 0
            archive.addfile(info, io.BytesIO(data))
    checksum = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_name(output.name + '.sha256').write_text(f'{checksum}  {output.name}\n')
    print(f'Created {output} ({len(files)} files); SHA256 {checksum}')


if __name__ == '__main__':
    main()
