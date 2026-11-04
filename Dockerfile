FROM python:3.11-slim

ARG INSTALL_PROFILE=native
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1

RUN apt-get update && apt-get install -y --no-install-recommends file \
    && if [ "$INSTALL_PROFILE" = "vision" ] || [ "$INSTALL_PROFILE" = "full" ]; then \
        apt-get install -y --no-install-recommends ffmpeg libgl1 libglib2.0-0 poppler-utils tesseract-ocr tesseract-ocr-chi-sim; \
    fi \
    && rm -rf /var/lib/apt/lists/*

COPY requirements*.txt ./
RUN case "$INSTALL_PROFILE" in \
        native) requirements=requirements-native.txt ;; \
        minimal) requirements=requirements.minimal.txt ;; \
        vision) requirements=requirements-vision.txt ;; \
        full) requirements=requirements-full.txt ;; \
        *) echo "Unsupported INSTALL_PROFILE: $INSTALL_PROFILE" >&2; exit 1 ;; \
    esac \
    && pip install --no-cache-dir "setuptools>=84.1.0" -r "$requirements"

COPY . .
EXPOSE 8006
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8006/health', timeout=3)"
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8006", "--workers", "1", "--loop", "asyncio", "--http", "h11"]
