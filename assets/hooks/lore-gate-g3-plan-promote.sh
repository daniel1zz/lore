#!/usr/bin/env bash
#
# g3-plan-promote.sh — Claude Code PreToolUse hook bridging `lore gate plan-promote`
# (IoC vertical-slice tech-spec §4.1/§11, commit-time cross-tier gate) into a real
# session: fires whenever the AI is ABOUT TO promote an ALREADY-CREATED plan doc
# toward approval, runs the deterministic upstream-spec gate, and either denies the
# tool call (feeding back the gate's stderr message as the deny reason) or lets it
# through unmodified.
#
# Fires on two call shapes (mirrors g4-task-claim.sh's Bash/MCP split — SPEC-024:
# MCP is the DEFAULT agent surface, so a Bash-only hook here would let an MCP-driven
# agent bypass this gate entirely by calling `lore_approve`/`lore_set` instead of the
# CLI):
#   - Bash tool calls whose `command` is either `lore approve <id> ...` (any path
#     prefix) or `lore set <id> ... --status (in-review|approved) ...`.
#   - MCP `lore_approve` / `lore_set` tool calls (tool_name containing "lore_approve"
#     / "lore_set") — the doc id is `tool_input.id_or_slug` (the field name of
#     `LoreApproveSchema` / `LoreSetSchema`, packages/lore/src/adapters/mcp/tools.ts).
#     `lore_set` additionally requires `tool_input.status` to be "in-review" or
#     "approved" — mirroring the Bash shape's `--status` filter — so an MCP `lore_set`
#     call that only touches title/content/tags/extra (not status) is out of scope,
#     same as the Bash `lore set` shape without a matching `--status` flag.
# AND whose <id> resolves to a doc of type "plan" (checked via `lore get --json`
# BEFORE invoking the gate — same mandatory pre-check rationale as g2-spec-promote.sh:
# `lore gate plan-promote` exits 4 for BOTH "ancestor spec unapproved/missing AC" AND
# "resolves but is not a plan" (gate.ts header). Every other tool call — including
# approve/set-status on a non-plan doc (prd/spec/adr/knowledge/task) — is out of
# scope and allowed without further inspection.
#
# Protocol (Claude Code PreToolUse hooks): reads the hook payload JSON
# ({tool_name, tool_input, cwd, ...}) from stdin, writes ONE JSON object to
# stdout — same allow/deny shape as g2-spec-promote.sh.
#
# ⛔ FAIL-OPEN CONTRACT (project CLAUDE.md 边界③ / R2): identical to
# g2-spec-promote.sh — any parsing/lookup/gate-command anomaly allows the call
# through and logs one stderr line. Only an ACTUAL upstream-spec-check failure on
# an ACTUAL plan resolved from an ACTUAL promote-shaped command denies.
#
# Honors LORE_GATE_BYPASS=1 — short-circuits to allow before touching stdin.

set -u # deliberately NOT `set -e`: every failure path below must fall through to allow

log() { printf 'g3-plan-promote: %s\n' "$1" >&2; }

allow() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}\n'
  exit 0
}

# $1 = reason text (verbatim `lore gate plan-promote` stdout message).
deny_with_reason() {
  if command -v jq >/dev/null 2>&1; then
    jq -n --arg reason "$1" \
      '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$reason}}'
    exit 0
  fi
  log "jq unavailable at deny-time — failing open instead of risking malformed JSON"
  allow
}

[ "${LORE_GATE_BYPASS:-}" = "1" ] && allow

# Project-vendored dedupe (2026-07-17): when the active project mounts its own
# copy of this gate (repo hooks/g3-plan-promote.sh via .claude/settings.json, the
# SPEC-046 project flavor), this global mount would run the SAME deterministic
# gate a SECOND time on every matching tool call — pure duplicate latency.
# Coverage is preserved by the project copy AND the service-layer GateEnforcer
# (the authoritative backstop). Sessions outside such a project fall through
# unchanged (CLAUDE_PROJECT_DIR unset, or no vendored copy present).
[ -n "${CLAUDE_PROJECT_DIR:-}" ] && [ -x "${CLAUDE_PROJECT_DIR}/hooks/g3-plan-promote.sh" ] && allow

if ! command -v jq >/dev/null 2>&1; then
  log "jq not found on PATH — cannot parse hook payload, failing open"
  allow
fi

STDIN_JSON="$(cat)"

if ! printf '%s' "$STDIN_JSON" | jq -e . >/dev/null 2>&1; then
  log "stdin is not valid JSON — failing open"
  allow
fi

TOOL_NAME="$(printf '%s' "$STDIN_JSON" | jq -r '.tool_name // empty')"
HOOK_CWD="$(printf '%s' "$STDIN_JSON" | jq -r '.cwd // empty')"

# Globalized shim (synced from <lore-repo>/hooks/): lore resolved from PATH,
# and any project WITHOUT a .lore/ corpus at the call cwd is allowed untouched.
TARGET_CWD="${HOOK_CWD:-$PWD}"
LORE_BIN="$(command -v lore || true)"
[ -d "$TARGET_CWD/.lore" ] || allow

if [ ! -x "$LORE_BIN" ]; then
  log "lore binary not found/executable at $LORE_BIN — failing open"
  allow
fi

DOC_ID=""

case "$TOOL_NAME" in
  Bash)
    COMMAND="$(printf '%s' "$STDIN_JSON" | jq -r '.tool_input.command // empty')"

    if printf '%s' "$COMMAND" | grep -Eq '(^|[/[:space:]])lore[[:space:]]+approve[[:space:]]+[^[:space:]]+'; then
      DOC_ID="$(printf '%s' "$COMMAND" | sed -nE 's/.*lore[[:space:]]+approve[[:space:]]+([^[:space:]]+).*/\1/p')"
    elif printf '%s' "$COMMAND" | grep -Eq '(^|[/[:space:]])lore[[:space:]]+set[[:space:]]+[^[:space:]]+' \
      && printf '%s' "$COMMAND" | grep -Eq -- '--status[[:space:]]+(in-review|approved)([[:space:]]|$)'; then
      DOC_ID="$(printf '%s' "$COMMAND" | sed -nE 's/.*lore[[:space:]]+set[[:space:]]+([^[:space:]]+).*/\1/p')"
    else
      allow
    fi
    ;;
  *lore_approve*)
    DOC_ID="$(printf '%s' "$STDIN_JSON" | jq -r '.tool_input.id_or_slug // empty')"
    ;;
  *lore_set*)
    MCP_STATUS="$(printf '%s' "$STDIN_JSON" | jq -r '.tool_input.status // empty')"
    if [ "$MCP_STATUS" = "in-review" ] || [ "$MCP_STATUS" = "approved" ]; then
      DOC_ID="$(printf '%s' "$STDIN_JSON" | jq -r '.tool_input.id_or_slug // empty')"
    else
      allow
    fi
    ;;
  *)
    allow
    ;;
esac

if [ -z "$DOC_ID" ]; then
  log "matched an approve/set-status command shape but could not extract the doc id — failing open"
  allow
fi

# Pre-check: only proceed into the plan-promote gate when DOC_ID actually
# resolves to a plan (see header note). Any lookup failure — unresolvable id,
# store error, `lore get` crashing — fails open, same as every other anomaly.
GET_OUTPUT="$(cd "$TARGET_CWD" 2>/dev/null && "$LORE_BIN" get "$DOC_ID" --json 2>/dev/null)"
GET_EXIT=$?

if [ "$GET_EXIT" -ne 0 ]; then
  log "lore get $DOC_ID exited $GET_EXIT — could not confirm doc type, failing open"
  allow
fi

DOC_TYPE="$(printf '%s' "$GET_OUTPUT" | jq -r '.data.doc.type // empty' 2>/dev/null)"

if [ "$DOC_TYPE" != "plan" ]; then
  allow
fi

GATE_STDOUT="$(cd "$TARGET_CWD" 2>/dev/null && "$LORE_BIN" gate plan-promote --plan "$DOC_ID" 2>/dev/null)"
GATE_EXIT=$?

case "$GATE_EXIT" in
  0) allow ;;
  4) deny_with_reason "$GATE_STDOUT" ;;
  *)
    log "lore gate plan-promote exited $GATE_EXIT (undocumented verdict) — failing open"
    allow
    ;;
esac
