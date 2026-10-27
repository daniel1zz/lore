/**
 * @layer lore-unit AC-RMCP-3 (write half; the AC's owner file is packages/core/tests/caller-surface-mcp-history-read.test.ts)
 * Every writer refuses the surface "mcp" at compile time: each call below passes "mcp" under `// @ts-expect-error`,
 * so `bun run typecheck` turns red (unused directive) the moment any writer accepts it again. The runtime
 * assertions cover the pieces a type cannot: the built-in AI defaults and the config schema.
 *
 * Dimensions: NEGATIVE (each writer refuses "mcp"), HAPPY (each writer still takes a live surface), BOUNDARY
 * (a historical audit row carrying "mcp" passes through the stamper unchanged), REGRESSION (config key refused).
 *
 * @spec_ref spec-remove-the-lore-mcp-server#AC-RMCP-3
 */
import { describe, it, expect } from "vitest";
import { AiDefaultPerSurfaceSchema, type AuditEntry, type WrittenSetupEntry } from "@lore/core";
import type { App } from "../../../src/app.js";
import { resolveAiDefault, BUILT_IN_AI_DEFAULTS } from "../../../src/ai/resolve-ai.js";
import { runWithAuditSurface, stampAuditSurface } from "../../../src/store/audit-surface.js";

/** Never called: it exists so tsc checks each assignment. */
function compileTimeBans(app: App): void {
  // @ts-expect-error — app.callerSurface takes the writable union, which has no "mcp"
  app.callerSurface = "mcp";
  // @ts-expect-error — runWithAuditSurface takes the writable union
  runWithAuditSurface("mcp", () => 1);
  // @ts-expect-error — AI-default resolution takes the writable union
  resolveAiDefault(undefined, "mcp", undefined);
  // @ts-expect-error — the install-manifest entry writer shape excludes kind "mcp"
  const entry: WrittenSetupEntry = { path: "mcp:lore", kind: "mcp", sha256: "x", written_at: "t" };
  void entry;
}
void compileTimeBans;

describe("AC-RMCP-3 write half: no writer accepts the surface mcp", () => {
  it("writers still accept a live surface", () => {
    expect(runWithAuditSurface("cli", () => 7)).toBe(7);
    expect(resolveAiDefault(undefined, "agent", undefined)).toEqual({ ai: false, source: "env" });
  });

  it("the built-in AI defaults carry no mcp key", () => {
    expect(Object.keys(BUILT_IN_AI_DEFAULTS).sort()).toEqual(["agent", "cli", "http_cookie", "http_token"]);
  });

  it("the per-surface AI default schema refuses an mcp key", () => {
    expect(AiDefaultPerSurfaceSchema.safeParse({ mcp: true }).success).toBe(false);
    expect(AiDefaultPerSurfaceSchema.safeParse({ cli: true }).success).toBe(true);
  });

  it("a historical audit row that already carries surface mcp passes through the stamper unchanged", () => {
    const row: AuditEntry = {
      timestamp: "2026-01-01T00:00:00.000Z",
      actor: "alice",
      session_id: "s1",
      action: "set",
      details: { surface: "mcp" },
    };
    expect(runWithAuditSurface("cli", () => stampAuditSurface(row))).toBe(row);
  });
});
