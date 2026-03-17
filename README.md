# React + Flask Docker App

A full-stack task manager with a React frontend and Flask backend, containerized with Docker.

## Architecture

```
Browser
  └── http://localhost:80
        └── Nginx (frontend container)
              ├── /* ──────→ React static files (built by Vite)
              └── /api/* ──→ Flask backend container (port 5000)
```

## Project Structure

```
react-flask-app/
├── backend/
│   ├── app.py               # Flask API
│   ├── requirements.txt     # Python deps
│   ├── Dockerfile           # Python + Gunicorn
│   └── .dockerignore
├── frontend/
│   ├── src/
│   │   ├── App.jsx          # React app
│   │   └── main.jsx         # Entry point
│   ├── index.html
│   ├── vite.config.js
│   ├── package.json
│   ├── nginx.conf           # Nginx reverse proxy config
│   ├── Dockerfile           # Multi-stage: Node build → Nginx serve
│   └── .dockerignore
├── docker-compose.yml       # Production
├── docker-compose.dev.yml   # Development (hot reload)
└── .gitignore
```

## Quick Start (Production)

```bash
# Build and start all containers
docker-compose up --build

# App runs at:
#   http://localhost       → React UI
#   http://localhost/api/health → API health check
#   http://localhost:5000  → Flask direct access
```

## Development (Hot Reload)

```bash
# Hot reload for both React and Flask
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up --build

# Frontend: http://localhost:3000 (Vite dev server)
# Backend:  http://localhost:5000 (Flask debug mode)
```

## API Endpoints

| Method | Endpoint                    | Description         |
|--------|-----------------------------|---------------------|
| GET    | /api/health                 | Health check        |
| GET    | /api/tasks                  | List all tasks      |
| GET    | /api/tasks?priority=high    | Filter by priority  |
| POST   | /api/tasks                  | Create task         |
| GET    | /api/tasks/:id              | Get single task     |
| PATCH  | /api/tasks/:id/toggle       | Toggle done status  |
| DELETE | /api/tasks/:id              | Delete task         |
| GET    | /api/stats                  | Task statistics     |

## Useful Commands

```bash
# View logs
docker-compose logs -f
docker-compose logs -f backend
docker-compose logs -f frontend

# Restart a single service
docker-compose restart backend

# Rebuild a single service
docker-compose up --build backend

# Stop everything
docker-compose down

# Stop and remove volumes
docker-compose down -v

# Shell into backend container
docker exec -it flask-backend sh

# Shell into frontend container
docker exec -it react-frontend sh
```

## Deploy to AWS ECS

1. Push images to ECR:
```bash
# Authenticate to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin \
  <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com

# Build and tag
docker build -t react-flask-backend ./backend
docker tag react-flask-backend:latest \
  <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/react-flask-backend:latest

docker build -t react-flask-frontend ./frontend
docker tag react-flask-frontend:latest \
  <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/react-flask-frontend:latest

# Push
docker push <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/react-flask-backend:latest
docker push <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/react-flask-frontend:latest
```

2. Create ECS task definition with both containers
3. Create ECS service in your cluster


docker run -e BACKEND_URL=http://your-api.com -p 80:80 react-flask-frontend

# ECS Task Definition — no rebuild needed
environment:
  - name: BACKEND_URL
    value: http://backend-alb-123.us-east-1.elb.amazonaws.com

# Flask backend — allow ALB frontend origin
  - name: ALLOWED_ORIGINS
    value: http://frontend-alb-456.us-east-1.elb.amazonaws.com