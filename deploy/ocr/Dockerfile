FROM python:3.11-slim
WORKDIR /opt/ocr
COPY deploy/ocr/requirements.txt /opt/ocr/requirements.txt
RUN pip install --no-cache-dir --no-deps -r requirements.txt
COPY deploy/ocr/server.py /opt/ocr/server.py
COPY deploy/ocr/engine_pool.py /opt/ocr/engine_pool.py
ENV OCR_BIND=0.0.0.0 OCR_PORT=8014 OCR_WORKERS=2 OCR_THREADS=8 OCR_DET_MAX_EDGE=736 PYTHONDONTWRITEBYTECODE=1
USER 65534:65534
EXPOSE 8014
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8014/health',timeout=3)"
CMD ["python", "/opt/ocr/server.py"]
