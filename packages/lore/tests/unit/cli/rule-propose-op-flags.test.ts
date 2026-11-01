// @spawns packages/lore/tests/helpers/approve-nodes-cli.ts
// @reads assets/project/lore-config-template.yaml
/**
 * Oracle for task-lore-rule-propose-amend-refuses-flags-its-op-does-not-take.
 *
 * `lore rule propose <spec> <op>` takes only the flags its op defines; a flag the op does not take is a usage error
 * (exit 2) naming the flag and the op, never silently dropped. `amend` additionally ACCEPTS `--leaf`: it moves THIS
 * spec's proposed `add` entry to another business leaf (same validation as `add --leaf`); amending the leaf of a
 * modify entry is refused (exit 4, naming the op).
 *
 * Coverage: HAPPY (amend --leaf moves, changes JSON shows it), NEGATIVE (retire --statement, withdraw --example,
 * modify --note, add --note, amend --note, retire --leaf, modify --leaf: exit 2), ERROR (amend --leaf on a modify
 * entry exit 4; unknown leaf refused), STATE (a refused amend leaves the entry's leaf untouched),
 * REGRESSION (amend without --leaf still keeps the leaf). Registry follow-up: rule-propose-op-flags-registry.bun.test.ts.
 *
 * Throwaway corpus (mkdtemp + `lore init`, HOME redirected); never the repo's own `.lore/`.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { patchLoreConfig } from "../../helpers/patch-lore-config.js";
import { runLoreInProcess } from "../../helpers/run-lore-in-process";
import { templatedFieldsArgs } from "../../helpers/templated-create.js";
import { asyncLoreRunnerFor, ensureLiveRuleViaAsyncCli } from "../../helpers/cli-live-rule";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

let dir = "";
let leafA = "";
let leafB = "";
let liveRuleId = "";

async function lore(args: readonly string[]): Promise<RunResult> {
  return await runLoreInProcess(args, { cwd: dir, home: dir, env: { ...process.env, HOME: dir, EDITOR: "true" } });
}

async function loreOk(args: readonly string[]): Promise<string> {
  const run = await lore(args);
  if (run.exitCode !== 0) throw new Error(`lore ${args.join(" ")} failed (${run.exitCode}): ${run.stderr}${run.stdout}`);
  return run.stdout;
}

const text = (run: RunResult): string => `${run.stdout}\n${run.stderr}`;

function slugOf(stdout: string): string {
  const m = stdout.match(/Slug:\s+(\S+)/) ?? stdout.match(/Created baseline \w+ (\S+) \(/);
  if (m?.[1] !== undefined) return m[1];
  return (JSON.parse(stdout) as { data: { slug: string } }).data.slug;
}

async function createSpec(title: string): Promise<string> {
  return slugOf(await loreOk(["create", "spec", "--title", title, "--kind", "feature", "--no-ai", ...templatedFieldsArgs("spec", { kind: "feature" }), "--json"]));
}

async function proposeAdd(spec: string): Promise<string> {
  const out = await loreOk(["rule", "propose", spec, "add", "--leaf", leafA, "--statement", "original wording", "--enforced-by", "both", "--example", "example one"]);
  const id = out.match(/\bBR-\d+\b/)?.[0];
  if (id === undefined) throw new Error(`no rule id in: ${out}`);
  return id;
}

interface ChangeRow { id: string; op: string; leaf?: string }

async function changesOf(spec: string): Promise<ChangeRow[]> {
  return (JSON.parse(await loreOk(["rule", "changes", spec, "--json"])) as { data: { changes: ChangeRow[] } }).data.changes;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "rule-propose-op-flags-"));
  await loreOk(["init"]);
  patchLoreConfig(dir, ["workflow:", "  review:", "    judgment_required_types: []", "  gates:", "    spec-create:", "      enabled: false", "    spec-promote:", "      enabled: false", ""].join("\n"));
  const prd = slugOf(await loreOk(["create", "prd", "--title", "Fixture PRD", "--no-ai", ...templatedFieldsArgs("prd"), "--json"]));
  liveRuleId = await ensureLiveRuleViaAsyncCli(
    asyncLoreRunnerFor(async (args, cwd) => await runLoreInProcess(args, { cwd, home: cwd, env: { ...process.env, HOME: cwd, EDITOR: "true" } }), dir),
    dir,
    prd,
  );
  leafA = (JSON.parse(await loreOk(["rule", "show", liveRuleId, "--json"])) as { data: { leaf: string } }).data.leaf;
  const root = slugOf(await loreOk(["baseline", "add", prd, "--node", "root", "--label", "Root2", "--title", "Second Root"]));
  const branch = slugOf(await loreOk(["baseline", "add", root, "--node", "branch", "--label", "Branch2", "--title", "Second Branch"]));
  leafB = slugOf(await loreOk(["baseline", "add", branch, "--node", "leaf", "--label", "Leaf2", "--title", "Second Leaf"]));
}, 180_000);

afterAll(() => {
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

describe("lore rule propose amend --leaf", () => {
  it("HAPPY: moves a proposed add to another business leaf; changes --json shows it", async () => {
    const spec = await createSpec("Amend leaf happy");
    const id = await proposeAdd(spec);
    const run = await lore(["rule", "propose", spec, "amend", id, "--leaf", leafB, "--json"]);
    expect(run.exitCode, text(run)).toBe(0);
    const row = (await changesOf(spec)).find((c) => c.id === id);
    expect(row?.leaf).toBe(leafB);
  });

  it("REGRESSION: amend without --leaf keeps the leaf", async () => {
    const spec = await createSpec("Amend keeps leaf");
    const id = await proposeAdd(spec);
    const run = await lore(["rule", "propose", spec, "amend", id, "--statement", "reworded"]);
    expect(run.exitCode, text(run)).toBe(0);
    expect((await changesOf(spec)).find((c) => c.id === id)?.leaf).toBe(leafA);
  });

  it("ERROR/STATE: an unknown leaf is refused and the entry keeps its leaf", async () => {
    const spec = await createSpec("Amend leaf unknown");
    const id = await proposeAdd(spec);
    const run = await lore(["rule", "propose", spec, "amend", id, "--leaf", "no-such-leaf-slug"]);
    expect(run.exitCode, text(run)).not.toBe(0);
    expect((await changesOf(spec)).find((c) => c.id === id)?.leaf).toBe(leafA);
  });

  it("ERROR: amend --leaf on a modify entry exits 4 naming the op", async () => {
    const spec = await createSpec("Amend leaf on modify");
    await loreOk(["rule", "propose", spec, "modify", liveRuleId, "--statement", "reworded live rule"]);
    const run = await lore(["rule", "propose", spec, "amend", liveRuleId, "--leaf", leafB]);
    await lore(["rule", "propose", spec, "withdraw", liveRuleId]); // free the rule for the other cases (modify is exclusive per rule)
    expect(run.exitCode, text(run)).toBe(4);
    expect(text(run)).toMatch(/modify/);
  });
});

describe("lore rule propose: a flag the op does not take is exit 2 naming flag and op", () => {
  it("retire --statement", async () => {
    const spec = await createSpec("Retire statement");
    const run = await lore(["rule", "propose", spec, "retire", liveRuleId, "--note", "why", "--statement", "ignored?"]);
    expect(run.exitCode, text(run)).toBe(2);
    expect(text(run)).toContain("--statement");
    expect(text(run)).toContain("retire");
  });

  it("withdraw --example", async () => {
    const spec = await createSpec("Withdraw example");
    await loreOk(["rule", "propose", spec, "modify", liveRuleId, "--statement", "reworded live rule"]);
    const run = await lore(["rule", "propose", spec, "withdraw", liveRuleId, "--example", "ignored?"]);
    await lore(["rule", "propose", spec, "withdraw", liveRuleId]); // free the rule (a no-op failure when the run above already withdrew it)
    expect(run.exitCode, text(run)).toBe(2);
    expect(text(run)).toContain("--example");
    expect(text(run)).toContain("withdraw");
  });

  it("modify --note", async () => {
    const spec = await createSpec("Modify note");
    const run = await lore(["rule", "propose", spec, "modify", liveRuleId, "--statement", "x reworded", "--note", "ignored?"]);
    expect(run.exitCode, text(run)).toBe(2);
    expect(text(run)).toContain("--note");
    expect(text(run)).toContain("modify");
  });

  it("amend --note", async () => {
    const spec = await createSpec("Amend note");
    const id = await proposeAdd(spec);
    const run = await lore(["rule", "propose", spec, "amend", id, "--statement", "reworded", "--note", "ignored?"]);
    expect(run.exitCode, text(run)).toBe(2);
    expect(text(run)).toContain("--note");
    expect(text(run)).toContain("amend");
  });

  it("add --note", async () => {
    const spec = await createSpec("Add note");
    const run = await lore(["rule", "propose", spec, "add", "--leaf", leafA, "--statement", "s", "--enforced-by", "both", "--example", "e", "--note", "ignored?"]);
    expect(run.exitCode, text(run)).toBe(2);
    expect(text(run)).toContain("--note");
  });

  it("modify --leaf and retire --leaf", async () => {
    const spec = await createSpec("Leaf on modify and retire");
    const modify = await lore(["rule", "propose", spec, "modify", liveRuleId, "--statement", "reworded", "--leaf", leafB]);
    expect(modify.exitCode, text(modify)).toBe(2);
    expect(text(modify)).toContain("--leaf");
    const retire = await lore(["rule", "propose", spec, "retire", liveRuleId, "--note", "why", "--leaf", leafB]);
    expect(retire.exitCode, text(retire)).toBe(2);
    expect(text(retire)).toContain("--leaf");
  });

  it("retire --example and --enforced-by, withdraw --statement", async () => {
    const spec = await createSpec("Retire and withdraw extras");
    const a = await lore(["rule", "propose", spec, "retire", liveRuleId, "--note", "why", "--example", "e"]);
    expect(a.exitCode, text(a)).toBe(2);
    const b = await lore(["rule", "propose", spec, "retire", liveRuleId, "--note", "why", "--enforced-by", "both"]);
    expect(b.exitCode, text(b)).toBe(2);
    const c = await lore(["rule", "propose", spec, "withdraw", liveRuleId, "--statement", "s"]);
    expect(c.exitCode, text(c)).toBe(2);
    expect(text(c)).toContain("--statement");
  });
});
