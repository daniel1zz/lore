#!/usr/bin/env node
/**
 * session-start-resume.mjs — SessionStart hook.
 *
 * Phase C: REMOVED (spec-context-fragments-config-driven-layered-rule-injection
 *          D6). The governance prose (`lore governance`, formerly injected
 *          here) now ships as context fragments under assets/context/
 *          rendered into the project CLAUDE.md Z1 by `lore context refresh`
 *          (run by `lore setup --project`); dynamic fragments come from the
 *          SECOND SessionStart hook, `session-start-fragments.mjs`, so each
 *          hook string stays under the 10,000-char cap on its own. Phase
 *          letters D-F are kept unchanged so cross-references stay valid.
 * Phase D: linked-worktree seat detection (SPEC-047) — auto-injects the
 *          seat-briefing discipline block for sessions opened inside a
 *          linked git worktree of a lore-governed repo. SPEC-085 D2: the
 *          template source is now the RUNTIME `lore governance
 *          --seat-briefing` verb (the SAME resolved binary Phase C/E spawn),
 *          never an installed file snapshot — the pre-SPEC-085 two-candidate
 *          lookup (`<claude-dir>/governance/seat-briefing.md`, then
 *          `<main-checkout>/assets/governance/seat-briefing.md`) is retired
 *          along with the install-set entry (D3). Placeholder substitution
 *          and the fail-open contract are unchanged.
 * Phase E: lore bootstrap injection (corpus-global state snapshot, when the
 *          resolved corpus root — main checkout for a linked worktree, cwd
 *          otherwise — has .lore/). SPEC-080 D3, strengthened by
 *          spec-context-provenance-injected-corpus-global-state-and-a D2 —
 *          this hook is a BLIND PIPE, now via TWO independent spawns of the
 *          SAME resolved binary rather than one mixed stream:
 *            (E-a) `lore governance bootstrap-framing` — the scope-boundary
 *                  line (`BOOTSTRAP_FRAMING_LINE`, `@lore/core`), fetched
 *                  EXACTLY the same way Phase C fetches its own topic and
 *                  Phase D fetches `seat-briefing`. Fail-open, same contract
 *                  as those two phases: a missing binary, non-zero exit, or
 *                  empty stdout leaves this line absent — never a
 *                  degradation entry (advisory framing, not the payload).
 *            (E-b) `lore bootstrap --injection` — UNCHANGED from before D2:
 *                  bare compact JSON, nothing else, on stdout (SPEC-080
 *                  AC-080-3's documented public CLI contract — a `| jq`
 *                  consumer never sees a prose line prepended to its JSON).
 *          The two are composed as ONE rendered block: E-a's line OUTSIDE
 *          the markdown fence (the position the hook's own retired header
 *          used to occupy), E-b's JSON INSIDE it. This hook still never
 *          parses, re-serializes, or inspects either spawn's output — it
 *          relays each verbatim and only decides WHERE the seam between them
 *          goes, never what either side contains. (An earlier draft of this
 *          hook printed the framing line as `bootstrap --injection`'s own
 *          stdout line 1, requiring this hook to split one stream at a
 *          newline — REJECTED: it broke SPEC-080 AC-080-3's bare-JSON
 *          contract and made the hook parse-adjacent instead of purely
 *          blind. Two spawns, two verbatim relays, is strictly the stronger
 *          blind pipe.) `INJECTION_BACKSTOP_CAP` (12000 chars) remains a
 *          pure safety backstop on E-b's JSON stdout alone (never E-a's much
 *          shorter framing line) — the projection is already char-budgeted
 *          binary-side, so exceeding this cap signals a binary-side bug. On
 *          overflow the hook drops the ENTIRE composed block (framing line
 *          included, even if E-a already succeeded) rather than slicing
 *          stdout, and records a degradation entry naming the observed
 *          length — a scope-boundary line with no data below it to bound
 *          would be misleading, not merely incomplete.
 * Phase F: session-start advisory — cache-first asset-freshness check
 *          (SPEC-076 §C6). Reads `<claude-dir>/.lore-setup-check.json`
 *          (written by `lore setup --check`, T4 of SPEC-076) — a fresh
 *          (<24h) `sync` cache injects nothing, a fresh `stale` cache injects
 *          exactly one advisory line, and a missing/expired/corrupted cache
 *          fires a DETACHED, UNREF'D `lore setup --check --json` refresh
 *          (never awaited — this session gets nothing, the NEXT session may
 *          see a fresh cache). `LORE_SETUP_NO_CHECK=1` is a hard kill-switch
 *          checked BEFORE any cache read.
 *
 *          Known gap (documented, not silently dropped): SPEC-076 §C6's
 *          illustrative advisory text shows "(binary X / installed Y)", but
 *          the ACTUAL `SetupCheckCache` shape (`adapters/cli/setup-check.ts`,
 *          §C6 Downstream Handoff) carries only the CURRENTLY-RUNNING
 *          binary's own `binary_version` — no separate "installed" version
 *          field exists in the cache. This phase renders what the cache
 *          actually contains (`binary_version` + stale-file counts) rather
 *          than inventing a phantom installed-version field.
 *
 *          `setup.check_reminder` (`packages/core/src/config.ts`, default
 *          true) is enforced end-to-end as of task task-skill-implement-t8b:
 *          this standalone installed hook script still never parses
 *          `.lore/config.yaml` itself (no guaranteed local `node_modules`,
 *          so no `yaml` parser reachable) — instead the CLI-side write path
 *          (`adapters/cli/setup-check.ts::resolveCheckReminderEnabled`)
 *          resolves the config and stamps `reminder_enabled: false` onto the
 *          cache when the reminder is disabled; this phase just honors that
 *          field (`cache.reminder_enabled === false` → suppress, same as the
 *          `LORE_SETUP_NO_CHECK=1` kill-switch but per-config instead of
 *          per-env-var). A cache with NO `reminder_enabled` field (legacy,
 *          or the reminder enabled) behaves byte-identically to before this
 *          task — fail-open on absence.
 *
 * Bootstrap is hook-injected (was lazy-loaded by AI). Rationale: SessionStart
 * is low-frequency, `lore bootstrap` is a slim progressive-disclosure pointer
 * set, 100% delivery rate beats AI self-trigger (~70-90%).
 *
 * Graceful degradation — a missing lore binary or corpus must never block
 * session start. Projects without .lore/ simply get no bootstrap block.
 * Phase D follows the same rule: any git/fs error there must never block
 * session start — it silently produces no seat block and the rest of the
 * hook runs exactly as if this were a main-checkout session (g1-hook
 * fail-open precedent). Phase F follows the SAME rule (I6 fail-open) — any
 * fs/JSON/spawn error there must never block or crash session start.
 */

import {
  existsSync, readFileSync, readdirSync, rmSync, statSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync, spawn } from 'node:child_process';
import { resolveSessionId } from './lib/turn-state.mjs';

// No longer read for a roster (removed 2026-07-17 — harness lists agents
// natively); retained because Phase D derives <claude-dir> as its dirname,
// and CLAUDE_AGENTS_DIR_OVERRIDE keeps tests hermetic.
const AGENTS_DIR = process.env.CLAUDE_AGENTS_DIR_OVERRIDE
  || join(homedir(), '.claude', 'agents');
const SESSION_STATE_BASE = process.env.CLAUDE_STATE_BASE_OVERRIDE
  || join(homedir(), '.claude', 'session-state');
// SPEC-080 D3 — a pure safety backstop on the ALREADY char-budgeted tier-1
// injection payload (`buildBootstrapInjection`, `@lore/core`), never a
// second truncation policy: exceeding it means the binary side is not
// honoring its own budget, so the hook drops the whole block rather than
// mid-JSON-slicing (which would violate the projection contract's
// no-mid-JSON-slice rule at this layer too).
const INJECTION_BACKSTOP_CAP = 12000;

// Phase F (SPEC-076 §C6) — cache filename is a DELIBERATE literal duplicate of
// `adapters/cli/setup-check.ts`'s private `CHECK_CACHE_FILENAME` constant of
// the same value: that module owns the write side, this hook only ever reads
// it, and the two live in physically separate deployable artifacts (compiled
// binary vs. standalone installed .mjs file) with no shared import surface —
// same "deliberate literal duplicate" precedent `setup-check.ts`'s own module
// doc documents for `MANIFEST_FILENAME`.
const SETUP_CHECK_CACHE_FILENAME = '.lore-setup-check.json';
// 24h — SPEC-076 §C6/D4: the timestamp only gates *when* to recheck; the
// truth of "sync vs stale" always comes from the cache's own `status` field
// (oh-my-zsh lesson named explicitly in the spec), never re-derived here.
const SETUP_CHECK_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function emit(additionalContext) {
  if (!additionalContext) {
    process.stdout.write('{}');
    process.exit(0);
  }
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext },
  }));
  process.exit(0);
}

// ── Clear stale autopilot lock ─────────────────────────────────────
const sessionId = resolveSessionId();
const lockFile = join(SESSION_STATE_BASE, 'sessions', sessionId, 'autopilot.lock');
try { if (existsSync(lockFile)) rmSync(lockFile); } catch {}

// ── GC: sweep session-state dirs idle > 14 days ────────────────────
// Turn-state marks (read/edit jsonl + per-turn dirs) accumulate one dir per
// turn with NO other reclaimer (observed 2026-07-17: 37MB / 1146 dirs).
// Old sessions are worthless — sweep at session start, fail-silent, never
// touching the CURRENT session's dir.
try {
  const sessionsRoot = join(SESSION_STATE_BASE, 'sessions');
  if (existsSync(sessionsRoot)) {
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    for (const name of readdirSync(sessionsRoot)) {
      if (name === sessionId) continue;
      const dir = join(sessionsRoot, name);
      try {
        if (statSync(dir).mtimeMs < cutoff) rmSync(dir, { recursive: true, force: true });
      } catch { /* skip entry */ }
    }
  }
} catch { /* GC is best-effort — must never block session start */ }

// ── Degradation tracker — critical component failures only ────────
const degradations = [];

// ── Phase D: linked-worktree seat detection (SPEC-047) ─────────────
// A linked worktree's `.git` is a file pointing at a per-worktree gitdir
// under the MAIN checkout's `.git/worktrees/<name>`; `--git-common-dir`
// always resolves to the main checkout's real `.git` directory while
// `--git-dir` resolves to the per-worktree one — they differ iff cwd is a
// linked worktree (identical in the main checkout, and in a non-worktree
// repo). Detection is pure environment inference: no new state, no config,
// mirrors SPEC-042's "derived, never stored" session ethos.
let seatBlock = '';
let bootstrapCwd = process.cwd();
// SPEC-057 AC-S-4 — the resolved seat/worktree branch, threaded onto Phase E's
// `lore bootstrap` spawn as `--seat-branch <branch>` so SessionService can scope
// resume_hint to this worktree's seat plan. Stays `null` for a main-checkout
// session (bootstrapCwd never redirects) — Phase E's spawn args stay
// byte-unchanged in that case (REGRESSION, AC-S-4).
let seatBranchForBootstrap = null;
try {
  const commonDirRaw = spawnSync('git', ['rev-parse', '--git-common-dir'], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 5000,
  });
  const gitDirRaw = spawnSync('git', ['rev-parse', '--git-dir'], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 5000,
  });
  if (commonDirRaw.status === 0 && gitDirRaw.status === 0
      && commonDirRaw.stdout && gitDirRaw.stdout) {
    const commonDirAbs = resolve(process.cwd(), commonDirRaw.stdout.trim());
    const gitDirAbs = resolve(process.cwd(), gitDirRaw.stdout.trim());
    if (commonDirAbs !== gitDirAbs) {
      // Linked worktree. The main checkout is the common gitdir's parent.
      const mainCheckout = dirname(commonDirAbs);
      if (existsSync(join(mainCheckout, '.lore'))) {
        bootstrapCwd = mainCheckout; // corpus lives at the main checkout, not here

        let branch = '';
        const branchRaw = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
          cwd: process.cwd(), encoding: 'utf8', timeout: 5000,
        });
        if (branchRaw.status === 0 && branchRaw.stdout) branch = branchRaw.stdout.trim();
        if (!branch || branch === 'HEAD') {
          // Detached HEAD (or resolution failure) — fall back to a short-sha slug.
          const shaRaw = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
            cwd: process.cwd(), encoding: 'utf8', timeout: 5000,
          });
          const shortSha = shaRaw.status === 0 && shaRaw.stdout ? shaRaw.stdout.trim() : 'unknown';
          branch = `worktree-${shortSha}`;
        }

        // SPEC-057 AC-S-4 — threaded onto Phase E's `lore bootstrap --seat-branch`
        // below. Set for EVERY linked-worktree session with a resolved corpus root,
        // including the detached-HEAD synthetic `worktree-<shortsha>` label —
        // SessionService.bootstrap's own `parseSeatBranch` resolves that as
        // unresolvable and degrades to corpus-global + `seat_unresolved: true`,
        // never this hook's job to pre-filter.
        seatBranchForBootstrap = branch;

        const actorSlug = branch
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
        const actor = `agent:${actorSlug}`;

        // SPEC-085 D2 — source is now the RUNTIME `lore governance --seat-briefing`
        // verb (never an installed file snapshot under `<claude-dir>/governance/`
        // or the worktree's `assets/governance/`, both retired from the install
        // set by D3). Same binary Phase C/E already spawn as bare `'lore'`, same
        // invocation shape (`cwd: mainCheckout` — the corpus root Phase D just
        // resolved). Fail-open: a missing binary (ENOENT), non-zero exit, or
        // empty stdout leaves `seatBlock` at its initial `''` and prints a
        // same-shaped stderr notice — identical fail-open contract to the
        // pre-SPEC-085 missing-file case, never blocks session start.
        let briefingTemplate = '';
        try {
          const briefingResult = spawnSync('lore', ['governance', '--seat-briefing'], {
            cwd: mainCheckout,
            encoding: 'utf8',
            timeout: 5000,
          });
          if (briefingResult.status === 0 && typeof briefingResult.stdout === 'string'
              && briefingResult.stdout.length > 0) {
            briefingTemplate = briefingResult.stdout;
          }
        } catch { /* fail-open — seat-briefing injection must never block session start */ }

        if (briefingTemplate) {
          seatBlock = briefingTemplate
            .split('{{ACTOR}}').join(actor)
            .split('{{BRANCH}}').join(branch)
            .split('{{MAIN_CHECKOUT}}').join(mainCheckout);
        } else {
          process.stderr.write(
            'session-start-resume: linked worktree detected but seat-briefing unavailable '
            + "from binary ('lore governance --seat-briefing' failed or returned empty); "
            + 'skipping seat injection\n',
          );
        }
      }
    }
  }
} catch {
  // Fail-open — any git/fs error here must never block session start.
}

// ── Phase E: lore bootstrap injection ──────────────────────────────
// Corpus-global state snapshot (root doc, active plans + task counts,
// pending reviews, active sessions, stale candidates). Only when the
// resolved corpus root (main checkout for a linked worktree, cwd
// otherwise) has .lore/.
let bootstrapBlock = '';
if (existsSync(join(bootstrapCwd, '.lore'))) {
  // Phase E-a: the scope-boundary framing line
  // (spec-context-provenance-injected-corpus-global-state-and-a D2) — spawns
  // `lore governance bootstrap-framing`, the SAME resolved binary and the
  // SAME verb Phase C/D already spawn for their own topics. Fail-open,
  // IDENTICAL contract to those two phases: a missing binary, non-zero
  // exit, or empty stdout leaves `framingLine` at `''` and the JSON-only
  // block below still renders — this is advisory framing describing the
  // payload, not the payload itself, so its own absence is never
  // degradation-worthy on its own (mirrors Phase C's `workflowBlock`, which
  // also pushes no degradation entry on failure).
  let framingLine = '';
  try {
    const framingResult = spawnSync('lore', ['governance', 'bootstrap-framing'], {
      cwd: bootstrapCwd,
      encoding: 'utf8',
      timeout: 5000,
    });
    if (framingResult.status === 0 && typeof framingResult.stdout === 'string'
        && framingResult.stdout.length > 0) {
      framingLine = framingResult.stdout;
    }
  } catch { /* fail-open — framing-line injection must never block session start */ }

  // Phase E-b: the bootstrap --injection JSON payload — UNCHANGED single-stream
  // contract (SPEC-080 D3, AC-080-3): bare compact JSON, nothing else, on
  // stdout. Blind pipe — this hook never parses, re-serializes, or inspects
  // a single field.
  // SPEC-057 AC-S-4 — `--seat-branch <branch>` is appended ONLY for a linked-worktree
  // session with a resolved corpus root (`seatBranchForBootstrap` non-null); a
  // main-checkout session's spawn args stay byte-unchanged (REGRESSION).
  const bootstrapArgs = ['bootstrap', '--injection'];
  if (seatBranchForBootstrap !== null) {
    bootstrapArgs.push('--seat-branch', seatBranchForBootstrap);
  }
  const r = spawnSync('lore', bootstrapArgs, {
    cwd: bootstrapCwd,
    encoding: 'utf8',
    timeout: 10000,
    env: { ...process.env, CLAUDECODE: '1' }, // agent surface → AI defaults off (SPEC-024)
  });
  const stdout = r.status === 0 && typeof r.stdout === 'string' ? r.stdout.trim() : '';
  if (stdout) {
    if (stdout.length > INJECTION_BACKSTOP_CAP) {
      // Drops the ENTIRE composed block — including a successfully-fetched
      // `framingLine` — never just the JSON half. A scope-boundary line with
      // no data below it to bound would be misleading, not merely
      // incomplete, so E-a's own success buys it no separate survival here.
      degradations.push({
        component: 'lore bootstrap',
        reason: `injection payload ${stdout.length} chars exceeds ${INJECTION_BACKSTOP_CAP} backstop `
          + '— binary-side bug, run `lore setup` / investigate',
      });
    } else {
      // D2 placement: the framing line goes OUTSIDE the markdown fence —
      // exactly where this hook's own retired header used to sit — and the
      // JSON payload stays INSIDE it, fence language tag restored to `json`
      // now that the fenced content is strictly JSON again.
      const fence = `\`\`\`json\n${stdout}\n\`\`\``;
      bootstrapBlock = framingLine ? `${framingLine}\n\n${fence}` : fence;
    }
  } else {
    const reason = r.error?.code === 'ENOENT'
      ? 'lore binary not on PATH (expected: symlink of <lore-repo>/dist/lore)'
      : `lore bootstrap failed (exit ${r.status ?? 'signal'}): ${(r.stderr || '').slice(0, 200)}`;
    degradations.push({ component: 'lore bootstrap', reason });
  }
}

// ── Degradation report — only for critical component failures ─────
let degradationBlock = '';
if (degradations.length > 0) {
  const seen = new Set();
  const unique = degradations.filter(d => {
    if (seen.has(d.component)) return false;
    seen.add(d.component);
    return true;
  });
  const items = unique.map(d => `- **${d.component}**: ${d.reason}`).join('\n');
  degradationBlock = `## ⚠️ Degradation Report

Critical hook component(s) unavailable this session. Some workflow features may be reduced:

${items}

Action: Check installation. Non-critical features are unaffected.`;
}

// ── Phase F: session-start advisory — cache-first freshness (SPEC-076 §C6) ─
// See this file's module-header "Phase F" note for the full contract,
// including the documented `setup.check_reminder` config-knob gap.

/**
 * Fires a DETACHED, UNREF'D `lore setup --check --json` refresh — never
 * awaited, never blocks this session. `--claude-dir` is passed explicitly
 * (rather than relying on the child's own `$CLAUDE_CONFIG_DIR`/`~/.claude`
 * default resolution) so the refresh always targets the SAME directory this
 * phase read the cache from, including under a test's
 * `CLAUDE_AGENTS_DIR_OVERRIDE`. An 'error' listener is attached so a missing
 * `lore` binary (ENOENT) surfaces as a swallowed async event instead of an
 * unhandled 'error' throw — fail-open (I6), mirrors every other phase in
 * this hook.
 */
function spawnSetupCheckRefresh(claudeDir) {
  try {
    const child = spawn('lore', ['setup', '--check', '--json', '--claude-dir', claudeDir], {
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', () => {});
    child.unref();
  } catch {
    // Fail-open — spawn() throwing synchronously (rare) must never block session start.
  }
}

let advisoryBlock = '';
try {
  if (process.env.LORE_SETUP_NO_CHECK !== '1') {
    const claudeDir = dirname(AGENTS_DIR);
    const cachePath = join(claudeDir, SETUP_CHECK_CACHE_FILENAME);

    let cache = null;
    if (existsSync(cachePath)) {
      try {
        cache = JSON.parse(readFileSync(cachePath, 'utf8'));
      } catch {
        cache = null; // corrupted JSON — treated as unusable below, never throws
      }
    }

    const isValidCache = cache !== null && typeof cache === 'object'
      && typeof cache.checked_at === 'string'
      && typeof cache.binary_version === 'string'
      && (cache.status === 'sync' || cache.status === 'stale');

    if (!isValidCache) {
      // Missing file, corrupted JSON, or a shape that doesn't match
      // SetupCheckCache — all treated identically: fire a background refresh,
      // inject nothing THIS session (never wait for it).
      spawnSetupCheckRefresh(claudeDir);
    } else {
      const ageMs = Date.now() - Date.parse(cache.checked_at);
      const fresh = Number.isFinite(ageMs) && ageMs >= 0 && ageMs < SETUP_CHECK_CACHE_TTL_MS;
      if (!fresh) {
        spawnSetupCheckRefresh(claudeDir);
      } else if (cache.status === 'stale' && cache.reminder_enabled !== false) {
        // `cache.reminder_enabled === false` is written ONLY when the team's
        // `setup.check_reminder` config resolved to false (setup-check.ts's
        // resolveCheckReminderEnabled); a legacy cache with no such field
        // falls through this check unaffected (fail-open, REGRESSION-safe).
        const counts = cache.stale_counts;
        const countsNote = counts && typeof counts === 'object'
          ? `${(counts.outdated ?? 0) + (counts.diverged ?? 0) + (counts.missing ?? 0)} file(s), binary ${cache.binary_version}`
          : `binary ${cache.binary_version}`;
        advisoryBlock = `⚠ lore assets outdated (${countsNote}) — run \`lore setup\``;
      }
      // fresh + sync, OR fresh + stale with reminder_enabled === false →
      // advisoryBlock stays '' (0 bytes, 0 spawn)
    }
  }
} catch {
  // Fail-open (I6) — any fs/JSON error here must never block or crash session start.
}

// ── Compose (order: seat → bootstrap → degradation → advisory) ─
const parts = [seatBlock, bootstrapBlock, degradationBlock, advisoryBlock].filter(Boolean);
emit(parts.join('\n\n'));
