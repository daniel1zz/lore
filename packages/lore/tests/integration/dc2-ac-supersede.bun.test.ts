// @reads assets/project/lore-config-template.yaml
// @reads assets/governance/write-spec-rule.md
/**
 * @spec_ref spec-defect-clusters-round-2-part-b-review-pending-queue-corpus#AC-DC2-15 (D15, BR-163)
 *
 * A single acceptance criterion can be superseded by another spec's criterion; afterwards it is immutable,
 * `lore verify` skips it and lists it as superseded, and the spec is not demoted.
 * Throwaway corpus only (mkdtemp + `lore init`), commands run in-process; never the repo's own `.lore/`.
 *
 * The green-but-broken case this guards: marking the criterion in `ac list` while `lore verify` still runs the
 * old command and records a passing row for it. Part (b) therefore runs verify and counts evidence rows per criterion.
 *
 * Coverage: HAPPY (a, b), NEGATIVE (c, d), STATE (a: status/version/audit; d: nothing written on a bad target),
 * BOUNDARY (self-supersede, unknown target AC, missing reason), REGRESSION (b: the live AC-2 still verifies).
 */
import { mkdtempSync, rmSync } from "fs";
import { patchLoreConfig } from "../helpers/patch-lore-config.js";
import { join } from "path";
import { tmpdir } from "os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runLoreInProcess } from "../helpers/run-lore-in-process";

const ID = "spec-defect-clusters-round-2-part-b-review-pending-queue-corpus#AC-DC2-15";

let dir = "";
let specS = "";
let specS2 = "";
let plan = "";
let task = "";
let s2Id = "";

async function lore(args: readonly string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const r = await runLoreInProcess(args, {
    cwd: dir,
    home: dir,
    env: { ...process.env, HOME: dir, CLAUDECODE: "1", LORE_ACTOR: "agent:dc2-15-test" },
  });
  return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode };
}

async function must(args: readonly string[]): Promise<string> {
  const r = await lore(args);
  if (r.exitCode !== 0) throw new Error(`lore ${args.join(" ")} exited ${r.exitCode}: ${r.stderr}`);
  return r.stdout;
}

const slugOf = (stdout: string): string => {
  const slug = (stdout.match(/Slug:\s+(\S+)/) ?? stdout.match(/Created baseline \w+ (\S+) \(/))?.[1];
  if (slug === undefined) throw new Error(`no slug in: ${stdout}`);
  return slug;
};

interface DocJson {
  readonly id: string;
  readonly status: string;
  readonly version: number;
}

async function docOf(slug: string): Promise<DocJson> {
  const parsed = JSON.parse(await must(["get", slug, "--json"])) as { data?: { doc?: DocJson }; doc?: DocJson };
  const doc = parsed.data?.doc ?? parsed.doc;
  if (doc === undefined) throw new Error("no doc in get --json");
  return doc;
}

interface CriterionJson {
  readonly id: string;
  readonly statement: string;
  readonly superseded_by?: { spec: string; ac: string; reason: string; by: string; at: string };
}

async function criteriaOf(slug: string): Promise<CriterionJson[]> {
  const parsed = JSON.parse(await must(["ac", "list", slug, "--json"])) as { data?: { criteria?: CriterionJson[] } };
  return parsed.data?.criteria ?? [];
}

async function evidenceRowsPerAc(): Promise<Record<string, number>> {
  const parsed = JSON.parse(await must(["get", task, "--json"])) as {
    data?: { doc?: { extra?: { verification_evidence?: { ac_ref?: string }[] } } };
  };
  const counts: Record<string, number> = {};
  for (const row of parsed.data?.doc?.extra?.verification_evidence ?? []) {
    if (row.ac_ref !== undefined) counts[row.ac_ref] = (counts[row.ac_ref] ?? 0) + 1;
  }
  return counts;
}

let citedRule = "";

async function addScriptAc(spec: string, acId: string): Promise<void> {
  await must([
    "ac", "add", spec, acId, "--statement", `criterion ${acId} holds`, "--mode", "script", "--oracle", "other",
    "--command", `echo ${acId}-ran`, "--cite", citedRule,
  ]);
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "lore-dc2-15-"));
  await must(["init"]);
  patchLoreConfig(
    dir,
    [
      "workflow:", "  gates:",
      "    spec-create:", "      enabled: false",
      "    spec-promote:", "      enabled: false",
      "    plan-promote:", "      enabled: false",
      "    task-claim:", "      enabled: false",
      '    "task-create":', "      enabled: false",
      "",
    ].join("\n"),
  );
  // Approval needs a live cited rule: a minimal baseline tree with one rule.
  const prd = slugOf(await must(["create", "prd", "--title", "DC2-15 PRD", "--content", "root", "--no-ai"]));
  const root = slugOf(await must(["baseline", "add", prd, "--node", "root", "--label", "Root", "--title", "DC2-15 Root"]));
  const branch = slugOf(await must(["baseline", "add", root, "--node", "branch", "--label", "Branch", "--title", "DC2-15 Branch"]));
  const leaf = slugOf(await must(["baseline", "add", branch, "--node", "leaf", "--label", "Leaf", "--title", "DC2-15 Leaf"]));
  const rule = await must(["rule", "add", leaf, "--statement", "a live rule to cite", "--confidence", "established", "--enforced-by", "guaranteed", "--example", "example one"]);
  citedRule = rule.match(/\bBR-\d+\b/)?.[0] ?? "";
  if (citedRule === "") throw new Error(`no rule id in: ${rule}`);
  // a direct add is a pending add: citable only once its leaf is approved (the override class is loosened above)
  await must(["approve", leaf, "--override-no-judgment"]);
  specS =slugOf(await must(["create", "spec", "--title", "DC2-15 Spec S", "--content", "body", "--no-ai"]));
  specS2 = slugOf(await must(["create", "spec", "--title", "DC2-15 Spec S2", "--content", "body", "--no-ai"]));
  await addScriptAc(specS, "AC-1");
  await addScriptAc(specS, "AC-2");
  await addScriptAc(specS2, "AC-9");
  plan = slugOf(await must(["create", "plan", "--title", "DC2-15 Plan", "--parent", specS, "--no-ai", "--content", "body"]));
  task = slugOf(
    await must([
      "create", "task", "--title", "DC2-15 Task", "--parent", plan, "--plan-id", plan, "--no-ai", "--content", "body",
      "--ac-scope", "AC-1", "--ac-scope", "AC-2",
    ]),
  );
  await must(["approve", specS, "--override-no-judgment"]);
  await must(["approve", specS2, "--override-no-judgment"]);
  s2Id = (await docOf(specS2)).id;
}, 120_000);

afterAll(() => {
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

describe(ID, () => {
  it(`${ID} (a)-(d) supersede records the marker, verify skips it, it is immutable, bad targets are refused`, async () => {
    // (d) first: bad targets and a missing reason change nothing.
    const before = await docOf(specS);
    const unknown = await lore(["ac", "supersede", specS, "AC-1", "--by", `${specS2}:AC-404`, "--reason", "r"]);
    expect(unknown.exitCode).toBe(4);
    expect(unknown.stderr).toContain("AC-404");
    const self = await lore(["ac", "supersede", specS, "AC-1", "--by", `${specS}:AC-1`, "--reason", "r"]);
    expect(self.exitCode).toBe(4);
    const noReason = await lore(["ac", "supersede", specS, "AC-1", "--by", `${specS2}:AC-9`]);
    expect(noReason.exitCode).toBe(2);
    expect((await docOf(specS)).version).toBe(before.version);

    // (a) the supersede itself
    expect(before.status).toBe("approved");
    const updateAudits = async (): Promise<number> =>
      (await must(["audit", specS, "--action", "update", "--json"])).match(/"action":\s*"update"/g)?.length ?? 0;
    const auditBefore = await updateAudits();
    const ok = await lore(["ac", "supersede", specS, "AC-1", "--by", `${specS2}:AC-9`, "--reason", "r"]);
    expect(ok.exitCode).toBe(0);
    const ac1 = (await criteriaOf(specS)).find((c) => c.id === "AC-1");
    expect(ac1?.superseded_by).toMatchObject({ spec: s2Id, ac: "AC-9", reason: "r" });
    expect(ac1?.superseded_by?.by).toBeTruthy();
    expect(ac1?.superseded_by?.at).toBeTruthy();
    const after = await docOf(specS);
    expect(after.status).toBe("approved");
    expect(after.version).toBe(before.version + 1);
    expect(await updateAudits()).toBe(auditBefore + 1);

    // (b) verify records nothing for AC-1, records AC-2, lists AC-1 as superseded.
    const verify = await lore(["verify", plan, "--task", task, "--allow-new-commands", "--json"]);
    expect(verify.exitCode).toBe(0);
    const data = (JSON.parse(verify.stdout) as { data: { superseded: { ac_id: string }[]; results: { ac_id: string }[] } }).data;
    expect(data.superseded.map((s) => s.ac_id)).toEqual(["AC-1"]);
    expect(data.results.map((r) => r.ac_id)).toEqual(["AC-2"]);
    const rows = await evidenceRowsPerAc();
    expect(rows["AC-1"]).toBeUndefined();
    expect(rows["AC-2"]).toBe(1);

    // (c) immutable: set, rm and a second supersede all exit 4 naming "superseded".
    for (const args of [
      ["ac", "set", specS, "AC-1", "--statement", "z"],
      ["ac", "rm", specS, "AC-1"],
      ["ac", "supersede", specS, "AC-1", "--by", `${specS2}:AC-9`, "--reason", "again"],
    ]) {
      const refused = await lore(args);
      expect(refused.exitCode, args.join(" ")).toBe(4);
      expect(refused.stderr, args.join(" ")).toContain("superseded");
    }
    expect((await docOf(specS)).version).toBe(after.version);
  }, 180_000);
});
