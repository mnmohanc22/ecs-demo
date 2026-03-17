# ── Stage 1: Build React app ──────────────────────────
FROM node:18-alpine AS builder

WORKDIR /app

# Install deps first (layer caching)
COPY package.json package-lock.json* ./
RUN npm install

# Copy source and build
COPY index.html .
COPY vite.config.js .
COPY src/ ./src/
RUN npm run build

# ── Stage 2: Serve with Nginx ──────────────────────────
FROM nginx:alpine

# Copy built assets
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
