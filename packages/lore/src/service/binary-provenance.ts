/**
 * Binary-provenance oracle backing `lore status --check-binary-provenance` and
 * the `binary_provenance` field on `lore status --json`
 * (spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor, AC-BFI-1 /
 * AC-BFI-2).
 *
 * WHY THIS EXISTS: the global `lore` on a developer machine is a symlink into
 * ONE checkout's `dist/lore`. A co-resident session can re-branch that checkout
 * at any moment, so the binary that just issued a verdict may have been built
 * from a tree that no longer exists anywhere. Before this module there was no
 * way to answer "was this verdict issued by a binary built from this source?".
 * `scripts/build.ts` embeds the build commit via `Bun.build`'s `define`; this
 * module classifies that embedded commit against the cwd repo.
 *
 * Public surface:
 *   - `readEmbeddedBuildProvenance()` — reads the build-time-injected literal
 *     (the ONE ambient read; everything downstream is fact-injected).
 *   - `isCompiledBinary(bunMain)` — the compiled-vs-source discriminator (D2).
 *   - `GitProvenanceProbe` / `createRealGitProvenanceProbe()` — the git port
 *     and its one real implementation (the module's only IO).
 *   - `gatherBinaryProvenanceFacts(input)` — assembles facts through the port.
 *   - `classifyBinaryProvenance(facts)` — PURE total function, facts → verdict.
 *   - `renderBinaryProvenanceVerdict(verdict)` — verdict → operator lines.
 *   - `BINARY_PROVENANCE_EXIT_CODES` — verdict kind → process exit code.
 *   - `provenanceOrNull(read)` — the `lore status --json` projection.
 *
 * Invariants:
 *   - `classifyBinaryProvenance` is PURE and TOTAL: no IO, no clock, no
 *     `process.*` read. Every fact arrives in `BinaryProvenanceFacts`. Modelled
 *     on `prd-budget-check.ts`'s store-free convention for exactly this reason —
 *     all five verdicts must be constructible in a unit test without a build.
 *   - A `dev-stale` verdict ALWAYS carries BOTH shas (AC-BFI-2 requires the
 *     output to name them), which is why an unreadable `repo_head` is
 *     classified `not-a-dev-checkout` BEFORE the commit-membership test rather
 *     than coerced to a placeholder.
 *   - `not-a-dev-checkout` and `source-run` both render the literal token
 *     `skipped` (AC-BFI-2 pins that token for the consumer case).
 *   - This module NEVER opens the corpus. Classification depends only on the
 *     cwd's git repo, so `commands/status.ts` dispatches the check without
 *     `loadLoreApp`/`bun:sqlite` — mirroring `--check-claude-md`'s standalone
 *     dispatch. It therefore cannot touch the repo's own `.lore/`.
 *
 * Side-effect class: pure, EXCEPT `createRealGitProvenanceProbe`'s returned
 * probe (spawns `git`, read-only) and `readEmbeddedBuildProvenance` (reads one
 * build-time-substituted ambient identifier).
 *
 * ── D1: why a dirty tree at HEAD is NOT a fourth state ──────────────────────
 * AC-BFI-2 pins exactly three states, all keyed on COMMIT IDENTITY: dev-synced
 * (build commit == repo HEAD), dev-stale (build commit is in this repo but is
 * not HEAD), not-a-dev-checkout (build commit unknown to this repo). A binary
 * built from a dirty tree at HEAD is `dev-synced` by that definition, and
 * inventing a fourth "dirty" state would exceed the approved criterion. Silence
 * would nonetheless mislead — the binary genuinely does not correspond to any
 * commit — so `renderBinaryProvenanceVerdict` NAMES the dirtiness on the
 * dev-synced line while leaving the exit code at 0. ⛔ Do not promote this to
 * its own exit code without re-baselining AC-BFI-2 first.
 *
 * ── D2: compiled-vs-source, and why compiled-without-provenance fails loud ──
 * Discriminator: `Bun.main.startsWith("/$bunfs/")` — Bun's virtual filesystem
 * root for a `bun build --compile` binary's embedded entry. Independently
 * measured 2026-08-17 on Bun 1.3.x, three-way: a compiled binary built WITH
 * `define` → `Bun.main = /$bunfs/root/entry.js`, provenance present; the SAME
 * source compiled WITHOUT `define` → `/$bunfs/root/entry.js`, provenance absent
 * (a `typeof` guard on an unsubstituted identifier yields `"undefined"`, never
 * a ReferenceError); `bun run entry.ts` → `Bun.main` is the real on-disk path.
 * So the prefix separates compiled from source WITHOUT depending on whether the
 * injection happened — which is precisely what splitting "no provenance" in two
 * requires. Bun 1.3.x exposes no public `isStandaloneExecutable`; the same
 * prefix is already the codebase's established signal
 * (`adapters/cli/report-issue-wiring.ts::InstalledBinaryContext.isCompiled`).
 * Pinned by `tests/unit/status/binary-provenance.test.ts` ("D2 compiled-vs-
 * source discriminator") and end-to-end by the real compiled binary in
 * `tests/integration/binary-provenance-check.test.ts`.
 *
 * Running from SOURCE with no provenance is legitimate (`bun run dev` never
 * goes through `scripts/build.ts`) → `source-run`, exit 0, `skipped`. A
 * COMPILED binary with no provenance is a BUILD DEFECT, and it is the exact
 * failure this slice exists to catch: passing it silently would hollow out the
 * mechanism, leaving AC-BFI-1's test as the only remaining guard. It therefore
 * fails loud as `provenance-missing`, exit 4 — the `--check-*` family's
 * established "the check's own input is missing or invalid" code (the same code
 * `--check-tree` returns for a missing/invalid blueprint), deliberately
 * distinct from 3 so it can never be mistaken for a drift verdict.
 */

import { spawnSync } from "node:child_process";
import { z } from "zod";

// ─── Embedded provenance (build-time `define` substitution) ─────────────────

/**
 * Build-time-substituted JSON string carrying this binary's provenance.
 *
 * `scripts/build.ts` passes `define: { __LORE_BUILD_PROVENANCE__: <json> }` to
 * `Bun.build`, so in a compiled binary this identifier IS a string literal. In
 * every other context (vitest, `bun run dev`, a build that omitted the
 * injection) it is never declared at all — which is why every read below is
 * guarded by `typeof`, the one operator that is safe on an undeclared
 * identifier. ⛔ Never reference this identifier outside a `typeof` guard.
 */
declare const __LORE_BUILD_PROVENANCE__: string | undefined;

/** Zod SSOT for the injected payload — the type below is inferred from it. */
const buildProvenanceSchema = z.object({
  /** Full 40-hex sha of the commit the binary was built from. */
  build_commit: z.string().regex(/^[0-9a-f]{40}$/),
  /** Whether `git status --porcelain` was non-empty in the build tree. */
  build_dirty: z.boolean(),
  /** ISO-8601 build timestamp. */
  built_at: z.string().datetime(),
});

/** This binary's build provenance, as embedded by `scripts/build.ts`. */
export type BuildProvenance = z.infer<typeof buildProvenanceSchema>;

/**
 * The three outcomes of reading the embedded literal. `malformed` is a distinct
 * state rather than a degrade-to-`absent`: a build that injected garbage is a
 * different defect from a build that injected nothing, and both must stay
 * loud.
 */
export type EmbeddedProvenanceRead =
  | { kind: "absent" }
  | { kind: "malformed"; raw: string; reason: string }
  | { kind: "present"; provenance: BuildProvenance };

/**
 * Reads the build-time-injected provenance literal for THIS process.
 *
 * @returns `{kind: "absent"}` when nothing was injected (source run, or a build
 *   that omitted `define`), `{kind: "malformed"}` when the literal exists but
 *   is not valid JSON matching {@link buildProvenanceSchema}, else
 *   `{kind: "present"}`. Never throws.
 * @example
 *   readEmbeddedBuildProvenance();
 *   // => { kind: "present", provenance: { build_commit: "b2e8…", build_dirty: false, built_at: "2026-08-17T…Z" } }
 */
export function readEmbeddedBuildProvenance(): EmbeddedProvenanceRead {
  const raw = typeof __LORE_BUILD_PROVENANCE__ === "string" ? __LORE_BUILD_PROVENANCE__ : undefined;
  if (raw === undefined) return { kind: "absent" };
  return parseEmbeddedBuildProvenance(raw);
}

/**
 * Pure half of {@link readEmbeddedBuildProvenance} — exported so the malformed
 * branch is unit-testable without a build that deliberately injects garbage.
 *
 * @param raw - the raw injected string.
 * @returns `{kind: "malformed"}` naming why, or `{kind: "present"}`.
 */
export function parseEmbeddedBuildProvenance(raw: string): EmbeddedProvenanceRead {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch (e) {
    // reason: NOT a silent fallback — `malformed` is a loud verdict that maps
    // to exit 4 via BINARY_PROVENANCE_EXIT_CODES. The catch exists only to keep
    // a broken build's payload from throwing out of a status read.
    return { kind: "malformed", raw, reason: `not valid JSON: ${String(e)}` };
  }
  const parsed = buildProvenanceSchema.safeParse(decoded);
  if (!parsed.success) {
    return {
      kind: "malformed",
      raw,
      reason: `does not match the build-provenance schema: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    };
  }
  return { kind: "present", provenance: parsed.data };
}

/**
 * Projects an {@link EmbeddedProvenanceRead} into the `binary_provenance` field
 * of `lore status --json` (AC-BFI-1).
 *
 * @param read - the result of {@link readEmbeddedBuildProvenance}.
 * @returns the provenance object, or `null` for absent/malformed — `null`
 *   rather than an omitted key, so a consumer can never read "absent" as
 *   "nothing was checked" (same convention as `status`'s `invalid_docs`).
 */
export function provenanceOrNull(read: EmbeddedProvenanceRead): BuildProvenance | null {
  return read.kind === "present" ? read.provenance : null;
}

// ─── Compiled-vs-source discriminator (D2) ──────────────────────────────────

/** Bun's virtual filesystem root for a compiled binary's embedded entry. */
export const BUN_COMPILED_ENTRY_PREFIX = "/$bunfs/";

/**
 * Whether this process is a `bun build --compile` standalone binary. See the
 * module header's D2 block for the measurement backing this discriminator.
 *
 * @param bunMain - `Bun.main` (injected, so the predicate stays testable).
 * @returns `true` for a compiled binary, `false` for a `bun run <file>` source run.
 * @example isCompiledBinary("/$bunfs/root/index.js") // true
 * @example isCompiledBinary("/repo/packages/lore/src/index.ts") // false
 */
export function isCompiledBinary(bunMain: string): boolean {
  return bunMain.startsWith(BUN_COMPILED_ENTRY_PREFIX);
}

// ─── Git port ───────────────────────────────────────────────────────────────

/**
 * Read-only git facts the classifier needs. A port (rather than direct
 * `spawnSync` calls in the classifier) so all five verdicts are reachable in a
 * unit test with no repo — same DI shape as `DriftCheckService`'s `FsProbe`.
 */
export interface GitProvenanceProbe {
  /**
   * The repo's current HEAD commit sha.
   *
   * @param cwd - directory to resolve the repo from.
   * @returns the 40-hex sha, or `null` when `cwd` is not in a git repo or the
   *   repo has no commit yet (both exit 128 — measured).
   */
  /** @lore-site BR-434 */
  readHeadCommit(cwd: string): string | null;
  /**
   * Whether `sha` names a commit object present in this repo's object store.
   *
   * @param cwd - directory to resolve the repo from.
   * @param sha - full commit sha to look up.
   * @returns `true` only on a clean lookup. `git cat-file -e <sha>^{commit}`
   *   exits 128 for an unknown sha — measured, and NOT an error path: that 128
   *   is exactly the evidence for the `not-a-dev-checkout` verdict.
   */
  /** @lore-site BR-434 */
  hasCommit(cwd: string, sha: string): boolean;
}

/**
 * The one real {@link GitProvenanceProbe} — spawns `git`, reads only.
 *
 * @returns a probe bound to the ambient `git` on `PATH`.
 */
export function createRealGitProvenanceProbe(): GitProvenanceProbe {
  return {
    readHeadCommit(cwd: string): string | null {
      const run = spawnSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" });
      if (run.status !== 0) return null;
      const sha = run.stdout.trim();
      return sha.length > 0 ? sha : null;
    },
    hasCommit(cwd: string, sha: string): boolean {
      const run = spawnSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd, encoding: "utf8" });
      return run.status === 0;
    },
  };
}

// ─── Facts → verdict ────────────────────────────────────────────────────────

/** Everything {@link classifyBinaryProvenance} needs, all caller-measured. */
export interface BinaryProvenanceFacts {
  /** What this binary carries — see {@link readEmbeddedBuildProvenance}. */
  embedded: EmbeddedProvenanceRead;
  /** Whether this process is compiled — see {@link isCompiledBinary}. */
  is_compiled: boolean;
  /** The cwd repo's HEAD sha, `null` when unreadable. */
  repo_head: string | null;
  /** Whether the embedded build commit is a commit in the cwd repo. */
  build_commit_in_repo: boolean;
}

/** Why a `not-a-dev-checkout` verdict was reached. */
export type NotADevCheckoutReason = "no-readable-head" | "build-commit-unknown-to-repo";

/** The five states this check distinguishes. Exit codes: {@link BINARY_PROVENANCE_EXIT_CODES}. */
export type BinaryProvenanceVerdict =
  | { kind: "dev-synced"; build_commit: string; repo_head: string; build_dirty: boolean; built_at: string }
  | { kind: "dev-stale"; build_commit: string; repo_head: string; built_at: string }
  | {
      kind: "not-a-dev-checkout";
      build_commit: string;
      built_at: string;
      repo_head: string | null;
      reason: NotADevCheckoutReason;
    }
  | { kind: "source-run" }
  | { kind: "provenance-missing"; reason: string };

/**
 * Verdict kind → process exit code. AC-BFI-2 pins the first three EXACTLY;
 * `source-run` joins the 0s (legitimate) and `provenance-missing` fails loud on
 * 4 (see the module header's D2 block). ⛔ Never widen an assertion on these to
 * "non-zero" — a crash is also non-zero and has no discriminating power.
 */
export const BINARY_PROVENANCE_EXIT_CODES = {
  "dev-synced": 0,
  "dev-stale": 3,
  "not-a-dev-checkout": 0,
  "source-run": 0,
  "provenance-missing": 4,
} as const satisfies Record<BinaryProvenanceVerdict["kind"], number>;

/** Input to {@link gatherBinaryProvenanceFacts}. */
export interface GatherBinaryProvenanceFactsInput {
  /** This binary's embedded provenance. */
  embedded: EmbeddedProvenanceRead;
  /** Whether this process is compiled. */
  is_compiled: boolean;
  /** Directory whose git repo the build commit is classified against. */
  cwd: string;
  /** Git facts source. */
  probe: GitProvenanceProbe;
}

/**
 * Assembles {@link BinaryProvenanceFacts}, probing git ONLY when there is a
 * build commit to classify — a source run must never pay two `git` spawns to
 * learn something the embedded read already settled.
 *
 * @param input - see {@link GatherBinaryProvenanceFactsInput}.
 * @returns facts ready for {@link classifyBinaryProvenance}.
 */
export function gatherBinaryProvenanceFacts(
  input: GatherBinaryProvenanceFactsInput,
): BinaryProvenanceFacts {
  if (input.embedded.kind !== "present") {
    return {
      embedded: input.embedded,
      is_compiled: input.is_compiled,
      repo_head: null,
      build_commit_in_repo: false,
    };
  }
  const buildCommit = input.embedded.provenance.build_commit;
  return {
    embedded: input.embedded,
    is_compiled: input.is_compiled,
    repo_head: input.probe.readHeadCommit(input.cwd),
    build_commit_in_repo: input.probe.hasCommit(input.cwd, buildCommit),
  };
}

/**
 * Classifies a binary's provenance against the repo it is being run in. PURE
 * and TOTAL — every branch is reachable from a hand-built `facts` object.
 *
 * Branch order is load-bearing: `repo_head === null` is decided BEFORE the
 * commit-membership test so a `dev-stale` verdict can always name both shas
 * (AC-BFI-2), and membership is decided BEFORE the HEAD comparison so an
 * npm-installed consumer is never told their binary is stale.
 *
 * @param facts - see {@link BinaryProvenanceFacts}.
 * @returns one of the five {@link BinaryProvenanceVerdict} states.
 * @example
 *   classifyBinaryProvenance({ embedded: {kind: "present", provenance: p},
 *     is_compiled: true, repo_head: p.build_commit, build_commit_in_repo: true });
 *   // => { kind: "dev-synced", … }
 */
export function classifyBinaryProvenance(facts: BinaryProvenanceFacts): BinaryProvenanceVerdict {
  if (facts.embedded.kind !== "present") {
    if (!facts.is_compiled) return { kind: "source-run" };
    return {
      kind: "provenance-missing",
      reason:
        facts.embedded.kind === "malformed"
          ? `the compiled binary's embedded build provenance ${facts.embedded.reason}`
          : "this compiled binary carries no embedded build provenance at all",
    };
  }

  const { build_commit, built_at } = facts.embedded.provenance;

  if (facts.repo_head === null) {
    return {
      kind: "not-a-dev-checkout",
      build_commit,
      built_at,
      repo_head: null,
      reason: "no-readable-head",
    };
  }
  if (!facts.build_commit_in_repo) {
    return {
      kind: "not-a-dev-checkout",
      build_commit,
      built_at,
      repo_head: facts.repo_head,
      reason: "build-commit-unknown-to-repo",
    };
  }
  if (facts.repo_head === build_commit) {
    return {
      kind: "dev-synced",
      build_commit,
      repo_head: facts.repo_head,
      build_dirty: facts.embedded.provenance.build_dirty,
      built_at,
    };
  }
  return { kind: "dev-stale", build_commit, repo_head: facts.repo_head, built_at };
}

// ─── Rendering ──────────────────────────────────────────────────────────────

/** The literal token AC-BFI-2 pins for every no-comparison-possible verdict. */
export const BINARY_PROVENANCE_SKIPPED_TOKEN = "skipped";

/**
 * Renders a verdict for an operator. Line 1 is the headline; `summary` repeats
 * it so `--json` consumers see the same tokens stdout-only readers do.
 *
 * @param verdict - see {@link classifyBinaryProvenance}.
 * @returns `{summary, lines}` — `lines[0] === summary`.
 */
export function renderBinaryProvenanceVerdict(verdict: BinaryProvenanceVerdict): {
  summary: string;
  lines: string[];
} {
  switch (verdict.kind) {
    case "dev-synced": {
      // D1: the dirtiness is NAMED but never changes the exit code — see the
      // module header's D1 block before "fixing" this into a fourth state.
      const dirty = verdict.build_dirty
        ? " ⚠ built from a DIRTY tree — the binary matches no commit exactly, only its base commit"
        : "";
      return {
        summary: `binary provenance: dev-synced — built from ${verdict.build_commit}, which is this repo's HEAD.${dirty}`,
        lines: [
          `binary provenance: dev-synced — built from ${verdict.build_commit}, which is this repo's HEAD.${dirty}`,
          `  built_at:     ${verdict.built_at}`,
          `  build_dirty:  ${String(verdict.build_dirty)}`,
        ],
      };
    }
    case "dev-stale": {
      const summary =
        `binary provenance: dev-stale — this binary was built from ${verdict.build_commit}, ` +
        `but this repo's HEAD is ${verdict.repo_head}.`;
      return {
        summary,
        lines: [
          summary,
          `  built_at:     ${verdict.built_at}`,
          "  fix: rebuild with `bun run build` before trusting any verdict this binary issues.",
        ],
      };
    }
    case "not-a-dev-checkout": {
      const because =
        verdict.reason === "no-readable-head"
          ? "this directory has no readable git HEAD"
          : `build commit ${verdict.build_commit} is unknown to this repo`;
      const summary =
        `binary provenance: ${BINARY_PROVENANCE_SKIPPED_TOKEN} (not a dev checkout) — ${because}, ` +
        "so there is nothing to compare against. This is the normal state for an installed `lore`.";
      return { summary, lines: [summary, `  built_at:     ${verdict.built_at}`] };
    }
    case "source-run": {
      const summary =
        `binary provenance: ${BINARY_PROVENANCE_SKIPPED_TOKEN} (running from source) — ` +
        "an uncompiled `bun run` carries no build commit by construction.";
      return { summary, lines: [summary] };
    }
    case "provenance-missing": {
      const summary = `binary provenance: BUILD DEFECT — ${verdict.reason}.`;
      return {
        summary,
        lines: [
          summary,
          "  A compiled `lore` must always carry its build commit; rebuild with `bun run build`",
          "  and check scripts/build.ts's `define` injection if this recurs.",
        ],
      };
    }
    default: {
      const exhaustive: never = verdict;
      return exhaustive;
    }
  }
}

/**
 * Renders the `lore status` (plain run) provenance line — always printed,
 * including the absent case, so an operator can never read silence as "this
 * binary is fine".
 *
 * @param read - the result of {@link readEmbeddedBuildProvenance}.
 * @returns one line of human output.
 */
export function formatBinaryProvenanceStatusLine(read: EmbeddedProvenanceRead): string {
  switch (read.kind) {
    case "present":
      return (
        `Binary provenance: built from ${read.provenance.build_commit}` +
        `${read.provenance.build_dirty ? " (dirty tree)" : ""} at ${read.provenance.built_at} ` +
        "(run `lore status --check-binary-provenance` to compare it against this repo)"
      );
    case "malformed":
      return `Binary provenance: MALFORMED — ${read.reason} (this is a build defect)`;
    case "absent":
      return "Binary provenance: none embedded (running from source, or built without provenance injection)";
    default: {
      const exhaustive: never = read;
      return exhaustive;
    }
  }
}
