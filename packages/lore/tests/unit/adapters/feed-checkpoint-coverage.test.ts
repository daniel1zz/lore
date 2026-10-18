// @spawns packages/lore/src/index.ts
/**
 * AC-FR-1 (task-derive-lore-feed-s-checkpoint-set-from-the-registry-make,
 * spec-falsifiability-reachability-a-feedable-checkpoint-an) — `lore feed`'s
 * accepted checkpoint set derives from `checkpointRegistry`, not a parallel
 * hand-maintained list.
 *
 * Measured baseline (2026-08-10, on the merged tree, before this task):
 *   spec-create      exit=0   [source: knowledge-write-spec-rules-gate-feeding-source, ...]
 *   spec-promote      exit=0   "unknown checkpoint: spec-promote"
 *   plan-promote      exit=0   "unknown checkpoint: plan-promote"
 *   task-claim        exit=0   "unknown checkpoint: task-claim"
 * Three of four deterministic gates were unfeedable, AND an unknown checkpoint
 * exited 0 (silent success) rather than refusing — a script running
 * `lore feed spec-promote && <next step>` proceeded as though a pack had been
 * delivered.
 *
 * This suite enumerates `checkpointRegistry`'s keys AT TEST TIME
 * (`Object.keys(checkpointRegistry)`, never a hand-listed array) and drives the
 * REAL CLI (`bun run src/index.ts feed <checkpoint>`) once per entry, against a
 * throwaway `mkdtemp` + `lore init` corpus seeded with one approved
 * `knowledge/skill` doc per checkpoint (never the repo's own `.lore/`, per
 * project CLAUDE.md). Seeding uses the SAME discovery-scope derivation
 * `buildFeed` itself uses (`CHECKPOINT_PRODUCED_TYPE[checkpoint] ?? checkpoint`,
 * imported from `flows/feed-flow.ts`, never re-derived by hand here) — so this
 * test proves the discovery mechanism generalizes to every registered
 * checkpoint, not just that a bare fallback string appears.
 *
 * `bun run src/index.ts` resolves relative to THIS file's own location inside
 * THIS worktree (`PACKAGE_ROOT`/`INDEX_TS` below) — the global `lore` binary is
 * a symlink into the MAIN checkout's `dist/`, so a bare `lore` invocation here
 * would silently test someone else's build (project CLAUDE.md standing lesson).
 * Seeding the skill docs needs the SERVICE layer (`CorpusService.create`/`set`)
 * to write `extra.skill.applies_to` — no CLI flag exists for it (only
 * `scripts/seed-write-spec-rule.ts` does this, via `createApp` directly) — so a
 * small seeder script is written to the throwaway corpus's own tmpdir and run
 * as a SEPARATE `bun` subprocess (this file itself never imports `bun:sqlite`,
 * keeping it vitest-safe; `feed-flow.ts`/`checkpoint-registry.ts` are already
 * proven vitest-reachable by pre-existing sibling test files).
 *
 * Six-dimension coverage:
 *   HAPPY:      every checkpoint currently in `checkpointRegistry` (8, as of
 *               this task: spec-create/spec-promote/plan-promote/task-claim/
 *               plan-close/phase-claim/task-create/review-judgment) exits 0
 *               with a non-empty rule slice naming its source — asserted by
 *               enumeration, never a hand-listed set.
 *   NEGATIVE:   an UNREGISTERED checkpoint name exits EXACTLY 2, never 0 — the
 *               sharper half of the baseline defect (a silent-success advisory
 *               note that let a script proceed as though fed).
 *   BOUNDARY:   exit codes asserted EXACTLY (0 / 2), never "non-zero" — a tool
 *               dying before the check runs also exits non-zero and would have
 *               zero discriminating power here.
 *   ERROR:      a checkpoint name that only differs by case
 *               ("Spec-Promote") is NOT registered (case-sensitive lookup) and
 *               is refused exactly like a wholly unrelated typo — proves the
 *               registered-set membership check is not doing fuzzy matching.
 *   STATE:      driving `lore feed` for every checkpoint does not mutate the
 *               corpus (feed is advisory-only, module header) — doc count is
 *               unchanged after all 8 invocations.
 *   REGRESSION: the exact three checkpoints the baseline measured as
 *               unfeedable (`spec-promote`/`plan-promote`/`task-claim`) are
 *               explicitly covered by the enumeration and now succeed.
 *
 * @spec_ref spec-falsifiability-reachability-a-feedable-checkpoint-an AC-FR-1
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { checkpointRegistry } from "../../../src/service/checkpoint-registry.js";
import { CHECKPOINT_PRODUCED_TYPE } from "../../../src/flows/feed-flow.js";

// tests/unit/adapters/ -> tests/unit/ -> tests/ -> packages/lore/
const PACKAGE_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const APP_TS = join(PACKAGE_ROOT, "src", "app.ts");
const LIVE_TS = join(PACKAGE_ROOT, "tests", "live-invocation.ts");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Spawn `bun run <INDEX_TS> ...args` in `cwd` with an isolated HOME dir (mirrors cli-ac-set.test.ts's proven subprocess pattern). */
function runLore(args: string[], cwd: string): RunResult {
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true" },
    encoding: "utf8",
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? -1,
  };
}

/**
 * One `knowledge/skill` doc this suite seeds — `appliesTo` matches whatever
 * discovery scope `buildFeed` will actually use for the checkpoint it's meant
 * to feed (see `discoveryScopeFor` below), and `marker` is a unique token
 * embedded in `content` so a passing assertion can prove the OUTPUT actually
 * came from THIS doc, not a different one or a bare fallback note.
 */
interface SeedSpec {
  readonly appliesTo: string;
  readonly title: string;
  readonly content: string;
}

/** A distinctive, greppable marker embedded in each seeded skill doc's content. */
function ruleMarker(checkpoint: string): string {
  return `RULE-MARKER-${checkpoint}`;
}

/**
 * The SAME discovery-scope derivation `buildFeed` (`flows/feed-flow.ts`) uses
 * internally — imported, never hand-re-derived — so this suite's fixture setup
 * can never silently drift from what production actually looks up.
 */
function discoveryScopeFor(checkpoint: string): string {
  return CHECKPOINT_PRODUCED_TYPE[checkpoint] ?? checkpoint;
}

/**
 * Writes a throwaway seeder script into `scriptDir` and runs it as a SEPARATE
 * `bun` subprocess against `dbPath` — creates + fast-track-approves one
 * `knowledge/skill` doc per `specs` entry via `CorpusService.create`/`set`
 * directly (the only way to set `extra.skill.applies_to`; no CLI flag exists
 * for it). Throws with full stdout/stderr context on any failure.
 */
function seedSkillDocs(dbPath: string, scriptDir: string, specs: readonly SeedSpec[]): void {
  const scriptPath = join(scriptDir, "seed-skills.ts");
  const scriptSource = `
import { createApp } from ${JSON.stringify(APP_TS)};
import { liveAmbient, liveWriteContext } from ${JSON.stringify(LIVE_TS)};

const dbPath = process.argv[2];
const specs = JSON.parse(process.argv[3]);

const app = createApp(dbPath, undefined, liveAmbient(), liveWriteContext());
try {
  for (const spec of specs) {
    const createResult = await app.corpusService.create({
      type: "knowledge",
      title: spec.title,
      content: spec.content,
      extra: { sub_type: "skill", skill: { applies_to: spec.appliesTo } },
    });
    if (!createResult.ok) {
      console.error("CREATE_FAILED", spec.appliesTo, JSON.stringify(createResult.error));
      process.exit(1);
    }
    const approveResult = await app.corpusService.set(createResult.value.id, { status: "approved" });
    if (!approveResult.ok) {
      console.error("APPROVE_FAILED", spec.appliesTo, JSON.stringify(approveResult.error));
      process.exit(1);
    }
  }
  console.log("SEED_OK");
} finally {
  app.close();
}
`;
  writeFileSync(scriptPath, scriptSource, "utf8");

  const result = spawnSync("bun", ["run", scriptPath, dbPath, JSON.stringify(specs)], {
    encoding: "utf8",
  });
  if (result.status !== 0 || !(result.stdout ?? "").includes("SEED_OK")) {
    throw new Error(
      `seedSkillDocs failed (exit ${result.status}).\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  }
}

describe("derived-from-registry — lore feed's checkpoint set derives from checkpointRegistry (AC-FR-1)", () => {
  let tmpDir: string;
  let dbPath: string;

  // AT TEST TIME — never a hand-listed array. This is the ONE enumeration
  // every assertion below is built from.
  const registeredCheckpoints = Object.keys(checkpointRegistry);

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-feed-checkpoint-coverage-"));
    mkdirSync(tmpDir, { recursive: true });

    const init = runLore(["init"], tmpDir);
    if (init.exitCode !== 0) {
      throw new Error(`lore init failed (exit ${init.exitCode}): ${init.stderr}`);
    }
    dbPath = join(tmpDir, ".lore", "lore.db");

    const specs: SeedSpec[] = registeredCheckpoints.map((checkpoint) => ({
      appliesTo: discoveryScopeFor(checkpoint),
      title: `Feed coverage rule — ${checkpoint}`,
      content: `## Rule\n\n${ruleMarker(checkpoint)}\n\nGoverning rule for checkpoint "${checkpoint}".\n`,
    }));
    seedSkillDocs(dbPath, tmpDir, specs);
  }, 60_000);

  afterAll(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  describe("HAPPY + REGRESSION", () => {
    // registeredCheckpoints is resolved at describe-time (module load), which
    // is AT TEST TIME for vitest's own collection phase — still driven off the
    // SAME `Object.keys(checkpointRegistry)` call above, never a second list.
    it.each(registeredCheckpoints)(
      'checkpoint "%s": lore feed exits 0 with a non-empty rule slice naming its source',
      (checkpoint) => {
        const result = runLore(["feed", checkpoint], tmpDir);

        expect(result.exitCode).toBe(0);
        expect(result.stdout.length).toBeGreaterThan(0);
        // Naming its source: the real `renderFeedingPack` provenance header —
        // never the bare "no approved governing skill for X" / "unknown
        // checkpoint: X" shapes.
        expect(result.stdout).toContain("[source:");
        // Proves the rule slice that came back is THIS checkpoint's own seeded
        // doc, not a different one and not a fallback note.
        expect(result.stdout).toContain(ruleMarker(checkpoint));
      },
      60_000,
    );
  });

  describe("NEGATIVE + BOUNDARY", () => {
    it(
      "an UNREGISTERED checkpoint name exits EXACTLY 2, never 0 (never a silent-success advisory)",
      () => {
        const result = runLore(["feed", "totally-unknown-checkpoint-xyz"], tmpDir);

        expect(result.exitCode).toBe(2);
        expect(result.stderr).toContain("totally-unknown-checkpoint-xyz");
        // The pre-fix defect: this used to print a one-line note and exit 0.
        expect(result.stdout).toBe("");
      },
      30_000,
    );
  });

  describe("ERROR", () => {
    it(
      "checkpoint-name lookup is case-sensitive — a differently-cased real checkpoint is refused like any other unregistered name",
      () => {
        // "spec-promote" IS registered; "Spec-Promote" must NOT fuzzy-match it.
        expect(registeredCheckpoints).toContain("spec-promote");
        const result = runLore(["feed", "Spec-Promote"], tmpDir);

        expect(result.exitCode).toBe(2);
      },
      30_000,
    );
  });

  describe("STATE", () => {
    it(
      "feeding every registered checkpoint does not mutate the corpus (feed stays advisory-only)",
      () => {
        const before = runLore(["list", "--json"], tmpDir);
        expect(before.exitCode).toBe(0);
        const beforeCount = (JSON.parse(before.stdout) as { data: { docs: unknown[] } }).data.docs.length;

        for (const checkpoint of registeredCheckpoints) {
          const fed = runLore(["feed", checkpoint], tmpDir);
          expect(fed.exitCode).toBe(0);
        }

        const after = runLore(["list", "--json"], tmpDir);
        expect(after.exitCode).toBe(0);
        const afterCount = (JSON.parse(after.stdout) as { data: { docs: unknown[] } }).data.docs.length;

        expect(afterCount).toBe(beforeCount);
      },
      120_000,
    );
  });
});
