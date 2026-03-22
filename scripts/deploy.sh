#!/usr/bin/env bash
# =============================================================
# deploy.sh — Build, push to ECR, and deploy to ECS Fargate
#
# Usage:
#   ./scripts/deploy.sh [options]
#
# Options:
#   -a, --account-id   AWS Account ID        (or set AWS_ACCOUNT_ID)
#   -r, --region       AWS region            (default: us-east-1)
#   -c, --cluster      ECS cluster name      (default: ecs-demo)
#   -s, --service      ECS service name      (default: ecs-demo-service)
#   -t, --tag          Docker image tag      (default: git short SHA)
#   -e, --env-bucket   S3 bucket for .env    (optional — uploads backend/.env)
#       --backend-only  Build/push backend only
#       --frontend-only Build/push frontend only
#       --no-push       Build images but do not push or deploy
#       --dry-run       Print commands without executing
# =============================================================
set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────
REGION="${AWS_REGION:-us-east-1}"
CLUSTER="${ECS_CLUSTER:-ecs-demo}"
SERVICE="${ECS_SERVICE:-ecs-demo-service}"
ACCOUNT_ID="${AWS_ACCOUNT_ID:-}"
TAG="${IMAGE_TAG:-$(git rev-parse --short HEAD 2>/dev/null || echo "latest")}"
ENV_BUCKET="${ENV_BUCKET:-}"
BUILD_BACKEND=true
BUILD_FRONTEND=true
PUSH=true
DRY_RUN=false
TASK_DEF_FILE="ecs/task-definition.json"

# ── Colours ───────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'

log()  { echo -e "${BLUE}[INFO]${RESET}  $*"; }
ok()   { echo -e "${GREEN}[OK]${RESET}    $*"; }
warn() { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
err()  { echo -e "${RED}[ERROR]${RESET} $*" >&2; exit 1; }
run()  {
  if [[ "$DRY_RUN" == "true" ]]; then
    echo -e "${YELLOW}[DRY-RUN]${RESET} $*"
  else
    eval "$@"
  fi
}

# ── Argument parsing ──────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case $1 in
    -a|--account-id)   ACCOUNT_ID="$2"; shift 2 ;;
    -r|--region)       REGION="$2";     shift 2 ;;
    -c|--cluster)      CLUSTER="$2";    shift 2 ;;
    -s|--service)      SERVICE="$2";    shift 2 ;;
    -t|--tag)          TAG="$2";        shift 2 ;;
    -e|--env-bucket)   ENV_BUCKET="$2"; shift 2 ;;
    --backend-only)    BUILD_FRONTEND=false; shift ;;
    --frontend-only)   BUILD_BACKEND=false;  shift ;;
    --no-push)         PUSH=false;      shift ;;
    --dry-run)         DRY_RUN=true;    shift ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) err "Unknown option: $1" ;;
  esac
done

# ── Validate required vars ────────────────────────────────────
[[ -z "$ACCOUNT_ID" ]] && err "AWS Account ID is required. Use -a or set AWS_ACCOUNT_ID."

ECR_BASE="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
BACKEND_REPO="${ECR_BASE}/ecs-demo-backend"
FRONTEND_REPO="${ECR_BASE}/ecs-demo-frontend"

echo ""
echo -e "${BOLD}=== ECS Demo Deploy ===${RESET}"
echo -e "  Account:  ${ACCOUNT_ID}"
echo -e "  Region:   ${REGION}"
echo -e "  Cluster:  ${CLUSTER}"
echo -e "  Service:  ${SERVICE}"
echo -e "  Tag:      ${TAG}"
echo -e "  Dry-run:  ${DRY_RUN}"
echo ""

# ── Step 1: Upload .env to S3 (if bucket provided) ───────────
if [[ -n "$ENV_BUCKET" ]]; then
  log "Uploading backend/.env to s3://${ENV_BUCKET}/ecs-demo/backend.env ..."
  run "aws s3 cp backend/.env s3://${ENV_BUCKET}/ecs-demo/backend.env \
        --region ${REGION} \
        --sse aws:kms"
  ok "backend/.env uploaded to S3"
else
  warn "--env-bucket not set; skipping S3 upload of backend/.env"
  warn "Task definition environmentFiles[s3] will not be refreshed."
fi

# ── Step 2: ECR login ─────────────────────────────────────────
if [[ "$PUSH" == "true" ]]; then
  log "Authenticating to ECR ..."
  run "aws ecr get-login-password --region ${REGION} \
        | docker login --username AWS --password-stdin ${ECR_BASE}"
  ok "ECR login successful"
fi

# ── Step 3: Build & push backend ──────────────────────────────
if [[ "$BUILD_BACKEND" == "true" ]]; then
  log "Building backend image (tag: ${TAG}) ..."
  run "docker build \
        --platform linux/amd64 \
        -t ${BACKEND_REPO}:${TAG} \
        -t ${BACKEND_REPO}:latest \
        ./backend"
  ok "Backend image built"

  if [[ "$PUSH" == "true" ]]; then
    log "Pushing backend image ..."
    run "docker push ${BACKEND_REPO}:${TAG}"
    run "docker push ${BACKEND_REPO}:latest"
    ok "Backend image pushed: ${BACKEND_REPO}:${TAG}"
  fi
fi

# ── Step 4: Build & push frontend ────────────────────────────
if [[ "$BUILD_FRONTEND" == "true" ]]; then
  log "Building frontend image (tag: ${TAG}) ..."
  run "docker build \
        --platform linux/amd64 \
        -t ${FRONTEND_REPO}:${TAG} \
        -t ${FRONTEND_REPO}:latest \
        ./frontend"
  ok "Frontend image built"

  if [[ "$PUSH" == "true" ]]; then
    log "Pushing frontend image ..."
    run "docker push ${FRONTEND_REPO}:${TAG}"
    run "docker push ${FRONTEND_REPO}:latest"
    ok "Frontend image pushed: ${FRONTEND_REPO}:${TAG}"
  fi
fi

# ── Step 5: Register new ECS task definition revision ────────
if [[ "$PUSH" == "true" ]]; then
  log "Rendering task definition with Account ID and image tag ..."

  RENDERED_TASK_DEF=$(mktemp /tmp/task-definition-XXXX.json)

  # Substitute placeholders in the task definition template
  sed \
    -e "s|ACCOUNT_ID|${ACCOUNT_ID}|g" \
    -e "s|ecs-demo-backend:latest|ecs-demo-backend:${TAG}|g" \
    -e "s|ecs-demo-frontend:latest|ecs-demo-frontend:${TAG}|g" \
    "${TASK_DEF_FILE}" > "${RENDERED_TASK_DEF}"

  log "Registering new task definition revision ..."
  if [[ "$DRY_RUN" == "true" ]]; then
    echo -e "${YELLOW}[DRY-RUN]${RESET} aws ecs register-task-definition --cli-input-json file://${RENDERED_TASK_DEF}"
    NEW_REVISION="DRY_RUN"
  else
    TASK_DEF_ARN=$(aws ecs register-task-definition \
      --cli-input-json "file://${RENDERED_TASK_DEF}" \
      --region "${REGION}" \
      --query "taskDefinition.taskDefinitionArn" \
      --output text)
    NEW_REVISION=$(echo "${TASK_DEF_ARN}" | awk -F: '{print $NF}')
    ok "Task definition registered: ${TASK_DEF_ARN}"
  fi

  rm -f "${RENDERED_TASK_DEF}"

  # ── Step 6: Update ECS service ──────────────────────────────
  log "Updating ECS service '${SERVICE}' on cluster '${CLUSTER}' ..."
  run "aws ecs update-service \
        --cluster ${CLUSTER} \
        --service ${SERVICE} \
        --task-definition ${TASK_DEF_ARN:-ecs-demo:${NEW_REVISION}} \
        --force-new-deployment \
        --region ${REGION} \
        --query 'service.{status:status, desiredCount:desiredCount, runningCount:runningCount}' \
        --output table"
  ok "ECS service update triggered"

  # ── Step 7: Wait for stable deployment ──────────────────────
  log "Waiting for service to reach steady state (timeout: 10 min) ..."
  run "aws ecs wait services-stable \
        --cluster ${CLUSTER} \
        --services ${SERVICE} \
        --region ${REGION}"
  ok "Service is stable — deployment complete ✅"
fi

echo ""
echo -e "${GREEN}${BOLD}=== Deploy complete ===${RESET}"
echo -e "  Backend:  ${BACKEND_REPO}:${TAG}"
echo -e "  Frontend: ${FRONTEND_REPO}:${TAG}"
echo -e "  Cluster:  ${CLUSTER} / ${SERVICE}"
echo ""
