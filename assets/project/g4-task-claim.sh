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

# ─── task-gate-hook-denies-the-whole-chained-bash-command-when-any: chain-block banner ───
# PreToolUse hooks are all-or-nothing per Bash tool call — there is no way to let an
# earlier chain segment execute and block only a LATER one that trips this gate. Left
# silent, denying `A && B` (only B matches) reads as "A failed": the deny reason only
# ever described B's gate verdict (three live round-trips were burned on a false "gate
# non-determinism" hypothesis before this was traced to that ambiguity — chosen fix is
# (b) explicit whole-chain-blocked banner, not only-B-blocking semantics: a PreToolUse
# hook cannot partially execute a Bash string, so there is no sound way to run A and
# still deny B from the SAME tool call). Prefixes the deny reason with a banner that
# (1) quotes the segment that actually matched, verbatim, using the SAME split
# `is_command_position_match` uses (no independent re-parsing to drift out of sync
# with SPEC-050 D4 semantics), and (2) names every earlier segment, stating none of
# them ran. When the same pattern matches more than one segment (e.g. two chained
# calls of the same shape), the LAST match is reported — that mirrors the existing
# DOC_ID/PAYLOAD-extraction sed's greedy `.*`, which also resolves to the segment the
# gate actually ran against. Returns empty output for a single-segment command —
# callers MUST skip prefixing in that case so the single-command deny path stays
# byte-identical to before this fix.
# $1 = raw Bash command string. $2 = the command-position pattern that produced the
# deny-triggering match (the same pattern string passed to the winning
# `is_command_position_match` call above).
build_chain_block_banner() {
  local cmd="$1" pattern="$2" segments segment_count
  segments="$(printf '%s' "$cmd" | sed -E 's/(\&\&|\|\||;|\||\$\(|`)/\n/g')"
  segment_count="$(printf '%s\n' "$segments" | grep -c '[^[:space:]]')"
  [ "$segment_count" -le 1 ] && return 0

  # Pass 1: find the LAST segment (by index) that matches — see rationale above.
  local seg trimmed idx=0 match_idx=0
  while IFS= read -r seg; do
    trimmed="$(printf '%s' "$seg" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
    [ -z "$trimmed" ] && continue
    idx=$((idx + 1))
    if printf '%s' "$trimmed" | grep -Eq "^([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*${pattern}"; then
      match_idx=$idx
    fi
  done < <(printf '%s\n' "$segments")
  [ "$match_idx" -eq 0 ] && return 0

  # Pass 2: re-walk in order, naming the matched segment and every segment before it.
  local matched_segment="" earlier_named=""
  idx=0
  while IFS= read -r seg; do
    trimmed="$(printf '%s' "$seg" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
    [ -z "$trimmed" ] && continue
    idx=$((idx + 1))
    if [ "$idx" -eq "$match_idx" ]; then
      matched_segment="$trimmed"
    elif [ "$idx" -lt "$match_idx" ]; then
      if [ -z "$earlier_named" ]; then
        earlier_named="\`$trimmed\`"
      else
        earlier_named="$earlier_named, \`$trimmed\`"
      fi
    fi
  done < <(printf '%s\n' "$segments")

  # NOTE: no trailing \n here — `$(...)` command substitution at every call site
  # strips trailing newlines anyway, so the blank-line separator before the gate's
  # own reason is added explicitly by the caller instead (see deny call site below).
  printf '⛔ CHAINED COMMAND BLOCKED — matched segment: `%s`\nThis segment tripped an armed gate that denies below. A PreToolUse hook can only allow or deny an ENTIRE Bash tool call — it cannot run part of a chain and block only this segment — so the WHOLE command was blocked, including the earlier segment(s) that did NOT run: %s' \
    "$matched_segment" "${earlier_named:-(none — matched segment ran first)}"
}

[ "${LORE_GATE_BYPASS:-}" = "1" ] && allow

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

REPO_ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
LORE_BIN="$REPO_ROOT/dist/lore"
TARGET_CWD="${HOOK_CWD:-$REPO_ROOT}"
CD_PREFIX_TARGET="$(extract_cd_prefix_target "$RAW_COMMAND")"
[ -n "$CD_PREFIX_TARGET" ] && [ -d "$CD_PREFIX_TARGET" ] && TARGET_CWD="$CD_PREFIX_TARGET"

if [ ! -x "$LORE_BIN" ]; then
  log "lore binary not found/executable at $LORE_BIN — failing open"
  allow
fi

DOC_ID=""
# Chain-block banner state (task-gate-hook-denies-the-whole-chained-bash-command-when-any):
# only the Bash branch below ever populates these — MCP tool calls are atomic, not
# shell commands, so they have no "chain" and the banner never applies to them.
CHAIN_MATCH_PATTERN=""
CHAIN_COMMAND=""

case "$TOOL_NAME" in
  Bash)
    COMMAND="$RAW_COMMAND"

    # SPEC-050 D4: command-position check (is_command_position_match above) —
    # avoids matching the trigger phrase when it merely appears inside a
    # quoted argument value elsewhere in the command.
    CLAIM_PATTERN='([^[:space:]]*/)?lore[[:space:]]+claim[[:space:]]+[^[:space:]]+'
    if ! is_command_position_match "$COMMAND" "$CLAIM_PATTERN"; then
      allow
    fi

    # First positional token after `claim` (mirrors g2/g3's approve/set id
    # extraction) — not a flag value, so no --flag lookahead needed.
    DOC_ID="$(printf '%s' "$COMMAND" | sed -nE 's/.*lore[[:space:]]+claim[[:space:]]+([^[:space:]]+).*/\1/p')"
    CHAIN_MATCH_PATTERN="$CLAIM_PATTERN"
    CHAIN_COMMAND="$COMMAND"
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
  4)
    CHAIN_BANNER=""
    [ -n "$CHAIN_MATCH_PATTERN" ] && CHAIN_BANNER="$(build_chain_block_banner "$CHAIN_COMMAND" "$CHAIN_MATCH_PATTERN")"
    if [ -n "$CHAIN_BANNER" ]; then
      deny_with_reason "${CHAIN_BANNER}

${GATE_STDOUT}"
    else
      deny_with_reason "$GATE_STDOUT"
    fi
    ;;
  *)
    log "lore gate $CHECKPOINT exited $GATE_EXIT (undocumented verdict) — failing open"
    allow
    ;;
esac
