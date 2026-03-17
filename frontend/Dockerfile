# ── Stage 1: Build React app ──────────────────────────
FROM node:18-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY index.html .
COPY vite.config.js .
COPY src/ ./src/
RUN npm run build

# ── Stage 2: Serve with Nginx ──────────────────────────
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy entrypoint that writes runtime config
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80

# Use entrypoint instead of default nginx CMD
ENTRYPOINT ["/entrypoint.sh"]