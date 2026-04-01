FROM python:3.11-slim

WORKDIR /app

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Python deps
COPY requirements.txt requirements.web.txt ./
RUN pip install --no-cache-dir -r requirements.txt -r requirements.web.txt

# App source
COPY src/ ./src/
COPY web/ ./web/

# Folders that will be mounted as volumes at runtime
RUN mkdir -p data/raw data/processed data/processed/charts reports templates references

ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app

EXPOSE 8000

CMD ["uvicorn", "web.main:app", "--host", "0.0.0.0", "--port", "8000"]
