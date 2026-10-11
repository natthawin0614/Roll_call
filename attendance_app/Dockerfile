# CPU-only image for a server without a GPU.
#   docker compose up -d --build      -> https://<server-ip>:8000
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

# libgl/libglib are not needed by opencv-python-headless; libgomp is used by onnxruntime
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app
COPY web ./web
COPY scripts ./scripts
COPY models ./models
COPY config.yaml run.py ./

EXPOSE 8000
# --https: browsers only allow the camera on https (or localhost); --lan: listen on 0.0.0.0
CMD ["python", "run.py", "--https", "--no-browser"]
