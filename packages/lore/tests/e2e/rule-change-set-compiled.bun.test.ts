/**
 * rule-change-set-compiled.bun.test.ts — AC-CS-3: a spec's rule change set, from proposal to landing, observed
 * from the REAL compiled binary on a throwaway corpus with the citation gate ENFORCING.
 *
 * Spec: spec-a-spec-carries-its-rule-changes-the-baseline-takes-them (Model, D2, D3, D4, Edge cases).
 * Rules: BR-86 / BR-257 (cite a live rule or one the spec's own change set proposes), BR-626 (a rule enters the
 *   tree as live only through apply), BR-641 (proposed -> live via apply; proposed -> retired on abandonment),
 *   BR-1007 (a spec citing only its own proposal is approvable).
 *
 * Scenarios (one corpus per scenario, so a failure names its own world):
 *   A  propose add prints the reserved BR id; `ac add` citing it exits 0 under the enforcing gate; a criterion of
 *      ANOTHER spec citing it exits 4; `rule changes --json` lists it; the spec is approvable; `rule apply` exits
 *      exactly 4 before evidence naming the criterion; closing the implementing plan while apply would fail exits 4
 *      naming the criterion and leaves the id `proposed`; after a runner-attested pass (`lore verify`) apply exits 0,
 *      `rule show` prints the rule live on its leaf, a second apply is a no-op, and the plan then closes.
 *   B  closing the plan IS the landing: with the attested pass in place `lore set <plan> --status archived` exits 0
 *      and the proposed id is live afterwards (the smallest red mutation: plan close not calling apply leaves it
 *      `proposed`).
 *   C  `rule set --lifecycle deprecated` exits 4 naming retire and the change set; a spec moved to deprecated before
 *      landing retires its proposed id with the note "never landed: <spec>".
 *
 * bun test (not vitest): spawns `dist/lore` against `mkdtemp` + `lore init` (cwd AND HOME inside it) — never the
 * repo's own `.lore/`. `assertFreshBinary` fails loud on a stale `dist/lore`. Run `bun run build` first.
 * Hermetic session id: CLAUDE_CODE_SESSION_ID is pinned, so no ambient session leaks into actor attribution.
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
 *
 * @spec_ref AC-CS-3 — spec-a-spec-carries-its-rule-changes-the-baseline-takes-them
 *
 * TG-25 (adr-tg-1 option b): the commands run IN-PROCESS through tests/helpers/run-lore-in-process.ts, not through
 * dist/lore. Wherever the prose above says the compiled binary is spawned or its freshness asserted, that is the
 * history of this file; the assertions and the throwaway-corpus rule are unchanged.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const setDefaultTimeout = (ms: number): void => { vi.setConfig({ testTimeout: ms, hookTimeout: ms }); };
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { patchLoreConfig } from "../helpers/patch-lore-config.js";
import { runLoreInProcess } from "../helpers/run-lore-in-process";

setDefaultTimeout(180_000);

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

// tests/e2e/ -> packages/lore/ -> packages/ -> repo root (4 levels up).
const PROJECT_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");

const PROPOSAL = ["--statement", "A rule the spec introduces and the baseline takes only when it lands", "--example", "when X then Y", "--enforced-by", "both"] as const;

const cleanupDirs: string[] = [];

/** One throwaway corpus: PRD -> baseline root/branch/leaf (live BR-1), citation gate enforcing on the branch. */
class World {
  readonly dir: string;
  branch = "";
  leaf = "";

  constructor() {
    this.dir = mkdtempSync(join(tmpdir(), "lore-rule-change-set-e2e-"));
    cleanupDirs.push(this.dir);
    expect(this.dir.startsWith(PROJECT_ROOT)).toBe(false);
  }

  async run(args: string[]): Promise<RunResult> {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") env[k] = v;
    const proc = await runLoreInProcess(args, {
      cwd: this.dir,
      home: this.dir,
      env: { ...env, HOME: this.dir, CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "c53e57e1-aaaa-bbbb-cccc-444444444444" },
    });
    return { stdout: proc.stdout, stderr: proc.stderr, exitCode: proc.exitCode };
  }

  async must(args: string[]): Promise<string> {
    const r = await this.run(args);
    if (r.exitCode !== 0) throw new Error(`lore ${args.join(" ")} failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
    return r.stdout;
  }

  async slug(args: string[]): Promise<string> {
    const out = await this.must(args);
    const slug = out.match(/Slug:\s+(\S+)/)?.[1] ?? out.match(/Created baseline \w+ (\S+) \(/)?.[1];
    if (slug === undefined) throw new Error(`no slug in: ${out}`);
    return slug;
  }

  async init(): Promise<this> {
    await this.must(["init"]);
    const prd = await this.slug(["create", "prd", "--title", "Change set PRD", "--content", "PRD body.", "--no-ai"]);
    const root = await this.slug(["baseline", "add", prd, "--node", "root", "--label", "Root", "--title", "CS Root"]);
    this.branch = await this.slug(["baseline", "add", root, "--node", "branch", "--label", "Branch", "--title", "CS Branch"]);
    this.leaf = await this.slug(["baseline", "add", this.branch, "--node", "leaf", "--label", "Leaf", "--title", "CS Leaf"]);
    await this.must(["rule", "add", this.leaf, "--statement", "A live rule that already describes the product", "--confidence", "established", "--enforced-by", "guaranteed", "--example", "e1"]);
    patchLoreConfig(this.dir, {
      workflow: {
        // citation gate ENFORCING on the branch; judgment off (fixture approvals); plan-close gate off so the apply
        // step is the only plan-close refusal under test (it is unconditional, not part of that gate).
        gates: { "ac-cite": { mode: "enforce", armed_branches: [this.branch] }, "plan-close": { enabled: false } },
        review: { judgment_required_types: [] },
      },
    });
    return this;
  }

  async spec(title: string): Promise<string> {
    return await this.slug(["create", "spec", "--title", title, "--kind", "tech", "--content", "## Overview\n\nBody.\n", "--no-ai"]);
  }

  /** `lore rule propose <spec> add ...` -> the reserved id. */
  async propose(spec: string): Promise<string> {
    const out = await this.must(["rule", "propose", spec, "add", "--leaf", this.leaf, ...PROPOSAL]);
    const id = out.match(/\bBR-\d+\b/)?.[0];
    if (id === undefined) throw new Error(`no reserved id in: ${out}`);
    return id;
  }

  async addScriptAc(spec: string, acId: string, cite: string): Promise<RunResult> {
    return await this.run(["ac", "add", spec, acId, "--statement", `criterion ${acId} holds`, "--mode", "script", "--oracle", "other", "--command", "true", "--cite", cite]);
  }

  async plan(spec: string, acId: string): Promise<{ plan: string; task: string }> {
    const plan = await this.slug(["create", "plan", "--title", `Plan of ${spec}`, "--parent", spec, "--content", "## Plan\n\nbody", "--no-ai"]);
    const task = await this.slug(["create", "task", "--title", `Task of ${spec}`, "--plan-id", plan, "--ac-scope", acId, "--content", "## Task\n\nbody", "--no-ai"]);
    return { plan, task };
  }

  /** The runner-attested pass (SPEC-039): the ONLY producer of an attestation-bearing row. */
  async verify(plan: string, task: string, acId: string): Promise<RunResult> {
    return await this.run(["verify", plan, "--task", task, "--ac", acId, "--allow-new-commands"]);
  }

  async ruleState(id: string): Promise<string> {
    const shown = JSON.parse(await this.must(["rule", "show", id, "--json"])) as { data: { state: string } };
    return shown.data.state;
  }
}

afterAll(() => {
  for (const dir of cleanupDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
});

describe("rule change set, compiled binary (AC-CS-3)", () => {
  it("A: propose -> cite -> apply refused (exit 4) -> plan close refused -> lore verify -> apply (exit 0) -> live", async () => {
    const w = await new World().init();
    const specA = await w.spec("Spec A");
    const specB = await w.spec("Spec B");

    // propose add prints the reserved id; the leaf is untouched
    const id = await w.propose(specA);
    expect(id).toMatch(/^BR-\d+$/);
    expect(await w.ruleState(id)).toBe("proposed");

    // the enforcing gate accepts the OWN spec's citation and refuses ANOTHER spec's
    expect((await w.addScriptAc(specA, "AC-CSE-1", id)).exitCode).toBe(0);
    const foreign = await w.addScriptAc(specB, "AC-CSE-9", id);
    expect(foreign.exitCode).toBe(4);

    // the change set is listed
    const listed = JSON.parse(await w.must(["rule", "changes", specA, "--json"])) as { data: { changes: Array<{ op: string; id: string }> } };
    expect(listed.data.changes.map((c) => `${c.op}:${c.id}`)).toEqual([`add:${id}`]);

    // BR-1007: a spec citing only its own proposal is approvable
    expect((await w.run(["approve", specA])).exitCode).toBe(0);

    // apply exits exactly 4 before evidence, naming the criterion; nothing lands
    const refused = await w.run(["rule", "apply", specA]);
    expect(refused.exitCode).toBe(4);
    expect(refused.stderr).toContain("AC-CSE-1");
    expect(await w.ruleState(id)).toBe("proposed");

    // closing the implementing plan while apply would fail is refused, naming the criterion
    const { plan, task } = await w.plan(specA, "AC-CSE-1");
    expect((await w.run(["approve", plan])).exitCode).toBe(0);
    const closeRefused = await w.run(["set", plan, "--status", "archived"]);
    expect(closeRefused.exitCode).toBe(4);
    expect(closeRefused.stderr).toContain("AC-CSE-1");
    expect(await w.ruleState(id)).toBe("proposed");

    // a runner-attested pass, then apply exits 0 and the rule is live on its leaf
    const verified = await w.verify(plan, task, "AC-CSE-1");
    expect(verified.exitCode).toBe(0);
    const applied = await w.run(["rule", "apply", specA]);
    expect(applied.exitCode).toBe(0);
    expect(applied.stdout).toContain(id);
    expect(await w.ruleState(id)).toBe("live");
    const shown = await w.must(["rule", "show", id]);
    expect(shown).toContain(w.leaf);
    expect(shown).toContain("live");

    // idempotent: a second apply changes nothing and still exits 0
    const leafBefore = await w.must(["log", w.leaf]);
    const again = await w.run(["rule", "apply", specA]);
    expect(again.exitCode).toBe(0);
    expect(await w.must(["log", w.leaf])).toBe(leafBefore);

    // and the plan now closes
    expect((await w.run(["set", plan, "--status", "archived"])).exitCode).toBe(0);
  });

  it("B: closing the plan lands the change set (plan close calls apply)", async () => {
    const w = await new World().init();
    const spec = await w.spec("Spec closing");
    const id = await w.propose(spec);
    expect((await w.addScriptAc(spec, "AC-CSE-2", id)).exitCode).toBe(0);
    expect((await w.run(["approve", spec])).exitCode).toBe(0);
    const { plan, task } = await w.plan(spec, "AC-CSE-2");
    expect((await w.run(["approve", plan])).exitCode).toBe(0);
    expect((await w.verify(plan, task, "AC-CSE-2")).exitCode).toBe(0);
    expect(await w.ruleState(id)).toBe("proposed");

    const closed = await w.run(["set", plan, "--status", "archived"]);
    expect(closed.exitCode).toBe(0);
    // smallest red mutation: a plan close that never calls apply leaves the id proposed
    expect(await w.ruleState(id)).toBe("live");
  });

  it("C: `rule set --lifecycle deprecated` is refused; a spec deprecated before landing retires its proposed id", async () => {
    const w = await new World().init();

    const refused = await w.run(["rule", "set", "BR-1", "--lifecycle", "deprecated"]);
    expect(refused.exitCode).toBe(4);
    expect(refused.stderr).toContain("retire");
    expect(refused.stderr).toContain("change set");
    expect(await w.ruleState("BR-1")).toBe("live");

    const spec = await w.spec("Abandoned spec");
    const id = await w.propose(spec);
    expect((await w.addScriptAc(spec, "AC-CSE-3", id)).exitCode).toBe(0);
    expect((await w.run(["approve", spec])).exitCode).toBe(0);
    expect(await w.ruleState(id)).toBe("proposed");

    const deprecated = await w.run(["set", spec, "--status", "deprecated"]);
    expect(deprecated.exitCode).toBe(0);
    expect(await w.ruleState(id)).toBe("retired");
    const leaf = await w.must(["get", w.leaf, "--json"]);
    expect(leaf).toContain(`never landed: ${spec}`);
  });
});
