# Mode: init-tools

First-time setup — install and authenticate all CLIs, create global config.
Run this once on a new machine. Idempotent: safe to re-run.

## Procedure

### Step 1: Detect Platform

```bash
uname -s  # Darwin / Linux
```

### Step 2: Install Missing CLIs

Check each tool and install if missing:

| Tool | macOS (brew) | Linux |
|------|-------------|-------|
| neonctl | `brew install neonctl` | `npm i -g neonctl` |
| vercel | `npm i -g vercel` | `npm i -g vercel` |
| gcloud | `brew install --cask google-cloud-sdk` | see cloud.google.com/sdk/install |
| gh | `brew install gh` | `brew install gh` or apt/dnf |

For each: check `command -v <tool>` first. Skip if already installed. Report version after install.

**gcloud special**: After `brew install --cask google-cloud-sdk`, also install alpha components:
```bash
gcloud components install alpha --quiet
```

**Post-install PATH fix** (MANDATORY — run immediately after installing):
```bash
bash ~/.claude/skills/lore-auto-wire/scripts/fix-path.sh
```

This automatically detects non-standard install paths (gcloud brew cask → `/opt/homebrew/share/google-cloud-sdk/bin`, npm global) and appends them to ~/.zshrc. Idempotent — safe to re-run. The current shell session is also updated via `export PATH`.

### Step 3: Authenticate Each CLI

⛔ **Principle: auto-fix, don't report.** For each tool, CHECK auth status first. If not authenticated, RUN the auth command directly — do not ask the user to run it themselves. The browser will open automatically for OAuth flows; the user just clicks "Allow".

```bash
# 1. Neon — check then auth if needed
neonctl projects list --output json &>/dev/null || neonctl auth

# 2. Vercel — check then auth if needed
vercel whoami &>/dev/null || vercel login

# 3. Google Cloud — check then auth if needed
gcloud auth print-access-token &>/dev/null || gcloud auth login

# 4. GitHub — check then auth if needed
gh auth status &>/dev/null || gh auth login
```

After ALL auths complete, verify:
```bash
bash ~/.claude/skills/lore-auto-wire/scripts/check-tools.sh
```

If any tool still shows ⚠️, retry its auth command once. If it fails again, THEN report the specific error.

### Step 4: Set Up Google OAuth App (One-Time)

This creates ONE Google OAuth app that all future projects share.

⛔ **gcloud IAP OAuth API is DEPRECATED (shut down March 2026)**. Do NOT use `gcloud alpha iap oauth-clients`. The only working path is browser automation via agent-browser.

**Procedure (agent-browser via user's Chrome):**

1. Connect to user's Chrome:
   ```bash
   agent-browser --auto-connect open "https://console.cloud.google.com/auth/overview/create?project=<PROJECT_ID>"
   ```

2. If Chrome isn't discoverable, try these fallbacks IN ORDER:
   - Read `~/Library/Application Support/Google/Chrome/DevToolsActivePort` for WS URL
   - AppleScript URL navigation: `osascript -e 'tell application "Google Chrome" to set URL of active tab of first window to "<URL>"'`
   - Ask user to restart Chrome: `killall "Google Chrome"; sleep 2; /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --restore-last-session &`

3. Fill the 4-step OAuth consent screen wizard:
   - Step 1: App name = "ZZ Shared OAuth", Support email = user's email
   - Step 2: Select "外部" (External)
   - Step 3: Developer contact email = user's email
   - Step 4: Check agreement → Create

4. After consent screen created, navigate to create OAuth client:
   - URL: `https://console.cloud.google.com/auth/clients/create?project=<PROJECT_ID>`
   - Or click "创建 OAuth 客户端" on the overview page

5. Fill OAuth client form:
   - Application type: "Web 应用" (Web application)
   - Name: "ZZ Shared OAuth"
   - Redirect URI: `http://localhost:3000/api/auth/callback/google`
   - Click Create

6. Extract Client ID and Secret:
   ```javascript
   // Client ID: look for *.apps.googleusercontent.com pattern
   // Client Secret: look for GOCSPX-* pattern
   // Or download JSON via the "下载 JSON" button
   ```

7. Alternatively, navigate to client details page and find secret via:
   ```
   button "复制到剪贴板：GOCSPX-..."
   ```

**Known issues:**
- Google Cloud Console is a heavy SPA — `agent-browser snapshot` may need `wait --load networkidle` + `sleep 3-5` between page transitions
- "添加 URI" button for redirect URIs creates a dynamic input that may not appear in accessibility tree — use JS to find and fill: `document.getElementById('_0rif_mat-input-N')`
- Some buttons don't respond to `click @ref` — use JS: `document.querySelector('button').scrollIntoView(); button.click()`

### Step 5: Set Up GitHub OAuth App (One-Time)

⛔ **GitHub has NO API for creating OAuth Apps.** Must use browser automation.

**Procedure (agent-browser via user's Chrome):**

1. Connect to user's Chrome (same connection as Step 4)

2. Navigate to creation page:
   ```bash
   agent-browser open "https://github.com/settings/applications/new"
   ```

3. Fill form using `keyboard type` (more reliable than `fill` for GitHub's React forms):
   ```bash
   agent-browser click @<name-field>
   agent-browser keyboard type "ZZ Shared Auth"
   agent-browser press Tab
   agent-browser keyboard type "https://github.com/<username>"
   agent-browser press Tab  # skip Description
   agent-browser press Tab
   agent-browser keyboard type "http://localhost:3000/api/auth/callback/github"
   ```

4. Submit via **Enter key** (more reliable than clicking Register button):
   ```bash
   agent-browser press Enter
   ```

5. Extract Client ID from result page:
   ```javascript
   document.body.innerText.match(/Ov23\w+/)[0]
   ```

6. Click "Generate a new client secret" button, then extract:
   ```javascript
   document.body.innerText.match(/([a-f0-9]{40})/)[0]
   ```

**Known issues:**
- `agent-browser fill` sets value but GitHub's React doesn't pick up the change for form validation → use `keyboard type` instead
- `agent-browser click @<register-button>` sometimes doesn't submit → use `press Enter` while focused on the callback URL field
- `form.submit()` via JS bypasses CSRF validation and redirects to empty form → don't use
- If login is needed: "Continue with Google" from GitHub login page works if user's Google session is active in the same Chrome

### Step 6: Create Global Config

```bash
mkdir -p ~/.config/lore-auto-wire
```

Create `~/.config/lore-auto-wire/config.json` with collected values.

Auto-collect where possible:
- Neon org_id: `neonctl projects list --output json | jq -r '.projects[0].org_id'`
- GitHub username: `gh api user --jq '.login'`
- GCP projects: `gcloud projects list --format='value(projectId)' | head -1`

Only ask user for values that can't be auto-collected (OAuth secrets if not captured via browser).

### Step 7: Verify

Run full check:
```bash
bash ~/.claude/skills/lore-auto-wire/scripts/check-tools.sh
```

Expected: all ✅. Report any remaining issues.

## Chrome Connection Reference (macOS)

Connecting to the user's existing Chrome is the hardest part. Here's the escalation ladder:

| Priority | Method | How | When It Works |
|----------|--------|-----|---------------|
| 1 | `--auto-connect` | Reads DevToolsActivePort | Chrome started with `--remote-debugging-port` |
| 2 | AppleScript navigate | `osascript -e 'tell app "Google Chrome" to set URL of...'` | Always (navigation only) |
| 3 | AppleScript JS | `execute...javascript` | Requires "Allow JavaScript from Apple Events" in Chrome menu: 显示→开发者 |
| 4 | Enable via AppleScript | `click menu item "允许..." of menu "开发者" of menu item "开发者" of menu "显示"` | Needs macOS Automation permission for Terminal |
| 5 | Restart Chrome | `killall "Google Chrome"; /Applications/.../Google Chrome --remote-debugging-port=9222 --restore-last-session &` | Last resort, preserves tabs |

**Enabling AppleScript JS permanently:**
```bash
# Set Chrome preference (requires Chrome restart to take effect)
defaults write com.google.Chrome AppleScriptEnabled -bool true
# Then enable via menu: 显示 → 开发者 → 允许 Apple 事件中的 JavaScript
# Note: menu name is "显示" NOT "查看" in Chinese macOS Chrome
```

**Best practice for first-time setup:**
1. Try `--auto-connect` first
2. If fails, use AppleScript URL navigation + agent-browser for form filling
3. If Chrome has no debugging port, guide restart with `--remote-debugging-port=9222`
4. Save agent-browser session state for future use: `agent-browser state save ~/.config/lore-auto-wire/browser-state.json`

## Output

```
✅ init-tools complete
   neonctl: authenticated (org: xxx)
   vercel: authenticated (user: xxx)
   gcloud: authenticated (project: xxx)
   gh: authenticated (user: xxx)
   Google OAuth app: ZZ Shared OAuth (client_id: xxx...xxx)
   GitHub OAuth app: ZZ Shared Auth (client_id: xxx...xxx)
   Global config: ~/.config/lore-auto-wire/config.json
```
