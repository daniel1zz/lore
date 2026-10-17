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
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const setDefaultTimeout = (ms: number): void => { vi.setConfig({ testTimeout: ms, hookTimeout: ms }); };
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import yaml from "yaml";
import { assertFreshBinary } from "../integration/helpers/assert-fresh-binary";

setDefaultTimeout(180_000);

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

// tests/e2e/ -> packages/lore/ -> packages/ -> repo root (4 levels up).
const PROJECT_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(PROJECT_ROOT, "dist", "lore");

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

  run(args: string[]): RunResult {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") env[k] = v;
    const proc = Bun.spawnSync([LORE_BIN, ...args], {
      cwd: this.dir,
      env: { ...env, HOME: this.dir, CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "c53e57e1-aaaa-bbbb-cccc-444444444444" },
    });
    return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
  }

  must(args: string[]): string {
    const r = this.run(args);
    if (r.exitCode !== 0) throw new Error(`lore ${args.join(" ")} failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
    return r.stdout;
  }

  slug(args: string[]): string {
    const out = this.must(args);
    const slug = out.match(/Slug:\s+(\S+)/)?.[1] ?? out.match(/Created baseline \w+ (\S+) \(/)?.[1];
    if (slug === undefined) throw new Error(`no slug in: ${out}`);
    return slug;
  }

  init(): this {
    this.must(["init"]);
    const prd = this.slug(["create", "prd", "--title", "Change set PRD", "--content", "PRD body.", "--no-ai"]);
    const root = this.slug(["baseline", "add", prd, "--node", "root", "--label", "Root", "--title", "CS Root"]);
    this.branch = this.slug(["baseline", "add", root, "--node", "branch", "--label", "Branch", "--title", "CS Branch"]);
    this.leaf = this.slug(["baseline", "add", this.branch, "--node", "leaf", "--label", "Leaf", "--title", "CS Leaf"]);
    this.must(["rule", "add", this.leaf, "--statement", "A live rule that already describes the product", "--confidence", "established", "--enforced-by", "guaranteed", "--example", "e1"]);
    const cfgPath = join(this.dir, ".lore", "config.yaml");
    const existing = yaml.parse(readFileSync(cfgPath, "utf8")) as Record<string, unknown>;
    const workflow = {
      ...(existing["workflow"] as Record<string, unknown> | undefined),
      // citation gate ENFORCING on the branch; judgment off (fixture approvals); plan-close gate off so the apply
      // step is the only plan-close refusal under test (it is unconditional, not part of that gate).
      gates: { "ac-cite": { mode: "enforce", armed_branches: [this.branch] }, "plan-close": { enabled: false } },
      review: { judgment_required_types: [] },
    };
    writeFileSync(cfgPath, yaml.stringify({ ...existing, workflow }), "utf8");
    return this;
  }

  spec(title: string): string {
    return this.slug(["create", "spec", "--title", title, "--kind", "tech", "--content", "## Overview\n\nBody.\n", "--no-ai"]);
  }

  /** `lore rule propose <spec> add ...` -> the reserved id. */
  propose(spec: string): string {
    const out = this.must(["rule", "propose", spec, "add", "--leaf", this.leaf, ...PROPOSAL]);
    const id = out.match(/\bBR-\d+\b/)?.[0];
    if (id === undefined) throw new Error(`no reserved id in: ${out}`);
    return id;
  }

  addScriptAc(spec: string, acId: string, cite: string): RunResult {
    return this.run(["ac", "add", spec, acId, "--statement", `criterion ${acId} holds`, "--mode", "script", "--oracle", "other", "--command", "true", "--cite", cite]);
  }

  plan(spec: string, acId: string): { plan: string; task: string } {
    const plan = this.slug(["create", "plan", "--title", `Plan of ${spec}`, "--parent", spec, "--content", "## Plan\n\nbody", "--no-ai"]);
    const task = this.slug(["create", "task", "--title", `Task of ${spec}`, "--plan-id", plan, "--ac-scope", acId, "--content", "## Task\n\nbody", "--no-ai"]);
    return { plan, task };
  }

  /** The runner-attested pass (SPEC-039): the ONLY producer of an attestation-bearing row. */
  verify(plan: string, task: string, acId: string): RunResult {
    return this.run(["verify", plan, "--task", task, "--ac", acId, "--allow-new-commands"]);
  }

  ruleState(id: string): string {
    const shown = JSON.parse(this.must(["rule", "show", id, "--json"])) as { data: { state: string } };
    return shown.data.state;
  }
}

beforeAll(() => {
  // reason: `bun run build` produces dist/lore; this fails loud on a missing or stale binary.
  assertFreshBinary(LORE_BIN, [join(PROJECT_ROOT, "packages", "lore", "src"), join(PROJECT_ROOT, "packages", "core", "src")]);
});

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
  it("A: propose -> cite -> apply refused (exit 4) -> plan close refused -> lore verify -> apply (exit 0) -> live", () => {
    const w = new World().init();
    const specA = w.spec("Spec A");
    const specB = w.spec("Spec B");

    // propose add prints the reserved id; the leaf is untouched
    const id = w.propose(specA);
    expect(id).toMatch(/^BR-\d+$/);
    expect(w.ruleState(id)).toBe("proposed");

    // the enforcing gate accepts the OWN spec's citation and refuses ANOTHER spec's
    expect(w.addScriptAc(specA, "AC-CSE-1", id).exitCode).toBe(0);
    const foreign = w.addScriptAc(specB, "AC-CSE-9", id);
    expect(foreign.exitCode).toBe(4);

    // the change set is listed
    const listed = JSON.parse(w.must(["rule", "changes", specA, "--json"])) as { data: { changes: Array<{ op: string; id: string }> } };
    expect(listed.data.changes.map((c) => `${c.op}:${c.id}`)).toEqual([`add:${id}`]);

    // BR-1007: a spec citing only its own proposal is approvable
    expect(w.run(["approve", specA]).exitCode).toBe(0);

    // apply exits exactly 4 before evidence, naming the criterion; nothing lands
    const refused = w.run(["rule", "apply", specA]);
    expect(refused.exitCode).toBe(4);
    expect(refused.stderr).toContain("AC-CSE-1");
    expect(w.ruleState(id)).toBe("proposed");

    // closing the implementing plan while apply would fail is refused, naming the criterion
    const { plan, task } = w.plan(specA, "AC-CSE-1");
    expect(w.run(["approve", plan]).exitCode).toBe(0);
    const closeRefused = w.run(["set", plan, "--status", "archived"]);
    expect(closeRefused.exitCode).toBe(4);
    expect(closeRefused.stderr).toContain("AC-CSE-1");
    expect(w.ruleState(id)).toBe("proposed");

    // a runner-attested pass, then apply exits 0 and the rule is live on its leaf
    const verified = w.verify(plan, task, "AC-CSE-1");
    expect(verified.exitCode).toBe(0);
    const applied = w.run(["rule", "apply", specA]);
    expect(applied.exitCode).toBe(0);
    expect(applied.stdout).toContain(id);
    expect(w.ruleState(id)).toBe("live");
    const shown = w.must(["rule", "show", id]);
    expect(shown).toContain(w.leaf);
    expect(shown).toContain("live");

    // idempotent: a second apply changes nothing and still exits 0
    const leafBefore = w.must(["log", w.leaf]);
    const again = w.run(["rule", "apply", specA]);
    expect(again.exitCode).toBe(0);
    expect(w.must(["log", w.leaf])).toBe(leafBefore);

    // and the plan now closes
    expect(w.run(["set", plan, "--status", "archived"]).exitCode).toBe(0);
  });

  it("B: closing the plan lands the change set (plan close calls apply)", () => {
    const w = new World().init();
    const spec = w.spec("Spec closing");
    const id = w.propose(spec);
    expect(w.addScriptAc(spec, "AC-CSE-2", id).exitCode).toBe(0);
    expect(w.run(["approve", spec]).exitCode).toBe(0);
    const { plan, task } = w.plan(spec, "AC-CSE-2");
    expect(w.run(["approve", plan]).exitCode).toBe(0);
    expect(w.verify(plan, task, "AC-CSE-2").exitCode).toBe(0);
    expect(w.ruleState(id)).toBe("proposed");

    const closed = w.run(["set", plan, "--status", "archived"]);
    expect(closed.exitCode).toBe(0);
    // smallest red mutation: a plan close that never calls apply leaves the id proposed
    expect(w.ruleState(id)).toBe("live");
  });

  it("C: `rule set --lifecycle deprecated` is refused; a spec deprecated before landing retires its proposed id", () => {
    const w = new World().init();

    const refused = w.run(["rule", "set", "BR-1", "--lifecycle", "deprecated"]);
    expect(refused.exitCode).toBe(4);
    expect(refused.stderr).toContain("retire");
    expect(refused.stderr).toContain("change set");
    expect(w.ruleState("BR-1")).toBe("live");

    const spec = w.spec("Abandoned spec");
    const id = w.propose(spec);
    expect(w.addScriptAc(spec, "AC-CSE-3", id).exitCode).toBe(0);
    expect(w.run(["approve", spec]).exitCode).toBe(0);
    expect(w.ruleState(id)).toBe("proposed");

    const deprecated = w.run(["set", spec, "--status", "deprecated"]);
    expect(deprecated.exitCode).toBe(0);
    expect(w.ruleState(id)).toBe("retired");
    const leaf = w.must(["get", w.leaf, "--json"]);
    expect(leaf).toContain(`never landed: ${spec}`);
  });
});
