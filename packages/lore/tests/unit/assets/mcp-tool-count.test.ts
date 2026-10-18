// @reads .claude/**
// @reads .lore-bootstrap/**
// @reads .lore/**
// @reads .serena/**
// @reads CLAUDE.md
// @reads assets/**
// @reads dist-npm/**
// @reads dist/**
// @reads docs/**
// @reads hooks/**
// @reads npm-pkg/**
// @reads packages/**
// @reads scripts/**
/**
 * RED scenarios for AC-CV-8 (issue #209): the MCP tool count is a registered
 * variable (LORE_MCP_TOOL_NAMES), never a hand-typed number.
 *
 * Expected RED today: tool-names.ts does not exist; CLAUDE.md:64 says "16",
 * assets/skills/lore/SKILL.md:122 says "23".
 *
 * @spec_ref AC-CV-8
 */

import { liveInvocation } from "../../live-invocation.js";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { JudgmentService } from "../../../src/service/judgment-service.js";
import { NoOpTelemetry } from "@lore/core";
import type { App } from "../../../src/app.js";
import { registerTools } from "../../../src/adapters/mcp/tools.js";
import { RealAssetSource } from "../../../src/adapters/real-asset-source.js";
import { LORE_MCP_TOOL_NAMES } from "../../../src/adapters/mcp/tool-names.js";

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..");
const ASSETS_ROOT = join(REPO_ROOT, "assets");
const HAND_TYPED_COUNT = /\b\d+ `?lore_\*`? tools/;

// reason: tool registration only needs the services handlers close over; other App
// fields are null-cast exactly as mcp-tools.test.ts does.
function makeApp(): App {
  const store = new InMemoryStore();
  const lock = new RecordLockService(store, new GateEnforcer(undefined));
  return {
    corpusService: new CorpusService(store, lock),
    judgmentService: new JudgmentService(store, new NoOpTelemetry()),
    callerSurface: "cli" as const,
    resolveAiDefault: () => ({ ai: false, source: "cli_flag" as const }),
    telemetry: new NoOpTelemetry(),
    close: () => undefined,
  } as unknown as App;
}

function walk(dir: string, out: string[]): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".git" || e.name === "worktrees") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
}

function handTypedLines(files: string[]): string[] {
  return files.flatMap((f) =>
    readFileSync(f, "utf8")
      .split("\n")
      .map((l, i) => (HAND_TYPED_COUNT.test(l) ? `${f}:${i + 1}: ${l.trim()}` : ""))
      .filter(Boolean),
  );
}

describe("AC-CV-8 MCP tool count is a variable", () => {
  it("LORE_MCP_TOOL_NAMES set-equals the tools registered on a real MCP server", () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerTools(server, makeApp(), undefined, liveInvocation());
    const registered = Object.keys(
      (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools,
    );
    expect(registered.length).toBeGreaterThan(0);
    expect(new Set(LORE_MCP_TOOL_NAMES)).toEqual(new Set(registered));
    expect(new Set(LORE_MCP_TOOL_NAMES).size).toBe(LORE_MCP_TOOL_NAMES.length);
  });

  it("RealAssetSource.load() of skills/lore/SKILL.md carries the derived count and no unexpanded outlet", async () => {
    const loaded = await new RealAssetSource(ASSETS_ROOT).load();
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const skill = loaded.value.files.find((f) => f.path === "skills/lore/SKILL.md");
    expect(skill).toBeDefined();
    const content = String(skill?.content);
    expect(content).toContain(`${LORE_MCP_TOOL_NAMES.length} \`lore_*\` tools`);
    expect(content).not.toContain("{{lore:");
  });

  it("no CLAUDE.md in the repo hand-types an MCP tool count", () => {
    const files: string[] = [];
    walk(REPO_ROOT, files);
    expect(handTypedLines(files.filter((f) => f.endsWith("/CLAUDE.md")))).toEqual([]);
  });

  it("no file under assets/ hand-types an MCP tool count", () => {
    const files: string[] = [];
    walk(ASSETS_ROOT, files);
    expect(handTypedLines(files)).toEqual([]);
  });
});
