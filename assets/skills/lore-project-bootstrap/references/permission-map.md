# Permission Map

Framework → required CLI permissions for `.claude/settings.json`.

Generate project-level settings with ONLY permissions not already in user's global `~/.claude/settings.json`.

## TypeScript (Base)

```json
{
  "allow": [
    "Bash(npx tsc --noEmit)",
    "Bash(npx tsc --noEmit *)"
  ]
}
```

## Next.js

```json
{
  "allow": [
    "Bash(npm run dev)",
    "Bash(npm run build)",
    "Bash(npm run start)",
    "Bash(npx next *)",
    "Bash(npx tsc --noEmit)",
    "Bash(npx vitest *)",
    "Bash(npx playwright *)"
  ]
}
```

## Nuxt

```json
{
  "allow": [
    "Bash(npm run dev)",
    "Bash(npm run build)",
    "Bash(npm run preview)",
    "Bash(npx nuxi *)",
    "Bash(npx tsc --noEmit)",
    "Bash(npx vitest *)",
    "Bash(npx playwright *)"
  ]
}
```

## UniApp

```json
{
  "allow": [
    "Bash(npm run dev:*)",
    "Bash(npm run build:*)",
    "Bash(npx uni *)",
    "Bash(npx tsc --noEmit)",
    "Bash(npx vitest *)"
  ]
}
```

## NestJS

```json
{
  "allow": [
    "Bash(npm run start:dev)",
    "Bash(npm run start:debug)",
    "Bash(npm run build)",
    "Bash(npx nest *)",
    "Bash(npx tsc --noEmit)",
    "Bash(npx vitest *)",
    "Bash(npx jest *)"
  ]
}
```

## FastAPI

```json
{
  "allow": [
    "Bash(python -m uvicorn *)",
    "Bash(uvicorn *)",
    "Bash(pytest *)",
    "Bash(python -m pytest *)",
    "Bash(mypy *)",
    "Bash(ruff *)",
    "Bash(pip install *)",
    "Bash(uv *)"
  ]
}
```

## Electron

```json
{
  "allow": [
    "Bash(npm run dev)",
    "Bash(npm run build)",
    "Bash(npx electron *)",
    "Bash(npx tsc --noEmit)",
    "Bash(npx vitest *)",
    "Bash(npx playwright *)"
  ]
}
```

## Tauri

```json
{
  "allow": [
    "Bash(npm run tauri *)",
    "Bash(cargo build *)",
    "Bash(cargo test *)",
    "Bash(cargo clippy *)",
    "Bash(npx tsc --noEmit)",
    "Bash(npx vitest *)"
  ]
}
```

## Common Add-ons

### pnpm (if detected)
Replace `npm run` → `pnpm` in all permission entries.

### Docker (if Dockerfile present)
```json
{
  "allow": [
    "Bash(docker build *)",
    "Bash(docker compose *)",
    "Bash(docker run *)"
  ]
}
```

### Database CLI (if ORM detected)
```json
{
  "allow": [
    "Bash(npx prisma *)",
    "Bash(npx drizzle-kit *)",
    "Bash(alembic *)"
  ]
}
```

## Merge Strategy

When generating project settings.json:
1. Read user's `~/.claude/settings.json` → extract existing `allow` list
2. Compute framework permissions from this map
3. Output ONLY permissions NOT already in global settings
4. If all permissions already exist globally → skip settings.json generation
