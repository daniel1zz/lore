/**
 * @spec_ref AC-CP-4 (spec-corpus-resolution-carries-provenance-and-a-foreign-write §D4)
 *
 * Lands ONLY the config half of the foreign-corpus-write guard: a seventh
 * `.strict()` sub-predicate (`foreign_corpus_write`) on `GateCheckpointConfigSchema`
 * plus its `resolveForeignCorpusWriteGateEnabled` helper
 * (`task-foreign-corpus-write-joins-the-six-gate-sub-predicates-and`). The
 * predicate that actually REFUSES a foreign write is a SEPARATE task
 * (`task-the-foreign-write-guard-intent-is-a-claim-lease-fact-and`, AC-CP-3),
 * owning `foreign-corpus-write-guard.ts` / `corpus-service.ts` / `loader.ts` —
 * none of which this file's task touches.
 *
 * ⛔ THIS IS DELIBERATE, DOCUMENTED, EXPECTED-RED STATE for half (a) below,
 * NOT a bug in this test: AC-CP-4(a) asserts the guard's REFUSAL BEHAVIOUR,
 * which does not exist until AC-CP-3 lands. Half (a) is written IN FULL (no
 * `.skip`, no weakened assertion) and WILL fail until then — see
 * `assertForeignWriteRefused`'s thrown message, which names the landing task
 * by slug so a red run between now and then is self-explanatory. Half (b) is
 * consequently VACUOUS today too: with no guard at all, EVERY write succeeds
 * regardless of the config knob, so "(b) passes" currently proves nothing
 * about the knob — it becomes a real control only once (a) can also go green.
 * Half (c) is pure config-schema/dispatch structure and MUST pass today; it
 * depends on nothing this task doesn't own.
 *
 * FIXTURE (shared by (a) and (b), pinned by AC-CP-4's own text so this file
 * is reproducible without reading AC-CP-3): a throwaway `mkdtemp` git repo,
 * `lore init`-ed by the COMPILED binary and NOTHING else, with a NESTED
 * worktree at `repo/.claude/worktrees/agent-x` carrying no `.lore/` of its
 * own — so `findLoreDbPath`'s §M4 git-common-dir fallback resolves the
 * PARENT repo's corpus from inside it, and every write from that worktree is
 * genuinely foreign. Never touches this repo's own `.lore/` corpus — every
 * fixture repo lives under a fresh OS tmpdir (project CLAUDE.md).
 *
 * Freshness guard: `beforeAll` calls `assertFreshBinary` against THIS
 * worktree's own `dist/lore` and `packages/{lore,core}/src` — a `.bun.test.ts`
 * spawning a compiled binary directly needs `bun run build` first (dogfood
 * lesson, repo CLAUDE.md false-oracle vector #4 — a stale binary is a
 * documented false oracle in this repo), and REPO_ROOT is derived from
 * `import.meta.url` so it can never accidentally resolve to a sibling
 * worktree or the main checkout.
 *
 * Coverage (AC-CP-4's own three halves, not a generic six-dimension grid —
 * see the AC's structured statement for why):
 *   (a) BEHAVIOURAL DEFAULT — a non-lifecycle foreign write is refused by
 *       default (exit 4, stderr containing the pinned refusal token).
 *       EXPECTED RED until AC-CP-3 lands the guard.
 *   (b) CONTROL — the identical write, with `foreign_corpus_write.enabled:
 *       false` in the project config, succeeds. Vacuously true today (see
 *       above); becomes a real two-sided control once (a) is green.
 *   (c) STRUCTURAL SAME-PATH CHECK — `GateCheckpointConfigSchema`'s own shape
 *       enumerates exactly seven sub-predicate keys as a SET, each carrying
 *       the identical `.strict()` enabled-boolean shape, and each key's
 *       resolver is reachable through the SAME naming-convention dispatch
 *       (`resolve<PascalCase(key)>GateEnabled`) that the six pre-existing
 *       keys already use — so a seventh predicate wired PAST that convention
 *       (e.g. a schema key with no matching exported resolver, or a resolver
 *       named off-pattern) goes RED. Pure, in-process, no subprocess spawn.
 *
 * TG-25 (adr-tg-1 option b): the commands run IN-PROCESS through tests/helpers/run-lore-in-process.ts, not through
 * dist/lore. Wherever the prose above says the compiled binary is spawned or its freshness asserted, that is the
 * history of this file; the assertions and the throwaway-corpus rule are unchanged.
 */

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
// Runtime (not type-only) import — @lore/core's default barrel is browser-safe
// and re-exports config.ts's schemas/resolvers via `export *`. `* as loreCore`
// lets (c) below do a genuine property-name lookup (the "keyed dispatch") in
// naming-convention.
import { GateCheckpointConfigSchema } from "@lore/core";
import * as loreCore from "@lore/core";
import { runLoreInProcess } from "../helpers/run-lore-in-process";

// ─── Path / spawn setup (mirrors worktree-corpus-resolution.bun.test.ts) ───

// tests/e2e/ -> tests/ -> packages/lore/ -> packages/ -> repo root (4 levels
// up) — THIS worktree's own root, never a sibling worktree or main checkout,
// because import.meta.url always points at THIS file's own on-disk location.
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

beforeAll(() => {
  // Pins "YOUR worktree's dist/lore, never the main checkout's" as a runtime
  // assertion, not just a derivation: cross-validate the `import.meta.url`-
  // derived REPO_ROOT against an INDEPENDENTLY computed git toplevel (`git
  // rev-parse --show-toplevel` run from this very file's own directory). If
  // this file were ever executed from a copy under a DIFFERENT checkout (main
  // or a sibling worktree), the two derivations would disagree and this
  // throws before assertFreshBinary ever runs — silently building/spawning
  // the WRONG dist/lore is exactly the false-oracle vector this guards.
  const gitToplevel = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: fileURLToPath(new URL(".", import.meta.url)),
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  }).trim();
  if (gitToplevel !== REPO_ROOT) {
    throw new Error(
      `REPO_ROOT derivation mismatch: import.meta.url-derived REPO_ROOT is "${REPO_ROOT}" ` +
        `but 'git rev-parse --show-toplevel' from this file's own directory says ` +
        `"${gitToplevel}". This test must run against ITS OWN worktree's checkout, never ` +
        `a sibling worktree or the main checkout.`,
    );
  }
});

const cleanupDirs: string[] = [];

afterEach(() => {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Creates a fresh mkdtemp scratch dir and resolves it via `realpathSync` —
 * macOS's `TMPDIR` is itself a symlink, and `git`'s own path output is the
 * REAL (resolved) path; comparing an unresolved path against it would
 * spuriously mismatch. Registered for cleanup in `afterEach`.
 */
function mkScratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanupDirs.push(dir);
  return realpathSync(dir);
}

/** Runs `git <args>` in `cwd`. Fixture setup only — never the code path under test. */
function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" }).trim();
}

/** Initializes a git repo at `dir` with one commit on `main`. */
function initGitRepo(dir: string): void {
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "foreign-corpus-write-default-test@example.invalid"]);
  git(dir, ["config", "user.name", "foreign-corpus-write-default e2e"]);
  writeFileSync(join(dir, "README.md"), "foreign-corpus-write-default fixture\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-q", "-m", "init"]);
}

/**
 * Spawns the COMPILED `dist/lore` binary with `cwd`/`HOME` both pointed at
 * `cwd` (never the real user's `~/.config/lore`). `CLAUDECODE=1` resolves the
 * "agent" caller surface (SPEC-024) so no write here risks a nested AI call.
 */
async function runLore(args: string[], cwd: string): Promise<RunResult> {
  const proc = await runLoreInProcess(args, {
    cwd,
    env: { ...process.env, HOME: cwd, CLAUDECODE: "1" },
  });
  return {
    stdout: proc.stdout,
    stderr: proc.stderr,
    exitCode: proc.exitCode,
  };
}

async function initCorpus(dir: string): Promise<void> {
  const result = await runLore(["init", "--author", "foreign-write-default-e2e"], dir);
  if (result.exitCode !== 0) {
    throw new Error(`fixture setup: 'lore init' failed in ${dir}: ${result.stderr}`);
  }
}

/**
 * Builds the AC-CP-4 fixture, pinned exactly as the AC's own text states:
 * a throwaway git repo, `lore init`-ed by the compiled binary and NOTHING
 * ELSE (no gate config, no seeded docs — none of that is needed here, since
 * `lore create knowledge` touches no EXISTING checkpoint), with a nested
 * worktree at `repo/.claude/worktrees/agent-x` carrying no `.lore/` of its
 * own. Returns both paths; every write in (a)/(b) targets `worktreePath`.
 */
async function createNestedWorktreeFixture(prefix: string): Promise<{ repoRoot: string; worktreePath: string }> {
  const repoRoot = mkScratchDir(`fcwd-${prefix}-repo-`);

  // Pins "every fixture is an mkdtemp repo asserted to live OUTSIDE the repo
  // root" (AC-CP-3's fixture discipline, reused verbatim by AC-CP-4) as a
  // runtime check, not a comment: the real corpus (this checkout's own
  // .lore/) must never be reachable from the throwaway repo's path.
  if (repoRoot === REPO_ROOT || repoRoot.startsWith(`${REPO_ROOT}/`)) {
    throw new Error(
      `fixture safety: mkdtemp repoRoot "${repoRoot}" is INSIDE this checkout's own ` +
        `REPO_ROOT ("${REPO_ROOT}") — refusing to proceed. Every fixture in this file ` +
        `must live outside the repo root so a write can never reach the real corpus.`,
    );
  }

  initGitRepo(repoRoot);
  await initCorpus(repoRoot);

  mkdirSync(join(repoRoot, ".claude", "worktrees"), { recursive: true });
  const worktreeRelPath = join(".claude", "worktrees", "agent-x");
  git(repoRoot, ["worktree", "add", "-b", `${prefix}-agent-x`, worktreeRelPath]);
  const worktreePath = join(repoRoot, worktreeRelPath);

  // Precondition the whole fixture depends on: the nested worktree genuinely
  // has no local .lore/ — every write below is a write into a corpus this
  // worktree does not own (the §M4 git-common-dir fallback resolves the
  // PARENT's corpus). Without this the fixture could silently degrade into a
  // non-foreign write, and neither (a) nor (b) would mean anything.
  expect(existsSync(join(worktreePath, ".lore"))).toBe(false);

  return { repoRoot, worktreePath };
}

/** A non-lifecycle corpus write — `lore create knowledge` — AC-CP-4's own example of the measured pollution vector. */
function knowledgeCreateArgs(titleSuffix: string): string[] {
  return [
    "create",
    "knowledge",
    "--sub-type",
    "reference",
    "--title",
    `AC-CP-4 fixture write ${titleSuffix}`,
    "--content",
    "x",
    "--no-ai",
  ];
}

/** The pinned refusal token — AC-CP-3 fixes this literal, AC-CP-5(a) asserts it equal across CLI/MCP; reused here so half (a)'s oracle value matches exactly, never a paraphrase. */
const FOREIGN_PROVENANCE_TOKEN = "gate:corpus-write:foreign-provenance";

/** Names the guard-landing task so a red run between now and then is self-explanatory — see this file's module header. */
const FOREIGN_WRITE_GUARD_LANDING_TASK =
  "task-the-foreign-write-guard-intent-is-a-claim-lease-fact-and (AC-CP-3)";

/**
 * Asserts `result` is the guard's REFUSAL shape: exit code EXACTLY 4 and
 * stderr CONTAINING the pinned token. Throws (rather than a bare `expect`)
 * so the failure message is self-describing per this file's module header —
 * this is expected to fail until the guard itself lands.
 */
function assertForeignWriteRefused(result: RunResult, acLabel: string): void {
  const refused = result.exitCode === 4 && result.stderr.includes(FOREIGN_PROVENANCE_TOKEN);
  if (!refused) {
    throw new Error(
      `${acLabel}: EXPECTED the write to be REFUSED (exit code 4, stderr containing ` +
        `"${FOREIGN_PROVENANCE_TOKEN}"), but got exit=${result.exitCode} ` +
        `stderr=${JSON.stringify(result.stderr)} stdout=${JSON.stringify(result.stdout)}.\n` +
        `This is EXPECTED TO BE RED until ${FOREIGN_WRITE_GUARD_LANDING_TASK} lands the guard ` +
        `itself (foreign-corpus-write-guard.ts / corpus-service.ts / loader.ts) — the task that ` +
        `owns THIS test file (foreign_corpus_write joins the six gate sub-predicates, AC-CP-4) ` +
        `only wires the config knob in packages/core/src/config.ts, never the refusal behaviour.`,
    );
  }
}

describe("foreign_corpus_write config default, control, and structural dispatch (AC-CP-4)", () => {
  it(
    "(a) BEHAVIOURAL DEFAULT: a non-lifecycle foreign write is refused by default — EXPECTED RED until the guard task lands",
    async () => {
      const { worktreePath } = await createNestedWorktreeFixture("a");
      const result = await runLore(knowledgeCreateArgs("a"), worktreePath);
      assertForeignWriteRefused(result, "AC-CP-4(a)");
    },
    30000,
  );

  it(
    "(b) CONTROL: foreign_corpus_write.enabled:false in the project config leaves the identical write succeeding — VACUOUS until (a) is also green (see module header)",
    async () => {
      const { repoRoot, worktreePath } = await createNestedWorktreeFixture("b");

      // Same map key `resolveForeignCorpusWriteGateEnabled` reads
      // (config.ts) — "corpus-write", deliberately not one of the four real
      // GateCheckpoint ids, per D4's "NOT scoped to task-claim" constraint.
      appendFileSync(
        join(repoRoot, ".lore", "config.yaml"),
        ["workflow:", "  gates:", "    corpus-write:", "      foreign_corpus_write:", "        enabled: false", ""].join(
          "\n",
        ),
      );

      const result = await runLore(knowledgeCreateArgs("b"), worktreePath);
      // NOTE (per this file's module header): with no guard wired at all yet,
      // EVERY write succeeds regardless of this config knob — this assertion
      // is currently satisfied for the WRONG reason (vacuously) and only
      // becomes a meaningful two-sided control once (a) can also go green.
      // Do not read a green (b) alone as proof the knob works.
      expect(result.exitCode).toBe(0);

      // Positive landing check (mirrors AC-CP-3's "asserts both writes
      // LANDED" discipline) — even vacuously, confirm the doc actually
      // reached the PARENT corpus rather than the command silently no-op'ing.
      const verify = await runLore(["list", "--type", "knowledge", "--json"], repoRoot);
      expect(verify.exitCode).toBe(0);
      const parsed = JSON.parse(verify.stdout) as { data: { docs: Array<{ title: string }> } };
      expect(parsed.data.docs.some((d) => d.title === "AC-CP-4 fixture write b")).toBe(true);
    },
    30000,
  );

  // ─── (c) STRUCTURAL SAME-PATH CHECK — pure, in-process, no subprocess ────

  const EXPECTED_SUB_PREDICATE_KEYS = [
    "anchor_overlap",
    "actor_identity",
    "ac_quantifiable",
    "oracle_coverage",
    "requires_uat",
    "prd_sync",
    "foreign_corpus_write",
  ] as const;

  /**
   * Structural check for "the identical `.strict()` enabled-boolean shape":
   * an OPTIONAL wrapper around a STRICT ZodObject whose ONLY key is `enabled`,
   * itself an OPTIONAL ZodBoolean. Introspects zod v3's own `_def` (verified
   * empirically: `.strict()` sets `_def.catchall` to a `ZodNever` instance;
   * a non-strict `z.object()` has no `catchall` at all).
   */
  function isStrictEnabledBooleanShape(schema: z.ZodTypeAny): boolean {
    const unwrapped: z.ZodTypeAny = schema instanceof z.ZodOptional ? schema.unwrap() : schema;
    if (!(unwrapped instanceof z.ZodObject)) return false;
    const objectSchema = unwrapped as z.AnyZodObject;
    if (!(objectSchema._def.catchall instanceof z.ZodNever)) return false;
    const shapeKeys = Object.keys(objectSchema.shape);
    if (shapeKeys.length !== 1 || shapeKeys[0] !== "enabled") return false;
    const enabledField = objectSchema.shape["enabled"] as z.ZodTypeAny;
    const enabledUnwrapped = enabledField instanceof z.ZodOptional ? enabledField.unwrap() : enabledField;
    return enabledUnwrapped instanceof z.ZodBoolean;
  }

  /**
   * The SHARED keyed-dispatch lookup this AC drives with all seven keys:
   * every `resolve*GateEnabled` helper in config.ts (six pre-existing plus
   * `foreign_corpus_write`) is named by the SAME convention —
   * `resolve` + PascalCase(snake_case key) + `GateEnabled` — verified against
   * all six pre-existing names before being trusted here (anchor_overlap ->
   * resolveAnchorOverlapGateEnabled, actor_identity -> resolveActorIdentityGateEnabled,
   * ac_quantifiable -> resolveAcQuantifiableGateEnabled, oracle_coverage ->
   * resolveOracleCoverageGateEnabled, requires_uat -> resolveRequiresUatGateEnabled,
   * prd_sync -> resolvePrdSyncGateEnabled). A seventh predicate whose resolver
   * is missing, misnamed, or not re-exported from `@lore/core` is invisible to
   * every ACTUAL caller (gate-enforcer.ts / commands/gate.ts import by this
   * exact name) exactly as it would be invisible to this lookup.
   */
  function subPredicateKeyToResolverName(key: string): string {
    const pascal = key
      .split("_")
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join("");
    return `resolve${pascal}GateEnabled`;
  }

  it("(c) STRUCTURAL SAME-PATH CHECK: GateCheckpointConfigSchema carries exactly seven sub-predicate keys as a set, each with the identical .strict() enabled-boolean shape, each reachable through the shared naming-convention dispatch", () => {
    const shape = GateCheckpointConfigSchema.shape as Record<string, z.ZodTypeAny>;
    const actualSubPredicateKeys = Object.keys(shape).filter((k) => k !== "enabled");

    const actualSet = new Set(actualSubPredicateKeys);
    const expectedSet = new Set<string>(EXPECTED_SUB_PREDICATE_KEYS);
    const setsMatch =
      actualSet.size === expectedSet.size && [...expectedSet].every((k) => actualSet.has(k));
    if (!setsMatch) {
      throw new Error(
        `AC-CP-4(c): GateCheckpointConfigSchema's sub-predicate keys are ` +
          `${JSON.stringify([...actualSet].sort())}, expected exactly the seven-key SET ` +
          `${JSON.stringify([...expectedSet].sort())}.`,
      );
    }

    for (const key of EXPECTED_SUB_PREDICATE_KEYS) {
      const fieldSchema = shape[key];
      if (fieldSchema === undefined) {
        throw new Error(`AC-CP-4(c): schema is missing the "${key}" sub-predicate key entirely.`);
      }
      if (!isStrictEnabledBooleanShape(fieldSchema)) {
        throw new Error(
          `AC-CP-4(c): sub-predicate "${key}" does not carry the identical .strict() ` +
            `enabled-boolean shape (optional -> strict object -> sole key "enabled" -> ` +
            `optional boolean).`,
        );
      }

      const resolverName = subPredicateKeyToResolverName(key);
      const resolver = (loreCore as unknown as Record<string, unknown>)[resolverName];
      if (typeof resolver !== "function") {
        throw new Error(
          `AC-CP-4(c): sub-predicate key "${key}" has no live helper reachable through the ` +
            `shared naming-convention dispatch (expected @lore/core to export a function named ` +
            `"${resolverName}", got ${typeof resolver}). A sub-predicate wired past this shared ` +
            `lookup — present on the schema but unreachable by the same dispatch as its six ` +
            `siblings — is exactly the escape this AC exists to catch.`,
        );
      }
    }
  });
});
