#!/bin/sh
set -e

# ── Fetch DB password from AWS Secrets Manager at startup ────
# If SECRET_NAME is set, retrieve the secret and extract the
# "password" key.  This keeps secrets out of env vars, task
# definitions, and .env files in production.
# Requires: aws cli installed in the image, IAM permissions for
#           secretsmanager:GetSecretValue, and jq for parsing.

if [ -n "$SECRET_NAME" ]; then
    echo "[entrypoint] Fetching DB password from Secrets Manager: ${SECRET_NAME}"
    REGION="${AWS_REGION:-us-east-1}"

    SECRET_JSON=$(aws secretsmanager get-secret-value \
        --secret-id "$SECRET_NAME" \
        --region "$REGION" \
        --query SecretString \
        --output text)

    export DB_PASSWORD=$(echo "$SECRET_JSON" | jq -r '.password // .DB_PASSWORD // .db_password')

    if [ -z "$DB_PASSWORD" ] || [ "$DB_PASSWORD" = "null" ]; then
        echo "[entrypoint] ERROR: No password key found in secret '${SECRET_NAME}'"
        exit 1
    fi

    echo "[entrypoint] DB_PASSWORD set from Secrets Manager"
else
    echo "[entrypoint] SECRET_NAME not set — using DB_PASSWORD from environment"
fi

exec gunicorn --bind 0.0.0.0:5000 --workers 2 --timeout 60 app:app
