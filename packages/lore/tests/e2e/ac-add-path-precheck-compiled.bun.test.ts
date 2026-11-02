// @reads assets/project/lore-config-template.yaml
/**
 * Compiled-binary e2e for SPEC-061/AC-061-21 — `lore ac add`'s D8
 * declaration-time path-existence check, driven end-to-end through the
 * COMPILED `dist/lore` binary against a THROWAWAY `mkdtemp` corpus (never
 * this repo's own `.lore/`; project CLAUDE.md hard rule, 2026-07-07
 * pollution incident).
 *
 * Why a compiled suite exists at all: `checkDeclaredPathExistence`
 * (`packages/lore/src/service/ac-service.ts`) and the `extractTestFileTokens`
 * primitive it composes (`@lore/core`'s `oracle-file-existence.ts`) are pure
 * and exhaustively unit-tested from vitest
 * (`tests/unit/service/ac-service.test.ts`'s "echo-prose-not-a-path" describe
 * block), but the CLI command that must WIRE the fix to a real invocation
 * (`src/adapters/cli/commands/ac.ts`'s `add` subcommand, via
 * `buildDeclarePathOpts`) imports the bun-only `loader.ts` (`bun:sqlite`)
 * and is unreachable from vitest. An attested service-layer pass certifies
 * an unreachable capability if nothing drives the CLI surface itself
 * (project CLAUDE.md's "An ATTESTED pass is not evidence of production
 * wiring" lesson) — this file is that surface-level oracle.
 *
 * Freshness guard (repo CLAUDE.md false-oracle vector #4 — a stale
 * `dist/lore` silently validates stale compiled logic against current
 * source): `beforeAll` calls `assertFreshBinary`. Run `bun run build` (repo
 * root) first.
 *
 * Coverage (sequential scenarios over ONE spec):
 *   1. ACCEPT — a declaration whose runner segment names a REAL test path
 *      and whose success-echo segment separately mentions that file's bare
 *      basename as prose: written, exits 0 (AC-061-21).
 *   2. REFUSE — the same shape, but the runner segment names a path that
 *      does NOT exist: exits 4, writes NOTHING (spec's criteria count is
 *      unchanged from scenario 1's single entry) (AC-061-21).
 *
 * RED (per the AC's own text): reverting `extractTestFileTokens` to a flat,
 * unsegmented scan makes scenario 1 exit 4 (the echo's basename is
 * mis-extracted and reported missing) — the exact D8 gap 8 shape measured
 * 2026-08-19 (`knowledge-four-governance-gaps-measured-while-resuming-
 * handoff` §8).
 *
 * @spec_ref AC-061-21; spec-spec-061-attestation-completeness-guard-detect-
 *   zero-match-u; spec-oracle-executability-a-runner-s-discovery-refusal-
 *   is-not-a §M6.3/D8; task-promote-splitcommandsegments-to-the-one-
 *   segmentation-seam
 *
 * TG-25 (adr-tg-1 option b): the commands run IN-PROCESS through tests/helpers/run-lore-in-process.ts, not through
 * dist/lore. Wherever the prose above says the compiled binary is spawned or its freshness asserted, that is the
 * history of this file; the assertions and the throwaway-corpus rule are unchanged.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runLoreInProcess } from "../helpers/run-lore-in-process";
import { templatedFieldsArgs } from "../helpers/templated-create";

// tests/e2e/ -> tests/ -> packages/lore/ -> packages/ -> repo root (4 levels up),
// mirrors every sibling compiled-binary e2e suite's own REPO_ROOT derivation.
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");

/** Path (relative to the throwaway corpus root) of the REAL test file the accept scenario names. */
const REAL_TEST_RELATIVE = "packages/x/real.test.ts";

/**
 * The declaration under test: the runner segment names the REAL path above;
 * the success-echo segment separately spells that file's BARE basename as
 * human-readable prose — the exact D8 gap 8 shape (measured 2026-08-19).
 */
const ECHO_PROSE_COMMAND = `bunx vitest run ${REAL_TEST_RELATIVE} && echo 'ran real.test.ts successfully'`;

/** Same shape, but the runner segment names a path that genuinely does not exist. */
const MISSING_RUNNER_PATH_COMMAND =
  "bunx vitest run packages/x/ghost.test.ts && echo 'expected ghost.test.ts to exist'";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Spawns the COMPILED binary. `CLAUDECODE=1` resolves the "agent" caller
 * surface (SPEC-024) so no `create`/`ac add` risks a nested AI call; a fixed
 * `LORE_ACTOR` keeps writes attributable.
 */
async function runLore(args: string[], cwd: string): Promise<RunResult> {
  const proc = await runLoreInProcess(args, {
    cwd,
    home: cwd,
    env: {
      ...process.env,
      HOME: cwd,
      CLAUDECODE: "1",
      LORE_ACTOR: "agent:ac-061-21-probe",
    },
  });
  return {
    stdout: proc.stdout,
    stderr: proc.stderr,
    exitCode: proc.exitCode,
  };
}

function parseSlug(stdout: string): string {
  const match = stdout.match(/Slug:\s+(\S+)/);
  const slug = match?.[1];
  if (slug === undefined) throw new Error(`could not parse slug from: ${stdout}`);
  return slug;
}

/**
 * Creates the ONE file the accept scenario's runner segment names, at the
 * throwaway corpus root — `checkDeclaredPathExistence`'s `pathContext.cwd`
 * is the CLI's `process.cwd()`, which `runLore` sets to `dir`. Contents are
 * irrelevant; only existence is checked.
 */
function seedRealTestFile(dir: string): void {
  mkdirSync(join(dir, "packages", "x"), { recursive: true });
  writeFileSync(join(dir, REAL_TEST_RELATIVE), "// existence-only fixture\n");
}

/** Reads the spec's CURRENT declared acceptance-criteria ids straight from the corpus. */
async function readCriterionIds(dir: string, specSlug: string): Promise<string[]> {
  const result = await runLore(["get", specSlug, "--json"], dir);
  if (result.exitCode !== 0) throw new Error(`lore get failed: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout) as {
    data: { doc: { extra: { acceptance_criteria?: Array<{ id: string }> } } };
  };
  return (parsed.data.doc.extra.acceptance_criteria ?? []).map((c) => c.id);
}

async function addCriterion(dir: string, specSlug: string, id: string, command: string): Promise<RunResult> {
  return await runLore(
    [
      "ac",
      "add",
      specSlug,
      id,
      "--statement",
      `Does the thing (${id})`,
      "--mode",
      "script",
      "--oracle",
      "test",
      "--command",
      command,
    ],
    dir,
  );
}

let dir: string;
let specSlug: string;

beforeAll(async () => {

  dir = mkdtempSync(join(tmpdir(), "lore-ac-061-21-"));
  // Never inside this repo — the corpus under test must not be the repo's own.
  expect(dir.startsWith(REPO_ROOT)).toBe(false);

  const init = await runLore(["init"], dir);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);
  seedRealTestFile(dir);

  const prd = await runLore(
    ["create", "prd", "--title", "AC-061-21 Root", ...templatedFieldsArgs("prd", { refTarget: "problem" }), "--no-ai"],
    dir,
  );
  if (prd.exitCode !== 0) throw new Error(`create prd failed: ${prd.stderr}`);

  const spec = await runLore(
    [
      "create",
      "spec",
      "--title",
      "AC-061-21 Spec",
      ...templatedFieldsArgs("spec", { kind: "feature", refTarget: "problem" }),
      "--no-ai",
    ],
    dir,
  );
  if (spec.exitCode !== 0) throw new Error(`create spec failed: ${spec.stderr}`);
  specSlug = parseSlug(spec.stdout);
});

afterAll(() => {
  if (dir !== undefined) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup of a throwaway dir */
    }
  }
});

describe("AC-061-21 — compiled lore ac add scopes its path precheck to runner segments", () => {
  it("accepts a declaration whose success-echo segment mentions the real file's bare basename as prose, and writes the criterion", async () => {
    expect(await readCriterionIds(dir, specSlug)).toEqual([]);

    const accepted = await addCriterion(dir, specSlug, "AC-CLI-1", ECHO_PROSE_COMMAND);

    expect(accepted.exitCode).toBe(0);
    expect(await readCriterionIds(dir, specSlug)).toEqual(["AC-CLI-1"]);
  });

  it("still refuses a genuinely missing path named in the RUNNER segment, echo prose notwithstanding, and writes nothing", async () => {
    const before = await readCriterionIds(dir, specSlug);

    const refused = await addCriterion(dir, specSlug, "AC-CLI-2", MISSING_RUNNER_PATH_COMMAND);

    expect(refused.exitCode).toBe(4);
    expect(refused.stderr).toContain("packages/x/ghost.test.ts");
    // Nothing was written — the criteria list is byte-unchanged from before this call.
    expect(await readCriterionIds(dir, specSlug)).toEqual(before);
  });
});
