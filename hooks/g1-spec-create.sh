#!/usr/bin/env bash
#
# g1-spec-create.sh — Claude Code PreToolUse hook bridging `lore gate spec-create`
# (IoC vertical-slice tech-spec §4.1/§11, `lore` CLI commit e3f4b0e) into a real
# session: fires whenever the AI is ABOUT TO create a spec doc, runs the
# deterministic pre-flight gate against the CANDIDATE payload, and either denies
# the tool call (injecting the gate's feeding-pack text as the deny reason, so
# the model sees WHY and how to fix it) or lets it through unmodified.
#
# Fires on two call shapes:
#   - Bash tool calls whose `command` contains `lore create spec ...` (any path
#     prefix in front of the `lore` binary name, e.g. `./dist/lore create spec`).
#   - MCP `lore_create` tool calls (tool_name containing "lore_create") whose
#     `tool_input.type == "spec"`.
# Every other tool call is out of scope and is allowed without inspection.
#
# Protocol (Claude Code PreToolUse hooks): reads the hook payload JSON
# ({tool_name, tool_input, cwd, ...}) from stdin, writes ONE JSON object to
# stdout:
#   {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}
#   {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"<feeding pack>"}}
#
# ⛔ FAIL-OPEN CONTRACT (project CLAUDE.md 边界③ / R2): this shim must NEVER be
# the reason a normal tool call gets blocked. Every unexpected condition —
# stdin not JSON, `jq` missing, the `lore` binary missing/non-executable, the
# gate command crashing or returning an exit code other than its two
# documented verdicts (0 pass / 4 fail) — allows the call through and logs one
# line to stderr instead. Only an ACTUAL gate-predicate failure on an ACTUAL
# spec-creation call denies.
#
# Honors LORE_GATE_BYPASS=1 (same escape hatch `lore gate` itself reads) —
# short-circuits to allow before touching stdin at all.
#
# ⛔ Allow-path is PULL-ONLY, not push (§5.4 research finding, P4 T4): on the "allow"
# verdict this shim only ever emits {hookEventName, permissionDecision:"allow"} — it
# does NOT (and structurally cannot) attach the governing skill's rule slice as
# `hookSpecificOutput.additionalContext`. Official Claude Code docs (Tier S:
# code.claude.com/docs/en/hooks, "Decision control" table, fetched 2026-07-09) scope
# PreToolUse's hookSpecificOutput to exactly `{permissionDecision,
# permissionDecisionReason}` — additionalContext is documented there for
# SessionStart/Setup/SubagentStart/Stop/SubagentStop/PostToolUse, explicitly NOT for
# PreToolUse. A second, independently-cached reference agrees (identical note in
# `../packages/lore/src/adapters/cli/commands/gate.ts::runSpecCreateGate`). So there
# is no transport for a proactive push on a clean pass here, by design — `lore feed
# spec-create` (P4 T2) is the ONE guaranteed feed-before-produce surface: an agent
# PULLS the governing skill ahead of writing rather than the gate pushing it on
# allow. This does not change the allow verdict this shim already emits.

set -u # deliberately NOT `set -e`: every failure path below must fall through to allow

log() { printf 'g1-spec-create: %s\n' "$1" >&2; }

allow() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}\n'
  exit 0
}

# $1 = reason text (verbatim `lore gate spec-create` stdout, the feeding pack).
deny_with_reason() {
  if command -v jq >/dev/null 2>&1; then
    jq -n --arg reason "$1" \
      '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$reason}}'
    exit 0
  fi
  # jq disappeared between the earlier presence check and here — fail open
  # rather than hand-roll unescaped JSON that could itself be malformed.
  log "jq unavailable at deny-time — failing open instead of risking malformed JSON"
  allow
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

REPO_ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
LORE_BIN="$REPO_ROOT/dist/lore"
TARGET_CWD="${HOOK_CWD:-$REPO_ROOT}"

if [ ! -x "$LORE_BIN" ]; then
  log "lore binary not found/executable at $LORE_BIN — failing open"
  allow
fi

PAYLOAD=""

case "$TOOL_NAME" in
  Bash)
    COMMAND="$(printf '%s' "$STDIN_JSON" | jq -r '.tool_input.command // empty')"

    # Word-boundary check: "lore" preceded by start-of-string/slash/space, followed
    # by "create spec" as its own tokens. Avoids matching e.g. "explore create spec".
    if ! printf '%s' "$COMMAND" | grep -Eq '(^|[/[:space:]])lore[[:space:]]+create[[:space:]]+spec([[:space:]]|$)'; then
      allow
    fi

    # Best-effort flag extraction: double-quoted, single-quoted, then bare-token
    # value, in that priority order. Values that don't parse (complex shell
    # quoting/escaping) come back empty — the gate call still runs with whatever
    # WAS extracted, and its own predicates surface the right violation (e.g.
    # MISSING_SKELETON for an unrecovered --content). This is intentionally NOT a
    # full shell-word parser — see task note "提取不确定时优先 MCP 结构化路径".
    extract_flag() {
      local flag="$1" val
      val="$(printf '%s' "$COMMAND" | sed -nE "s/.*--${flag}[[:space:]]+\"([^\"]*)\".*/\\1/p")"
      if [ -n "$val" ]; then printf '%s' "$val"; return; fi
      val="$(printf '%s' "$COMMAND" | sed -nE "s/.*--${flag}[[:space:]]+'([^']*)'.*/\\1/p")"
      if [ -n "$val" ]; then printf '%s' "$val"; return; fi
      val="$(printf '%s' "$COMMAND" | sed -nE "s/.*--${flag}[[:space:]]+([^[:space:]]+).*/\\1/p")"
      printf '%s' "$val"
    }

    TITLE="$(extract_flag title)"
    PARENT="$(extract_flag parent)"
    KIND="$(extract_flag kind)"
    CONTENT="$(extract_flag content)"
    CONTENT_FILE="$(extract_flag content-file)"

    if [ -z "$CONTENT" ] && [ -n "$CONTENT_FILE" ]; then
      if [ -r "$TARGET_CWD/$CONTENT_FILE" ]; then
        CONTENT="$(cat "$TARGET_CWD/$CONTENT_FILE" 2>/dev/null || true)"
      elif [ -r "$CONTENT_FILE" ]; then
        CONTENT="$(cat "$CONTENT_FILE" 2>/dev/null || true)"
      else
        # UNRESOLVED_CONTENT_FILE (fail-honest > fail-confusing): the command
        # declared a --content-file this shim cannot read — typically the path
        # contains an unexpanded shell variable (the hook sees the raw command
        # string, never the shell's expansion). Running the gate with empty
        # content would emit a misleading MISSING_SKELETON deny against a
        # possibly fully-conformant spec. Fail open instead: the service-layer
        # GateEnforcer re-runs the SAME predicates on the REAL resolved
        # content, so nothing goes ungated.
        log "UNRESOLVED_CONTENT_FILE: cannot read --content-file '$CONTENT_FILE' (unexpanded shell variable in the path?) — failing open; service-layer GateEnforcer still gates the real content"
        allow
      fi
    fi

    PAYLOAD="$(jq -n --arg title "$TITLE" --arg parent "$PARENT" --arg kind "$KIND" --arg content "$CONTENT" '
      {type: "spec", title: $title}
      | if $parent  != "" then . + {parent_id: $parent} else . end
      | if $content != "" then . + {content: $content} else . end
      | if $kind    != "" then . + {extra: {spec_kind: $kind}} else . end
    ')"
    ;;
  *lore_create*)
    INPUT_TYPE="$(printf '%s' "$STDIN_JSON" | jq -r '.tool_input.type // empty')"
    if [ "$INPUT_TYPE" != "spec" ]; then
      allow
    fi
    # MCP tool_input is already lore_create's structured shape — pass through
    # untouched (gateSpecCreateInputSchema is .passthrough(), it only reads the
    # subset it needs).
    PAYLOAD="$(printf '%s' "$STDIN_JSON" | jq -c '.tool_input')"
    ;;
  *)
    allow
    ;;
esac

if [ -z "$PAYLOAD" ]; then
  log "could not build a gate payload from the tool call — failing open"
  allow
fi

GATE_OUTPUT="$(cd "$TARGET_CWD" 2>/dev/null && "$LORE_BIN" gate spec-create --input-json "$PAYLOAD" 2>/dev/null)"
GATE_EXIT=$?

case "$GATE_EXIT" in
  0) allow ;;
  4) deny_with_reason "$GATE_OUTPUT" ;;
  *)
    log "lore gate spec-create exited $GATE_EXIT (undocumented verdict) — failing open"
    allow
    ;;
esac
