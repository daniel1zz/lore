/**
 * @spec_ref AC-BLS2-2
 *
 * Composition-root wiring of the citation gate (spec-baseline-slice-2 §C4/D5): the raw
 * `workflow.gates."ac-cite"` entry of a REAL parsed `.lore/config.yaml` reaches `AcService` and
 * `CorpusService` through `createApp`. Without this the gate would be unit-green and dead in production.
 *
 * Runner: `bun test` (createApp opens bun:sqlite). Throwaway corpus per test — never the repo's `.lore/`.
 *
 * Dimensions: HAPPY (configured enforce resolves + refuses on the real store), NEGATIVE (invalid mode in
 * YAML is rejected at config load), BOUNDARY (no config + no baseline docs => off; with baseline => report),
 * REGRESSION (a real SQLite store applies the same refusal as the in-memory double, end to end).
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LoreConfigSchema, type CreateDocInput, type LoreConfig } from "@lore/core";
import { createApp, type App } from "../../../src/app.js";

const PROJECT = { name: "wiring", author: "tester" };

function configWithGate(gate: unknown): LoreConfig {
  const parsed = LoreConfigSchema.safeParse({ project: PROJECT, workflow: { gates: { "ac-cite": gate } } });
  if (!parsed.success) throw new Error(`fixture config rejected: ${JSON.stringify(parsed.error.issues)}`);
  return parsed.data;
}

async function must<T>(r: { ok: boolean; value?: T; error?: unknown }, what: string): Promise<T> {
  if (!r.ok) throw new Error(`fixture ${what} failed: ${JSON.stringify(r.error)}`);
  return r.value as T;
}

/** A corpus with one armed-able branch holding live BR-1, one spec, no criteria yet. */
async function seed(app: App): Promise<{ specId: string; prdId: string }> {
  const cs = app.corpusService;
  const prd = await must(await cs.create({ type: "prd", title: "Wiring product", content: "root" } as CreateDocInput), "prd");
  const root = await must(await rulesOf(app).addNode(prd.id, { node: "root", label: "Root", title: "Wiring root", content: "r" }, { by: "agent:seed" }), "root");
  const branch = await must(
    await cs.create({
      type: "baseline", title: "Wiring branch", slug: "baseline-wiring", content: "b", parent_id: root.id,
      extra: { node: "branch", label: "Wiring branch", glossary: [{ term: "Wire", meaning: "Config to service" }] },
    } as CreateDocInput),
    "branch",
  );
  const leaf = await must(await rulesOf(app).addNode(branch.id, { node: "leaf", label: "Leaf", title: "Wiring leaf", content: "l" }, { by: "agent:seed" }), "leaf");
  await must(
    await rulesOf(app).addRule(leaf.id, { statement: "Config reaches the gate", confidence: "established", enforced_by: "guaranteed", examples: ["e"] }, { by: "agent:seed" }),
    "rule",
  );
  const spec = await must(await cs.create({ type: "spec", title: "Wiring spec", content: SKELETON, parent_id: prd.id } as CreateDocInput), "spec");
  return { specId: spec.id, prdId: prd.id };
}

const SKELETON = "## Overview/Goal\n\nx\n\n## Scope\n\nx\n\n## Acceptance Criteria\n\nx";

const AC = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  statement: `Does the thing ${id}`,
  verify: { mode: "script", oracle: "test", command: "bun test x" },
  ...extra,
});

let dir: string;
let app: App | undefined;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cite-gate-wiring-"));
});
afterEach(() => {
  app?.close();
  app = undefined;
  rmSync(dir, { recursive: true, force: true });
});

function acOf(a: App): NonNullable<App["acService"]> {
  if (a.acService === undefined) throw new Error("createApp wired no acService");
  return a.acService;
}

function rulesOf(a: App): NonNullable<App["ruleService"]> {
  if (a.ruleService === undefined) throw new Error("createApp wired no ruleService");
  return a.ruleService;
}

function open(config: LoreConfig | undefined): App {
  const made = config === undefined ? createApp(join(dir, "c.db")) : createApp(join(dir, "c.db"), config);
  if ("ok" in made) throw new Error(`createApp failed: ${JSON.stringify(made)}`);
  app = made;
  return made;
}

describe("the configured gate reaches the services through createApp (AC-BLS2-2)", () => {
  it("a configured enforce + armed branch resolves as configured", async () => {
    const a = open(configWithGate({ mode: "enforce", armed_branches: ["baseline-wiring"] }));
    const resolved = await acOf(a).resolveCiteGate();
    expect(resolved.ok && resolved.value).toEqual({ mode: "enforce", armed_branches: ["baseline-wiring"] });
  });

  it("on a real SQLite store the armed branch refuses an uncited add and accepts a live-cited one", async () => {
    const a = open(configWithGate({ mode: "enforce", armed_branches: ["baseline-wiring"] }));
    const { specId } = await seed(a);
    const refused = await acOf(a).addCriterion(specId, AC("AC-W-1"));
    expect(!refused.ok && refused.error.code).toBe("AC_CITE_REQUIRED");
    const accepted = await acOf(a).addCriterion(specId, AC("AC-W-2", { cites: ["BR-1"] }));
    expect(accepted.ok).toBe(true);
  });

  it("the same configuration gates create's inline criteria", async () => {
    const a = open(configWithGate({ mode: "enforce", armed_branches: ["baseline-wiring"] }));
    const { prdId } = await seed(a);
    const created = await a.corpusService.create({
      type: "spec", title: "Born uncited", content: SKELETON, parent_id: prdId,
      extra: { acceptance_criteria: [AC("AC-N-1")] },
    } as CreateDocInput);
    expect(!created.ok && created.error.code).toBe("AC_CITE_REQUIRED");
  });

  it("no config and no baseline docs resolves to off", () => {
    const a = open(undefined);
    return acOf(a).resolveCiteGate().then((r) => expect(r.ok && r.value.mode).toBe("off"));
  });

  it("no gate entry but baseline docs present resolves to report, and an uncited add is accepted", async () => {
    const a = open(LoreConfigSchema.parse({ project: PROJECT }));
    const { specId } = await seed(a);
    const resolved = await acOf(a).resolveCiteGate();
    expect(resolved.ok && resolved.value.mode).toBe("report");
    expect((await acOf(a).addCriterion(specId, AC("AC-W-1"))).ok).toBe(true);
  });
});

describe("a malformed gate entry never loads (AC-BLS2-2, no silent fallback)", () => {
  it("an unknown mode in config is rejected by the schema", () => {
    expect(LoreConfigSchema.safeParse({ project: PROJECT, workflow: { gates: { "ac-cite": { mode: "block" } } } }).success).toBe(false);
  });
});
