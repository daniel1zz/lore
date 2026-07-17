#!/usr/bin/env bash
# lore-auto-wire: detect installed + authenticated CLIs

# Known non-standard install paths (brew cask, etc.)
GCLOUD_PATHS=(
  "/opt/homebrew/share/google-cloud-sdk/bin"
  "/usr/local/Caskroom/google-cloud-sdk/latest/google-cloud-sdk/bin"
  "$HOME/google-cloud-sdk/bin"
)

resolve_cmd() {
  local cmd="$1"
  command -v "$cmd" 2>/dev/null && return 0
  if [ "$cmd" = "gcloud" ]; then
    for p in "${GCLOUD_PATHS[@]}"; do
      [ -x "$p/gcloud" ] && echo "$p/gcloud" && return 0
    done
  fi
  return 1
}

check() {
  local name="$1" cmd="$2" auth_check="$3"
  local resolved
  if resolved=$(resolve_cmd "$cmd"); then
    local version
    version=$("$resolved" --version 2>/dev/null | head -1) || version="unknown"
    local in_path="yes"
    command -v "$cmd" &>/dev/null || in_path="no"
    local auth_resolved="${auth_check/$cmd/$resolved}"
    if eval "$auth_resolved" >/dev/null 2>&1; then
      echo "✅ $name: installed ($version) + authenticated"
    else
      echo "⚠️  $name: installed ($version) but NOT authenticated"
    fi
    [ "$in_path" = "no" ] && echo "   ⚠️  not in PATH — run: export PATH=\"$(dirname "$resolved"):\$PATH\""
  else
    echo "❌ $name: not installed"
  fi
}

echo "=== lore-auto-wire: Tool Status ==="
check "neonctl"  "neonctl"  "neonctl projects list --output json"
check "vercel"   "vercel"   "vercel whoami"
check "gcloud"   "gcloud"   "gcloud auth print-access-token"
check "gh"       "gh"       "gh auth status"
echo ""

CONFIG="$HOME/.config/lore-auto-wire/config.json"
if [ -f "$CONFIG" ]; then
  echo "✅ Global config: $CONFIG"
  if command -v jq &>/dev/null; then
    count=$(jq -r '.projects | keys | length' "$CONFIG" 2>/dev/null) || count="?"
    echo "   Projects registered: $count"
  fi
else
  echo "❌ Global config: not found (run /lore-auto-wire init-tools)"
fi
