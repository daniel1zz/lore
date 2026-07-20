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

# ─── BUG-014 fix: constrain --content-file to safe path prefixes ────────────
# extract_flag (below) returns the RAW --content-file value from the Bash
# command string with zero shell-quoting/escaping awareness. Without a path
# constraint, an agent coaxed into e.g. `lore create spec --content-file
# ~/.ssh/id_rsa` would have this shim `cat` an arbitrary readable file into
# the gate payload BEFORE the real write — and on a gate deny, that content
# is echoed back verbatim in the deny reason. Legitimate usage (CLAUDE.md
# dogfood discipline: "pass literal absolute paths") only ever needs paths
# inside the target corpus (TARGET_CWD) or a scratch dir (/tmp,
# /private/tmp, $TMPDIR — macOS resolves /var/folders/... to
# /private/var/folders/... under realpath; both forms are checked). A path
# that resolves outside every allowed prefix is NOT treated as a confirmed
# attack — many false positives are just wrong-corpus/relative-path corner
# cases — so this follows the file's existing fail-OPEN posture: log
# UNRESOLVED_CONTENT_FILE and let the service-layer GateEnforcer gate the
# REAL resolved content at write time, exactly like the pre-existing
# unreadable-path branch below. Symlinks are covered because `realpath`
# follows them: a repo-internal symlink pointing outside every allowed
# prefix resolves to its (disallowed) target before the prefix check runs.
resolve_realpath() {
  local p="$1"
  if command -v realpath >/dev/null 2>&1; then
    realpath "$p" 2>/dev/null
    return
  fi
  # No `realpath` on PATH (unexpected on Linux/macOS, kept as a portable
  # fallback): resolve via `cd` into the real directory + `pwd -P`, which
  # also collapses symlinked directory components.
  if [ -d "$p" ]; then
    (cd "$p" 2>/dev/null && pwd -P)
    return
  fi
  local dir base
  dir="$(dirname "$p")"
  base="$(basename "$p")"
  if [ -d "$dir" ]; then
    printf '%s/%s\n' "$(cd "$dir" 2>/dev/null && pwd -P)" "$base"
  fi
}

# $1 = a path already resolved via resolve_realpath (absolute, symlink-free).
# Returns success iff it falls under TARGET_CWD, /tmp, /private/tmp, or
# $TMPDIR (each independently realpath'd — a raw string-prefix compare would
# miss the /var/folders → /private/var/folders macOS TMPDIR alias).
is_content_file_path_allowed() {
  local resolved="$1" allowed_root
  for allowed_root in "$TARGET_CWD" /tmp /private/tmp "${TMPDIR:-}"; do
    [ -z "$allowed_root" ] && continue
    allowed_root="$(resolve_realpath "$allowed_root")"
    [ -z "$allowed_root" ] && continue
    case "$resolved" in
      "$allowed_root"/*|"$allowed_root") return 0 ;;
    esac
  done
  return 1
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

PAYLOAD=""

case "$TOOL_NAME" in
  Bash)
    COMMAND="$RAW_COMMAND"

    # SPEC-050 D4: command-position check (is_command_position_match above) —
    # "lore" preceded by start-of-segment/whitespace/path-prefix, followed by
    # "create spec" as its own tokens. Avoids matching e.g. "explore create
    # spec" AND avoids matching the phrase when it merely appears inside a
    # quoted argument value elsewhere in the command.
    if ! is_command_position_match "$COMMAND" '([^[:space:]]*/)?lore[[:space:]]+create[[:space:]]+spec([[:space:]]|$)'; then
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
      RESOLVED_CONTENT_FILE=""
      if [ -r "$TARGET_CWD/$CONTENT_FILE" ]; then
        RESOLVED_CONTENT_FILE="$(resolve_realpath "$TARGET_CWD/$CONTENT_FILE")"
      elif [ -r "$CONTENT_FILE" ]; then
        RESOLVED_CONTENT_FILE="$(resolve_realpath "$CONTENT_FILE")"
      fi

      if [ -n "$RESOLVED_CONTENT_FILE" ] && is_content_file_path_allowed "$RESOLVED_CONTENT_FILE"; then
        CONTENT="$(cat "$RESOLVED_CONTENT_FILE" 2>/dev/null || true)"
      else
        # UNRESOLVED_CONTENT_FILE (fail-honest > fail-confusing): the command
        # declared a --content-file this shim cannot read — either the path
        # contains an unexpanded shell variable (the hook sees the raw command
        # string, never the shell's expansion), OR it resolved to a path
        # outside every allowed prefix (BUG-014: TARGET_CWD / /tmp /
        # /private/tmp / $TMPDIR only — see is_content_file_path_allowed
        # above). Running the gate with empty content would emit a misleading
        # MISSING_SKELETON deny against a possibly fully-conformant spec, and
        # (for the disallowed-prefix case) reading the file at all risks
        # leaking its content into the gate's deny-reason echo. Fail open
        # instead, without ever populating CONTENT: the service-layer
        # GateEnforcer re-runs the SAME predicates on the REAL resolved
        # content at write time, so nothing goes ungated.
        log "UNRESOLVED_CONTENT_FILE: cannot read --content-file '$CONTENT_FILE' (unexpanded shell variable, unreadable, or outside allowed path prefixes: \$TARGET_CWD, /tmp, /private/tmp, \$TMPDIR) — failing open; service-layer GateEnforcer still gates the real content"
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
  4)
    # SPEC-050 D2: a declared parent the gate could not RESOLVE in
    # TARGET_CWD's corpus is a lookup anomaly, not a confirmed violation —
    # the command may be running against a DIFFERENT corpus than this shim
    # resolved (wrong TARGET_CWD, or a transient read). Fail open; the
    # service-layer GateEnforcer re-runs the SAME predicate against the REAL
    # resolved corpus at write time, so nothing goes ungated. A command that
    # declared NO parent at all keeps the deny — that PARENT_REQUIRED is a
    # real violation, resolvable without any corpus read.
    DECLARED_PARENT="$(printf '%s' "$PAYLOAD" | jq -r '.parent_id // empty' 2>/dev/null)"
    if [ -n "$DECLARED_PARENT" ] && printf '%s' "$GATE_OUTPUT" | grep -q 'PARENT_REQUIRED'; then
      log "UNRESOLVED_PARENT: declared parent '$DECLARED_PARENT' did not resolve against $TARGET_CWD's corpus — failing open; service-layer GateEnforcer still gates the real write"
      allow
    fi
    deny_with_reason "$GATE_OUTPUT"
    ;;
  *)
    log "lore gate spec-create exited $GATE_EXIT (undocumented verdict) — failing open"
    allow
    ;;
esac
