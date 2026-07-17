# Docker Patterns Quick Reference

## Multi-Stage Build Templates

### Node.js
```dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 appuser
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
USER appuser
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

### Next.js (standalone output)
```dockerfile
# Key differences from Node.js:
# ENV NEXT_TELEMETRY_DISABLED 1
# Copy: public/, .next/standalone, .next/static
# CMD ["node", "server.js"]
# ENV HOSTNAME "0.0.0.0"
```

### Python
```dockerfile
# builder: pip wheel --wheel-dir /app/wheels -r requirements.txt
# runner: pip install --no-cache /wheels/*
# USER: useradd --create-home appuser
```

## Key Conventions

| Pattern | Rule |
|---------|------|
| Base image | Always `-alpine` or `-slim` |
| Layer cache | COPY package*.json before COPY . |
| User | Non-root, UID 1001 (K8s compat: `USER 1001`) |
| Secrets | `RUN --mount=type=secret,id=X` (BuildKit), never ENV |
| Health | `HEALTHCHECK CMD wget -q --spider http://localhost:PORT/health` |
| .dockerignore | node_modules, .git, .env*, dist, *.md, Dockerfile*, docker-compose* |
| ARG vs ENV | ARG=build-time only, ENV=persists in image |

## Docker Compose Patterns

| Variant | Key Config |
|---------|-----------|
| Dev | volumes: `.:/app`, `command: npm run dev`, depends_on with healthcheck |
| Prod | `image:` (not build), `restart: unless-stopped`, resource limits, json-file logging |
| Override | base=`docker-compose.yml`, local=`docker-compose.override.yml` (auto-loaded), prod=`-f docker-compose.yml -f docker-compose.prod.yml` |

## Networking

- `internal: true` on backend network = no external access
- `network_mode: host` for monitoring containers
