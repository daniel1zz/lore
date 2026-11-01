// @spawns packages/lore/tests/helpers/approve-nodes-cli.ts
// @reads assets/project/lore-config-template.yaml
/**
 * Oracle for task-lore-rule-propose-amend-refuses-flags-its-op-does-not-take (registry side).
 *
 * `amend --leaf` must move the proposed id's `rule_registry.leaf_doc_id` together with the spec's change set, in one
 * write; a refused amend leaves the registry row where it was. Reads the corpus db with bun:sqlite (read-only).
 *
 * Coverage: HAPPY (registry follows), STATE (refused amend leaves registry unchanged), REGRESSION (no --leaf: unchanged).
 * Throwaway corpus (mkdtemp + `lore init`); never the repo's own `.lore/`.
 */

import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { patchLoreConfig } from "../../helpers/patch-lore-config.js";
import { runLoreInProcess } from "../../helpers/run-lore-in-process";

let dir = "";
let leafA = "";
let leafB = "";

async function lore(args: readonly string[]) {
  return await runLoreInProcess(args, { cwd: dir, home: dir, env: { ...process.env, HOME: dir, EDITOR: "true" } });
}
async function loreOk(args: readonly string[]): Promise<string> {
  const run = await lore(args);
  if (run.exitCode !== 0) throw new Error(`lore ${args.join(" ")} failed (${run.exitCode}): ${run.stderr}${run.stdout}`);
  return run.stdout;
}
function slugOf(stdout: string): string {
  const m = stdout.match(/Slug:\s+(\S+)/) ?? stdout.match(/Created baseline \w+ (\S+) \(/);
  if (m?.[1] !== undefined) return m[1];
  return (JSON.parse(stdout) as { data: { slug: string } }).data.slug;
}
/** The registry's owning leaf doc id for a rule id. */
function registryLeafOf(ruleId: string): string {
  const db = new Database(join(dir, ".lore", "lore.db"), { readonly: true });
  try {
    return (db.prepare("SELECT leaf_doc_id FROM rule_registry WHERE id = ?").get(ruleId) as { leaf_doc_id: string }).leaf_doc_id;
  } finally {
    db.close();
  }
}
function docIdOf(slug: string): string {
  const db = new Database(join(dir, ".lore", "lore.db"), { readonly: true });
  try {
    return (db.prepare("SELECT id FROM docs WHERE slug = ?").get(slug) as { id: string }).id;
  } finally {
    db.close();
  }
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "rule-propose-op-flags-reg-"));
  await loreOk(["init"]);
  patchLoreConfig(dir, ["workflow:", "  review:", "    judgment_required_types: []", "  gates:", "    spec-create:", "      enabled: false", "    spec-promote:", "      enabled: false", ""].join("\n"));
  const prd = slugOf(await loreOk(["create", "prd", "--title", "Fixture PRD", "--no-ai", "--content", "## Overview\n\nFixture body.", "--json"]));
  const chain = async (label: string): Promise<string> => {
    const root = slugOf(await loreOk(["baseline", "add", prd, "--node", "root", "--label", `Root${label}`, "--title", `Root ${label}`]));
    const branch = slugOf(await loreOk(["baseline", "add", root, "--node", "branch", "--label", `Branch${label}`, "--title", `Branch ${label}`]));
    return slugOf(await loreOk(["baseline", "add", branch, "--node", "leaf", "--label", `Leaf${label}`, "--title", `Leaf ${label}`]));
  };
  leafA = await chain("A");
  leafB = await chain("B");
}, 180_000);

afterAll(() => {
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

async function proposed(title: string): Promise<{ spec: string; id: string }> {
  const spec = slugOf(await loreOk(["create", "spec", "--title", title, "--kind", "feature", "--no-ai", "--content", "## Overview\n\nFixture body.", "--json"]));
  const out = await loreOk(["rule", "propose", spec, "add", "--leaf", leafA, "--statement", "original wording", "--enforced-by", "both", "--example", "example one"]);
  const id = out.match(/\bBR-\d+\b/)?.[0];
  if (id === undefined) throw new Error(`no rule id in: ${out}`);
  return { spec, id };
}

describe("amend --leaf and the rule registry", () => {
  it("HAPPY: the registry row follows the moved leaf", async () => {
    const { spec, id } = await proposed("Registry follows");
    expect(registryLeafOf(id)).toBe(docIdOf(leafA));
    await loreOk(["rule", "propose", spec, "amend", id, "--leaf", leafB]);
    expect(registryLeafOf(id)).toBe(docIdOf(leafB));
  });

  it("STATE: a refused amend (unknown leaf) leaves the registry row where it was", async () => {
    const { spec, id } = await proposed("Registry stays on refusal");
    const run = await lore(["rule", "propose", spec, "amend", id, "--leaf", "no-such-leaf"]);
    expect(run.exitCode).not.toBe(0);
    expect(registryLeafOf(id)).toBe(docIdOf(leafA));
  });

  it("REGRESSION: amend without --leaf leaves the registry row", async () => {
    const { spec, id } = await proposed("Registry unchanged without leaf");
    await loreOk(["rule", "propose", spec, "amend", id, "--statement", "reworded"]);
    expect(registryLeafOf(id)).toBe(docIdOf(leafA));
  });
});
