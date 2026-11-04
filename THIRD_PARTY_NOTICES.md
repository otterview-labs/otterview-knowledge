# Third-party components

The root LICENSE covers original project code only. Dependencies, downloaded
models, system executables and remotely loaded browser libraries keep their own
licenses. This inventory describes preparation work, not a completed legal or
binary redistribution certification.

## Dependency profiles

| Profile | Purpose | Release review |
| --- | --- | --- |
| requirements-native.txt | HTTP model clients, PostgreSQL/pgvector, FastAPI, text/Office/PDF parsing | Baseline source/native profile; review every resolved transitive package |
| requirements.minimal.txt / requirements.txt | Source/container profile with FAISS, Milvus, spaCy and local helpers | Additional native libraries and package data must be inventoried |
| requirements-vision.txt | Optional local OCR/vision | Review weights, datasets and downstream licenses independently |
| requirements-full.txt | Optional multimedia/local model stack | Review FFmpeg build configuration, native libraries and weights before shipping |

PyMuPDF was removed from declared dependencies and the PDF parser no longer
imports it. PDF text/tables use the existing pdfplumber implementation. PyMuPDF
is offered under AGPL or commercial terms; adding it again requires an explicit
license decision. html2text 2024.2.26 (GPLv3) was unused and was also removed.
These edits do not change the licenses of old binaries, local installed packages,
or optional third-party tools brought in by an operator.

Sources: [PyMuPDF licensing](https://pymupdf.readthedocs.io/en/latest/about.html),
[html2text 2024.2.26 metadata](https://pypi.org/project/html2text/2024.2.26/).

## Components needing attention when redistributing

- `psycopg2-binary`: LGPL family terms and bundled native library notices. Preserve
  the exact wheel's notices; a standalone executable must be evaluated separately.
- `pdfplumber` and its PDF/image dependencies: inventory the resolved wheel set,
  including pdfminer.six and pypdfium2/PDFium if resolved. Preserve bundled notices.
- FFmpeg/Poppler/Tesseract/system libraries: inventory the actual executable build
  and enabled codecs. A Python wrapper's license does not cover its executables.
- FAISS, Milvus clients, spaCy, OCR/vision frameworks: include package/native data
  and transitive notices for the selected profile, not just top-level names.
- Model weights are not included. Remote LLM/embedding/VLM/ASR services are subject
  to the operator's own provider agreement; code licensing grants no model rights.
- The static demo pages reference D3 and Font Awesome through public CDNs. These
  are external network dependencies, not vendored assets. Review their exact
  versions and licensing before creating an offline or bundled UI distribution.

## Reproducible release evidence

Create a fresh environment for each profile and platform. Never package an old
working `.venv` containing removed dependencies. Record the resolved dependency
versions, export all installed license texts, run an advisory audit, and generate
an SBOM for the **actual** artifact. For example:

```bash
python scripts/dependency_inventory.py --output /tmp/knowledge-dependencies
python -m pip_audit --format json --output /tmp/knowledge-pip-audit.json
```

The inventory script copies available installed license/notice files and produces
an SPDX 2.3 package inventory. For exact versions of jieba, loguru and the
packageurl-python audit tool, missing wheel notices are supplemented from
`third_party/licenses/`, with immutable upstream commit URLs and SHA256 provenance.
Missing or ambiguous metadata requires manual
review. Its output covers Python distributions in that environment; native
system libraries, model weights, embedded assets and obligations of standalone
linking must be added during artifact review. License texts and SBOM should ship
beside each executable/image release, together with root LICENSE and NOTICE.

Apache redistribution terms: [Apache License 2.0, section 4](https://www.apache.org/licenses/LICENSE-2.0.html).
