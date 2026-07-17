# Deploy Mode: Container

> Containerization setup, Dockerfile creation, image optimization, and security scanning.

## Workflow

1. **Analyze app** — language, framework, dependencies, build output
2. **Create Dockerfile** — multi-stage, minimal base, non-root user
3. **Create .dockerignore** — exclude node_modules, .git, .env*, docs, test files
4. **Security hardening** — non-root user, read-only filesystem, no secrets in image
5. **Docker Compose** — dev (volumes, healthcheck) + prod (image, resource limits)
6. **Security scan** — scan image for CVEs before pushing to registry
7. **Optimize** — layer caching (lockfile first), size reduction, build cache
8. **Verify** — image builds, scan passes, health check responds, size within baseline

## Image Security Checklist

| Check | How | Block |
|-------|-----|-------|
| Non-root user | `USER 1001` or named user | HARD |
| No secrets baked in | `docker history` shows no secrets, use `--mount=type=secret` | HARD |
| Minimal base | `-alpine` or `-slim` or distroless | HARD |
| Pinned base version | `FROM node:20.11-alpine` not `FROM node:latest` | HARD |
| CVE scan passes | `trivy image {name}` — no critical/high | HARD |
| Read-only root FS (K8s) | `securityContext.readOnlyRootFilesystem: true` | SOFT |
| No unnecessary packages | No curl/wget/shell in production image (use distroless) | SOFT |

## Image Scanning

```bash
# Trivy (recommended — free, comprehensive)
trivy image --severity CRITICAL,HIGH {image}:{tag}

# Snyk
snyk container test {image}:{tag}

# Docker Scout (built into Docker)
docker scout cves {image}:{tag}
```

**Scan gates**:
- CRITICAL CVEs: Block push, fix immediately
- HIGH CVEs: Block push, fix within sprint
- MEDIUM CVEs: Log warning, fix in next maintenance window
- LOW CVEs: Informational, batch fixes quarterly

## Size Optimization Targets

| App Type | Target Size | Techniques |
|----------|-------------|-----------|
| Node.js API | < 200MB | Multi-stage, production deps only, alpine base |
| Next.js | < 300MB | Standalone output, copy only .next/standalone |
| Python API | < 150MB | Wheels in builder, slim/distroless runner |
| Go binary | < 50MB | Single-stage with scratch/distroless, CGO_ENABLED=0 |
| Java (Spring) | < 250MB | JRE base (not JDK), layered jars, jlink |

## Health Check Pattern

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-3000}/health || exit 1
```

**Health endpoint requirements**:
- Returns 200 when service is ready to accept traffic
- Checks critical dependencies (database connection, cache)
- Responds within timeout (3s default)
- Does not perform expensive operations

## Exit Criteria

- [ ] Image builds successfully (multi-stage, minimal base)
- [ ] Security scan passes (no critical/high CVEs)
- [ ] Non-root user configured
- [ ] Health check endpoint responds correctly
- [ ] Image size within target baseline
- [ ] .dockerignore configured (no dev files in image)
- [ ] Secrets handled via build secrets or runtime env (not baked into image)
- [ ] Docker Compose works for local dev (volumes, hot reload)

## Tools

- `serena`: create_text_file, replace_content, execute_shell_command
- `context7`: Docker documentation
- See [docker-patterns.md](docker-patterns.md)
