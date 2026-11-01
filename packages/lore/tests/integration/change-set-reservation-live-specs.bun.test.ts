// @spawns packages/lore/tests/helpers/approve-nodes-cli.ts
// @reads assets/project/lore-config-template.yaml
/**
 * Oracle for task-skill-fix-a-deleted-spec-s-change-set-stops-reserving.
 *
 * (a) a soft-deleted spec's `modify BR-x` no longer reserves BR-x: another spec can propose it (exit 0);
 * (b) `lore rule propose <spec> withdraw <BR-x>` removes a modify/retire entry (locked spec: --correction, status
 *     kept, ONE version); a second spec can then propose it; an `add`, an unknown id and a landed id are refused;
 * (c) a foreign-provenance refusal of a TASK write says "this task write", a baseline target "this baseline write".
 *
 * Coverage: HAPPY (a, b), NEGATIVE (withdraw add / unknown id; no --correction), ERROR (exit codes exact),
 * STATE (versions, status), REGRESSION (a live spec's modify still reserves the rule).
 *
 * Throwaway corpus (mkdtemp + `lore init`, HOME redirected); never the repo's own `.lore/`.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DOC_TYPE_ROLE_MAP } from "@lore/core";
import type { DocId, DocRecord } from "@lore/core";
import { runLoreInProcess } from "../helpers/run-lore-in-process";
import { asyncLoreRunnerFor, ensureLiveRuleViaAsyncCli } from "../helpers/cli-live-rule";
import { InMemoryStore } from "../../src/store/in-memory-store.js";
import { CorpusWriteAuthority } from "../../src/service/foreign-corpus-write-guard.js";
import { patchLoreConfig } from "../helpers/patch-lore-config.js";
import { DECIDED_FLAGS } from "../helpers/decision-flags.js";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

let dir = "";
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

async function createSpec(title: string): Promise<string> {
  const out = await loreOk(["create", "spec", "--title", title, "--kind", "feature", "--no-ai", "--content", "## Overview\n\nFixture body.", "--json"]);
  return (JSON.parse(out) as { data: { slug: string } }).data.slug;
}

async function proposeModify(spec: string, rule: string): Promise<RunResult> {
  return await lore(["rule", "propose", spec, "modify", rule, "--statement", `reworded by ${spec}`]);
}

async function changeIds(spec: string): Promise<string[]> {
  const parsed = JSON.parse(await loreOk(["rule", "changes", spec, "--json"])) as { data: { changes: Array<{ id: string }> } };
  return parsed.data.changes.map((c) => c.id);
}

async function specState(spec: string): Promise<{ status: string; version: number }> {
  const parsed = JSON.parse(await loreOk(["get", spec, "--json"])) as {
    data: { doc?: { status: string; version: number }; status?: string; version?: number };
  };
  const status = parsed.data.doc?.status ?? parsed.data.status;
  const version = parsed.data.doc?.version ?? parsed.data.version;
  if (status === undefined || version === undefined) throw new Error("get --json carries no status/version");
  return { status, version };
}

async function approve(spec: string): Promise<void> {
  await loreOk(["ac", "add", spec, "AC-1", "--statement", "the fixture behaves", "--mode", "human"]);
  await loreOk(["ac", "cite", spec, "AC-1", liveRuleId]);
  await loreOk(["set", spec, "--status", "approved"]);
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "change-set-reservation-"));
  await loreOk(["init"]);
  patchLoreConfig(
    dir,
    ["workflow:", "  review:", "    judgment_required_types: []", "  gates:", "    spec-create:", "      enabled: false", "    spec-promote:", "      enabled: false", ""].join("\n"),
  );
  const prd = (JSON.parse(await loreOk(["create", "prd", "--title", "Fixture PRD", "--no-ai", "--content", "## Overview\n\nFixture body.", "--json"])) as { data: { slug: string } }).data.slug;
  liveRuleId = await ensureLiveRuleViaAsyncCli(
    asyncLoreRunnerFor(async (args, cwd) => await runLoreInProcess(args, { cwd, home: cwd, env: { ...process.env, HOME: cwd, EDITOR: "true" } }), dir),
    dir,
    prd,
  );
}, 120_000);

afterAll(() => {
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

describe("AC-a: a deleted spec's change set does not reserve rules", () => {
  it("HAPPY: after deleting the spec that modifies BR-x, another spec proposes modify BR-x (exit 0)", async () => {
    const first = await createSpec("Reservation first");
    expect((await proposeModify(first, liveRuleId)).exitCode).toBe(0);
    const blocked = await createSpec("Reservation blocked");
    const refused = await proposeModify(blocked, liveRuleId);
    expect(refused.exitCode).toBe(4); // REGRESSION: a live spec still reserves the rule
    expect(text(refused)).toContain("already modified");

    await loreOk(["delete", first, "--confirm"]);
    const run = await proposeModify(blocked, liveRuleId);
    expect(run.exitCode, text(run)).toBe(0);
    expect(await changeIds(blocked)).toEqual([liveRuleId]);
    await loreOk(["delete", blocked, "--confirm"]); // release the rule for the later tests
  });
});

describe("AC-b: lore rule propose <spec> withdraw <BR-n>", () => {
  it("HAPPY/STATE: withdraw removes the entry in ONE version; a second spec can then propose it", async () => {
    const owner = await createSpec("Withdraw owner");
    expect((await proposeModify(owner, liveRuleId)).exitCode).toBe(0);
    const before = await specState(owner);
    const run = await lore(["rule", "propose", owner, "withdraw", liveRuleId]);
    expect(run.exitCode, text(run)).toBe(0);
    expect(text(run)).toContain(liveRuleId);
    expect(await changeIds(owner)).toEqual([]);
    expect((await specState(owner)).version).toBe(before.version + 1);

    const other = await createSpec("Withdraw other");
    expect((await proposeModify(other, liveRuleId)).exitCode).toBe(0);
    await lore(["rule", "propose", other, "withdraw", liveRuleId]); // release the rule for the later tests
  });

  it("HAPPY/STATE: on an approved spec --correction withdraws, status stays approved, one version", async () => {
    const owner = await createSpec("Withdraw locked");
    expect((await proposeModify(owner, liveRuleId)).exitCode).toBe(0);
    await approve(owner);
    const before = await specState(owner);
    expect(before.status).toBe("approved");

    const refused = await lore(["rule", "propose", owner, "withdraw", liveRuleId]);
    expect(refused.exitCode).toBe(4);
    expect(text(refused)).toContain("record-edit");
    expect(await changeIds(owner)).toEqual([liveRuleId]);

    const run = await lore(["rule", "propose", owner, "withdraw", liveRuleId, "--correction", "entry belongs to a split-off spec", ...DECIDED_FLAGS]);
    expect(run.exitCode, text(run)).toBe(0);
    expect(await specState(owner)).toEqual({ status: "approved", version: before.version + 1 });
    expect(await changeIds(owner)).toEqual([]);
  });

  it("NEGATIVE/ERROR: an id this spec does not carry is refused with exit 4 naming it", async () => {
    const spec = await createSpec("Withdraw absent");
    const run = await lore(["rule", "propose", spec, "withdraw", "BR-987654"]);
    expect(run.exitCode).toBe(4);
    expect(text(run)).toContain("BR-987654");
  });

  it("NEGATIVE/ERROR: an `add` entry is not withdrawable (exit 4); the entry stays", async () => {
    const spec = await createSpec("Withdraw add");
    const leaf = (JSON.parse(await loreOk(["rule", "show", liveRuleId, "--json"])) as { data: { leaf: string } }).data.leaf;
    const added = await loreOk(["rule", "propose", spec, "add", "--leaf", leaf, "--statement", "a proposed rule", "--example", "e1", "--enforced-by", "both"]);
    const id = added.match(/\bBR-\d+\b/)?.[0] ?? "";
    const run = await lore(["rule", "propose", spec, "withdraw", id]);
    expect(run.exitCode).toBe(4);
    expect(text(run)).toContain(id);
    expect(await changeIds(spec)).toEqual([id]);
  });

  it("USAGE: withdraw without a rule id exits non-zero", async () => {
    const spec = await createSpec("Withdraw usage");
    expect((await lore(["rule", "propose", spec, "withdraw"])).exitCode).not.toBe(0);
  });
});

describe("AC-c: the foreign-provenance refusal names the target kind", () => {
  function doc(type: "task" | "baseline" | "spec", slug: string): DocRecord {
    const now = new Date().toISOString();
    return {
      id: `01TESTDOC${slug}`.padEnd(26, "0") as DocId,
      slug,
      type,
      role: DOC_TYPE_ROLE_MAP[type],
      title: slug,
      status: "draft",
      priority: "medium",
      content: slug,
      parent_id: null,
      created_at: now,
      updated_at: now,
      created_by: "test",
      version: 1,
      deleted_at: null,
      tags: [],
      extra: type === "baseline" ? { node: "leaf", label: slug } : {},
    } as DocRecord;
  }

  async function refusal(target: DocRecord): Promise<string> {
    const authority = new CorpusWriteAuthority(new InMemoryStore(), {
      foreign: { provenance: "git_common_dir", enabled: true },
      callerDir: "/nowhere/worktree",
      claimTtlMinutes: 60,
    });
    const decided = await authority.decide([target]);
    if (decided.ok) throw new Error("expected a refusal");
    if (!("message" in decided.error)) throw new Error(`refusal carries no message: ${decided.error.code}`);
    return decided.error.message;
  }

  it("a task target says 'this task write', never 'baseline write'", async () => {
    const message = await refusal(doc("task", "some-task"));
    expect(message).toContain("this task write");
    expect(message).not.toContain("baseline write");
  });

  it("a baseline target says 'this baseline write'; any other doc says 'this document write'", async () => {
    expect(await refusal(doc("baseline", "some-leaf"))).toContain("this baseline write");
    expect(await refusal(doc("spec", "some-spec"))).toContain("this document write");
  });
});
