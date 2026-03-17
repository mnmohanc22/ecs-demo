FROM node:18-alpine

WORKDIR /app

# Install Nginx and OpenSSL
RUN apk add --no-cache nginx openssl

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm install

# Copy source
COPY index.html .
COPY vite.config.js .
COPY src/ ./src/

# Build React app
RUN npm run build

# Create nginx html dir and copy built assets
RUN mkdir -p /usr/share/nginx/html && \
    cp -r /app/dist/. /usr/share/nginx/html/

# Generate self-signed SSL certificate
RUN mkdir -p /etc/nginx/ssl && \
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
      -keyout /etc/nginx/ssl/nginx.key \
      -out    /etc/nginx/ssl/nginx.crt \
      -subj "/C=US/ST=Georgia/L=Atlanta/O=MyApp/CN=localhost"

# Copy configs
COPY nginx.conf      /etc/nginx/nginx.conf
COPY entrypoint.sh   /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80 443

ENTRYPOINT ["/entrypoint.sh"]