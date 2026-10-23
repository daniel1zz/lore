/**
 * AC-ROI-1 (spec-run-only-write-identity-and-run-end-claim-release): no WRITE surface takes `by`.
 *
 * Walks the REAL citty command registry (`adapters/cli/index.ts`, every leaf of every group) and the
 * REAL MCP tool registry (`registerTools` against a McpServer), and pins the read-side `by` filters
 * as EXACTLY the {@link READ_SIDE_BY_FILTERS} constant — equality, so neither a new `by` on a write
 * verb nor an unlisted read filter can slip in.
 *
 * Coverage:
 *   HAPPY:      the set of CLI leaves declaring `by` equals the pinned CLI allowlist; same for MCP tools
 *   NEGATIVE:   no leaf declares the `reviewer` alias (approve/reject took it as `--by`'s alias)
 *   BOUNDARY:   group commands with nested leaves (gate, phase, ac, anchor, ...) are walked, not skipped
 *   REGRESSION: an unknown `--by` on a write command is rejected by the strict-flag seam (exit 2 path)
 */

import { liveInvocation } from "../../live-invocation.js";
import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CommandDef } from "citty";
import { READ_SIDE_BY_FILTERS } from "../../../src/adapters/read-side-by-filters.js";
import { findUnknownFlag } from "../../../src/adapters/cli/strict-flags.js";
import type { App } from "../../../src/app.js";

// reason: command modules import `loader.ts` -> `app.ts` -> `bun:sqlite`, which vitest (node) cannot
// resolve. Registry WALKING never opens a store, so an inert stand-in is enough.
vi.mock("bun:sqlite", () => ({ Database: class {} }));

type Resolvable<T> = T | Promise<T> | (() => T | Promise<T>);

async function resolveValue<T>(value: Resolvable<T> | undefined): Promise<T | undefined> {
  if (value === undefined) return undefined;
  return typeof value === "function" ? await (value as () => T | Promise<T>)() : await value;
}

interface CliLeaf {
  readonly path: string;
  readonly topLevel: string;
  readonly argNames: readonly string[];
  readonly def: CommandDef;
}

async function walk(def: CommandDef, path: string[], topLevel: string, out: CliLeaf[]): Promise<void> {
  const subCommands = (await resolveValue(def.subCommands as Resolvable<Record<string, Resolvable<CommandDef>>>)) ?? {};
  const args = (await resolveValue(def.args as Resolvable<Record<string, unknown>>)) ?? {};
  const names = Object.keys(subCommands);
  if (typeof def.run === "function" || names.length === 0) {
    out.push({ path: path.join(" "), topLevel, argNames: Object.keys(args), def });
  }
  for (const name of names) {
    const child = await resolveValue(subCommands[name]);
    if (child !== undefined) await walk(child, [...path, name], topLevel, out);
  }
}

async function collectCliLeaves(): Promise<CliLeaf[]> {
  const main = (await import("../../../src/adapters/cli/index.js")).default as CommandDef;
  const top = (await resolveValue(main.subCommands as Resolvable<Record<string, Resolvable<CommandDef>>>)) ?? {};
  const out: CliLeaf[] = [];
  for (const name of Object.keys(top)) {
    const def = await resolveValue(top[name]);
    if (def === undefined) throw new Error(`registry entry ${name} resolved to nothing`);
    await walk(def, [name], name, out);
  }
  return out;
}

interface McpToolSchema {
  readonly shape?: Record<string, unknown>;
  safeParse(input: unknown): { success: boolean; error?: { issues: Array<{ code: string; keys?: string[] }> } };
}

async function collectMcpToolSchemas(): Promise<Map<string, McpToolSchema>> {
  const { registerTools } = await import("../../../src/adapters/mcp/tools.js");
  const server = new McpServer({ name: "ac-roi-1", version: "0.0.0" });
  registerTools(server, { callerSurface: "mcp" } as unknown as App, undefined, liveInvocation());
  const registered = (server as unknown as { _registeredTools: Record<string, { inputSchema?: McpToolSchema }> })._registeredTools;
  const out = new Map<string, McpToolSchema>();
  for (const [name, tool] of Object.entries(registered)) if (tool.inputSchema !== undefined) out.set(name, tool.inputSchema);
  return out;
}

async function collectMcpToolShapes(): Promise<Map<string, readonly string[]>> {
  const { registerTools } = await import("../../../src/adapters/mcp/tools.js");
  const server = new McpServer({ name: "ac-roi-1", version: "0.0.0" });
  registerTools(server, { callerSurface: "mcp" } as unknown as App, undefined, liveInvocation());
  const registered = (server as unknown as { _registeredTools: Record<string, { inputSchema?: { shape?: Record<string, unknown> } }> })
    ._registeredTools;
  const out = new Map<string, readonly string[]>();
  for (const [name, tool] of Object.entries(registered)) {
    out.set(name, Object.keys(tool.inputSchema?.shape ?? {}));
  }
  return out;
}

// reason: `ac supersede --by <spec>:<AC>` names the AC that REPLACES the superseded one; it is a criterion reference, not a
// writer's name, so it neither attributes the write nor belongs in the read-side actor filters. Pinned by name so a second
// non-actor `by` cannot slip in unnoticed.
const NON_ACTOR_BY_LEAVES: readonly string[] = ["ac supersede"];

const CLI_ALLOWED = [...READ_SIDE_BY_FILTERS.filter((f) => f.surface === "cli").map((f) => f.verb), ...NON_ACTOR_BY_LEAVES].sort();
const MCP_ALLOWED = READ_SIDE_BY_FILTERS.filter((f) => f.surface === "mcp").map((f) => f.verb).sort();

describe("AC-ROI-1 write commands take no `by`", () => {
  it("AC-ROI-1: the CLI leaves declaring `by` are exactly the pinned read-side allowlist", async () => {
    const leaves = await collectCliLeaves();
    expect(leaves.length).toBeGreaterThan(60);
    const declaring = leaves.filter((l) => l.argNames.includes("by")).map((l) => l.path).sort();
    expect(declaring).toEqual(CLI_ALLOWED);
  });

  it("AC-ROI-1: no CLI leaf declares the `reviewer` alias of `by`", async () => {
    const leaves = await collectCliLeaves();
    expect(leaves.filter((l) => l.argNames.includes("reviewer")).map((l) => l.path)).toEqual([]);
  });

  it("AC-ROI-1: nested group leaves are walked (gate/phase/ac/anchor/scope are in the walk)", async () => {
    const paths = (await collectCliLeaves()).map((l) => l.path);
    for (const expected of ["gate task-claim", "phase add", "ac add", "anchor add", "scope add", "rule add", "baseline add"]) {
      expect(paths, `${expected} missing from the registry walk`).toContain(expected);
    }
  });

  it("AC-ROI-1: the MCP tools whose schema has a `by` property are exactly the pinned read-side allowlist", async () => {
    const shapes = await collectMcpToolShapes();
    expect(shapes.size).toBeGreaterThan(40);
    const declaring = [...shapes.entries()].filter(([, keys]) => keys.includes("by")).map(([name]) => name).sort();
    expect(declaring).toEqual(MCP_ALLOWED);
  });

  it("AC-ROI-1: no MCP tool schema has a `reviewer` property", async () => {
    const shapes = await collectMcpToolShapes();
    expect([...shapes.entries()].filter(([, keys]) => keys.includes("reviewer")).map(([name]) => name)).toEqual([]);
  });

  it("AC-ROI-1: every registered MCP tool schema REFUSES an undeclared `by` loudly (strict), never strips it", async () => {
    const schemas = await collectMcpToolSchemas();
    const refusing: string[] = [];
    const stripping: string[] = [];
    const notAnObject: string[] = [];
    for (const [name, schema] of schemas) {
      if (MCP_ALLOWED.includes(name)) continue; // read-side filters declare `by` themselves
      // reason: a refine-wrapped schema (ZodEffects) has no `.strict()`; the only one is the READ tool lore_rule_find,
      // which never carried a `by` and attributes nothing. Pinned by equality below so a new one cannot hide.
      if (schema.shape === undefined) {
        notAnObject.push(name);
        continue;
      }
      const result = schema.safeParse({ by: "agent:someone-else" });
      const refused = result.error?.issues.some((i) => i.code === "unrecognized_keys" && i.keys?.includes("by")) === true;
      (refused ? refusing : stripping).push(name);
    }
    expect(refusing.length).toBeGreaterThan(30);
    expect(stripping).toEqual([]);
    expect(notAnObject).toEqual(["lore_rule_find"]);
  });

  it("AC-ROI-1: the strict-flag seam rejects `--by` on a write command", async () => {
    const leaves = await collectCliLeaves();
    const claim = leaves.find((l) => l.path === "claim");
    expect(claim).toBeDefined();
    const args = (await resolveValue(claim!.def.args as Resolvable<Record<string, unknown>>)) ?? {};
    expect(findUnknownFlag(["t", "--by", "x"], args as never)).toBe("--by");
  });
});
