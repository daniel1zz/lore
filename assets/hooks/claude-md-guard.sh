#!/usr/bin/env bash
#
# claude-md-guard.sh — Claude Code PostToolUse hook wiring the "CLAUDE.md
# two-zone admission" check (spec-context-verb-family-two-zone-claude-md-
# anatomy-lore D11) into a real session: fires immediately AFTER an Edit or
# Write tool call and, when the edited file's basename is the default memory
# filename, runs `lore status --check-claude-md` at the nearest ancestor
# directory that owns a `.lore/` corpus — feeding any reported breach back as
# blocking PostToolUse feedback.
#
# ⛔ ZERO NUMERIC LITERALS (D11): every budget ceiling (max_lines/max_bytes,
# for both the root and module roles) lives ONLY in `@lore/core`'s
# `contextConfigSchema` defaults / a corpus's own `.lore/config.yaml`
# overrides. `lore status --check-claude-md` is the SOLE measurement point —
# this shim relays that command's own exit code and stdout/stderr text
# verbatim; it never itself compares a measured count to a ceiling, so it
# never needs a numeric literal of its own.
#
# Fast path (deliberately narrow, NOT config-driven): only a basename of
# literally "CLAUDE.md" reaches the delegated command below. The FULL set of
# configured memory filenames (`context.memory_files.filenames`) is read and
# applied ONLY inside `lore status --check-claude-md` itself (via
# `resolveMemoryFileBudgets`/`discoverMemoryFiles` — see those modules) —
# never duplicated here. An Edit/Write on any other filename is out of scope
# for this hook and allowed silently.
#
# Protocol (Claude Code PostToolUse hooks): reads the hook payload JSON
# ({tool_name, tool_input, cwd, ...}) from stdin. Blocking contract (official
# docs; matches this repo's `subagent-stop-commit-guard.mjs` SubagentStop
# precedent): exit code two feeds stderr back to the model as blocking
# feedback; exit zero is silent success/allow. No other exit code is used —
# every anomaly below falls through to allow, never to a bare crash.
#
# ⛔ FAIL-OPEN CONTRACT (project CLAUDE.md 边界③ / R2): no `.lore/` anywhere
# above the edited file, no resolvable `lore` binary, malformed/empty stdin,
# a non-memory-file edit — all allow silently. Only an ACTUAL over-ceiling
# breach on an ACTUAL CLAUDE.md edit under a real `.lore/`-bearing repo
# blocks the tool call's aftermath.

set -u # deliberately NOT `set -e`: every failure path below must fall through to allow

log() { printf 'claude-md-guard: %s\n' "$1" >&2; }

allow() {
  exit 0
}

# $1 = blocking feedback text (verbatim `lore status --check-claude-md` output).
block() {
  printf '%s\n' "$1" >&2
  exit 2
}

# Walks upward from $1 looking for the nearest ancestor owning a `.lore/`
# directory — the repo root `lore status --check-claude-md` must be run from
# (that command itself is the sole budget measurement point per the module
# header above; this function only has to find WHERE to invoke it). Prints
# the found root and returns success, or prints nothing and fails when no
# ancestor up to and including the filesystem root has one.
find_repo_root() {
  local dir="$1"
  while :; do
    if [ -d "$dir/.lore" ]; then
      printf '%s' "$dir"
      return 0
    fi
    [ "$dir" = "/" ] && return 1
    dir="$(dirname "$dir")"
  done
}

if ! command -v jq >/dev/null 2>&1; then
  log "jq not found on PATH — cannot parse hook payload, failing open"
  allow
fi

STDIN_JSON="$(cat)"

if ! printf '%s' "$STDIN_JSON" | jq -e . >/dev/null 2>&1; then
  log "stdin is not valid JSON — failing open"
  allow
fi

FILE_PATH="$(printf '%s' "$STDIN_JSON" | jq -r '.tool_input.file_path // empty')"
[ -z "$FILE_PATH" ] && allow

# Fast path: only the default memory filename reaches the delegated command —
# see module header for why the full configured filename set is deliberately
# NOT re-read here.
BASENAME="$(basename "$FILE_PATH")"
[ "$BASENAME" = "CLAUDE.md" ] || allow

FILE_DIR="$(dirname "$FILE_PATH")"
REPO_ROOT="$(find_repo_root "$FILE_DIR")" || allow

LORE_BIN="$(command -v lore || true)"
if [ -z "$LORE_BIN" ] || [ ! -x "$LORE_BIN" ]; then
  log "lore binary not found/executable on PATH — failing open"
  allow
fi

CHECK_OUTPUT="$(cd "$REPO_ROOT" 2>/dev/null && "$LORE_BIN" status --check-claude-md 2>&1)"
CHECK_EXIT=$?

case "$CHECK_EXIT" in
  0) allow ;;
  3) block "$CHECK_OUTPUT" ;;
  *)
    log "lore status --check-claude-md exited $CHECK_EXIT (undocumented verdict) — failing open"
    allow
    ;;
esac
