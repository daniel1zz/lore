// @spawns packages/lore/src/index.ts
// @reads assets/project/lore.tree.yaml.template
// @reads lore.tree.yaml
/**
 * The tree blueprint models the parentless `template` type: a template document passes the review's
 * deterministic `tree_position` check and `lore status --check-tree` reports it neither orphan nor misplaced.
 *
 * Fixture: one throwaway corpus (`mkdtemp` + `lore init`, outside the repo) holding the SHIPPED seed blueprint
 * (`assets/project/lore.tree.yaml.template`) as its `lore.tree.yaml` and one `template` document. The repo's own
 * `.lore/` is never touched. The same assertions run against the repo's own `lore.tree.yaml`.
 *
 * Dimensions: HAPPY (tree_position pass, clean tree check), NEGATIVE (a blueprint without a template slot still
 * fails tree_position — the control that proves the slot is what fixes it), BOUNDARY (min 0: a corpus with no
 * template is not a drift), REGRESSION (a template WITH a parent is still misplaced — BR-2 stays enforced).
 *
 * @spec_ref spec-every-document-is-stored-as-structured-fields-validated-by
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTreeBlueprint, runDeterministicChecks, type CreateDocInput, type DocRecord } from "@lore/core";
import { createApp } from "../../src/app.js";
import { liveAmbient, liveWriteContext } from "../live-invocation.js";

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const SEED = join(REPO_ROOT, "assets", "project", "lore.tree.yaml.template");
const REPO_BLUEPRINT = join(REPO_ROOT, "lore.tree.yaml");
const NO_TEMPLATE_BLUEPRINT = "version: 1\nroot:\n  type: prd\n  children:\n    - { type: spec, min: 1 }\n";

let dir = "";
let templateDoc: DocRecord;

function runLore(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const env = { ...process.env, HOME: dir, CLAUDECODE: "1", LORE_ACTOR: "agent:template-tree-slot-test" };
  const proc = Bun.spawnSync(["bun", "run", ENTRY, ...args], { cwd: dir, env });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function treeDrifts(): { exitCode: number; drifts: { kind: string }[] } {
  const r = runLore(["status", "--check-tree", "--json"]);
  const parsed = JSON.parse(r.stdout) as { data: { drifts: { kind: string }[] } };
  return { exitCode: r.exitCode, drifts: parsed.data.drifts };
}

function treePositionOf(blueprintYaml: string, parent?: DocRecord) {
  const parsed = parseTreeBlueprint(blueprintYaml);
  if (!parsed.ok) throw new Error(`blueprint did not parse: ${JSON.stringify(parsed.error)}`);
  const results = runDeterministicChecks({
    doc: templateDoc,
    ...(parent !== undefined ? { parent } : {}),
    links: [],
    blueprint: parsed.value,
  });
  const found = results.find((r) => r.check === "tree_position");
  if (found === undefined) throw new Error("no tree_position result");
  return found;
}

beforeAll(async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "template-tree-slot-")));
  if (dir.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");
  const git = (args: string[]): void => void execFileSync("git", args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "tts@example.invalid"]);
  git(["config", "user.name", "template tree slot"]);
  writeFileSync(join(dir, "README.md"), "fixture\n");
  git(["add", "."]);
  git(["commit", "-q", "-m", "init"]);
  const init = runLore(["init"]);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}${init.stdout}`);
  copyFileSync(SEED, join(dir, "lore.tree.yaml"));

  const app = createApp(join(dir, ".lore", "lore.db"), undefined, liveAmbient(), liveWriteContext());
  try {
    const body = {
      doc_type: "spec",
      kind: "feature",
      version: 1,
      fields: { type: "object", required: ["summary"], properties: { summary: { type: "string", minLength: 1 } } },
      dimensions: [{ id: "edge-cases", question: "Which edge cases does it handle?" }],
      checks: [],
      render: [{ heading: "Summary", fields: ["summary"] }],
    };
    const created = await app.corpusService.create({ type: "template", title: "Tree slot fixture template", extra: { template: body } } as CreateDocInput);
    if (!created.ok) throw new Error(`template create failed: ${JSON.stringify(created.error)}`);
    templateDoc = created.value;
  } finally {
    app.close();
  }
});

afterAll(() => {
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

describe("the tree blueprint models the parentless template type", () => {
  it("HAPPY: the fixture template really is parentless", () => {
    expect(templateDoc.type).toBe("template");
    expect(templateDoc.parent_id ?? null).toBeNull();
  });

  it("HAPPY: tree_position passes for a template against the shipped seed blueprint", () => {
    expect(treePositionOf(readFileSync(SEED, "utf8"))).toEqual({ check: "tree_position", outcome: "pass" });
  });

  it("HAPPY: tree_position passes for a template against the repo's own lore.tree.yaml", () => {
    expect(treePositionOf(readFileSync(REPO_BLUEPRINT, "utf8"))).toEqual({ check: "tree_position", outcome: "pass" });
  });

  it("HAPPY: lore status --check-tree reports the template neither orphan nor misplaced, exit 0, on the seed", () => {
    const { exitCode, drifts } = treeDrifts();
    expect(drifts).toEqual([]);
    expect(exitCode).toBe(0);
  });

  it("HAPPY: lore status --check-tree stays clean on the repo's own blueprint", () => {
    copyFileSync(REPO_BLUEPRINT, join(dir, "lore.tree.yaml"));
    const { exitCode, drifts } = treeDrifts();
    copyFileSync(SEED, join(dir, "lore.tree.yaml"));
    expect(drifts).toEqual([]);
    expect(exitCode).toBe(0);
  });

  it("NEGATIVE control: a blueprint with no template slot still fails tree_position", () => {
    const result = treePositionOf(NO_TEMPLATE_BLUEPRINT);
    expect(result.outcome).toBe("fail");
    expect(result.detail).toContain("'template' is not modeled anywhere in lore.tree.yaml");
  });

  it("REGRESSION: a template that HAS a parent is still misplaced (BR-2)", () => {
    const parent = { ...templateDoc, id: "01ARZ3PARENT00000000001", slug: "some-prd", type: "prd" } as DocRecord;
    const result = treePositionOf(readFileSync(SEED, "utf8"), parent);
    expect(result.outcome).toBe("fail");
    expect(result.detail).toContain("takes no parent");
  });
});
