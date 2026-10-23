#!/usr/bin/env node
/**
 * session-start-marker.mjs — SessionStart hook.
 *
 * Purpose: record THIS session's start time as a stored fact
 * (task-verifying-a-handoff-you-just-authored-arms-the-coverage D1). No
 * such fact existed anywhere before this task — a "session" in this
 * codebase is DERIVED, never stored (SPEC-042 D1), and the one genuine
 * session boundary that DOES exist (the Claude Code transcript's own
 * per-entry timestamps) is reachable only from a Stop-hook's own process
 * (the removed `lore handoff coverage-check`), not from `lore feed session-resume`
 * (a separate, earlier-in-the-session process). This hook closes that gap
 * with the smallest possible new fact: a tiny, session-scoped marker file.
 *
 * `packages/lore/src/flows/feed-flow.ts::buildResumeFeed` reads this marker
 * (via its own `readSessionStartIso`) to decide whether a resumed handoff
 * was authored DURING the currently-arming session — narrowing WHEN the
 * resume-ticket coverage floor (RESUME_COVERAGE_FLOOR, `@lore/core`) arms,
 * so a session verifying the ticket it JUST wrote for its own successor is
 * no longer charged with the very next-steps it is explicitly handing off.
 *
 * Session identity: `CLAUDE_CODE_SESSION_ID`/`CLAUDE_SESSION_ID` — the SAME
 * precedence `@lore/core/node`'s `resolveActorWithSource` already trusts for
 * cross-process session identity. Docs (code.claude.com/docs/en/env-vars):
 * `CLAUDE_CODE_SESSION_ID` is set in Bash-tool AND hook subprocesses and "matches
 * the `session_id` field in the hook JSON input", so this writer and the
 * `lore feed` reader (a Bash child) resolve the SAME id. Writer and reader MUST
 * stay on this one env precedence (pinned by turn-state-producers.test.ts).
 * `./lib/turn-state.mjs::resolveSessionId(payload)` (payload `session_id`, no env
 * fallback) is the turn-state hooks' resolver; it has no CLI-side equivalent, so
 * this marker does not use it.
 *
 * Location: `os.tmpdir()`, filename
 * `lore-session-start-<sanitized-session-id>.json` — a DELIBERATE literal
 * duplicate of `@lore/core`'s `sessionStartMarkerFilename` (session.ts).
 * This standalone installed `.mjs` script has no `@lore/core` import (every
 * hook in this repo's registered set is self-contained,
 * `packages/core/src/distribution-hooks.ts`'s own module doc) — mirrors the
 * SAME precedent `session-start-resume.mjs` documents for
 * `SETUP_CHECK_CACHE_FILENAME`: one module owns the write/read side that
 * imports the real function, this hook owns the OTHER write side, and the
 * two are reviewed together, never independently re-derived.
 *
 * Idempotent: the FIRST write for a given session id wins — never
 * overwritten. A SessionStart hook can legitimately re-fire within one
 * session (compaction, `--continue`); re-stamping `started_at` on a later
 * fire would silently move the session's origin forward and defeat the
 * whole predicate (a genuinely earlier-session handoff would then look
 * "created after my session started").
 *
 * Fail-open (matches every hook in this registered set,
 * `distribution-hooks.ts`'s own module doc): an absent/blank session id, or
 * any fs error, is silently skipped — this hook NEVER blocks or delays
 * session start, and writes nothing to stdout/stderr on any path (there is
 * no `additionalContext` to inject; this hook's only side effect is the
 * marker file).
 *
 * Public surface: none. Executable script with no exports.
 * Side-effect class: IO — reads `process.env`, writes (at most) one small
 *   JSON file under `os.tmpdir()`.
 *
 * @spec_ref task-verifying-a-handoff-you-just-authored-arms-the-coverage D1
 */

import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// reason: DELIBERATE literal duplicate of `@lore/core`'s
// `sessionStartMarkerFilename` (packages/core/src/session.ts) — see this
// file's own module header for why a shared import isn't possible here.
function markerFilename(sessionId) {
  return `lore-session-start-${sessionId.replace(/[^A-Za-z0-9._-]/g, '-')}.json`;
}

try {
  const sessionId = process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_SESSION_ID;
  if (sessionId && sessionId.trim().length > 0) {
    const markerPath = join(tmpdir(), markerFilename(sessionId));
    // Idempotent: never overwrite an existing marker — the FIRST fire for
    // this session id is this session's true origin.
    if (!existsSync(markerPath)) {
      writeFileSync(markerPath, JSON.stringify({ started_at: new Date().toISOString() }), 'utf8');
    }
  }
} catch {
  // Fail-open — any fs/env error here must never block or crash session start.
}

process.exit(0);
