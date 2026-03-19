#!/bin/sh
set -e

# Write runtime backend URL config for browser
cat > /usr/share/nginx/html/config.js << EOF
window.ENV = {
  API_URL: "${BACKEND_URL:-http://localhost:5000}",
  LOG_LEVEL: "${LOG_LEVEL:-INFO}"
};
EOF

echo "Config written: BACKEND_URL=${BACKEND_URL}"

# Create nginx pid dir if missing
mkdir -p /run/nginx

# Start Nginx
exec nginx -g "daemon off;"