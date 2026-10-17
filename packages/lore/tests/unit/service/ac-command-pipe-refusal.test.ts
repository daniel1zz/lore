// @reads packages/core/src/**
// @reads packages/lore/src/**
/**
 * RED tests for the declaration-time pipe refusal at the AC write chokepoint (#19) —
 * task-skill-test-red-declaration-time-pipe-refusal-on-service. Paired impl:
 * task-skill-implement-one-shared-pipe-detector-ac-add-set-refuse.
 *
 * SPEC (AC-EH-6, BR-1078, decision D7/U1): a script criterion whose command has an unquoted
 * shell pipe (a logical or does not count) is refused with VALIDATION_ERROR field `command`,
 * writing nothing, for every check kind EXCEPT `other`; under `other` it is admitted with ONE
 * advisory naming the pipe. Applies when a criterion is added or its command / check kind
 * changes, on every AcWritePath; an unchanged stored criterion is not re-checked.
 *
 * PINNED CONTRACT (from the paired task's Approach, the implementer must satisfy exactly this):
 *  1. Refusal: `Result.error.code` "VALIDATION_ERROR", `field` "command", `message` quoting the
 *     pipe segment (e.g. "| tail -1") and naming the pipe-free `mktemp` form.
 *  2. Advisory: `admitAcWrite(...)` resolves to an `AcWriteAdmission` carrying `advisories: string[]`
 *     (ALWAYS an array, empty when none). Under oracle `other` it holds exactly one entry naming the pipe.
 *     The admission-level assertion is used because `addCriterion` returns the criteria list, not the
 *     admission; the CLI-level `advisory:` line is pinned by the compiled e2e file.
 *  3. Structural: `export function commandHasUnsafePipe` is defined in exactly ONE file under
 *     packages/core/src and packages/lore/src: packages/core/src/command-pipe.ts.
 *
 * RED NATURE: every refusal / advisory case fails on an ASSERTION today (the write is accepted,
 * `advisories` is undefined, the detector still lives in evidence-precheck.ts). No case calls a
 * not-yet-existing export; `advisories` is read through a cast because the field is added by the
 * paired task. Cases (d) and (f) are REGRESSION guards that already pass on current main except
 * where they also pin the `advisories: []` shape.
 *
 * Dimensions: HAPPY (other + advisory, quoted bar, logical or), NEGATIVE (test/e2e/tsc/lint/build pipe),
 * BOUNDARY (pipefail false positive), STATE (statement-only edit not re-checked; refused write leaves
 * the doc untouched), REGRESSION (stored piped commands untouched).
 *
 * @spec_ref AC-EH-6
 */

import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { CreateDocInput, DocId } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { AcService } from "../../../src/service/ac-service.js";
import { admitAcWrite } from "../../../src/service/ac-write-chokepoint.js";
import { recordLockGateOff } from "../../helpers/record-lock-gate-off.js";

const PIPED = "false | tail -1 && echo PASS";
const OTHER_PIPED = "grep -c x f | wc -l";
const ORACLES_REFUSED = ["test", "e2e", "tsc", "lint", "build"] as const;

type Verify = { mode: "script"; oracle: string; command: string };
const criterion = (id: string, oracle: string, command: string) => ({
  id,
  statement: `Exits 0 on a clean tree (${id})`,
  verify: { mode: "script", oracle, command } satisfies Verify,
});

/** Every store method that persists anything; the spy proves a refusal wrote NOTHING. */
const WRITE_METHODS = [
  "update",
  "updateWithProvenance",
  "insert",
  "insertWithProvenance",
  "insertWithAllocatedOrdinalAndProvenance",
  "appendAuditEntry",
] as const;

function spyOnWrites(store: InMemoryStore) {
  const spies = WRITE_METHODS.map((m) =>
    vi.spyOn(store as unknown as Record<string, (...a: unknown[]) => unknown>, m),
  );
  return {
    count: () => spies.reduce((n, s) => n + s.mock.calls.length, 0),
    reset: () => spies.forEach((s) => s.mockClear()),
  };
}

async function setup() {
  const store = new InMemoryStore();
  const cs = new CorpusService(store, recordLockGateOff(store));
  const ac = new AcService(store, recordLockGateOff(store));
  const prd = await cs.create({ type: "prd", title: "P", content: "root" } as CreateDocInput);
  if (!prd.ok) throw new Error("prd");
  const spec = await cs.create({ type: "spec", title: "S", content: "body" } as CreateDocInput);
  if (!spec.ok) throw new Error("spec");
  return { store, cs, ac, specId: spec.value.id as string, slug: spec.value.slug as string };
}

async function storedCriteria(store: InMemoryStore, specId: string): Promise<unknown[]> {
  const d = await store.find(specId as DocId);
  if (!d.ok || d.value === null) throw new Error("find");
  return (d.value.extra["acceptance_criteria"] as unknown[] | undefined) ?? [];
}

/** Write criteria straight into the store (bypassing every writer) to model a pre-existing stored command. */
async function seedStored(store: InMemoryStore, specId: string, criteria: unknown[]): Promise<void> {
  const d = await store.find(specId as DocId);
  if (!d.ok || d.value === null) throw new Error("find");
  const r = await store.update(specId as DocId, { extra: { ...d.value.extra, acceptance_criteria: criteria } });
  if (!r.ok) throw new Error(`seed: ${JSON.stringify(r.error)}`);
}

function expectPipeRefusal(res: { ok: boolean; error?: unknown }, pipeSegment: string): void {
  expect(res.ok).toBe(false);
  const e = res.error as { code?: string; field?: string; message?: string } | undefined;
  expect(e?.code).toBe("VALIDATION_ERROR");
  expect(e?.field).toBe("command");
  expect(e?.message).toContain(pipeSegment);
  expect(e?.message).toContain("mktemp");
}

async function admit(store: InMemoryStore, specId: string, slug: string, next: ReturnType<typeof criterion>[]) {
  const res = await admitAcWrite(store, {
    rawGateConfig: undefined,
    target: { id: specId, slug, anchors: [] },
    existing: [],
    next: next as never,
    actor: "agent:pipe-refusal-test",
  });
  if (!res.ok) throw new Error(`admit: ${JSON.stringify(res.error)}`);
  return res.value as unknown as { advisories?: string[] };
}

// ─── (a) NEGATIVE: the issue's own shape under oracle test ─────────────────────

describe("AC-EH-6 (a) — addCriterion refuses an unsafe-piped test command", () => {
  it("returns VALIDATION_ERROR field 'command' quoting '| tail -1' and naming mktemp; writes nothing", async () => {
    const { store, ac, specId } = await setup();
    const w = spyOnWrites(store);
    const res = await ac.addCriterion(specId, criterion("AC-P-1", "test", PIPED));
    expectPipeRefusal(res, "| tail -1");
    expect(w.count()).toBe(0);
    expect(await storedCriteria(store, specId)).toEqual([]);
  });
});

// ─── (b) NEGATIVE: every other script oracle except `other` ────────────────────

describe("AC-EH-6 (b) — the same command is refused identically under e2e, tsc, lint and build", () => {
  it.each(ORACLES_REFUSED.filter((o) => o !== "test"))("oracle %s is refused with write count 0", async (oracle) => {
    const { store, ac, specId } = await setup();
    const w = spyOnWrites(store);
    const res = await ac.addCriterion(specId, criterion("AC-P-2", oracle, PIPED));
    expectPipeRefusal(res, "| tail -1");
    expect(w.count()).toBe(0);
    expect(await storedCriteria(store, specId)).toEqual([]);
  });
});

// ─── (c) HAPPY: oracle other is admitted with exactly one advisory ─────────────

describe("AC-EH-6 (c) — oracle other with a pipe is accepted, stored and carries one advisory", () => {
  it("addCriterion accepts and stores the piped other command", async () => {
    const { store, ac, specId } = await setup();
    const res = await ac.addCriterion(specId, criterion("AC-P-3", "other", OTHER_PIPED));
    expect(res.ok).toBe(true);
    const stored = (await storedCriteria(store, specId)) as Array<{ id: string }>;
    expect(stored.map((c) => c.id)).toEqual(["AC-P-3"]);
  });

  it("the admission carries exactly one advisory naming '| wc -l'", async () => {
    const { store, specId, slug } = await setup();
    const adm = await admit(store, specId, slug, [criterion("AC-P-3", "other", OTHER_PIPED)]);
    expect(adm.advisories).toHaveLength(1);
    expect(adm.advisories?.[0]).toContain("| wc -l");
  });
});

// ─── (d) BOUNDARY: quoted bar and logical or are not pipes ─────────────────────

describe("AC-EH-6 (d) — a quoted bar and a logical or are accepted with no advisory", () => {
  it.each([
    ["quoted bar", "grep 'a|b' f"],
    ["logical or", "a || b"],
  ])("oracle test with a %s is accepted, stored, and the admission has an empty advisories array", async (_n, command) => {
    const { store, ac, specId, slug } = await setup();
    const res = await ac.addCriterion(specId, criterion("AC-P-4", "test", command));
    expect(res.ok).toBe(true);
    expect(((await storedCriteria(store, specId)) as unknown[]).length).toBe(1);
    const adm = await admit(store, specId, slug, [criterion("AC-P-4", "test", command)]);
    expect(adm.advisories).toEqual([]);
  });
});

// ─── (e) BOUNDARY: pipefail does not rescue a pipe (accepted false positive, D7) ─

describe("AC-EH-6 (e) — a pipe after pipefail is still refused", () => {
  it("'set -o pipefail; bunx vitest run x | tail -5' under oracle test is refused, write count 0", async () => {
    const { store, ac, specId } = await setup();
    const w = spyOnWrites(store);
    const res = await ac.addCriterion(specId, criterion("AC-P-5", "test", "set -o pipefail; bunx vitest run x | tail -5"));
    expectPipeRefusal(res, "| tail -5");
    expect(w.count()).toBe(0);
  });
});

// ─── (f) STATE: a statement-only edit does not re-check the stored command ─────

describe("AC-EH-6 (f) — setCriterion changing only the statement of a stored piped test command succeeds", () => {
  it("the stored command is untouched and the statement changes", async () => {
    const { store, ac, specId } = await setup();
    await seedStored(store, specId, [criterion("AC-P-6", "test", PIPED)]);
    const res = await ac.setCriterion(specId, "AC-P-6", { statement: "Exits 0 on a clean tree, reworded" });
    expect(res.ok).toBe(true);
    const [c] = (await storedCriteria(store, specId)) as Array<{ statement: string; verify: { command: string } }>;
    expect(c?.statement).toBe("Exits 0 on a clean tree, reworded");
    expect(c?.verify.command).toBe(PIPED);
  });
});

// ─── (g) NEGATIVE: changing the command or the oracle re-checks ────────────────

describe("AC-EH-6 (g) — setCriterion re-checks when the command or the oracle changes", () => {
  it("changing the command to a piped one is refused; write count 0; stored command unchanged", async () => {
    const { store, ac, specId } = await setup();
    await seedStored(store, specId, [criterion("AC-P-7", "test", "bun test x")]);
    const w = spyOnWrites(store);
    const res = await ac.setCriterion(specId, "AC-P-7", { command: "bunx vitest run a.test.ts | tail -3" });
    expectPipeRefusal(res, "| tail -3");
    expect(w.count()).toBe(0);
    const [c] = (await storedCriteria(store, specId)) as Array<{ verify: { command: string } }>;
    expect(c?.verify.command).toBe("bun test x");
  });

  it("changing the oracle from other to test on a piped command is refused; write count 0; oracle unchanged", async () => {
    const { store, ac, specId } = await setup();
    await seedStored(store, specId, [criterion("AC-P-8", "other", OTHER_PIPED)]);
    const w = spyOnWrites(store);
    const res = await ac.setCriterion(specId, "AC-P-8", { oracle: "test" });
    expectPipeRefusal(res, "| wc -l");
    expect(w.count()).toBe(0);
    const [c] = (await storedCriteria(store, specId)) as Array<{ verify: { oracle: string } }>;
    expect(c?.verify.oracle).toBe("other");
  });
});

// ─── (h) NEGATIVE: the create path ─────────────────────────────────────────────

describe("AC-EH-6 (h) — CorpusService.create refuses a spec whose criterion has a piped tsc command", () => {
  it("is refused with VALIDATION_ERROR field 'command' and no document exists afterwards", async () => {
    const { store, cs } = await setup();
    const before = await store.findMany({ type: "spec" });
    if (!before.ok) throw new Error("findMany");
    const res = await cs.create({
      type: "spec",
      title: "Born piped",
      content: "body",
      extra: { acceptance_criteria: [criterion("AC-P-9", "tsc", "bun run typecheck | tail -5")] },
    } as CreateDocInput);
    expectPipeRefusal(res, "| tail -5");
    const after = await store.findMany({ type: "spec" });
    if (!after.ok) throw new Error("findMany");
    expect(after.value.length).toBe(before.value.length);
    expect(after.value.some((d) => d.title === "Born piped")).toBe(false);
  });
});

// ─── Structural half: one shared detector, in core ─────────────────────────────

describe("AC-EH-6 structural — commandHasUnsafePipe has exactly one exported definition, in packages/core/src/command-pipe.ts", () => {
  const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");

  function walk(dir: string, out: string[]): void {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === "dist") continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (p.endsWith(".ts")) out.push(p);
    }
  }

  it("the definition file set is exactly [packages/core/src/command-pipe.ts]", () => {
    const files: string[] = [];
    walk(join(REPO_ROOT, "packages/core/src"), files);
    walk(join(REPO_ROOT, "packages/lore/src"), files);
    const defining = files
      .filter((f) => readFileSync(f, "utf8").includes("export function commandHasUnsafePipe"))
      .map((f) => f.slice(REPO_ROOT.length + 1));
    expect(defining).toEqual(["packages/core/src/command-pipe.ts"]);
  });
});
