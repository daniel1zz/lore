# Mode: add

Add a new service/integration to an existing project.

## Usage

```
/lore-auto-wire add <service>
```

## Supported Services

| Service | What It Provisions | Env Vars Added |
|---------|-------------------|----------------|
| `stripe` | Stripe API keys | STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET |
| `resend` | Resend email API | RESEND_API_KEY |
| `upstash` | Upstash Redis | UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN |
| `anthropic` | Anthropic API key | ANTHROPIC_API_KEY |
| `openai` | OpenAI API key | OPENAI_API_KEY |
| `railway` | Railway project + worker service (Docker/long-running; see tools/railway.md) | RAILWAY_TOKEN (CI), service env vars via `railway variables` |

## Procedure

### Step 1: Check Prerequisites

- Must be in a project directory (has package.json)
- Must be linked to Vercel (has .vercel/project.json)

### Step 2: Service-Specific Setup

Each service follows:
1. Ask user for API key/credentials (or guide signup)
2. Add env vars to Vercel (all environments)
3. Pull to .env.local
4. Install SDK package if applicable
5. Verify

### Step 3: Generic Pattern

```bash
# Ask for the key
echo "Enter your <SERVICE> API key:"

# Add to Vercel
vercel env add <VAR_NAME> production <<< "$VALUE"
vercel env add <VAR_NAME> preview <<< "$VALUE"
vercel env add <VAR_NAME> development <<< "$VALUE"

# Sync local
vercel env pull .env.local

# Install SDK (if applicable)
npm install <sdk-package>
```

### Step 4: Verify

```bash
# Check env var is set
grep -q '<VAR_NAME>' .env.local && echo "✅ <VAR_NAME> configured"
```

## Extending

To add a new service:
1. Add to the supported services table above
2. Add the env var names and setup steps
3. No code changes needed — the generic pattern handles it
