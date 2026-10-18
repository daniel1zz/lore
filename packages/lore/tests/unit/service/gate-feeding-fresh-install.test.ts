// @spawns packages/lore/src/index.ts
// @spawns scripts/seed-write-spec-rule.ts
/**
 * spec-governance-visibility-an-armed-gate-that-vacuously-passes §B3 — "a fresh
 * consumer install receives an empty feeding pack".
 *
 * `CorpusService._createImpl`'s spec-create gate enrichment (SPEC-049 §Design
 * Decisions D3) pre-fetches an approved `knowledge/skill` doc
 * (`findFeedingSkill("spec")`) and threads its slug/content into the denial's
 * feeding pack as `ruleSource`/`ruleMarkdown`. That lookup is a CORPUS read: a
 * project that has only ever run `lore init` has zero `knowledge` docs, so the
 * lookup always missed there, and the pack degraded all the way to a bare
 * `[source: unknown]` discriminator with an EMPTY rule slice — the gate ships in
 * the binary, but the rules that make its denial actionable did not (defeating
 * the whole "a denial carries the rule that explains it" IoC design, tech-spec
 * §4.1/§11). `corpus-service.ts` now falls back to a compiled-in
 * `FALLBACK_SPEC_CREATE_RULE_SOURCE`/`_MARKDOWN` pair when the corpus lookup
 * misses (`ok(null)`) OR fails outright (`!ok`) — this file proves that.
 *
 * ⛔ THE "both-ends" TEST MUST CONSTRUCT BOTH ENDS IN ONE RUN
 * (knowledge-retro-a-fresh-install-probe-vacuously-passes) — a single-ended probe
 * against only a fresh corpus cannot tell "the assertion is meaningful" from "the
 * assertion always trivially passes". End 1 is a genuinely fresh `mkdtemp` +
 * `lore init` corpus; end 2 is a SEEDED CONTROL — a second throwaway
 * `mkdtemp` + `lore init` corpus into which `scripts/seed-write-spec-rule.ts` (the
 * script this repo's own deploy runs against its real corpus) has seeded the
 * approved write-spec rule doc, i.e. a corpus that genuinely has the feeding source
 * the fresh end lacks. ⛔ This file never opens, copies or backs up this repository's
 * own `.lore/lore.db` (test-governance TG-3: a test whose control end reads live
 * corpus state goes red on unrelated corpus work and risks writing the team's
 * knowledge base). Both ends are disposable `mkdtemp` directories, mirroring
 * `packages/dashboard/tests/e2e/global-setup.ts`'s throwaway-corpus pattern.
 *
 * `runLore` spawns the real CLI (`bun run src/index.ts`) rather than importing
 * `commands/create.ts` in-process — that module transitively imports
 * `loader.ts` -> `app.ts` -> `bun:sqlite`, which vitest cannot statically
 * resolve (mirrors `cli-ac-set.test.ts`/`cli-strict-flags-incidents.test.ts`'s
 * proven subprocess pattern, same package).
 *
 * Six-dimension coverage:
 *   HAPPY:      corpus HAS an approved knowledge/skill doc -> ruleSource/
 *               ruleMarkdown come from THAT doc, fallback never consulted
 *               (unit-level, InMemoryStore — regression guard for D3's
 *               original behavior, which this task must not disturb)
 *   NEGATIVE:   corpus has ZERO knowledge docs -> falls back to the compiled-in
 *               constant, never `[source: unknown]` (unit-level)
 *   BOUNDARY:   the "both-ends" integration test — fresh mkdtemp+init corpus
 *               AND a live-corpus control in the SAME run, both denials
 *               non-empty with a named, DISTINCT source
 *   ERROR:      `findFeedingSkill`'s underlying `store.findMany` call fails
 *               outright (STORE_ERROR) -> STILL falls back (the `!ok` branch,
 *               not just `ok(null)`), never a thrown exception or a degraded
 *               `[source: unknown]`
 *   STATE:      `workflow.gates.spec-create.enabled: false` -> the fallback is
 *               NEVER consulted (ctx carries no ruleSource/ruleMarkdown at
 *               all) — the create simply passes, mirroring `gate-enforcer-
 *               service-layer.bun.test.ts`'s pre-existing disabled-gate guard
 *   REGRESSION: the fallback's rule slice is genuinely non-empty content (not
 *               just a non-"unknown" label with an empty body) on both the
 *               unit-level and both-ends assertions
 *
 * @spec_ref spec-governance-visibility-an-armed-gate-that-vacuously-passes §B3, AC-GV-5
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import type { StoreFilters } from "../../../src/store/store-interface.js";
import { err } from "@lore/core";
import type { CreateDocInput, DocRecord, LoreConfig, LoreError, Result } from "@lore/core";
import { actedStore } from "../../live-invocation.js";

// tests/unit/service/ -> tests/unit/ -> tests/ -> packages/lore/
const PACKAGE_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const SEED_SCRIPT = join(PACKAGE_ROOT, "..", "..", "scripts", "seed-write-spec-rule.ts");
const NO_HEADING_CONTENT = "no headings anywhere in this body";

// ─── Subprocess CLI harness (mirrors cli-ac-set.test.ts's proven pattern) ────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Spawn `bun run <INDEX_TS> ...args` in `cwd` with an isolated HOME dir. */
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

/** Parses `--json`-flagged `lore create`/`lore list` stdout, throwing with context on failure. */
function parseJsonStdout(result: RunResult, label: string): { ok: boolean; data?: unknown } {
  try {
    return JSON.parse(result.stdout) as { ok: boolean; data?: unknown };
  } catch (e) {
    throw new Error(
      `${label}: failed to parse stdout as JSON (exit ${result.exitCode}).\n` +
        `stdout: ${result.stdout}\nstderr: ${result.stderr}\ncause: ${String(e)}`,
    );
  }
}

/** Extracts the `[source: X, trust: Y]` header's `X` from a rendered feeding-pack message. */
function extractSource(message: string): string | null {
  const m = /\[source: ([^,]+), trust: [^\]]+\]/.exec(message);
  return m ? m[1] ?? null : null;
}

/**
 * Seeds the approved write-spec rule doc (`sub_type: "skill"`, `applies_to: "spec"`)
 * into the throwaway corpus at `corpusDir` by running the repo's own seed script
 * against that corpus's db — the same script the real deploy runs, so the control end
 * is populated by production code, not a hand-built imitation.
 */
function seedWriteSpecRuleInto(corpusDir: string): void {
  const result = spawnSync("bun", [SEED_SCRIPT, join(corpusDir, ".lore", "lore.db")], {
    cwd: corpusDir,
    env: { ...process.env, HOME: corpusDir },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `seed-write-spec-rule failed (exit ${String(result.status)}).\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  }
}

// ─── Unit-level coverage (InMemoryStore, no subprocess) ──────────────────────

function makeGatedService(store: InMemoryStore = actedStore(new InMemoryStore())) {
  const gateEnforcer = new GateEnforcer(undefined);
  return { service: new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)), undefined, undefined, gateEnforcer), store };
}

async function createApprovedPrd(service: CorpusService, title: string): Promise<DocRecord> {
  const created = await service.create({
    type: "prd",
    title,
    content: "PRD body",
  } as CreateDocInput);
  if (!created.ok) throw new Error(`prd create failed: ${JSON.stringify(created.error)}`);
  return created.value;
}

describe("CorpusService spec-create fallback — HAPPY", () => {
  it("a corpus WITH an approved knowledge/skill doc uses its slug/content, never the fallback", async () => {
    const { service } = makeGatedService();
    const prd = await createApprovedPrd(service, "Root PRD");

    const skillCreate = await service.create({
      type: "knowledge",
      title: "Team write-spec rules",
      content: "## Rule\n\nDistinctive team-authored rule text.",
      extra: { sub_type: "skill", skill: { applies_to: "spec" } },
    } as CreateDocInput);
    if (!skillCreate.ok) throw new Error(`skill create failed: ${JSON.stringify(skillCreate.error)}`);
    const skillApprove = await service.set(skillCreate.value.id, { status: "approved" });
    if (!skillApprove.ok) throw new Error(`skill approve failed: ${JSON.stringify(skillApprove.error)}`);

    const spec = await service.create({
      type: "spec",
      title: "Bad Spec",
      content: NO_HEADING_CONTENT,
    } as CreateDocInput);

    expect(spec.ok).toBe(false);
    if (spec.ok) return;
    const message = (spec.error as { message?: string }).message ?? "";
    expect(message).toContain(`[source: ${skillApprove.value.slug}, trust: team-authored]`);
    expect(message).toContain("Distinctive team-authored rule text.");
    expect(message).not.toContain("built-in fallback");
  });
});

describe("CorpusService spec-create fallback — NEGATIVE", () => {
  it("an EMPTY corpus (zero knowledge docs) falls back to the compiled-in rule slice, never [source: unknown]", async () => {
    const { service } = makeGatedService();
    const prd = await createApprovedPrd(service, "Root PRD");

    const spec = await service.create({
      type: "spec",
      title: "Bad Spec",
      content: NO_HEADING_CONTENT,
    } as CreateDocInput);

    expect(spec.ok).toBe(false);
    if (spec.ok) return;
    const message = (spec.error as { message?: string }).message ?? "";
    expect(message).not.toContain("[source: unknown");
    const source = extractSource(message);
    expect(source).not.toBeNull();
    expect(source).toBe("built-in fallback (no seeded rule doc)");
    // The rule slice itself must be genuinely present, not just a named,
    // still-empty label (the exact failure shape a single "not unknown"
    // assertion alone would miss).
    expect(message).toContain("## Rules a candidate spec must satisfy");
    expect(message).toContain("No parent.");
  });
});

describe("CorpusService spec-create fallback — ERROR", () => {
  it("a failing findFeedingSkill lookup (store.findMany errors) ALSO falls back, never throws or degrades to [source: unknown]", async () => {
    class FindManyFailingStore extends InMemoryStore {
      override async findMany(filters: StoreFilters): Promise<Result<DocRecord[], LoreError>> {
        if (filters.type === "knowledge") {
          return err({ code: "STORE_ERROR", message: "simulated findMany failure" });
        }
        return super.findMany(filters);
      }
    }

    const { service } = makeGatedService(new FindManyFailingStore());
    const prd = await createApprovedPrd(service, "Root PRD");

    const spec = await service.create({
      type: "spec",
      title: "Bad Spec",
      content: NO_HEADING_CONTENT,
    } as CreateDocInput);

    expect(spec.ok).toBe(false);
    if (spec.ok) return;
    const message = (spec.error as { message?: string }).message ?? "";
    expect(message).not.toContain("[source: unknown");
    expect(extractSource(message)).toBe("built-in fallback (no seeded rule doc)");
    expect(message).toContain("## Rules a candidate spec must satisfy");
  });
});

describe("CorpusService spec-create fallback — STATE", () => {
  it("a DISABLED spec-create gate never consults the fallback — the create simply passes", async () => {
    const gateEnforcer = new GateEnforcer({
      project: { name: "x", author: "owner" },
      workflow: { gates: { "spec-create": { enabled: false } } },
    } as unknown as LoreConfig);
    const store = actedStore(new InMemoryStore());
    const service = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)), undefined, undefined, gateEnforcer);
    const prd = await createApprovedPrd(service, "Root PRD");

    const spec = await service.create({
      type: "spec",
      title: "Skeleton-less Spec",
      content: NO_HEADING_CONTENT,
    } as CreateDocInput);

    expect(spec.ok).toBe(true);
  });
});

// ─── both-ends integration probe (AC-GV-5) ───────────────────────────────────

describe("gate-feeding fresh-install both-ends probe", () => {
  // reason: this body spawns ~7 subprocesses (bun CLI x8, the seed script) — scripts/check-test-budgets.ts's
  // SPAWN_THRESHOLD (3) requires a declared timeout for any new test case at or
  // above that count (spec-a-test-case-s-timeout-budget-must-be-declared-when-its
  // D1). 60s mirrors cli-ac-set.test.ts's identical CLI-subprocess-spawning
  // precedent in this same package.
  it(
    "both-ends: a fresh lore-init corpus AND a seeded throwaway corpus both produce a non-empty, named rule slice",
    { timeout: 60_000 },
    () => {
      // ── END 1: a genuinely fresh mkdtemp + `lore init` corpus ──────────────
      const freshDir = mkdtempSync(join(tmpdir(), "lore-gate-feeding-fresh-"));
      try {
        const initResult = runLore(["init"], freshDir);
        expect(initResult.exitCode).toBe(0);
        // reason: task-assert-the-plan-close-vacuity-discriminator-on-the-render
        // finding 3 (root CLAUDE.md's "an EMPTY output artifact is the same shape
        // as a clean one" lesson) — exit 0 alone does not prove `lore init`
        // actually ran and produced real state; a probe end that silently
        // no-op'd would still leave `initResult.exitCode` at 0. Asserting the
        // fresh corpus's OWN db path exists on disk is the positive trace: it
        // can only be true if the `lore init` subprocess genuinely executed
        // against `freshDir`, mirroring the SAME `existsSync(controlDbPath)`
        // check END 2 already applies to its own corpus below.
        expect(existsSync(join(freshDir, ".lore", "lore.db"))).toBe(true);

        const prdResult = runLore(
          ["create", "prd", "--title", "Fresh Root PRD", "--content", "# Fresh Root\n\nBody.", "--json"],
          freshDir,
        );
        expect(prdResult.exitCode).toBe(0);
        const prdParsed = parseJsonStdout(prdResult, "fresh prd create") as {
          ok: boolean;
          data?: { slug?: string };
        };
        const freshPrdSlug = prdParsed.data?.slug;
        if (!freshPrdSlug) throw new Error(`fresh prd create produced no slug: ${prdResult.stdout}`);
  
        const freshDeny = runLore(
          [
            "create",
            "spec",
            "--title",
            "Bad Fresh Spec",
            "--content",
            NO_HEADING_CONTENT,
            "--kind",
            "feature",
          ],
          freshDir,
        );
  
        // exit 4 == VALIDATION_ERROR (adapters/cli/CLAUDE.md exit-code table)
        expect(freshDeny.exitCode).toBe(4);
        expect(freshDeny.stderr).not.toContain("[source: unknown");
        const freshSource = extractSource(freshDeny.stderr);
        expect(freshSource).not.toBeNull();
        expect(freshSource).toBe("built-in fallback (no seeded rule doc)");
        expect(freshDeny.stderr).toContain("## Rules a candidate spec must satisfy");
        expect(freshDeny.stderr).toContain("No parent.");
  
        // ── END 2: a SEEDED throwaway corpus, used as the control ─────────────
        // Also mkdtemp + `lore init`, then populated by the repo's own seed script.
        const controlDir = mkdtempSync(join(tmpdir(), "lore-gate-feeding-control-"));
        try {
          const controlInit = runLore(["init"], controlDir);
          expect(controlInit.exitCode).toBe(0);
          const controlDbPath = join(controlDir, ".lore", "lore.db");
          expect(existsSync(controlDbPath)).toBe(true);
          seedWriteSpecRuleInto(controlDir);

          const controlPrd = runLore(
            ["create", "prd", "--title", "Control Root PRD", "--content", "# Control Root\n\nBody.", "--json"],
            controlDir,
          );
          expect(controlPrd.exitCode).toBe(0);

          const controlDeny = runLore(
            [
              "create",
              "spec",
              "--title",
              "Bad Control Spec",
              "--content",
              NO_HEADING_CONTENT,
              "--kind",
              "feature",
            ],
            controlDir,
          );
  
          expect(controlDeny.exitCode).toBe(4);
          expect(controlDeny.stderr).not.toContain("[source: unknown");
          const controlSource = extractSource(controlDeny.stderr);
          expect(controlSource).not.toBeNull();
          expect(controlSource ?? "").not.toBe("");
  
          // ── Cross-check: the two ends must NOT collapse to the same
          // evaluation. If they did, either the fresh end is secretly finding
          // real content (impossible — it never had any) or the assertion
          // helper itself cannot discriminate a miss from a hit — the exact
          // vacuous-probe failure mode this test exists to rule out.
          expect(controlSource).not.toBe(freshSource);
          // The control's source must be the SEEDED corpus doc
          // (scripts/seed-write-spec-rule.ts), not another compiled-in fallback string.
          expect(controlSource).toContain("write-spec-rules");
          // re-baseline (BR-1, BR-2): rule 1 of the seeded doc is now "No parent." (a spec belongs to the trees through citations)
          expect(controlDeny.stderr).toContain("No parent.");
        } finally {
          rmSync(controlDir, { recursive: true, force: true });
        }
      } finally {
        rmSync(freshDir, { recursive: true, force: true });
      }
    },
  );
});
