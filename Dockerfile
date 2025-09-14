FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends file && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir pandas==2.2.3 pyarrow==16.1.0
WORKDIR /app