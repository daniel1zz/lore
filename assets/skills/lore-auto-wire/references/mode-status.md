# Mode: status

Check what's configured globally and for the current project. Surfaces missing pieces.

## Procedure

### Step 1: Run Tool Check

```bash
bash ~/.claude/skills/lore-auto-wire/scripts/check-tools.sh
```

### Step 2: Read Global Config

```bash
cat ~/.config/lore-auto-wire/config.json 2>/dev/null || echo "NO GLOBAL CONFIG"
```

Check:
- Google OAuth client_id present?
- GitHub OAuth client_id present?
- Template repo configured?
- How many projects registered?

### Step 3: Current Project Check (if in a project directory)

```bash
# Is this a Vercel project?
[ -f .vercel/project.json ] && echo "Vercel: linked" || echo "Vercel: not linked"

# Has .env.local?
[ -f .env.local ] && echo ".env.local: exists" || echo ".env.local: missing"

# Check required env vars
for var in DATABASE_URL BETTER_AUTH_SECRET GOOGLE_CLIENT_ID GITHUB_CLIENT_ID; do
  grep -q "^${var}=" .env.local 2>/dev/null && echo "  ✅ $var" || echo "  ❌ $var missing"
done

# Is this project in global config?
PROJECT_NAME=$(basename "$PWD")
jq -r ".projects.\"$PROJECT_NAME\" // \"NOT REGISTERED\"" ~/.config/lore-auto-wire/config.json 2>/dev/null
```

### Step 4: Report

```
=== lore-auto-wire status ===

Global:
  Tools: neonctl ✅ | vercel ✅ | gcloud ✅ | gh ✅
  Google OAuth: configured (client_id: xxx...xxx)
  GitHub OAuth: configured (client_id: xxx...xxx)
  Projects: 3 registered (gankjob, my-saas, side-project)

Current Project (gankjob):
  Vercel: linked (project_id: prj_xxx)
  Database: Neon (project_id: xxx)
  Env vars: 8/8 configured
  Deploy: https://gankjob.vercel.app (last: 2 days ago)

Missing: NONE
```

If anything is missing, suggest the specific command to fix it.
