/**
 * `lore governance [topic]` — SPEC-083 D1 origin, extended by
 * spec-project-claude-md-content-contract-governance-injected §Design
 * Decisions D6 into a positional TOPIC REGISTRY: `seat-briefing` | `claude-md` |
 * `bootstrap-framing` (spec-context-provenance-injected-corpus-global-state-and-a
 * D2). Prints the resolved topic's governance prose verbatim to stdout, exit 0.
 *
 * RETIRED (spec-context-fragments-config-driven-layered-rule-injection D9,
 * amending SPEC-083): the `corpus-workflow` topic and the no-topic default that
 * used to serve it. Its prose now ships as static `main` fragments under
 * `assets/context/corpus-workflow-*.md`, delivered by `lore fragments render` and
 * the project CLAUDE.md Z1 `fragments` section. A retired-topic request (named, or
 * bare `lore governance`) exits 2 with stderr naming `lore fragments`
 * (`RETIRED_TOPIC_MESSAGE`); it never prints prose.
 *
 * Registry (topic → source):
 *   - `seat-briefing`              → file, `assets/governance/seat-briefing.md`
 *   - `claude-md`                  → file, `assets/governance/claude-md-contract.md`
 *   - `bootstrap-framing`          → IN-MEMORY constant, `BOOTSTRAP_FRAMING_LINE`
 *     (`@lore/core`) — the ONE topic with no backing asset file. It exists so
 *     the SessionStart hook's Phase E can obtain the bootstrap-injection
 *     scope-boundary line the SAME way Phase C/D already obtain their own
 *     topics (one spawned verb, zero installed-file drift surface), even
 *     though the line itself is a short constant rather than a governance
 *     document. `GOVERNANCE_TOPIC_ASSETS` deliberately has NO entry for this
 *     topic — `run()` special-cases it before ever touching `assetsRoot` or
 *     `readGovernanceAsset`.
 *
 * Legacy `--seat-briefing` boolean flag (SPEC-085 D1) is now a DEPRECATED
 * ALIAS for the positional form `lore governance seat-briefing` — same byte
 * output, PLUS exactly one deprecation line on stderr (D6). It stays
 * declared in `args` (not removed) so the SPEC-051/073 strict-flag seam
 * keeps accepting it with zero extra edits.
 *
 * Conflict handling (D6 — "More than one topic resolved... exit 2"): this
 * command resolves the FULL set of distinct topics requested across BOTH
 * input channels — every positional token actually passed (via `args._`,
 * the SAME "citty maps exactly one token per declared positional, but the
 * full raw list survives on `_`" mechanism `commands/anchor.ts`'s
 * `collectVariadicPositionals` documents) plus, when the legacy flag is set,
 * the literal `"seat-briefing"` topic. More than one DISTINCT topic in that
 * set (two differing positional tokens, or the flag conflicting with a
 * different positional) is a usage error — exit 2, message names every
 * distinct topic requested. This deliberately subsumes the "third boolean
 * flag" failure mode D6 rejects (`--seat-briefing --claude-md` used to
 * silently pick one) as a single distinct-topic-count check, not two
 * special-cased branches.
 *
 * Public surface: default export, a citty `CommandDef` with ONE optional
 * positional (`topic`) and the legacy boolean flag (no `--json` — the
 * payload IS text, per SPEC-083's D1 note).
 *
 * Bootstrap-stage exemption (mirrors `commands/setup.ts`'s own documented
 * exemption, `adapters/cli/CLAUDE.md`'s "Key Invariants" #4 — "Document the
 * exemption when adding a new bootstrap-stage command"): this command MUST
 * NOT import `loader.ts` / `bun:sqlite` / `loadLoreApp`. It needs no `.lore/`
 * corpus at all — the governance prose is a static asset shipped alongside
 * the binary, resolved from the binary's OWN assets root (never an installed
 * on-disk copy under `<claude-dir>/governance/`, which SPEC-083 D3 retires
 * from the machine install set). The session-start hook's Phase C (SPEC-083
 * D2) spawns this verb instead of reading that now-retired installed file,
 * so prose and binary version can never drift apart — this verb IS the fix
 * for that drift class.
 *
 * Path resolution reuses `setup-args.ts`'s `resolveAssetsRoot` — the SAME
 * realpath-resolved, compiled-vs-dev-mode derivation `lore setup` uses (see
 * that module's doc comment for the full empirically-verified chain). This
 * is deliberate: prose and binary ship from the same `assets/` tree next to
 * `dist/lore`, so this command and `lore setup` must never diverge on where
 * that tree lives.
 *
 * Invariants:
 *   - Never a silent empty print — an unreadable asset (missing file,
 *     permission error, nonexistent `assetsRoot`) surfaces as a
 *     `VALIDATION_ERROR` through the normal `exitCode()`/`formatError()`
 *     pipeline (exit 4), never a swallowed empty stdout. `bootstrap-framing`
 *     cannot hit this path at all — its content is a non-empty compile-time
 *     constant, not a file read that can fail.
 *   - stdout is written via `writeAllSync` (the SAME non-blocking-fd1-safe
 *     primitive `installSyncStdio()` wires onto `console.*`) with ZERO added
 *     bytes (no trailing newline injection) — the hook's byte-parity
 *     contract (AC-083-1: stdout byte-identical to the source file; for
 *     `bootstrap-framing`, byte-identical to the `BOOTSTRAP_FRAMING_LINE`
 *     constant, which itself carries no trailing newline — unlike every
 *     file-backed topic's asset) depends on this command never touching
 *     `console.log` (which appends `\n`).
 *   - A usage error (multi-topic conflict, unknown topic name) is written to
 *     stderr and exits 2 BEFORE any asset is read — never a partial print.
 *
 * Side-effect class: IO for the three file-backed topics (one synchronous
 *   file read via `node:fs`, one synchronous stdout write via `writeAllSync`,
 *   occasional stderr writes for deprecation/usage-error text) — no corpus,
 *   no network. `bootstrap-framing` is PURE plus the same stdout write (no
 *   file read at all).
 *
 * Source: SPEC-083 §Design Decisions D1;
 *   spec-project-claude-md-content-contract-governance-injected §Design
 *   Decisions D6;
 *   spec-context-provenance-injected-corpus-global-state-and-a §Design
 *   Decisions D2.
 */

import { readFileSync } from "node:fs";

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineLoreCommand } from "../cli-exit.js";
import { BOOTSTRAP_FRAMING_LINE, type LoreError } from "@lore/core";
import { resolveAssetsRoot, type SetupPathContext } from "../setup-args.js";
import { exitCode, formatError, formatErrorFor } from "../utils.js";
import { writeAllSync } from "../stdio-sync.js";
import { invocationOf } from "../command-invocation.js";

/** A registered `lore governance` topic name. */
type GovernanceTopic = "seat-briefing" | "claude-md" | "bootstrap-framing";

/**
 * The retired topic (spec-context-fragments-config-driven-layered-rule-injection D9).
 * A request for it — by name, or by bare `lore governance` (the old default) — is a
 * usage error pointing at `lore fragments`, never a prose print.
 */
const RETIRED_GOVERNANCE_TOPIC = "corpus-workflow";

/** stderr text for a retired-topic request (exit 2). Names `lore fragments` so the caller can migrate. */
const RETIRED_TOPIC_MESSAGE =
  "Error: the `corpus-workflow` governance topic is retired " +
  "(spec-context-fragments-config-driven-layered-rule-injection D9). " +
  "Its prose now ships as context fragments: run `lore fragments render` to read it, " +
  "or `lore context refresh` to write it into the project CLAUDE.md. " +
  "Remaining topics: seat-briefing, claude-md, bootstrap-framing.\n";

/**
 * Topic → repo-relative asset path registry (D6). SSOT for every FILE-BACKED
 * topic this command can serve; adding a file-backed topic means adding one
 * entry here. `bootstrap-framing` deliberately has NO entry — it resolves
 * from the in-memory `BOOTSTRAP_FRAMING_LINE` constant instead (see
 * `KNOWN_GOVERNANCE_TOPICS` for the full topic set including it).
 */
const GOVERNANCE_TOPIC_ASSETS: Record<Exclude<GovernanceTopic, "bootstrap-framing">, string> = {
  "seat-briefing": "governance/seat-briefing.md",
  "claude-md": "governance/claude-md-contract.md",
};

/**
 * Every registered topic name, file-backed or not — the SSOT for "is this a
 * known topic" (the unknown-topic error path) and for that error message's
 * listing. Kept separate from `GOVERNANCE_TOPIC_ASSETS` because that map's
 * keys are deliberately incomplete (it excludes `bootstrap-framing`).
 */
const KNOWN_GOVERNANCE_TOPICS: readonly GovernanceTopic[] = [
  "seat-briefing",
  "claude-md",
  "bootstrap-framing",
];

/** Type guard narrowing an arbitrary requested-topic string to a registered `GovernanceTopic`. */
function isKnownGovernanceTopic(topic: string): topic is GovernanceTopic {
  return (KNOWN_GOVERNANCE_TOPICS as readonly string[]).includes(topic);
}

/**
 * Deprecation line printed to stderr, EXACTLY once, when the legacy
 * `--seat-briefing` flag is used — never printed for the positional form.
 */
const SEAT_BRIEFING_FLAG_DEPRECATION_MESSAGE =
  "Deprecated: --seat-briefing is deprecated, use `lore governance seat-briefing` instead.";

// ─── Repo-root resolution (dev mode only — mirrors commands/setup.ts's own
// identical derivation verbatim: packages/lore/src/adapters/cli/commands/
// governance.ts -> repo root is 6 levels up. Compiled mode never uses this —
// `resolveAssetsRoot` branches on `isCompiled` and derives from `execPath`
// instead, same as `lore setup`.) ─────────────────────────────────────────
const MODULE_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(MODULE_DIR, "..", "..", "..", "..", "..", "..");

/**
 * Reads every positional argument actually passed on the command line
 * (citty maps exactly ONE token per declared `type: "positional"` arg,
 * `.shift()`-ing off a COPY of `parsed._` — the full raw list, including
 * every token beyond the first, survives untouched on `args._`; see
 * `commands/anchor.ts`'s `collectVariadicPositionals` for the same
 * mechanism documented against the same citty internals).
 *
 * @param args - The citty-parsed args object (proxies through to `parsed._`).
 * @returns Every positional token passed, in order (may be empty).
 */
function collectPositionalTopics(args: Record<string, unknown>): string[] {
  const all = (args as { _?: unknown[] })._ ?? [];
  return all.map(String);
}

/**
 * Resolves the set of distinct topics this invocation requested, across
 * both the positional token(s) and the legacy `--seat-briefing` flag.
 *
 * @param positionalTopics - Every positional token passed (from `args._`).
 * @param legacyFlag - Whether `--seat-briefing` was passed.
 * @returns Distinct topic strings requested, in first-seen order. Untyped —
 *   an entry may not be a registered `GovernanceTopic` (that validation
 *   happens after the conflict check, so an unknown-topic error message
 *   never gets shadowed by a spurious "multiple topics" message when only
 *   one bad token was actually passed).
 */
function resolveDistinctTopicsRequested(positionalTopics: string[], legacyFlag: boolean): string[] {
  const seen: string[] = [];
  for (const topic of positionalTopics) {
    if (!seen.includes(topic)) seen.push(topic);
  }
  if (legacyFlag && !seen.includes("seat-briefing")) seen.push("seat-briefing");
  return seen;
}

/**
 * Reads a governance asset's raw text off disk, given a resolved
 * `assetsRoot` (the SAME root `resolveAssetsRoot` computes for `lore setup`)
 * and a repo-relative path under it.
 *
 * @param assetsRoot - Absolute path to the repo's `assets/` tree.
 * @param relPath - Repo-relative path under `assetsRoot` to read.
 * @returns `{ok: true, value: <file contents>}`, or `{ok: false, error}`
 *   naming the unreadable path (never throws).
 * @throws Never.
 */
export function readGovernanceAsset(
  assetsRoot: string,
  relPath: string,
): { ok: true; value: string } | { ok: false; error: LoreError } {
  const assetPath = join(assetsRoot, relPath);
  try {
    return { ok: true, value: readFileSync(assetPath, "utf8") };
  } catch (cause) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: `lore governance: failed to read governance asset "${assetPath}": ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
        field: "assetsRoot",
        value: assetsRoot,
        rule: "BR-857",
      },
    };
  }
}

export default defineLoreCommand({
  meta: {
    name: "governance",
    description:
      "Print a governance prose topic verbatim to stdout — bootstrap-stage, no corpus required. " +
      "Topic registry: seat-briefing | claude-md (D6) | " +
      "bootstrap-framing (spec-context-provenance-injected-corpus-global-state-and-a D2). " +
      "--seat-briefing is a deprecated alias for the positional `seat-briefing` form (SPEC-085 D1).",
  },
  args: {
    topic: {
      type: "positional",
      description:
        "Governance topic to print: seat-briefing | claude-md | bootstrap-framing (corpus-workflow is retired: see `lore fragments`)",
      required: false,
    },
    "seat-briefing": {
      type: "boolean",
      description:
        "DEPRECATED — alias for the positional `seat-briefing` topic form (`lore governance seat-briefing`). " +
        "Still prints governance/seat-briefing.md verbatim, plus one deprecation line on stderr.",
      default: false,
    },
  },
  run(context): number {
    const { args } = context;
    const inv = invocationOf(context);
    const legacyFlag = args["seat-briefing"] === true;
    const positionalTopics = collectPositionalTopics(args);
    const distinctTopics = resolveDistinctTopicsRequested(positionalTopics, legacyFlag);

    if (distinctTopics.length > 1) {
      inv.io.stderr.write(
        `Error: lore governance accepts at most one topic (requested: ${distinctTopics.join(", ")})\n`,
      );
      return 2;
    }

    const requestedTopic = distinctTopics[0];
    let topic: GovernanceTopic;
    if (requestedTopic === undefined || requestedTopic === RETIRED_GOVERNANCE_TOPIC) {
      inv.io.stderr.write(RETIRED_TOPIC_MESSAGE);
      return 2;
    } else if (isKnownGovernanceTopic(requestedTopic)) {
      topic = requestedTopic;
    } else {
      const knownTopics = KNOWN_GOVERNANCE_TOPICS.join(", ");
      inv.io.stderr.write(
        `Error: unknown governance topic "${requestedTopic}" (known topics: ${knownTopics})\n`,
      );
      return 2;
    }

    // spec-context-provenance-injected-corpus-global-state-and-a D2 —
    // `bootstrap-framing` is the ONE topic with no backing asset file: it
    // serves the in-memory `BOOTSTRAP_FRAMING_LINE` constant directly, never
    // touching `assetsRoot` / `readGovernanceAsset` (there is nothing to fail
    // to read, so this branch can never reach the VALIDATION_ERROR path
    // below). The legacy-flag deprecation line is irrelevant here — that
    // flag only ever aliases `seat-briefing`.
    if (topic === "bootstrap-framing") {
      inv.io.stdout.write(BOOTSTRAP_FRAMING_LINE);
      return 0;
    }

    // Mirrors commands/setup.ts's own path-context resolution verbatim (see
    // setup-args.ts's module doc for the full `/$bunfs/` empirical chain) —
    // this command and `lore setup` must resolve the SAME assets/ tree.
    const pathCtx: SetupPathContext = {
      repoRoot: REPO_ROOT,
      isCompiled: inv.isCompiled,
      execPath: inv.execPath,
    };
    const assetsRoot = resolveAssetsRoot(pathCtx);

    const result = readGovernanceAsset(assetsRoot, GOVERNANCE_TOPIC_ASSETS[topic]);
    if (!result.ok) {
      inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
      return exitCode(result.error);
    }

    // The deprecation line is written AFTER a successful read (never on a
    // failed-read path) — a failed read already exits non-zero with its own
    // message, and D6 only requires the deprecation line when the legacy
    // flag actually served content.
    if (legacyFlag) {
      inv.io.stderr.write(SEAT_BRIEFING_FLAG_DEPRECATION_MESSAGE + "\n");
    }

    inv.io.stdout.write(result.value);
    return 0;
  },
});
