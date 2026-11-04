"""Export an installed-Python SPDX inventory and available license/notice files.

Run inside the fresh environment used for each release artifact. System libraries,
weights and linking obligations need separate review. Unknown metadata is explicit.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path


def export_inventory(output: Path) -> dict:
    output.mkdir(parents=True, exist_ok=True)
    packages, summary, relationships = [], [], []
    supplemental_root = Path(__file__).resolve().parents[1] / 'third_party' / 'licenses'
    source_manifest = supplemental_root / 'sources.json'
    supplemental = json.loads(source_manifest.read_text()) if source_manifest.is_file() else []
    for dist in sorted(importlib.metadata.distributions(), key=lambda d: d.metadata['Name'].lower()):
        name, version = dist.metadata['Name'], dist.version
        slug = re.sub(r'[^a-zA-Z0-9.-]', '-', name)
        identity = 'SPDXRef-' + slug + '-' + hashlib.sha256((name + version).encode()).hexdigest()[:12]
        notices = []
        for file in dist.files or []:
            if not re.search(r'(?:^|/)(?:licen[sc]es?|build_licenses|copying|notice|authors)(?:[./_-]|$)', str(file), re.I):
                continue
            source = Path(dist.locate_file(file))
            if not source.is_file():
                continue
            # Flatten metadata paths and avoid collisions without trusting package filenames.
            target = output / 'licenses' / f'{slug}-{version}' / (hashlib.sha256(str(file).encode()).hexdigest()[:10] + '-' + source.name)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(source.read_bytes())
            notices.append(str(target.relative_to(output)))
        provenance = None
        if not notices:
            provenance = next((entry for entry in supplemental
                               if entry['name'].lower() == name.lower() and entry['version'] == version), None)
            if provenance:
                source = (supplemental_root / provenance['file']).resolve()
                if not source.is_relative_to(supplemental_root.resolve()):
                    raise ValueError('Supplemental license path escapes its directory')
                data = source.read_bytes()
                if hashlib.sha256(data).hexdigest() != provenance['sha256']:
                    raise ValueError(f'License checksum mismatch: {name}')
                target = output / 'licenses' / f'{slug}-{version}' / 'upstream-LICENSE.txt'
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
                target.with_name('provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
                notices.append(str(target.relative_to(output)))
        expression = dist.metadata.get('License-Expression') or 'NOASSERTION'
        packages.append({'SPDXID': identity, 'name': name, 'versionInfo': version,
                         'downloadLocation': 'NOASSERTION', 'filesAnalyzed': False,
                         'licenseConcluded': 'NOASSERTION', 'licenseDeclared': expression,
                         'copyrightText': 'NOASSERTION',
                         'externalRefs': [{'referenceCategory': 'PACKAGE-MANAGER',
                                           'referenceType': 'purl', 'referenceLocator': f'pkg:pypi/{name.lower() }@{version}'}]})
        summary.append({'name': name, 'version': version, 'license_expression': expression,
                        'license_metadata': dist.metadata.get('License'),
                        'license_classifiers': [item for item in dist.metadata.get_all('Classifier', []) if item.startswith('License ::')],
                        'notice_files': notices, 'supplemental_provenance': provenance})
        relationships.append({'spdxElementId': 'SPDXRef-DOCUMENT', 'relationshipType': 'DESCRIBES', 'relatedSpdxElement': identity})
    sbom = {'spdxVersion': 'SPDX-2.3', 'dataLicense': 'CC0-1.0', 'SPDXID': 'SPDXRef-DOCUMENT',
            'name': 'knowledge-runtime-python-environment',
            'documentNamespace': 'https://spdx.org/spdxdocs/knowledge-runtime-' + str(uuid.uuid4()),
            'creationInfo': {'creators': ['Tool: knowledge-runtime-dependency-inventory'],
                             'created': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')},
            'packages': packages, 'relationships': relationships,
            'documentComment': 'Installed Python distributions only; includes build/test tools if installed. Native system libraries and embedded artifacts require separate review.'}
    (output / 'sbom.spdx.json').write_text(json.dumps(sbom, indent=2) + '\n')
    (output / 'dependencies.json').write_text(json.dumps(summary, indent=2) + '\n')
    return {'packages': len(packages), 'missing_notice_files': sum(not item['notice_files'] for item in summary)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(export_inventory(args.output)))


if __name__ == '__main__':
    main()
