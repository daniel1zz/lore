# Mode: rotate

Rotate a secret and sync it across all projects that use it.

## Usage

```
/lore-auto-wire rotate <secret-name>
```

Example: `/lore-auto-wire rotate google-client-secret`

## Supported Rotations

| Secret | Scope | How to Rotate |
|--------|-------|--------------|
| `google-client-secret` | All projects | Regenerate in Google Cloud Console → update Vercel env vars |
| `github-client-secret` | All projects | Regenerate in GitHub Developer Settings → update Vercel env vars |
| `better-auth-secret` | Per-project | Generate new random → update Vercel + .env.local |
| `anthropic-api-key` | All projects | Rotate in Anthropic Console → update Vercel env vars |
| `database-url` | Per-project | N/A (Neon connection strings don't rotate) |
| `railway-token` | Per-project | Revoke + re-mint project token in Railway dashboard → update CI secret; service env vars via `railway variables --set` + `railway redeploy` |

## Procedure

### Step 1: Identify Affected Projects

```bash
# Read all projects from global config
PROJECTS=$(jq -r '.projects | keys[]' ~/.config/lore-auto-wire/config.json)
echo "Projects that will be updated: $PROJECTS"
```

### Step 2: Get New Secret Value

Either:
- Guide user to regenerate in the provider's dashboard
- Or generate locally (for BETTER_AUTH_SECRET): `openssl rand -base64 32`

### Step 3: Update All Projects

For each affected project:
```bash
for project in $PROJECTS; do
  echo "Updating $project..."
  vercel env rm <VAR_NAME> production --yes 2>/dev/null
  vercel env add <VAR_NAME> production <<< "$NEW_VALUE"
  vercel env rm <VAR_NAME> preview --yes 2>/dev/null
  vercel env add <VAR_NAME> preview <<< "$NEW_VALUE"
  vercel env rm <VAR_NAME> development --yes 2>/dev/null
  vercel env add <VAR_NAME> development <<< "$NEW_VALUE"
  echo "  ✅ $project updated"
done
```

### Step 4: Redeploy Affected Projects

```bash
for project in $PROJECTS; do
  echo "Redeploying $project..."
  vercel deploy --prod --project=$project
done
```

### Step 5: Verify

```bash
for project in $PROJECTS; do
  URL=$(jq -r ".projects.\"$project\".domain" ~/.config/lore-auto-wire/config.json)
  STATUS=$(curl -s -o /dev/null -w '%{http_code}' "https://$URL")
  echo "$project: $STATUS"
done
```

## Output

```
✅ Rotated google-client-secret across 3 projects
   gankjob: updated + redeployed ✅
   my-saas: updated + redeployed ✅
   side-project: updated + redeployed ✅
```
