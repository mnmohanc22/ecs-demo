from flask import Flask, jsonify, request, g
from flask_cors import CORS
from dotenv import load_dotenv
import os
import datetime
import json
import logging
import time
import uuid
import psycopg2
import psycopg2.extras
import boto3
from botocore.exceptions import ClientError, NoCredentialsError

load_dotenv()

# ── Logging Setup ─────────────────────────────────────
LOG_LEVEL  = os.getenv("LOG_LEVEL", "INFO").upper()
LOG_FORMAT = os.getenv("LOG_FORMAT", "json")

class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        log = {
            "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
            "level":     record.levelname,
            "logger":    record.name,
            "message":   record.getMessage(),
            "module":    record.module,
            "function":  record.funcName,
            "line":      record.lineno,
        }
        for key, val in record.__dict__.items():
            if key not in (
                "args", "asctime", "created", "exc_info", "exc_text",
                "filename", "funcName", "id", "levelname", "levelno",
                "lineno", "message", "module", "msecs", "msg", "name",
                "pathname", "process", "processName", "relativeCreated",
                "stack_info", "thread", "threadName",
            ):
                log[key] = val
        if record.exc_info:
            log["exception"] = self.formatException(record.exc_info)
        return json.dumps(log)


def setup_logging() -> logging.Logger:
    logger = logging.getLogger("app")
    logger.setLevel(getattr(logging, LOG_LEVEL, logging.INFO))
    handler = logging.StreamHandler()
    if LOG_FORMAT == "json":
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(logging.Formatter(
            "%(asctime)s [%(levelname)s] %(name)s — %(message)s"
        ))
    if not logger.handlers:
        logger.addHandler(handler)
    logging.getLogger("werkzeug").setLevel(logging.WARNING)
    logging.getLogger("boto3").setLevel(logging.WARNING)
    logging.getLogger("botocore").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    return logger


log = setup_logging()

log.info("Starting Flask application", extra={
    "log_level":  LOG_LEVEL,
    "log_format": LOG_FORMAT,
    "env":        os.getenv("FLASK_ENV", "production"),
})

app = Flask(__name__)
CORS(app, origins="*")


# ── Request / Response Middleware ─────────────────────
@app.before_request
def before_request():
    g.request_id = request.headers.get("X-Request-ID", str(uuid.uuid4())[:8])
    g.start_time = time.time()
    log.info("Request started", extra={
        "request_id": g.request_id,
        "method":     request.method,
        "path":       request.path,
        "query":      request.query_string.decode(),
        "remote_ip":  request.remote_addr,
        "user_agent": request.headers.get("User-Agent", ""),
    })


@app.after_request
def after_request(response):
    duration_ms = round((time.time() - g.start_time) * 1000, 2)
    level = logging.INFO
    if response.status_code >= 500:
        level = logging.ERROR
    elif response.status_code >= 400:
        level = logging.WARNING
    log.log(level, "Request completed", extra={
        "request_id":  g.request_id,
        "method":      request.method,
        "path":        request.path,
        "status":      response.status_code,
        "duration_ms": duration_ms,
        "content_len": response.content_length,
    })
    return response


@app.teardown_request
def teardown_request(exc):
    if exc:
        log.error("Unhandled exception during request", extra={
            "request_id": getattr(g, "request_id", "unknown"),
            "path":       request.path,
            "error":      str(exc),
        }, exc_info=exc)


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# SECRETS MANAGER
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def get_secret(secret_name: str, region: str) -> dict:
    """Fetch and parse a secret from AWS Secrets Manager."""
    log.info("Fetching secret from Secrets Manager", extra={
        "secret_name": secret_name,
        "region":      region,
    })
    client = boto3.client("secretsmanager", region_name=region)
    try:
        response = client.get_secret_value(SecretId=secret_name)
        log.info("Secret fetched successfully", extra={"secret_name": secret_name})
    except ClientError as e:
        code = e.response["Error"]["Code"]
        error_map = {
            "DecryptionFailureException":    "KMS key can't decrypt the secret",
            "InternalServiceErrorException": "Secrets Manager internal error",
            "InvalidParameterException":     "Invalid secret parameter",
            "InvalidRequestException":       "Invalid request for current secret state",
            "ResourceNotFoundException":     f"Secret '{secret_name}' not found in {region}",
            "AccessDeniedException":         "IAM role lacks secretsmanager:GetSecretValue permission",
        }
        msg = error_map.get(code, str(e))
        log.error("Failed to fetch secret", extra={
            "secret_name": secret_name,
            "error_code":  code,
            "error":       msg,
        })
        raise RuntimeError(f"Secrets Manager error [{code}]: {msg}")
    except NoCredentialsError:
        log.error("No AWS credentials found for Secrets Manager")
        raise RuntimeError("No AWS credentials found — check IAM role or environment variables")

    secret_value = response.get("SecretString")
    if not secret_value:
        raise RuntimeError("Secret has no SecretString — binary secrets not supported")
    try:
        return json.loads(secret_value)
    except json.JSONDecodeError:
        return {"password": secret_value}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# DATABASE
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def build_db_config() -> dict:
    """Build DB config — password from Secrets Manager or env var."""
    secret_name = os.getenv("SECRET_NAME")
    region      = os.getenv("AWS_REGION", "us-east-1")

    if secret_name:
        log.info("Loading DB password from Secrets Manager", extra={
            "secret_name": secret_name,
            "region":      region,
        })
        secret   = get_secret(secret_name, region)
        password = (
            secret.get("password") or
            secret.get("DB_PASSWORD") or
            secret.get("db_password")
        )
        if not password:
            raise RuntimeError(
                f"No password key found in secret '{secret_name}'. Keys: {list(secret.keys())}"
            )
        db_host = os.getenv("DB_HOST") or secret.get("host", "localhost")
        db_user = os.getenv("DB_USER") or secret.get("username", "postgres")
        db_name = os.getenv("DB_NAME") or secret.get("dbname", "appdb")
        source  = "secrets_manager"
    else:
        log.warning("SECRET_NAME not set — using DB_PASSWORD env var (local dev mode)")
        password = os.getenv("DB_PASSWORD", "")
        db_host  = os.getenv("DB_HOST", "localhost")
        db_user  = os.getenv("DB_USER", "postgres")
        db_name  = os.getenv("DB_NAME", "appdb")
        source   = "env_var"

    config = {
        "host":            db_host,
        "port":            int(os.getenv("DB_PORT", "5432")),
        "dbname":          db_name,
        "user":            db_user,
        "password":        password,
        "connect_timeout": 5,
        "sslmode":         os.getenv("DB_SSLMODE", "require"),
    }
    log.info("DB config built", extra={
        "source":  source,
        "host":    config["host"],
        "port":    config["port"],
        "dbname":  config["dbname"],
        "user":    config["user"],
        "sslmode": config["sslmode"],
    })
    return config


try:
    DB_CONFIG = build_db_config()
except RuntimeError as e:
    log.error("Failed to load DB config at startup", extra={"error": str(e)})
    DB_CONFIG = None


def get_db_connection():
    if not DB_CONFIG:
        raise RuntimeError("DB config not loaded — check SECRET_NAME or DB_PASSWORD")
    return psycopg2.connect(**DB_CONFIG)


# ── Health ────────────────────────────────────────────
@app.route("/api/health1", methods=["GET"])
def health1():
    log.debug("Health check requested")
    return jsonify({
        "status":           "healthy",
        "timestamp":        datetime.datetime.utcnow().isoformat(),
        "version":          "1.0.0",
        "db_config_loaded": DB_CONFIG is not None,
        "secret_source":    "secrets_manager" if os.getenv("SECRET_NAME") else "env_var",
    })

@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({
        "status": "healthy",
        "timestamp": datetime.datetime.utcnow().isoformat(),
        "version": "1.0.0"
    })

# ── DB Health ─────────────────────────────────────────
@app.route("/api/db/health", methods=["GET"])
def db_health():
    log.info("DB health check requested", extra={"request_id": g.request_id})
    result = {
        "status":        "unknown",
        "host":          DB_CONFIG["host"] if DB_CONFIG else "not configured",
        "port":          DB_CONFIG["port"] if DB_CONFIG else None,
        "dbname":        DB_CONFIG["dbname"] if DB_CONFIG else None,
        "user":          DB_CONFIG["user"] if DB_CONFIG else None,
        "sslmode":       DB_CONFIG["sslmode"] if DB_CONFIG else None,
        "secret_source": "secrets_manager" if os.getenv("SECRET_NAME") else "env_var",
        "secret_name":   os.getenv("SECRET_NAME", "N/A"),
        "timestamp":     datetime.datetime.utcnow().isoformat(),
    }
    conn  = None
    start = time.time()
    try:
        log.debug("Attempting DB connection", extra={
            "request_id": g.request_id,
            "host":       DB_CONFIG["host"] if DB_CONFIG else "N/A",
        })
        conn   = get_db_connection()
        cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        cursor.execute("SELECT version();")
        version_row = cursor.fetchone()

        cursor.execute("SELECT NOW() as db_time;")
        time_row = cursor.fetchone()

        cursor.execute("""
            SELECT
                current_database()         AS database,
                current_user               AS connected_as,
                inet_server_addr()         AS server_ip,
                inet_server_port()         AS server_port,
                pg_postmaster_start_time() AS pg_started_at
        """)
        info_row = cursor.fetchone()

        cursor.execute("""
            SELECT count(*) AS active_connections
            FROM pg_stat_activity WHERE state = 'active'
        """)
        conn_row = cursor.fetchone()
        cursor.close()

        elapsed_ms = round((time.time() - start) * 1000, 2)
        log.info("DB health check passed", extra={
            "request_id":         g.request_id,
            "host":               DB_CONFIG["host"],
            "dbname":             info_row["database"],
            "connected_as":       info_row["connected_as"],
            "active_connections": conn_row["active_connections"],
            "elapsed_ms":         elapsed_ms,
        })
        result.update({
            "status":             "connected",
            "db_version":         version_row["version"],
            "db_time":            str(time_row["db_time"]),
            "database":           info_row["database"],
            "connected_as":       info_row["connected_as"],
            "server_ip":          str(info_row["server_ip"]),
            "server_port":        info_row["server_port"],
            "pg_started_at":      str(info_row["pg_started_at"]),
            "active_connections": conn_row["active_connections"],
            "elapsed_ms":         elapsed_ms,
        })
        return jsonify(result), 200

    except RuntimeError as e:
        log.error("DB config error", extra={"request_id": g.request_id, "error": str(e)})
        result.update({"status": "config_error", "error": str(e)})
        return jsonify(result), 503

    except psycopg2.OperationalError as e:
        elapsed_ms = round((time.time() - start) * 1000, 2)
        log.error("DB connection failed", extra={
            "request_id": g.request_id,
            "host":       DB_CONFIG["host"] if DB_CONFIG else "N/A",
            "error":      str(e),
            "elapsed_ms": elapsed_ms,
        })
        result.update({
            "status": "connection_failed",
            "error":  str(e),
            "hint":   "Check DB_HOST, security groups, VPC routing, and RDS availability",
        })
        return jsonify(result), 503

    except Exception as e:
        log.error("Unexpected DB error", extra={
            "request_id": g.request_id,
            "error":      str(e),
        }, exc_info=True)
        result.update({"status": "error", "error": str(e)})
        return jsonify(result), 500

    finally:
        if conn:
            conn.close()
            log.debug("DB connection closed", extra={"request_id": g.request_id})


# ── DB Ping ───────────────────────────────────────────
@app.route("/api/db/ping", methods=["GET"])
def db_ping():
    log.debug("DB ping requested", extra={"request_id": g.request_id})
    conn  = None
    start = time.time()
    try:
        conn   = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT 1;")
        cursor.close()
        elapsed_ms = round((time.time() - start) * 1000, 2)
        log.info("DB ping successful", extra={
            "request_id": g.request_id,
            "latency_ms": elapsed_ms,
            "host":       DB_CONFIG["host"],
        })
        return jsonify({
            "status":     "ok",
            "latency_ms": elapsed_ms,
            "host":       DB_CONFIG["host"],
            "timestamp":  datetime.datetime.utcnow().isoformat(),
        }), 200

    except Exception as e:
        elapsed_ms = round((time.time() - start) * 1000, 2)
        log.error("DB ping failed", extra={
            "request_id": g.request_id,
            "error":      str(e),
            "elapsed_ms": elapsed_ms,
            "host":       DB_CONFIG["host"] if DB_CONFIG else "not configured",
        })
        return jsonify({
            "status":     "error",
            "error":      str(e),
            "elapsed_ms": elapsed_ms,
            "host":       DB_CONFIG["host"] if DB_CONFIG else "not configured",
        }), 503

    finally:
        if conn:
            conn.close()


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# S3
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def get_s3_client():
    region = os.getenv("AWS_REGION", "us-east-1")
    log.debug("Creating S3 client", extra={"region": region})
    return boto3.client("s3", region_name=region)


def format_size(size_bytes: int) -> str:
    """Convert bytes to human-readable string."""
    for unit in ["B", "KB", "MB", "GB", "TB"]:
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} PB"


def get_s3_error_hint(code: str) -> str:
    hints = {
        "NoSuchBucket":                  "Bucket does not exist or wrong region",
        "AccessDenied":                  "IAM role lacks s3:ListBucket or s3:GetObject permission",
        "NoSuchKey":                     "Object key does not exist in bucket",
        "InvalidBucketName":             "Bucket name format is invalid",
        "AllAccessDisabled":             "Bucket owner has disabled all access",
        "NoSuchBucketPolicy":            "No bucket policy found",
    }
    return hints.get(code, "Check IAM permissions and bucket name")


# ── List All Buckets ──────────────────────────────────
@app.route("/api/s3/buckets", methods=["GET"])
def list_buckets():
    """List all S3 buckets with name, region, and creation date."""
    log.info("S3 list buckets requested", extra={"request_id": g.request_id})
    start = time.time()
    try:
        s3       = get_s3_client()
        response = s3.list_buckets()
        buckets  = response.get("Buckets", [])

        result = []
        for bucket in buckets:
            name = bucket["Name"]
            try:
                loc    = s3.get_bucket_location(Bucket=name)
                region = loc["LocationConstraint"] or "us-east-1"
            except ClientError as e:
                region = f"access-denied ({e.response['Error']['Code']})"

            result.append({
                "name":       name,
                "created_at": bucket["CreationDate"].isoformat(),
                "region":     region,
            })

        elapsed_ms = round((time.time() - start) * 1000, 2)
        log.info("S3 buckets listed", extra={
            "request_id":   g.request_id,
            "bucket_count": len(result),
            "elapsed_ms":   elapsed_ms,
        })
        return jsonify({
            "buckets":    result,
            "total":      len(result),
            "elapsed_ms": elapsed_ms,
            "timestamp":  datetime.datetime.utcnow().isoformat(),
        }), 200

    except ClientError as e:
        code = e.response["Error"]["Code"]
        log.error("S3 list buckets failed", extra={
            "request_id": g.request_id,
            "error_code": code,
            "error":      str(e),
        })
        return jsonify({
            "error":      str(e),
            "error_code": code,
            "hint":       "Check IAM role has s3:ListAllMyBuckets permission",
        }), 403

    except NoCredentialsError:
        log.error("No AWS credentials for S3", extra={"request_id": g.request_id})
        return jsonify({"error": "No AWS credentials found"}), 500

    except Exception as e:
        log.error("Unexpected S3 error", extra={
            "request_id": g.request_id,
            "error":      str(e),
        }, exc_info=True)
        return jsonify({"error": str(e)}), 500


# ── Bucket Metadata ───────────────────────────────────
@app.route("/api/s3/buckets/<bucket_name>", methods=["GET"])
def get_bucket_info(bucket_name):
    """Return metadata for a specific bucket — region, versioning, encryption, size."""
    log.info("S3 bucket info requested", extra={
        "request_id": g.request_id,
        "bucket":     bucket_name,
    })
    start  = time.time()
    result = {"bucket": bucket_name}
    try:
        s3 = get_s3_client()

        # Region
        try:
            loc              = s3.get_bucket_location(Bucket=bucket_name)
            result["region"] = loc["LocationConstraint"] or "us-east-1"
        except ClientError as e:
            result["region"] = f"error: {e.response['Error']['Code']}"

        # Versioning
        try:
            ver                  = s3.get_bucket_versioning(Bucket=bucket_name)
            result["versioning"] = ver.get("Status", "Disabled")
        except ClientError:
            result["versioning"] = "unknown"

        # Encryption
        try:
            enc   = s3.get_bucket_encryption(Bucket=bucket_name)
            rules = enc["ServerSideEncryptionConfiguration"]["Rules"]
            result["encryption"] = rules[0]["ApplyServerSideEncryptionByDefault"]["SSEAlgorithm"]
        except ClientError as e:
            code = e.response["Error"]["Code"]
            result["encryption"] = "none" if code == "ServerSideEncryptionConfigurationNotFoundError" else f"error: {code}"

        # Public access block
        try:
            pab = s3.get_public_access_block(Bucket=bucket_name)
            cfg = pab["PublicAccessBlockConfiguration"]
            result["public_access_blocked"] = all([
                cfg.get("BlockPublicAcls",      False),
                cfg.get("IgnorePublicAcls",      False),
                cfg.get("BlockPublicPolicy",     False),
                cfg.get("RestrictPublicBuckets", False),
            ])
        except ClientError:
            result["public_access_blocked"] = "unknown"

        # Object count + size (first 1000)
        try:
            objs     = s3.list_objects_v2(Bucket=bucket_name, MaxKeys=1000)
            contents = objs.get("Contents", [])
            result["object_count_sample"]      = len(contents)
            result["total_size_bytes_sample"]  = sum(o["Size"] for o in contents)
            result["total_size_human_sample"]  = format_size(result["total_size_bytes_sample"])
            result["sample_note"]              = "Counts reflect first 1000 objects only"
        except ClientError:
            result["object_count_sample"] = "error"

        elapsed_ms           = round((time.time() - start) * 1000, 2)
        result["elapsed_ms"] = elapsed_ms
        result["timestamp"]  = datetime.datetime.utcnow().isoformat()

        log.info("S3 bucket info retrieved", extra={
            "request_id": g.request_id,
            "bucket":     bucket_name,
            "region":     result.get("region"),
            "versioning": result.get("versioning"),
            "encryption": result.get("encryption"),
            "elapsed_ms": elapsed_ms,
        })
        return jsonify(result), 200

    except ClientError as e:
        code = e.response["Error"]["Code"]
        log.error("S3 bucket info failed", extra={
            "request_id": g.request_id,
            "bucket":     bucket_name,
            "error_code": code,
            "error":      str(e),
        })
        return jsonify({
            "error":      str(e),
            "error_code": code,
            "hint":       get_s3_error_hint(code),
        }), 404 if code == "NoSuchBucket" else 500

    except Exception as e:
        log.error("Unexpected S3 bucket info error", extra={
            "request_id": g.request_id,
            "error":      str(e),
        }, exc_info=True)
        return jsonify({"error": str(e)}), 500


# ── List Objects ──────────────────────────────────────
@app.route("/api/s3/buckets/<bucket_name>/objects", methods=["GET"])
def list_objects(bucket_name):
    """
    List objects in a bucket.
    Query params: ?prefix=  ?max_keys=  ?continuation_token=
    """
    prefix             = request.args.get("prefix", "")
    max_keys           = min(int(request.args.get("max_keys", 100)), 1000)
    continuation_token = request.args.get("continuation_token", "")

    log.info("S3 list objects requested", extra={
        "request_id": g.request_id,
        "bucket":     bucket_name,
        "prefix":     prefix,
        "max_keys":   max_keys,
    })
    start = time.time()

    try:
        s3     = get_s3_client()
        params = {"Bucket": bucket_name, "MaxKeys": max_keys}
        if prefix:
            params["Prefix"] = prefix
        if continuation_token:
            params["ContinuationToken"] = continuation_token

        response = s3.list_objects_v2(**params)
        objects  = response.get("Contents", [])

        result = []
        for obj in objects:
            result.append({
                "key":           obj["Key"],
                "size_bytes":    obj["Size"],
                "size_human":    format_size(obj["Size"]),
                "last_modified": obj["LastModified"].isoformat(),
                "etag":          obj["ETag"].strip('"'),
                "storage_class": obj.get("StorageClass", "STANDARD"),
            })

        elapsed_ms       = round((time.time() - start) * 1000, 2)
        is_truncated     = response.get("IsTruncated", False)
        next_token       = response.get("NextContinuationToken", "")
        key_count        = response.get("KeyCount", 0)
        total_size_bytes = sum(o["size_bytes"] for o in result)

        log.info("S3 objects listed", extra={
            "request_id":   g.request_id,
            "bucket":       bucket_name,
            "prefix":       prefix,
            "object_count": key_count,
            "total_size":   format_size(total_size_bytes),
            "is_truncated": is_truncated,
            "elapsed_ms":   elapsed_ms,
        })
        return jsonify({
            "bucket":           bucket_name,
            "prefix":           prefix,
            "objects":          result,
            "key_count":        key_count,
            "total_size_bytes": total_size_bytes,
            "total_size_human": format_size(total_size_bytes),
            "is_truncated":     is_truncated,
            "next_token":       next_token,
            "elapsed_ms":       elapsed_ms,
            "timestamp":        datetime.datetime.utcnow().isoformat(),
        }), 200

    except ClientError as e:
        code        = e.response["Error"]["Code"]
        status_map  = {"NoSuchBucket": 404, "AccessDenied": 403}
        http_status = status_map.get(code, 500)
        log.error("S3 list objects failed", extra={
            "request_id": g.request_id,
            "bucket":     bucket_name,
            "error_code": code,
            "error":      str(e),
        })
        return jsonify({
            "error":      str(e),
            "error_code": code,
            "bucket":     bucket_name,
            "hint":       get_s3_error_hint(code),
        }), http_status

    except Exception as e:
        log.error("Unexpected S3 error", extra={
            "request_id": g.request_id,
            "bucket":     bucket_name,
            "error":      str(e),
        }, exc_info=True)
        return jsonify({"error": str(e)}), 500


# ── Search Objects ────────────────────────────────────
@app.route("/api/s3/buckets/<bucket_name>/search", methods=["GET"])
def search_objects(bucket_name):
    """
    Search objects by keyword in key name.
    Query params: ?q=keyword (required)  ?prefix=
    """
    query  = request.args.get("q", "").strip()
    prefix = request.args.get("prefix", "")

    if not query:
        return jsonify({"error": "Query param 'q' is required"}), 400

    log.info("S3 object search requested", extra={
        "request_id": g.request_id,
        "bucket":     bucket_name,
        "query":      query,
        "prefix":     prefix,
    })
    start   = time.time()
    matches = []
    scanned = 0

    try:
        s3          = get_s3_client()
        paginator   = s3.get_paginator("list_objects_v2")
        page_config = {"Bucket": bucket_name, "MaxKeys": 1000}
        if prefix:
            page_config["Prefix"] = prefix

        for page in paginator.paginate(**page_config):
            for obj in page.get("Contents", []):
                scanned += 1
                if query.lower() in obj["Key"].lower():
                    matches.append({
                        "key":           obj["Key"],
                        "size_bytes":    obj["Size"],
                        "size_human":    format_size(obj["Size"]),
                        "last_modified": obj["LastModified"].isoformat(),
                        "storage_class": obj.get("StorageClass", "STANDARD"),
                    })

        elapsed_ms = round((time.time() - start) * 1000, 2)
        log.info("S3 search complete", extra={
            "request_id": g.request_id,
            "bucket":     bucket_name,
            "query":      query,
            "scanned":    scanned,
            "matches":    len(matches),
            "elapsed_ms": elapsed_ms,
        })
        return jsonify({
            "bucket":      bucket_name,
            "query":       query,
            "prefix":      prefix,
            "matches":     matches,
            "match_count": len(matches),
            "scanned":     scanned,
            "elapsed_ms":  elapsed_ms,
            "timestamp":   datetime.datetime.utcnow().isoformat(),
        }), 200

    except ClientError as e:
        code = e.response["Error"]["Code"]
        log.error("S3 search failed", extra={
            "request_id": g.request_id,
            "bucket":     bucket_name,
            "error_code": code,
            "error":      str(e),
        })
        return jsonify({
            "error":      str(e),
            "error_code": code,
            "hint":       get_s3_error_hint(code),
        }), 403 if code == "AccessDenied" else 500

    except Exception as e:
        log.error("Unexpected S3 search error", extra={
            "request_id": g.request_id,
            "error":      str(e),
        }, exc_info=True)
        return jsonify({"error": str(e)}), 500


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# TASKS
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
tasks = [
    {"id": 1, "title": "Set up Flask backend",   "done": True,  "priority": "high"},
    {"id": 2, "title": "Build React frontend",    "done": True,  "priority": "high"},
    {"id": 3, "title": "Connect API to React",    "done": False, "priority": "medium"},
    {"id": 4, "title": "Deploy to ECS Fargate",   "done": False, "priority": "low"},
]
next_id = 5


@app.route("/api/tasks", methods=["GET"])
def get_tasks():
    priority = request.args.get("priority")
    filtered = tasks if not priority else [t for t in tasks if t["priority"] == priority]
    log.info("Tasks fetched", extra={
        "request_id":   g.request_id,
        "filter":       priority or "none",
        "result_count": len(filtered),
    })
    return jsonify({"tasks": filtered, "total": len(filtered)})


@app.route("/api/tasks/<int:task_id>", methods=["GET"])
def get_task(task_id):
    task = next((t for t in tasks if t["id"] == task_id), None)
    if not task:
        log.warning("Task not found", extra={"request_id": g.request_id, "task_id": task_id})
        return jsonify({"error": "Task not found"}), 404
    log.debug("Task fetched", extra={"request_id": g.request_id, "task_id": task_id})
    return jsonify(task)


@app.route("/api/tasks", methods=["POST"])
def create_task():
    global next_id
    data = request.get_json()
    if not data or not data.get("title", "").strip():
        log.warning("Create task failed — missing title", extra={"request_id": g.request_id})
        return jsonify({"error": "Title is required"}), 400
    task = {
        "id":       next_id,
        "title":    data["title"].strip(),
        "done":     False,
        "priority": data.get("priority", "medium"),
    }
    tasks.append(task)
    next_id += 1
    log.info("Task created", extra={
        "request_id": g.request_id,
        "task_id":    task["id"],
        "title":      task["title"],
        "priority":   task["priority"],
    })
    return jsonify(task), 201


@app.route("/api/tasks/<int:task_id>/toggle", methods=["PATCH"])
def toggle_task(task_id):
    task = next((t for t in tasks if t["id"] == task_id), None)
    if not task:
        log.warning("Toggle failed — task not found", extra={
            "request_id": g.request_id,
            "task_id":    task_id,
        })
        return jsonify({"error": "Task not found"}), 404
    task["done"] = not task["done"]
    log.info("Task toggled", extra={
        "request_id": g.request_id,
        "task_id":    task_id,
        "done":       task["done"],
    })
    return jsonify(task)


@app.route("/api/tasks/<int:task_id>", methods=["DELETE"])
def delete_task(task_id):
    global tasks
    task = next((t for t in tasks if t["id"] == task_id), None)
    if not task:
        log.warning("Delete failed — task not found", extra={
            "request_id": g.request_id,
            "task_id":    task_id,
        })
        return jsonify({"error": "Task not found"}), 404
    tasks = [t for t in tasks if t["id"] != task_id]
    log.info("Task deleted", extra={"request_id": g.request_id, "task_id": task_id})
    return jsonify({"message": "Deleted", "id": task_id})


@app.route("/api/stats", methods=["GET"])
def get_stats():
    stats = {
        "total":   len(tasks),
        "done":    sum(1 for t in tasks if t["done"]),
        "pending": sum(1 for t in tasks if not t["done"]),
        "by_priority": {
            "high":   sum(1 for t in tasks if t["priority"] == "high"),
            "medium": sum(1 for t in tasks if t["priority"] == "medium"),
            "low":    sum(1 for t in tasks if t["priority"] == "low"),
        }
    }
    log.debug("Stats fetched", extra={"request_id": g.request_id, **stats})
    return jsonify(stats)


if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    log.info("Flask dev server starting", extra={"port": port})
    app.run(host="0.0.0.0", debug=False, port=port)