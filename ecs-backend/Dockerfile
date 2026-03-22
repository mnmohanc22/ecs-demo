FROM python:3.11-slim

WORKDIR /app

# Install system dependencies (aws cli for secrets, jq for parsing)
RUN apt-get update && \
    apt-get install -y --no-install-recommends jq awscli && \
    rm -rf /var/lib/apt/lists/*

# Install Python dependencies first (layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy app source
COPY app.py .
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh

# Non-root user for security
RUN useradd -m appuser && chown -R appuser /app
USER appuser

EXPOSE 5000

# Gunicorn for production
ENTRYPOINT ["./entrypoint.sh"]
