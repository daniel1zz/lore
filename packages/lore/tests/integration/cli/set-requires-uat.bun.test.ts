// @reads assets/project/lore-config-template.yaml
/**
 * AC-RMCP-4 —`lore set <plan> --requires-uat` merges `extra.requires_uat: true` into the plan's
 * existing extra (every other key kept); a non-plan doc is a usage error (exit 2, nothing written);
 * the plan-promote feeding pack names the CLI flag and no longer mentions the MCP `lore_set` tool.
 *
 * Source: spec-remove-the-lore-mcp-server D2/D3; BR-1486.
 * All commands run in-process against a throwaway corpus (mkdtemp + lore init), never the repo's .lore/.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runLoreInProcess } from "../../helpers/run-lore-in-process";
import { checkpointRegistry } from "../../../src/service/checkpoint-registry";
import { REQUIRES_UAT_FIELD } from "../../../src/service/gate-predicates";
import { ensureRequirementsDocSlugAsync } from "../../helpers/parented-create.js";

let tmpDir: string;

async function runLore(args: string[]) {
  return runLoreInProcess(args, {
    cwd: tmpDir,
    home: tmpDir,
    env: { ...process.env, HOME: tmpDir, EDITOR: "true", CLAUDECODE: "1" },
  });
}

async function createDoc(type: string, title: string, extra: string[] = []): Promise<string> {
  // reason: knowledge, decision and plan records need a parent (spec-documents-that-need-a-parent-are-refused-without-one-an-ad D6).
  const needsParent = ["knowledge", "adr", "plan"].includes(type) && !extra.includes("--parent");
  const parent = needsParent ? ["--parent", await ensureRequirementsDocSlugAsync((args) => runLore(args))] : [];
  const r = await runLore(["create", type, "--title", title, "--no-ai", "--content", "body", ...parent, ...extra]);
  if (r.exitCode !== 0) throw new Error(`create ${type} failed: ${r.stderr}`);
  const slug = r.stdout.match(/Slug:\s+(\S+)/)?.[1];
  if (!slug) throw new Error(`no slug in: ${r.stdout}`);
  return slug;
}

async function getExtra(slug: string): Promise<Record<string, unknown>> {
  const r = await runLore(["get", slug, "--json"]);
  expect(r.exitCode).toBe(0);
  const parsed = JSON.parse(r.stdout) as { data?: { doc?: { extra?: Record<string, unknown> }; extra?: Record<string, unknown> } };
  return (parsed.data?.doc?.extra ?? parsed.data?.extra ?? {}) as Record<string, unknown>;
}

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-set-requires-uat-"));
  const init = await runLore(["init"]);
  if (init.exitCode !== 0) throw new Error(`init failed: ${init.stderr}`);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("AC-RMCP-4: lore set --requires-uat", () => {
  it("HAPPY: merges requires_uat: true and keeps extra.phases deep-equal", async () => {
    const plan = await createDoc("plan", "Plan with phases");
    expect((await runLore(["phase", "add", plan, "Phase A"])).exitCode).toBe(0);
    const before = await getExtra(plan);
    expect(Array.isArray(before["phases"])).toBe(true);

    const r = await runLore(["set", plan, "--requires-uat"]);
    expect(r.exitCode).toBe(0);

    const after = await getExtra(plan);
    expect(after["requires_uat"]).toBe(true);
    expect(after["phases"]).toEqual(before["phases"]);
  });

  it("STATE: idempotent, a second run exits 0 and leaves extra unchanged", async () => {
    const plan = await createDoc("plan", "Plan idempotent");
    expect((await runLore(["set", plan, "--requires-uat"])).exitCode).toBe(0);
    const first = await getExtra(plan);
    expect((await runLore(["set", plan, "--requires-uat"])).exitCode).toBe(0);
    expect(await getExtra(plan)).toEqual(first);
  });

  it("NEGATIVE: a non-plan doc exits exactly 2, names --requires-uat, writes nothing", async () => {
    const prd = await createDoc("prd", "Some PRD");
    const before = await getExtra(prd);
    const r = await runLore(["set", prd, "--requires-uat"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("--requires-uat");
    expect(await getExtra(prd)).toEqual(before);
    expect(before["requires_uat"]).toBeUndefined();
  });

  it("REGRESSION: plan-promote feeding pack names the CLI flag and never the MCP lore_set tool", () => {
    const entry = checkpointRegistry["plan-promote"];
    expect(entry).toBeDefined();
    const text = entry!.feed({ targetIdOrSlug: "plan-demo" }, [
      { ok: false, reason: "requires_uat not declared", field: REQUIRES_UAT_FIELD },
    ]);
    expect(text).toContain("lore set plan-demo --requires-uat");
    expect(text).not.toContain("lore_set");
  });
});
