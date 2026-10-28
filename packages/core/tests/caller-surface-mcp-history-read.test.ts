/**
 * @layer core-unit AC-RMCP-3 (read half)
 * Rows and manifests written before the lore MCP server was removed carry `surface: "mcp"` / `kind: "mcp"`.
 * The read-side schemas keep that value so old history still parses; only the WRITE side refuses it
 * (see packages/lore/tests/unit/types/surface-mcp-write-ban.test.ts, the write half).
 *
 * Dimensions: HAPPY (each stored shape parses and keeps "mcp"), NEGATIVE (a value that was never a surface is still
 * refused), REGRESSION (the read union still names "mcp"; the writable union does not).
 *
 * @spec_ref AC-RMCP-3
 */
import { describe, it, expect } from "vitest";
import {
  aiGenerationEventSchema,
  setupManifestSchema,
  traceEventInputSchema,
  type AuditEntry,
  type CallerSurface,
  type WritableCallerSurface,
} from "@lore/core";

describe("AC-RMCP-3 read half: historical mcp values still read back", () => {
  it("a stored ai.generation telemetry row keeps caller_surface mcp", () => {
    const row = aiGenerationEventSchema.parse({
      event: "ai.generation",
      ts: "2026-01-01T00:00:00.000Z",
      provider: "claude-cli",
      doc_type: "prd",
      template_source: "built-in",
      duration_ms: 10,
      output_chars: 5,
      exit_code: 0,
      caller_surface: "mcp",
    });
    expect(row.caller_surface).toBe("mcp");
  });

  it("a stored trace row keeps surface mcp", () => {
    const row = traceEventInputSchema.parse({
      ts: "2026-01-01T00:00:00.000Z",
      actor: "alice",
      surface: "mcp",
      session_id: "s1",
      kind: "search",
    });
    expect(row.surface).toBe("mcp");
  });

  it("a stored audit row keeps details.surface mcp (the read-side shape is a plain record)", () => {
    const row: AuditEntry = {
      timestamp: "2026-01-01T00:00:00.000Z",
      actor: "alice",
      session_id: "s1",
      action: "set",
      details: { surface: "mcp" },
    };
    expect(row.details?.surface).toBe("mcp");
  });

  it("a setup manifest holding a kind mcp entry parses and keeps the entry", () => {
    const manifest = setupManifestSchema.parse({
      version: "1",
      claude_dir: "/tmp/claude",
      entries: [{ path: "mcp:lore", kind: "mcp", sha256: "abc", written_at: "2026-01-01T00:00:00.000Z" }],
    });
    expect(manifest.entries[0]?.kind).toBe("mcp");
  });

  it("a value that was never a surface is still refused by the read schemas", () => {
    const bad = { ts: "2026-01-01T00:00:00.000Z", actor: "a", surface: "grpc", session_id: "s", kind: "search" };
    expect(traceEventInputSchema.safeParse(bad).success).toBe(false);
  });

  it("the read union names mcp while the writable union does not (type level)", () => {
    const readable: CallerSurface = "mcp";
    // @ts-expect-error — the writable union refuses "mcp"
    const writable: WritableCallerSurface = "mcp";
    expect(readable).toBe("mcp");
    expect(writable).toBe("mcp");
  });
});
