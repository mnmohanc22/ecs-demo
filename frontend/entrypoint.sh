#!/bin/sh
# Runs at container startup — writes runtime config for the browser

cat > /usr/share/nginx/html/config.js << EOF
window.ENV = {
  API_URL: "${BACKEND_URL:-http://localhost:5000}"
};
EOF

echo "Config written: BACKEND_URL=${BACKEND_URL}"

# Start Nginx
nginx -g "daemon off;"