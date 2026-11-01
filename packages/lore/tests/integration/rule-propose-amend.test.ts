// @spawns packages/lore/tests/helpers/approve-nodes-cli.ts
// @reads assets/project/lore-config-template.yaml
/**
 * AC-DN5-3 oracle — `spec-design-necessity-rule-v5-separate-what-a-design-needs-from` (D3, "Amend a proposed rule").
 *
 * `lore rule propose <spec> amend <BR-n> ...` rewrites THIS spec's own proposed `add` entry in place: same id,
 * same leaf, exactly one new version. On an approved (locked) spec it needs `--correction <reason>` (the BR-1069
 * exit, status kept); without it the record-edit gate refuses (exit 4). A live id, or an id another spec
 * proposes, is refused (exit 4, naming the id).
 *
 * Coverage: HAPPY (locked + correction; draft without correction; --example wholesale; --enforced-by),
 * NEGATIVE (no correction; live id; other spec's id; unknown id), BOUNDARY (4 examples, 501-char statement),
 * ERROR (exit codes asserted exactly), STATE (status stays approved, one version, id/leaf unchanged),
 * REGRESSION (a plain `add` still reserves a fresh id afterwards).
 *
 * Throwaway corpus (mkdtemp + `lore init`, HOME redirected); never the repo's own `.lore/`. Commands run in-process.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { patchLoreConfig } from "../helpers/patch-lore-config.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLoreInProcess } from "../helpers/run-lore-in-process";
import { asyncLoreRunnerFor, ensureLiveRuleViaAsyncCli } from "../helpers/cli-live-rule";
import { DECIDED_FLAGS } from "../helpers/decision-flags";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

let dir = "";
let leafSlug = "";
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
  return (JSON.parse(stdout) as { data: { slug: string } }).data.slug;
}

async function createSpec(title: string): Promise<string> {
  return slugOf(
    await loreOk(["create", "spec", "--title", title, "--kind", "feature", "--no-ai", "--content", "## Overview\n\nFixture body.", "--json"]),
  );
}

/** Reserve a proposed rule on `spec`; returns its BR id. */
async function proposeAdd(spec: string, statement: string, examples: string[] = ["example one"]): Promise<string> {
  const args = ["rule", "propose", spec, "add", "--leaf", leafSlug, "--statement", statement, "--enforced-by", "both"];
  for (const example of examples) args.push("--example", example);
  const out = await loreOk(args);
  const id = out.match(/\bBR-\d+\b/)?.[0];
  if (id === undefined) throw new Error(`no rule id in: ${out}`);
  return id;
}

interface ChangeRow {
  id: string;
  op: string;
  leaf?: string;
  statement?: string;
  examples?: string[];
  enforced_by?: string;
}

async function changesOf(spec: string): Promise<ChangeRow[]> {
  const parsed = JSON.parse(await loreOk(["rule", "changes", spec, "--json"])) as { data: { changes: ChangeRow[] } };
  return parsed.data.changes;
}

async function specState(spec: string): Promise<{ status: string; version: number }> {
  const parsed = JSON.parse(await loreOk(["get", spec, "--json"])) as {
    data: { doc?: { status: string; version: number }; status?: string; version?: number };
  };
  const status = parsed.data.doc?.status ?? parsed.data.status;
  const version = parsed.data.doc?.version ?? parsed.data.version;
  if (status === undefined || version === undefined) throw new Error(`get --json carries no status/version: ${JSON.stringify(parsed.data).slice(0, 200)}`);
  return { status, version };
}

/** Approve `spec` (cites the live rule so the citation requirement is met) so it is a locked record. */
async function approve(spec: string): Promise<void> {
  await loreOk(["ac", "add", spec, "AC-1", "--statement", "the fixture behaves", "--mode", "human"]);
  await loreOk(["ac", "cite", spec, "AC-1", liveRuleId]);
  await loreOk(["set", spec, "--status", "approved"]);
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "rule-propose-amend-"));
  await loreOk(["init"]);
  patchLoreConfig(
    dir,
    [
      "workflow:",
      "  review:",
      "    judgment_required_types: []",
      "  gates:",
      "    spec-create:",
      "      enabled: false",
      "    spec-promote:",
      "      enabled: false",
      "",
    ].join("\n"),
  );
  const prd = slugOf(await loreOk(["create", "prd", "--title", "Fixture PRD", "--no-ai", "--content", "## Overview\n\nFixture body.", "--json"]));
  liveRuleId = await ensureLiveRuleViaAsyncCli(
    asyncLoreRunnerFor(async (args, cwd) => await runLoreInProcess(args, { cwd, home: cwd, env: { ...process.env, HOME: cwd, EDITOR: "true" } }), dir),
    dir,
    prd,
  );
  const tree = await loreOk(["rule", "show", liveRuleId, "--json"]);
  leafSlug = (JSON.parse(tree) as { data: { leaf: string } }).data.leaf;
}, 120_000);

afterAll(() => {
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

describe("lore rule propose <spec> amend", () => {
  it("HAPPY/STATE: on an approved spec, --correction rewrites the proposed add in place, keeps it approved, writes one version", async () => {
    const spec = await createSpec("Amend locked spec");
    const id = await proposeAdd(spec, "original wording of the proposed rule");
    await approve(spec);
    const before = await specState(spec);
    expect(before.status).toBe("approved");

    const run = await lore([
      "rule", "propose", spec, "amend", id,
      "--statement", "refined wording of the proposed rule",
      "--correction", "wording was patch-shaped; same intent", ...DECIDED_FLAGS,
    ]);
    expect(run.exitCode).toBe(0);
    expect(text(run)).toContain(id);

    const after = await specState(spec);
    expect(after.status).toBe("approved");
    expect(after.version).toBe(before.version + 1);
    const rows = (await changesOf(spec)).filter((c) => c.op === "add");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(id);
    expect(rows[0]?.leaf).toBe(leafSlug);
    expect(rows[0]?.statement).toBe("refined wording of the proposed rule");
    expect(rows[0]?.examples).toEqual(["example one"]);
    const log = JSON.parse(await loreOk(["log", spec, "--json"])) as { data: { entries: Array<{ version: number; change_summary?: string }> } };
    const written = log.data.entries.filter((e) => e.version > before.version);
    expect(written).toHaveLength(1);
    expect(written[0]?.change_summary).toBe("Correction: wording was patch-shaped; same intent");
  });

  it("NEGATIVE/ERROR: on an approved spec without --correction exits 4 naming the record-edit gate; nothing changes", async () => {
    const spec = await createSpec("Amend locked no correction");
    const id = await proposeAdd(spec, "wording that must stay");
    await approve(spec);
    const before = await specState(spec);

    const run = await lore(["rule", "propose", spec, "amend", id, "--statement", "wording that must not land"]);
    expect(run.exitCode).toBe(4);
    expect(text(run)).toContain("record-edit");
    expect(await specState(spec)).toEqual(before);
    expect((await changesOf(spec))[0]?.statement).toBe("wording that must stay");
  });

  it("NEGATIVE/ERROR: a live rule id is refused with exit 4 naming the id", async () => {
    const spec = await createSpec("Amend live id");
    await proposeAdd(spec, "some proposed rule");
    const run = await lore(["rule", "propose", spec, "amend", liveRuleId, "--statement", "rewrite of a live rule"]);
    expect(run.exitCode).toBe(4);
    expect(text(run)).toContain(liveRuleId);
  });

  it("NEGATIVE/ERROR: an id proposed by another spec is refused with exit 4 naming the id", async () => {
    const owner = await createSpec("Amend other owner");
    const ownerId = await proposeAdd(owner, "owned by another spec");
    const spec = await createSpec("Amend other caller");
    await proposeAdd(spec, "mine");
    const run = await lore(["rule", "propose", spec, "amend", ownerId, "--statement", "not mine to rewrite"]);
    expect(run.exitCode).toBe(4);
    expect(text(run)).toContain(ownerId);
    expect((await changesOf(owner))[0]?.statement).toBe("owned by another spec");
  });

  it("NEGATIVE/ERROR: an unknown id is refused with exit 4 naming the id", async () => {
    const spec = await createSpec("Amend unknown id");
    await proposeAdd(spec, "some proposed rule");
    const run = await lore(["rule", "propose", spec, "amend", "BR-987654", "--statement", "nothing to amend"]);
    expect(run.exitCode).toBe(4);
    expect(text(run)).toContain("BR-987654");
  });

  it("HAPPY: a draft (unlocked) spec amends without --correction; --example replaces wholesale; --enforced-by amends", async () => {
    const spec = await createSpec("Amend draft spec");
    const id = await proposeAdd(spec, "draft wording", ["first example", "second example"]);
    const before = await specState(spec);

    const run = await lore([
      "rule", "propose", spec, "amend", id,
      "--example", "only example one", "--example", "only example two", "--example", "only example three",
      "--enforced-by", "guaranteed",
    ]);
    expect(run.exitCode).toBe(0);
    const row = (await changesOf(spec)).find((c) => c.id === id);
    expect(row?.statement).toBe("draft wording");
    expect(row?.examples).toEqual(["only example one", "only example two", "only example three"]);
    expect(row?.enforced_by).toBe("guaranteed");
    expect(row?.leaf).toBe(leafSlug);
    const after = await specState(spec);
    expect(after.status).toBe(before.status);
    expect(after.version).toBe(before.version + 1);
  });

  it("NEGATIVE/ERROR: an amend that changes nothing is refused (exit 4), with no field and with identical values", async () => {
    const spec = await createSpec("Amend nothing");
    const id = await proposeAdd(spec, "stable wording");
    const before = await specState(spec);

    const bare = await lore(["rule", "propose", spec, "amend", id]);
    expect(bare.exitCode).toBe(4);
    expect(text(bare)).toContain("at least one");

    const same = await lore(["rule", "propose", spec, "amend", id, "--statement", "stable wording"]);
    expect(same.exitCode).toBe(4);
    expect(text(same)).toContain(id);
    expect(await specState(spec)).toEqual(before);
  });

  it("BOUNDARY/ERROR: 4 examples and a 501-character statement are refused (exit 4) like add / modify", async () => {
    const spec = await createSpec("Amend bounds");
    const id = await proposeAdd(spec, "bounded wording");
    const many = await lore([
      "rule", "propose", spec, "amend", id,
      "--example", "a", "--example", "b", "--example", "c", "--example", "d",
    ]);
    expect(many.exitCode).toBe(4);
    const long = await lore(["rule", "propose", spec, "amend", id, "--statement", "x".repeat(501)]);
    expect(long.exitCode).toBe(4);
    expect((await changesOf(spec))[0]?.statement).toBe("bounded wording");
  });

  it("REGRESSION: after an amend, a plain add still reserves a fresh id and modify still names only live rules", async () => {
    const spec = await createSpec("Amend then add");
    const id = await proposeAdd(spec, "first wording");
    expect((await lore(["rule", "propose", spec, "amend", id, "--statement", "second wording"])).exitCode).toBe(0);
    const next = await proposeAdd(spec, "another rule");
    expect(next).not.toBe(id);
    const modifyProposed = await lore(["rule", "propose", spec, "modify", id, "--statement", "x"]);
    expect(modifyProposed.exitCode).toBe(4);
    expect(text(modifyProposed)).toContain("LIVE");
  });
});
