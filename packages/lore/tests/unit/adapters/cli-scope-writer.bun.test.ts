// @reads assets/project/lore-config-template.yaml
/**
 * `lore scope add|rm|list` + `lore create task --ac-scope` — the declared-scope
 * authoring surface's CLI contract (spec-declared-scope-attestation-contract-
 * task-owned-ac-scope §Contract Details "Authoring surface", AC-VS-9/10/11).
 *
 * Spawns the COMPILED `dist/lore` binary (Bun.spawnSync) against a THROWAWAY
 * corpus (mkdtemp + `lore init`) — never touches the repo's own `.lore/`
 * corpus (project CLAUDE.md hard rule). Requires `bun run build` first;
 * `assertFreshBinary` fails loud before any test runs if `dist/lore` is
 * missing or older than the newest `.ts` source under
 * `packages/{lore,core}/src` (false-oracle vector 4).
 *
 * Fixture chain (all through real CLI verbs — no store-level seeding, so the
 * whole authoring path is exercised end to end):
 *   prd → spec (`## Overview` heading — the spec-create gate's hasSkeleton
 *   predicate) → `lore ac add` ×2 (so `lore evidence --ac` passes its
 *   cross-entity check against the parent spec's declared ids) → plan →
 *   `lore phase add` → task (`--phase`) + `lore evidence --ac` →
 *   `lore migrate tasks-to-phases` (the ONLY CLI path that materialises a
 *   `phase` DOC — there is deliberately no `lore create phase`; the migration
 *   merges the source task's evidence, `ac_ref` included, onto the phase).
 *
 * Coverage:
 *   HAPPY:      `create task --ac-scope` (repeatable) round-trips through
 *               `lore get --json` (AC-VS-10); `scope add` → `scope list`
 *   NEGATIVE:   `scope rm` of an EVIDENCED id → exit 4, pinned literal, id
 *               still present, for a task AND for a phase, with the
 *               non-evidenced control removal on the SAME fixture exiting 0
 *               (AC-VS-9); a non-task/non-phase target → exit 4; an
 *               empty-string id → exit 4 naming ac_scope
 *   BOUNDARY:   add-then-rm of the last id leaves `ac_scope: []` (present,
 *               empty) NOT an absent key, unrelated `extra` keys byte-
 *               identical, and `lore set --ac-scope` exits 2 (AC-VS-11);
 *               `scope list` on a task that never declared a scope
 *   ERROR:      `scope add` on a nonexistent target → exit 3
 *   STATE:      a scope edit leaves `extra.claim` + `extra.verification_evidence`
 *               byte-identical (the AC-S3-5 anchor-writer invariant, re-asserted
 *               at this sibling writer)
 *   REGRESSION: omitting `--ac-scope` on `create task` leaves `ac_scope`
 *               ABSENT (never `[]`) — the absent-vs-empty distinction AC-VS-5
 *               makes contractual must already hold at creation time;
 *               `scope add` of an already-declared id does not duplicate it
 *
 * @spec_ref AC-VS-9, AC-VS-10, AC-VS-11
 *
 * TG-25 (adr-tg-1 option b): the commands run IN-PROCESS through tests/helpers/run-lore-in-process.ts, not through
 * dist/lore. Wherever the prose above says the compiled binary is spawned or its freshness asserted, that is the
 * history of this file; the assertions and the throwaway-corpus rule are unchanged.
 */

import { describe, expect, it, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
const setDefaultTimeout = (ms: number): void => { vi.setConfig({ testTimeout: ms, hookTimeout: ms }); };
import { cpSync, mkdtempSync, rmSync } from "fs";
import { patchLoreConfig } from "../../helpers/patch-lore-config.js";
import { join } from "path";
import { tmpdir } from "os";
import { runLoreInProcess } from "../../helpers/run-lore-in-process";
import { planFieldsArgs, templatedFieldsArgs } from "../../helpers/templated-create.js";

// reason: the fixture chain below spawns ~10 compiled-binary processes; bun's
// 5s default applies to HOOKS too, so the one-time `beforeAll` seed and every
// per-test copy would time out at the default (measured: the seed alone
// exceeds 5s on a loaded machine). Raised once for the whole file rather than
// per hook/test so no future case silently inherits the 5s default.
setDefaultTimeout(120_000);

// tests/unit/adapters/ → tests/unit/ → tests/ → packages/lore/ → packages/ → repo root (5 levels up).
const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");

/** The exact refusal literal `assertScopeFreeze` carries (`packages/core/src/phase.ts`). */
const FREEZE_LITERAL = "cannot remove ac_scope id(s) with recorded evidence";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

async function runLore(args: string[], cwd: string): Promise<RunResult> {
  const proc = await runLoreInProcess(args, {
    cwd,
    home: cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true" },
  });
  return {
    stdout: proc.stdout,
    stderr: proc.stderr,
    exitCode: proc.exitCode,
  };
}

/** Runs a fixture-setup command, failing loud (never silently) on a nonzero exit. */
async function mustRun(args: string[], cwd: string): Promise<RunResult> {
  const result = await runLore(args, cwd);
  if (result.exitCode !== 0) {
    throw new Error(`fixture command \`lore ${args.join(" ")}\` failed (${result.exitCode}): ${result.stderr}`);
  }
  return result;
}

interface DocJson {
  readonly slug: string;
  readonly extra: Record<string, unknown>;
}

/** `lore get <slug> --json` → the doc record. */
async function getDoc(slug: string, cwd: string): Promise<DocJson> {
  const result = await mustRun(["get", slug, "--json"], cwd);
  return (JSON.parse(result.stdout) as { data: { doc: DocJson } }).data.doc;
}

/** Reads `extra.ac_scope` as-stored — `undefined` distinguishes ABSENT from `[]`. */
async function readAcScope(slug: string, cwd: string): Promise<string[] | undefined> {
  return (await getDoc(slug, cwd)).extra["ac_scope"] as string[] | undefined;
}

// ─── Fixture ────────────────────────────────────────────────────────────────

const PRD_SLUG = "prd-scope-root";
const SPEC_SLUG = "spec-scope-fixture";
const PLAN_SLUG = "plan-scope-fixture";
/** `lore migrate tasks-to-phases` titles each phase doc after the phase NAME. */
const PHASE_SLUG = "phase-alpha";

/**
 * Builds the shared prd→spec(+2 ACs)→plan→phase-doc fixture and returns the
 * migrated phase's slug. The phase doc carries ONE evidence entry whose
 * `ac_ref` is `AC-SC-1` (merged from the source task by the migration), which
 * is what makes the phase-tier freeze assertion possible.
 */
async function seedFixture(cwd: string): Promise<void> {
  await mustRun(["init"], cwd);
  // The task-claim gate (ancestor spec must be `approved`) is irrelevant to
  // THIS suite's subject — the scope writer. The fixture spec stays `draft`
  // deliberately (approving a spec would demand a review judgment, i.e. an AI
  // call), so the STATE case below disables the gate rather than faking one.
  //
  // reason: APPENDED, never written wholesale. `loadLoreApp` silently falls back
  // to `rawConfig = undefined` on ANY non-`ai` config parse failure (loader.ts,
  // "historical silent fallback"), and `lore init`'s config carries a required
  // `project:` block — so overwriting the file drops `project:`, the whole
  // config fails to parse, and EVERY gate stays on with no warning. Measured:
  // that shape leaves task-claim fully armed while reading as disabled. The
  // `mustRun(["claim", …])` call in the STATE case is the live control that this
  // append actually took effect (it throws if the gate still fires).
  //
  // reason: task-create (spec-declaring-ac-scope-is-required-at-task-creation-
  // so-the) is disabled for the SAME reason — this fixture's spec declares 2
  // script-mode ACs (AC-SC-1/2), which would otherwise make EVERY undeclared-
  // scope `createTask` call in this file (the writer's own subject — most
  // fixture tasks deliberately omit --ac-scope to exercise `lore scope add`
  // post-create) refuse at creation with AC_SCOPE_REQUIRED. This suite tests
  // the scope WRITER, not the admission gate; that gate has its own dedicated
  // coverage (create-task-ac-scope.test.ts / create-task-ac-scope-e2e.bun.test.ts).
  patchLoreConfig(
    cwd,
    [
      "workflow:",
      "  gates:",
      '    "task-claim":',
      "      enabled: false",
      '    "task-create":',
      "      enabled: false",
      "",
    ].join("\n"),
  );
  await mustRun(["create", "prd", "--title", "Scope Root", ...templatedFieldsArgs("prd"), "--no-ai"], cwd);
  await mustRun(
    ["create", "spec", "--title", "Scope Fixture", ...templatedFieldsArgs("spec", { kind: "feature" }), "--no-ai"],
    cwd,
  );
  for (const id of ["AC-SC-1", "AC-SC-2"]) {
    await mustRun(
      ["ac", "add", SPEC_SLUG, id, "--statement", `criterion ${id}`, "--mode", "script", "--oracle", "test", "--command", `bun test ${id}`],
      cwd,
    );
  }
  await mustRun(["create", "plan", "--title", "Scope Fixture", "--parent", SPEC_SLUG, ...planFieldsArgs(SPEC_SLUG), "--no-ai"], cwd);
  await mustRun(["phase", "add", PLAN_SLUG, "Alpha"], cwd);

  // Source task for the phase migration — its evidence (ac_ref AC-SC-1) is
  // merged onto the phase doc, then the task itself is archived.
  await mustRun(
    ["create", "task", "--title", "Migration Source", "--kind", "code", "--parent", PLAN_SLUG, "--plan-id", PLAN_SLUG, "--phase", "Alpha", ...templatedFieldsArgs("task"), "--no-ai"],
    cwd,
  );
  // reason: SUPERSEDED oracle (task-raise-the-evidence-tail-guard-s-
  // predicate-to-its-own) — "test" self-report is now refused regardless of
  // tail content; "manual" is the one oracle that still lets a genuinely
  // non-empty self-reported tail succeed. This fixture only needs a
  // successful pass row referencing AC-SC-1, not a specific oracle kind.
  await mustRun(
    ["evidence", "task-migration-source", "--oracle", "manual", "--command", "bun test AC-SC-1", "--result", "pass", "--ac", "AC-SC-1", "--output-tail", "ok"],
    cwd,
  );
  await mustRun(["migrate", "tasks-to-phases"], cwd);
}

/**
 * Creates a task under the fixture plan (AFTER the migration, so it survives
 * as a `task` doc) and returns its slug. `acScope`/`evidenceAc` are optional.
 */
async function createTask(
  cwd: string,
  title: string,
  opts: { acScope?: string[]; evidenceAc?: string; anchors?: string[] } = {},
): Promise<string> {
  const args = [
    "create",
    "task",
    "--title",
    title,
    "--kind",
    "code",
    "--parent",
    PLAN_SLUG,
    "--plan-id",
    PLAN_SLUG,
    ...templatedFieldsArgs("task"),
    "--no-ai",
    "--json",
  ];
  for (const id of opts.acScope ?? []) args.push("--ac-scope", id);
  for (const path of opts.anchors ?? []) args.push("--anchor", path);
  const created = await mustRun(args, cwd);
  const slug = (JSON.parse(created.stdout) as { data: { slug: string } }).data.slug;

  if (opts.evidenceAc !== undefined) {
    // reason: SUPERSEDED oracle (task-raise-the-evidence-tail-guard-s-
    // predicate-to-its-own) — see seedFixture's identical fix above.
    await mustRun(
      ["evidence", slug, "--oracle", "manual", "--command", `bun test ${opts.evidenceAc}`, "--result", "pass", "--ac", opts.evidenceAc, "--output-tail", "ok"],
      cwd,
    );
  }
  return slug;
}

/**
 * The fixture is seeded ONCE into `templateDir` and byte-copied per test —
 * ~10 compiled-binary spawns per test would otherwise dominate the suite's
 * runtime. The whole corpus is self-contained under `<dir>/.lore/` and located
 * by a cwd→root walk (never by an absolute path baked into config), so a
 * recursive directory copy is a faithful, fully isolated clone.
 */
let templateDir: string;
let tmpDir: string;

beforeAll(async () => {
  templateDir = mkdtempSync(join(tmpdir(), "lore-cli-scope-writer-template-"));
  await seedFixture(templateDir);
});

afterAll(() => {
  try {
    rmSync(templateDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-cli-scope-writer-"));
  cpSync(templateDir, tmpDir, { recursive: true });
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

// ─── AC-VS-10 — HAPPY: create task --ac-scope round trip ────────────────────

describe("lore create task --ac-scope (AC-VS-10)", () => {
  it("create task with ac-scope round trip — repeatable flags author exactly the ids passed", async () => {
    const slug = await createTask(tmpDir, "Scoped Task", { acScope: ["AC-SC-1", "AC-SC-2"] });

    expect(await readAcScope(slug, tmpDir)).toEqual(["AC-SC-1", "AC-SC-2"]);
  });

  it("create task with ac-scope round trip — a SINGLE --ac-scope occurrence still yields an array, not a bare string", async () => {
    const slug = await createTask(tmpDir, "Single Scoped Task", { acScope: ["AC-SC-2"] });

    expect(await readAcScope(slug, tmpDir)).toEqual(["AC-SC-2"]);
  });
});

// ─── AC-VS-9 — NEGATIVE: evidenced removal blocked, non-evidenced allowed ───

describe("lore scope rm freeze invariant (AC-VS-9)", () => {
  it("evidenced removal blocked non-evidenced allowed — TASK tier", async () => {
    const slug = await createTask(tmpDir, "Frozen Task", { evidenceAc: "AC-SC-1" });
    await mustRun(["scope", "add", slug, "AC-SC-1", "AC-SC-2"], tmpDir);

    const blocked = await runLore(["scope", "rm", slug, "AC-SC-1"], tmpDir);
    expect(blocked.exitCode).toBe(4);
    expect(blocked.stderr).toContain(FREEZE_LITERAL);
    expect(await readAcScope(slug, tmpDir)).toEqual(["AC-SC-1", "AC-SC-2"]);

    const allowed = await runLore(["scope", "rm", slug, "AC-SC-2"], tmpDir);
    expect(allowed.exitCode).toBe(0);
    expect(await readAcScope(slug, tmpDir)).toEqual(["AC-SC-1"]);
  });

  it("evidenced removal blocked non-evidenced allowed — PHASE tier", async () => {
    await mustRun(["scope", "add", PHASE_SLUG, "AC-SC-1", "AC-SC-2"], tmpDir);

    const blocked = await runLore(["scope", "rm", PHASE_SLUG, "AC-SC-1"], tmpDir);
    expect(blocked.exitCode).toBe(4);
    expect(blocked.stderr).toContain(FREEZE_LITERAL);
    expect(await readAcScope(PHASE_SLUG, tmpDir)).toEqual(["AC-SC-1", "AC-SC-2"]);

    const allowed = await runLore(["scope", "rm", PHASE_SLUG, "AC-SC-2"], tmpDir);
    expect(allowed.exitCode).toBe(0);
    expect(await readAcScope(PHASE_SLUG, tmpDir)).toEqual(["AC-SC-1"]);
  });
});

// ─── AC-VS-11 — BOUNDARY: empty array is the terminal state; set has no flag ─

describe("lore scope add/rm terminal state (AC-VS-11)", () => {
  it("scope writer round trip and set rejects the flag", async () => {
    const slug = await createTask(tmpDir, "Round Trip Task", { anchors: ["src/a"] });
    const before = (await getDoc(slug, tmpDir)).extra;
    expect(before["ac_scope"]).toBeUndefined();

    await mustRun(["scope", "add", slug, "AC-SC-1"], tmpDir);
    expect(await readAcScope(slug, tmpDir)).toEqual(["AC-SC-1"]);

    await mustRun(["scope", "rm", slug, "AC-SC-1"], tmpDir);

    // Removing the LAST id un-declares the scope explicitly: an empty array,
    // never an absent key (Contract Details §"Removing the last id…").
    const after = (await getDoc(slug, tmpDir)).extra;
    expect("ac_scope" in after).toBe(true);
    expect(after["ac_scope"]).toEqual([]);

    // Every unrelated extra key survives byte-identical.
    const strip = (extra: Record<string, unknown>): string => {
      const { ac_scope: _dropped, ...rest } = extra;
      return JSON.stringify(rest);
    };
    expect(strip(after)).toBe(strip(before));

    // `lore set` deliberately gains NO --ac-scope flag — the existing strict
    // unknown-flag seam is what refuses it (exit 2), not a bespoke check.
    const setAttempt = await runLore(["set", slug, "--ac-scope", "AC-SC-1"], tmpDir);
    expect(setAttempt.exitCode).toBe(2);
    expect(setAttempt.stderr).toContain("Unknown option: --ac-scope");
  });
});

// ─── NEGATIVE: unsupported target type / malformed id ───────────────────────

describe("lore scope — NEGATIVE", () => {
  it("a plan target (neither task nor phase) → exit 4 naming the supported types", async () => {
    const result = await runLore(["scope", "add", PLAN_SLUG, "AC-SC-1"], tmpDir);

    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("task or phase");
  });

  it("a plan target on the READ verb too → exit 4 (list is type-checked, not just the mutations)", async () => {
    const result = await runLore(["scope", "list", PLAN_SLUG, "--json"], tmpDir);

    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("task or phase");
  });

  it("an empty-string id → exit 4 naming ac_scope, and nothing is written", async () => {
    const slug = await createTask(tmpDir, "Empty Id Task");
    const result = await runLore(["scope", "add", slug, ""], tmpDir);

    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("ac_scope");
    expect(await readAcScope(slug, tmpDir)).toBeUndefined();
  });
});

// ─── ERROR: nonexistent target ──────────────────────────────────────────────

describe("lore scope — ERROR", () => {
  it("a nonexistent target slug → exit 3 (DOC_NOT_FOUND)", async () => {
    const result = await runLore(["scope", "add", "task-does-not-exist", "AC-SC-1"], tmpDir);

    expect(result.exitCode).toBe(3);
  });
});

// ─── BOUNDARY: list with no declared scope ──────────────────────────────────

describe("lore scope list — BOUNDARY", () => {
  it("a task that never declared a scope → exit 0, empty list, scope_declared false", async () => {
    const slug = await createTask(tmpDir, "Undeclared Task");
    const result = await runLore(["scope", "list", slug, "--json"], tmpDir);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      data: { ac_scope: string[]; scope_declared: boolean };
    };
    expect(parsed.data.ac_scope).toEqual([]);
    expect(parsed.data.scope_declared).toBe(false);
  });

  it("a task whose scope was declared then emptied → scope_declared true with an empty array", async () => {
    const slug = await createTask(tmpDir, "Emptied Task", { acScope: ["AC-SC-2"] });
    await mustRun(["scope", "rm", slug, "AC-SC-2"], tmpDir);

    const result = await runLore(["scope", "list", slug, "--json"], tmpDir);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      data: { ac_scope: string[]; scope_declared: boolean };
    };
    expect(parsed.data.ac_scope).toEqual([]);
    expect(parsed.data.scope_declared).toBe(true);
  });
});

// ─── STATE: sibling extra keys survive a scope edit ─────────────────────────

describe("lore scope add — STATE", () => {
  it("a scope edit leaves extra.claim and extra.verification_evidence byte-identical", async () => {
    const slug = await createTask(tmpDir, "Stateful Task", { evidenceAc: "AC-SC-2" });
    // reason: an absolute path inside the corpus dir: a relative worktree is probed by `git status` against the PROCESS cwd,
    // which an in-process run no longer changes (the claim is the subject here, not that probe).
    await mustRun(["claim", slug, "--worktree", join(tmpDir, "wt-x")], tmpDir);
    const before = (await getDoc(slug, tmpDir)).extra;

    await mustRun(["scope", "add", slug, "AC-SC-1"], tmpDir);
    const after = (await getDoc(slug, tmpDir)).extra;

    expect(JSON.stringify(after["claim"])).toBe(JSON.stringify(before["claim"]));
    expect(JSON.stringify(after["verification_evidence"])).toBe(
      JSON.stringify(before["verification_evidence"]),
    );
    expect(after["ac_scope"]).toEqual(["AC-SC-1"]);
  });
});

// ─── REGRESSION ─────────────────────────────────────────────────────────────

describe("lore create task / scope add — REGRESSION", () => {
  it("omitting --ac-scope leaves extra.ac_scope ABSENT, never an empty array", async () => {
    const slug = await createTask(tmpDir, "Plain Task");
    const extra = (await getDoc(slug, tmpDir)).extra;

    expect("ac_scope" in extra).toBe(false);
  });

  it("scope add of an already-declared id does not duplicate it", async () => {
    const slug = await createTask(tmpDir, "Dedup Task", { acScope: ["AC-SC-1"] });
    await mustRun(["scope", "add", slug, "AC-SC-1", "AC-SC-2"], tmpDir);

    expect(await readAcScope(slug, tmpDir)).toEqual(["AC-SC-1", "AC-SC-2"]);
  });
});
