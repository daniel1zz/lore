#!/usr/bin/env bash
#
# g4-task-claim.sh — Claude Code PreToolUse hook bridging `lore gate task-claim`
# / `lore gate phase-claim` (IoC vertical-slice tech-spec §4.1/§11, commit-time
# cross-tier gate; SPEC-056 D2/D7 phase-claim is the ADDITIVE generalization of
# task-claim onto the new `phase` doc type — task-claim keeps gating legacy
# `task` docs unchanged during the migration window) into a real session: fires
# whenever the AI is ABOUT TO claim an ALREADY-CREATED task OR phase doc, runs
# the matching deterministic upstream-spec gate, and either denies the tool
# call (feeding back the gate's stdout message as the deny reason) or lets it
# through unmodified.
#
# Filename kept as `g4-task-claim.sh` (not renamed to a generic `g4-claim.sh`)
# on landing phase-claim support — a rename would churn every installer
# manifest entry (assets-ssot.test.ts / real-setup-ports.test.ts /
# project-setup-service.test.ts) and the `.lore-setup-manifest.json` uninstall
# reverse-path for zero behavioral gain; in-place extension was chosen instead
# (SPEC-056 "Assets resync" task decision).
#
# Fires on two call shapes (mirrors g1-spec-create.sh's Bash/MCP split):
#   - Bash tool calls whose `command` contains `lore claim <doc> ...` (any path
#     prefix in front of the `lore` binary name) — the doc id is the FIRST
#     positional token after the `claim` subcommand. `lore claim` is ONE CLI
#     verb for both task and phase docs — the doc-type resolution below (not
#     the command text) decides which checkpoint applies.
#   - MCP `lore_claim` tool calls (tool_name containing "lore_claim") — the doc
#     id is `tool_input.id_or_slug` (the field name of `LoreClaimSchema`,
#     packages/lore/src/adapters/mcp/tools.ts: `{id_or_slug, by, branch?, steal?}`).
# AND whose id resolves to a doc of type "task" or "phase" (checked via
# `lore get --json` BEFORE invoking the gate — same mandatory pre-check
# rationale as g2/g3: `lore gate task-claim`/`phase-claim` exits 4 for BOTH
# "ancestor spec unapproved" AND "resolves but is not a task/phase" (gate.ts
# header). Every other tool call — including `claim` on a doc of any other
# type, or any other MCP tool — is out of scope and allowed without further
# inspection.
#
# Protocol (Claude Code PreToolUse hooks): reads the hook payload JSON
# ({tool_name, tool_input, cwd, ...}) from stdin, writes ONE JSON object to
# stdout — same allow/deny shape as g1/g2/g3.
#
# ⛔ FAIL-OPEN CONTRACT (project CLAUDE.md 边界③ / R2): identical to the other
# three shims — any parsing/lookup/gate-command anomaly allows the call through
# and logs one stderr line. Only an ACTUAL upstream-spec-check failure on an
# ACTUAL task/phase resolved from an ACTUAL claim-shaped command denies. This
# also covers the transitional window before a `lore gate phase-claim` CLI
# subcommand exists: an unrecognized checkpoint name falls into the
# "undocumented verdict" branch below and fails open, so this hook is safe to
# ship ahead of (or behind) that CLI surface landing.
#
# Honors LORE_GATE_BYPASS=1 — short-circuits to allow before touching stdin.

set -u # deliberately NOT `set -e`: every failure path below must fall through to allow

log() { printf 'g4-task-claim: %s\n' "$1" >&2; }

allow() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}\n'
  exit 0
}

# $1 = reason text (verbatim `lore gate task-claim`/`lore gate phase-claim` stdout message).
deny_with_reason() {
  if command -v jq >/dev/null 2>&1; then
    jq -n --arg reason "$1" \
      '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$reason}}'
    exit 0
  fi
  log "jq unavailable at deny-time — failing open instead of risking malformed JSON"
  allow
}

# ─── SPEC-050 D1: leading `cd <path> &&`/`cd <path> ;` prefix parsing ───────
# The gate must check the corpus a Bash command will ACTUALLY execute
# against, not the harness's ambient cwd — `cd <other-project> && lore ...`
# issued from a session anchored elsewhere was gate-checked against the WRONG
# corpus (false PARENT_REQUIRED denies observed live). Extracts a LEADING
# `cd <path>` — optionally preceded by simple `VAR=value` env assignments —
# from the raw Bash command string. Accepted <path> forms: double-quoted,
# single-quoted, bare token (checked in that priority order, mirroring
# extract_flag's convention below); a `$` anywhere in the extracted token
# (variable / command substitution, unresolvable by this static shim)
# disqualifies the match. Only the FIRST leading cd is honored — chained
# `cd a && cd b && ...` beyond the first is out of scope, covered by the
# surrounding fail-open contract, not by this parser.
extract_cd_prefix_target() {
  local cmd="$1" candidate=""
  candidate="$(printf '%s' "$cmd" | sed -nE \
    's/^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*cd[[:space:]]+"([^"]*)"[[:space:]]*(&&|;).*/\2/p')"
  if [ -z "$candidate" ]; then
    candidate="$(printf '%s' "$cmd" | sed -nE \
      "s/^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*cd[[:space:]]+'([^']*)'[[:space:]]*(&&|;).*/\\2/p")"
  fi
  if [ -z "$candidate" ]; then
    candidate="$(printf '%s' "$cmd" | sed -nE \
      's/^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*cd[[:space:]]+([^[:space:]&;]+)[[:space:]]*(&&|;).*/\2/p')"
  fi
  case "$candidate" in
    *'$'*) return ;; # disqualified: variable/command substitution in the path
  esac
  printf '%s' "$candidate"
}

# ─── SPEC-050 D4: command-position trigger matching ─────────────────────────
# A trigger phrase must sit at a COMMAND position — start of the raw string,
# or immediately after &&, ||, ;, |, $( or a backtick — never inside a quoted
# argument (observed false deny: a --statement VALUE that merely mentioned a
# gate's trigger phrase tripped the old anywhere-in-string grep). Pragmatic
# approximation, not a full shell parser: separator tokens are normalized to
# newlines WITHOUT quote-awareness, then each resulting segment is grepped
# anchored at its own start (after optional leading whitespace and simple
# `VAR=value` env assignments).
is_command_position_match() {
  local cmd="$1" pattern="$2"
  printf '%s' "$cmd" \
    | sed -E 's/(\&\&|\|\||;|\||\$\(|`)/\n/g' \
    | grep -Eq "^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*${pattern}"
}

[ "${LORE_GATE_BYPASS:-}" = "1" ] && allow

# Project-vendored dedupe (2026-07-17): when the active project mounts its own
# copy of this gate (repo hooks/g4-task-claim.sh via .claude/settings.json, the
# SPEC-046 project flavor), this global mount would run the SAME deterministic
# gate a SECOND time on every matching tool call — pure duplicate latency.
# Coverage is preserved by the project copy AND the service-layer GateEnforcer
# (the authoritative backstop). Sessions outside such a project fall through
# unchanged (CLAUDE_PROJECT_DIR unset, or no vendored copy present).
[ -n "${CLAUDE_PROJECT_DIR:-}" ] && [ -x "${CLAUDE_PROJECT_DIR}/hooks/g4-task-claim.sh" ] && allow

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
RAW_COMMAND=""
[ "$TOOL_NAME" = "Bash" ] && RAW_COMMAND="$(printf '%s' "$STDIN_JSON" | jq -r '.tool_input.command // empty')"

# Globalized shim (synced from <lore-repo>/hooks/): lore resolved from PATH,
# and any project WITHOUT a .lore/ corpus at the call cwd is allowed untouched.
TARGET_CWD="${HOOK_CWD:-$PWD}"
CD_PREFIX_TARGET="$(extract_cd_prefix_target "$RAW_COMMAND")"
[ -n "$CD_PREFIX_TARGET" ] && [ -d "$CD_PREFIX_TARGET" ] && TARGET_CWD="$CD_PREFIX_TARGET"
LORE_BIN="$(command -v lore || true)"
[ -d "$TARGET_CWD/.lore" ] || allow

if [ ! -x "$LORE_BIN" ]; then
  log "lore binary not found/executable at $LORE_BIN — failing open"
  allow
fi

DOC_ID=""

case "$TOOL_NAME" in
  Bash)
    COMMAND="$RAW_COMMAND"

    # SPEC-050 D4: command-position check (is_command_position_match above) —
    # avoids matching the trigger phrase when it merely appears inside a
    # quoted argument value elsewhere in the command.
    if ! is_command_position_match "$COMMAND" '([^[:space:]]*/)?lore[[:space:]]+claim[[:space:]]+[^[:space:]]+'; then
      allow
    fi

    # First positional token after `claim` (mirrors g2/g3's approve/set id
    # extraction) — not a flag value, so no --flag lookahead needed.
    DOC_ID="$(printf '%s' "$COMMAND" | sed -nE 's/.*lore[[:space:]]+claim[[:space:]]+([^[:space:]]+).*/\1/p')"
    ;;
  *lore_claim*)
    DOC_ID="$(printf '%s' "$STDIN_JSON" | jq -r '.tool_input.id_or_slug // empty')"
    ;;
  *)
    allow
    ;;
esac

if [ -z "$DOC_ID" ]; then
  log "matched a claim command/tool shape but could not extract the doc id — failing open"
  allow
fi

# Pre-check: only proceed into the task-claim gate when DOC_ID actually
# resolves to a task (see header note). Any lookup failure — unresolvable id,
# store error, `lore get` crashing — fails open, same as every other anomaly.
GET_OUTPUT="$(cd "$TARGET_CWD" 2>/dev/null && "$LORE_BIN" get "$DOC_ID" --json 2>/dev/null)"
GET_EXIT=$?

if [ "$GET_EXIT" -ne 0 ]; then
  log "lore get $DOC_ID exited $GET_EXIT — could not confirm doc type, failing open"
  allow
fi

DOC_TYPE="$(printf '%s' "$GET_OUTPUT" | jq -r '.data.doc.type // empty' 2>/dev/null)"

# SPEC-056 D2/D7: dispatch to the checkpoint matching the resolved doc type —
# legacy `task` docs still gate on `task-claim`; new `phase` docs gate on the
# additive `phase-claim` checkpoint (same checkpoint-agnostic predicates,
# reused verbatim server-side per checkpoint-registry.ts). Any other doc type
# is out of scope for this hook.
case "$DOC_TYPE" in
  task) CHECKPOINT="task-claim" ;;
  phase) CHECKPOINT="phase-claim" ;;
  *) allow ;;
esac

GATE_STDOUT="$(cd "$TARGET_CWD" 2>/dev/null && "$LORE_BIN" gate "$CHECKPOINT" --task "$DOC_ID" 2>/dev/null)"
GATE_EXIT=$?

case "$GATE_EXIT" in
  0) allow ;;
  4) deny_with_reason "$GATE_STDOUT" ;;
  *)
    log "lore gate $CHECKPOINT exited $GATE_EXIT (undocumented verdict) — failing open"
    allow
    ;;
esac
