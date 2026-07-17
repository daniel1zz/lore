# Mode: init-project

Create a new project with all infrastructure autowired: template → DB → OAuth → env vars → deploy.

## Prerequisites

- `init-tools` completed (all CLIs authenticated)
- Global config exists at `~/.config/lore-auto-wire/config.json`

If not ready, guide user to run `/lore-auto-wire init-tools` first.

## Input

```
/lore-auto-wire init-project [project-name]
```

**project-name is optional** — if omitted, auto-detect from current directory:
```bash
PROJECT_NAME="${1:-$(basename "$PWD")}"
```

This means `/lore-auto-wire init-project` inside `~/Projects/gankjob` automatically uses `gankjob`.

Optional flags (ask if not provided):
- `--template <repo>` — override template (default: from global config, typically next-forge)
- `--domain <domain>` — custom domain (default: `<project-name>.vercel.app`)
- `--region <region>` — Neon DB region (default: aws-us-east-2)

## Procedure

### Step 1: Validate Name

```bash
# Check name is valid (lowercase, alphanumeric + hyphens)
echo "<project-name>" | grep -qE '^[a-z][a-z0-9-]{1,62}$' || echo "INVALID"
```

Check name is not already used:
```bash
neonctl projects list --output json | grep -q '"<project-name>"'
vercel projects ls 2>/dev/null | grep -q '<project-name>'
```

### Step 2: Clone Template

```bash
npx next-forge@latest init --name <project-name>
cd <project-name>
```

If using a custom template repo:
```bash
npx degit <template-repo> <project-name>
cd <project-name>
npm install
```

### Step 3: Create Neon Database

```bash
# Create project (returns connection string)
neonctl projects create --name <project-name> --region aws-us-east-2 --output json

# Extract connection string
DATABASE_URL=$(neonctl connection-string --project-id <id> --database-name neondb)
```

Verify:
```bash
neonctl projects list --output json | grep '<project-name>'
```

### Step 4: Add OAuth Callback URIs

Read Google and GitHub OAuth client IDs from global config.

**Google OAuth** — add redirect URI:
```bash
# The redirect URI for Better-Auth / next-forge auth
CALLBACK="https://<project-name>.vercel.app/api/auth/callback/google"

# Google Cloud API to update OAuth client redirect URIs
# Get current URIs
CURRENT=$(gcloud alpha iap oauth-clients describe <client-id> \
  --project=<gcp-project> --format=json 2>/dev/null)

# Add new URI via API (append to existing list)
# Note: gcloud CLI support for this is limited — may need REST API
curl -X PATCH \
  "https://oauth2.googleapis.com/..." \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -d '{"redirect_uris": [... existing ..., "<new-callback>"]}'
```

If CLI method fails, tell user:
"Add this callback URI to your Google OAuth app: `<CALLBACK>`"
and wait for confirmation.

**GitHub OAuth** — add callback URL:
```bash
# GitHub API to update OAuth app callback URLs
APP_ID=$(cat ~/.config/lore-auto-wire/config.json | jq -r '.github_oauth.app_id')
CALLBACK="https://<project-name>.vercel.app/api/auth/callback/github"

gh api -X PATCH /applications/<client-id> \
  -f callback_url="<CALLBACK>" 2>/dev/null
```

If API method fails, tell user:
"Add this callback URL to your GitHub OAuth app: `<CALLBACK>`"

### Step 5: Create Vercel Project + Set Env Vars

```bash
# Link to Vercel (creates project)
vercel link --yes

# Set environment variables
vercel env add DATABASE_URL production <<< "$DATABASE_URL"
vercel env add DATABASE_URL preview <<< "$DATABASE_URL"
vercel env add DATABASE_URL development <<< "$DATABASE_URL"

# Auth secrets
AUTH_SECRET=$(openssl rand -base64 32)
vercel env add BETTER_AUTH_SECRET production <<< "$AUTH_SECRET"
vercel env add BETTER_AUTH_URL production <<< "https://<project-name>.vercel.app"

# OAuth credentials (from global config)
GOOGLE_CLIENT_ID=$(jq -r '.google_oauth.client_id' ~/.config/lore-auto-wire/config.json)
GOOGLE_CLIENT_SECRET= # ask user or read from secure store
vercel env add GOOGLE_CLIENT_ID production <<< "$GOOGLE_CLIENT_ID"
vercel env add GOOGLE_CLIENT_SECRET production <<< "$GOOGLE_CLIENT_SECRET"

GITHUB_CLIENT_ID=$(jq -r '.github_oauth.client_id' ~/.config/lore-auto-wire/config.json)
GITHUB_CLIENT_SECRET= # ask user or read from secure store
vercel env add GITHUB_CLIENT_ID production <<< "$GITHUB_CLIENT_ID"
vercel env add GITHUB_CLIENT_SECRET production <<< "$GITHUB_CLIENT_SECRET"

# Pull env vars to local
vercel env pull .env.local
```

### Step 6: Run Database Migration

```bash
npx drizzle-kit push
# or for next-forge (Prisma):
npx prisma db push
```

Verify tables exist:
```bash
neonctl query --project-id <id> "SELECT tablename FROM pg_tables WHERE schemaname='public'"
```

### Step 7: Deploy

```bash
vercel deploy --prod
```

Wait for deployment, then verify:
```bash
DEPLOY_URL=$(vercel inspect --json | jq -r '.url')
curl -s -o /dev/null -w '%{http_code}' "https://$DEPLOY_URL"
```

### Step 8: Update Global Config

Add the new project to `~/.config/lore-auto-wire/config.json`:

```json
{
  "projects": {
    "<project-name>": {
      "neon_project_id": "...",
      "vercel_project_id": "...",
      "domain": "<project-name>.vercel.app",
      "created_at": "2026-06-07T..."
    }
  }
}
```

### Step 9: Verify End-to-End

```bash
# Check deployment is live
curl -s -o /dev/null -w '%{http_code}' "https://<project-name>.vercel.app"
# Expected: 200

# Check auth endpoint exists
curl -s -o /dev/null -w '%{http_code}' "https://<project-name>.vercel.app/api/auth"
# Expected: 200 or 405 (method not allowed = endpoint exists)
```

## Output

```
✅ Project <project-name> autowired!

   Template: next-forge (cloned + installed)
   Database: Neon <project-name> (aws-us-east-2)
   Auth:     Better-Auth (Google + GitHub OAuth wired)
   Deploy:   https://<project-name>.vercel.app (live)
   Env vars: 8 vars set in Vercel (DATABASE_URL, OAuth creds, AUTH_SECRET)
   Local:    .env.local synced

   Next: cd <project-name> && npm run dev
```

## Rollback (if something fails mid-way)

```bash
# Delete Neon project
neonctl projects delete <project-id> --yes

# Remove Vercel project
vercel remove <project-name> --yes

# Remove from global config
# (manual: edit ~/.config/lore-auto-wire/config.json)
```
