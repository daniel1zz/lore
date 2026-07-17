#!/usr/bin/env bash
# lore-auto-wire: auto-fix PATH for tools installed to non-standard locations
# Called by init-tools after installation. Idempotent.

SHELL_RC="$HOME/.zshrc"
[ -n "$BASH_VERSION" ] && SHELL_RC="$HOME/.bashrc"

fixed=0

# gcloud: brew cask installs to /opt/homebrew/share/google-cloud-sdk/bin
if ! command -v gcloud &>/dev/null; then
  for p in "/opt/homebrew/share/google-cloud-sdk/bin" \
           "/usr/local/Caskroom/google-cloud-sdk/latest/google-cloud-sdk/bin" \
           "$HOME/google-cloud-sdk/bin"; do
    if [ -x "$p/gcloud" ]; then
      if ! grep -q "$p" "$SHELL_RC" 2>/dev/null; then
        echo "export PATH=\"$p:\$PATH\"" >> "$SHELL_RC"
        export PATH="$p:$PATH"
        echo "✅ gcloud: added $p to PATH in $SHELL_RC"
        fixed=$((fixed + 1))
      fi
      break
    fi
  done
fi

# neonctl: npm global might not be in PATH on some setups
if ! command -v neonctl &>/dev/null; then
  npm_bin=$(npm bin -g 2>/dev/null)
  if [ -n "$npm_bin" ] && [ -x "$npm_bin/neonctl" ]; then
    if ! grep -q "$npm_bin" "$SHELL_RC" 2>/dev/null; then
      echo "export PATH=\"$npm_bin:\$PATH\"" >> "$SHELL_RC"
      export PATH="$npm_bin:$PATH"
      echo "✅ neonctl: added $npm_bin to PATH in $SHELL_RC"
      fixed=$((fixed + 1))
    fi
  fi
fi

[ "$fixed" -eq 0 ] && echo "✅ PATH: all tools already accessible"
