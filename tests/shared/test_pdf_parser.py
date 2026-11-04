from __future__ import annotations

import importlib

from tests.helpers import clear_modules


def test_pdf_text_extraction_without_pymupdf(tmp_path):
    # A valid, minimal PDF with deterministic text and correct byte offsets.
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>',
               b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
               b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
               b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
    text = b'BT /F1 12 Tf 50 700 Td (Knowledge runtime PDF test) Tj ET'
    objects.append(b'<< /Length ' + str(len(text)).encode() + b' >>\nstream\n' + text + b'\nendstream')
    data, offsets = b'%PDF-1.4\n', [0]
    for i, obj in enumerate(objects, 1):
        offsets.append(len(data))
        data += str(i).encode() + b' 0 obj\n' + obj + b'\nendobj\n'
    xref = len(data)
    data += b'xref\n0 6\n0000000000 65535 f \n'
    data += b''.join(f'{offset:010} 00000 n \n'.encode() for offset in offsets[1:])
    data += b'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + str(xref).encode() + b'\n%%EOF\n'
    pdf = tmp_path / 'sample.pdf'
    pdf.write_bytes(data)
    clear_modules()
    module = importlib.import_module('app.shared.parsers.file_quckly_parse')
    assert 'Knowledge runtime PDF test' in module.FileToMarkdown()._pdf_to_markdown(str(pdf))
