// @spawns dist/lore
/**
 * record-lock-compiled.bun.test.ts — AC-DR-5: the record-edit gate and its read surfaces, observed from the
 * REAL compiled binary on a throwaway corpus.
 *
 * Covers: `lore set --content` / `lore restore` / `lore ac add` on an approved spec exit exactly 4 (stderr names
 * 'locked record' and 'lore reopen'); `lore set --correction` exits 0 and `lore get` then shows 'Standing: record',
 * 'locked (approved)', 'Corrections: 1', a newer relates-to spec under 'Later changed by'; a knowledge reference
 * shows 'Standing: living'; `lore reopen` on an evidence-free approved spec exits 0 and `get` shows draft; over
 * the MCP stdio server `lore_set` and `lore_batch set` return gate:record-edit and `lore_reopen` succeeds.
 *
 * bun test (not vitest): spawns `dist/lore` against `mkdtemp` + `lore init` (cwd AND HOME inside it) — never the
 * repo's own `.lore/`. `assertFreshBinary` fails loud on a stale `dist/lore`.
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
 *
 * @spec_ref AC-DR-5 — spec-documents-are-living-or-records-a-locked-record-is-never D4, D5, D6, D7
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const setDefaultTimeout = (ms: number): void => { vi.setConfig({ testTimeout: ms, hookTimeout: ms }); };
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import yaml from "yaml";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { assertFreshBinary } from "../integration/helpers/assert-fresh-binary";
import { citeSpecViaCli, loreRunnerFor } from "../helpers/cli-live-rule.js";

setDefaultTimeout(120_000);

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

// tests/e2e/ -> packages/lore/ -> packages/ -> repo root (4 levels up).
const PROJECT_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(PROJECT_ROOT, "dist", "lore");

let dir = "";

function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") env[k] = v;
  return { ...env, HOME: dir, CLAUDE_CODE_SESSION_ID: "a77e57e1-aaaa-bbbb-cccc-222222222222" };
}

function runLore(args: string[], cwd: string = dir): RunResult {
  const proc = Bun.spawnSync([LORE_BIN, ...args], { cwd, env: cleanEnv() });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function mustLore(args: string[]): string {
  const r = runLore(args);
  if (r.exitCode !== 0) throw new Error(`lore ${args.join(" ")} failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r.stdout;
}

function parseSlug(stdout: string): string {
  const slug = stdout.match(/Slug:\s+(\S+)/)?.[1];
  if (slug === undefined) throw new Error(`could not parse slug from: ${stdout}`);
  return slug;
}

/** A spec with one cited criterion, approved — the state the record-edit gate locks. */
function createApprovedSpec(title: string, acId: string): string {
  const slug = parseSlug(
    mustLore(["create", "spec", "--title", title, "--kind", "tech", "--content", "## Overview\n\nOriginal body.\n", "--no-ai"]),
  );
  mustLore([
    "ac", "add", slug, acId, "--statement", `${title} behaves as stated.`,
    "--mode", "script", "--oracle", "test", "--command", "bun test",
  ]);
  citeSpecViaCli(loreRunnerFor(runLore, dir), dir, undefined, slug, acId);
  mustLore(["approve", slug]);
  return slug;
}

function docIdOf(slug: string): string {
  const payload = JSON.parse(mustLore(["get", slug, "--json"])) as { data: { doc: { id: string } } };
  return payload.data.doc.id;
}

async function withMcp<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const transport = new StdioClientTransport({ command: LORE_BIN, args: ["--mcp-server"], cwd: dir, env: cleanEnv() });
  const client = new Client({ name: "record-lock-compiled", version: "0.0.0" });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ text?: string }> }).content ?? [];
  return content.map((c) => c.text ?? "").join("\n");
}

let lockedSpec = "";
let newerSpec = "";
let reopenCliSpec = "";
let reopenMcpSpec = "";

describe("record-edit gate and read surfaces, compiled binary (AC-DR-5)", () => {
  beforeAll(() => {
    // reason: `bun run build` produces dist/lore; this fails loud on a missing or stale binary.
    assertFreshBinary(LORE_BIN, [join(PROJECT_ROOT, "packages", "lore", "src"), join(PROJECT_ROOT, "packages", "core", "src")]);
    dir = mkdtempSync(join(tmpdir(), "lore-record-lock-e2e-"));
    mustLore(["init"]);
    mustLore(["create", "prd", "--title", "Record Lock PRD", "--content", "PRD body.", "--no-ai"]);
    // SPEC-103 M2's review-judgment checkpoint defaults spec/adr into `judgment_required_types`; disabled so the
    // approvals below are fixture steps, not the behaviour under test.
    const cfgPath = join(dir, ".lore", "config.yaml");
    const existing = yaml.parse(readFileSync(cfgPath, "utf8")) as Record<string, unknown>;
    const workflow = { ...(existing["workflow"] as Record<string, unknown> | undefined), review: { judgment_required_types: [] } };
    writeFileSync(cfgPath, yaml.stringify({ ...existing, workflow }), "utf8");

    lockedSpec = createApprovedSpec("Locked Spec", "AC-LK-1");
    newerSpec = parseSlug(
      mustLore(["create", "spec", "--title", "Newer Spec", "--kind", "tech", "--content", "## Overview\n\nNewer.\n", "--no-ai"]),
    );
    mustLore(["link", newerSpec, lockedSpec, "--type", "relates-to"]);
    reopenCliSpec = createApprovedSpec("Reopen Cli Spec", "AC-RC-1");
    reopenMcpSpec = createApprovedSpec("Reopen Mcp Spec", "AC-RM-1");
  });

  afterAll(() => {
    if (dir !== "") rmSync(dir, { recursive: true, force: true });
  });

  it("lore set --content on an approved spec exits exactly 4 naming 'locked record' and 'lore reopen'", () => {
    const r = runLore(["set", lockedSpec, "--content", "## Overview\n\nRewritten.\n"]);
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toContain("locked record");
    expect(r.stderr).toContain("lore reopen");
  });

  it("lore restore on the approved spec exits exactly 4", () => {
    expect(runLore(["restore", docIdOf(lockedSpec), "1"]).exitCode).toBe(4);
  });

  it("lore ac add on the approved spec exits exactly 4", () => {
    const r = runLore([
      "ac", "add", lockedSpec, "AC-LK-2", "--statement", "A second criterion.",
      "--mode", "script", "--oracle", "test", "--command", "bun test",
    ]);
    expect(r.exitCode).toBe(4);
  });

  it("lore get shows 'Standing: record', 'locked (approved)' and no Corrections line before any correction", () => {
    const out = mustLore(["get", lockedSpec]);
    expect(out).toContain("Standing: record");
    expect(out).toContain("locked (approved)");
    expect(out).not.toContain("Corrections:");
  });

  it("lore set --correction exits 0, then get shows Standing: record, locked (approved) and Corrections: 1", () => {
    const set = runLore(["set", lockedSpec, "--content", "## Overview\n\nOriginal body, typo fixed.\n", "--correction", "typo"]);
    expect(set.exitCode).toBe(0);
    const out = mustLore(["get", lockedSpec]);
    expect(out).toContain("Standing: record");
    expect(out).toContain("locked (approved)");
    expect(out).toContain("Corrections: 1");
    expect(out).toContain("Status: approved");
  });

  it("a newer spec linked relates-to appears under 'Later changed by' on the locked spec, not on the newer one", () => {
    const out = mustLore(["get", lockedSpec]);
    expect(out).toContain("Later changed by");
    expect(out).toContain(newerSpec);
    expect(mustLore(["get", newerSpec])).not.toContain("Later changed by");
  });

  it("a knowledge reference shows 'Standing: living'", () => {
    const slug = parseSlug(
      mustLore(["create", "knowledge", "--title", "Living Reference", "--sub-type", "reference", "--content", "Reference body.", "--no-ai"]),
    );
    const out = mustLore(["get", slug]);
    expect(out).toContain("Standing: living");
    expect(out).not.toContain("Corrections:");
  });

  it("lore reopen --reason on an evidence-free approved spec exits 0 and get shows draft", () => {
    const r = runLore(["reopen", reopenCliSpec, "--reason", "r"]);
    expect(r.exitCode).toBe(0);
    const out = mustLore(["get", reopenCliSpec]);
    expect(out).toContain("Status: draft");
    expect(out).toContain("Standing: record · not locked");
  });

  it("MCP lore_set and lore_batch set on the locked spec return gate:record-edit; lore_reopen succeeds on a third spec", async () => {
    await withMcp(async (c) => {
      const single = await c.callTool({
        name: "lore_set",
        arguments: { id_or_slug: lockedSpec, content: "## Overview\n\nMcp rewrite.\n" },
      });
      expect(single.isError).toBe(true);
      expect(textOf(single)).toContain("gate:record-edit");

      const batch = await c.callTool({
        name: "lore_batch",
        arguments: { operations: [{ op: "set", args: { id_or_slug: lockedSpec, content: "## Overview\n\nBatch rewrite.\n" } }] },
      });
      expect(textOf(batch)).toContain("gate:record-edit");

      const reopen = await c.callTool({ name: "lore_reopen", arguments: { id_or_slug: reopenMcpSpec, reason: "r" } });
      expect(reopen.isError ?? false).toBe(false);
    });
    expect(mustLore(["get", reopenMcpSpec])).toContain("Status: draft");
  });
});
