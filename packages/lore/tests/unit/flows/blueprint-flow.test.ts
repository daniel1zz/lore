/**
 * Tests for `loadTreeBlueprint` (`flows/blueprint-flow.ts`) — the shared
 * `lore.tree.yaml` load+parse extraction consumed by `adapters/cli/commands/
 * status.ts` and `adapters/cli/commands/review.ts`.
 * Pure fs + `@lore/core` (no `bun:sqlite`, no `App`), so this runs under
 * vitest. Uses a real mkdtemp temp dir per test — NEVER the repo's own
 * `.lore/`/`lore.tree.yaml` (project CLAUDE.md hard rule).
 *
 * Six-dimension coverage:
 *   HAPPY:      valid minimal blueprint -> status "ok", parsed blueprint shape
 *   NEGATIVE:   n/a — no CLI-usage mutex to probe at this layer (that's the
 *               CLI adapters' job); malformed input is covered under ERROR
 *   BOUNDARY:   blueprint file exists but is an empty string -> "invalid"
 *               (YAML parses empty string to `undefined`, fails schema)
 *   ERROR:      missing file -> "missing"; malformed YAML -> "invalid" with a
 *               LoreError; YAML that parses but violates the schema (wrong
 *               `version`) -> "invalid" with a LoreError
 *   STATE:      `path` in every result variant always resolves to
 *               `<cwd>/lore.tree.yaml` regardless of outcome
 *   REGRESSION: calling twice in a row against the same cwd returns
 *               deep-equal results (pure function of fs state, no side effects)
 *
 * @spec_ref refactor: shared blueprint-flow extraction (SPEC-045 T2 follow-up)
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadTreeBlueprint } from "../../../src/flows/blueprint-flow.js";

const VALID_BLUEPRINT = ["version: 1", "root:", "  type: prd", "  min: 1", "  max: 1", ""].join("\n");

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-blueprint-flow-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ─── HAPPY ──────────────────────────────────────────────────────────────────

describe("loadTreeBlueprint — HAPPY", () => {
  it("valid blueprint file parses to status 'ok' with the parsed TreeBlueprint", () => {
    writeFileSync(join(tmpDir, "lore.tree.yaml"), VALID_BLUEPRINT);

    const result = loadTreeBlueprint(tmpDir);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.blueprint.version).toBe(1);
    expect(result.blueprint.root.type).toBe("prd");
    expect(result.blueprint.root.min).toBe(1);
    expect(result.blueprint.root.max).toBe(1);
  });
});

// ─── BOUNDARY ───────────────────────────────────────────────────────────────

describe("loadTreeBlueprint — BOUNDARY", () => {
  it("empty file content -> status 'invalid' (YAML parses to undefined, fails schema)", () => {
    writeFileSync(join(tmpDir, "lore.tree.yaml"), "");

    const result = loadTreeBlueprint(tmpDir);

    expect(result.status).toBe("invalid");
  });
});

// ─── ERROR ──────────────────────────────────────────────────────────────────

describe("loadTreeBlueprint — ERROR", () => {
  it("no lore.tree.yaml in cwd -> status 'missing'", () => {
    const result = loadTreeBlueprint(tmpDir);

    expect(result.status).toBe("missing");
  });

  it("malformed YAML -> status 'invalid' with a LoreError", () => {
    writeFileSync(join(tmpDir, "lore.tree.yaml"), "version: [unterminated");

    const result = loadTreeBlueprint(tmpDir);

    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") throw new Error("expected invalid");
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("YAML parses but violates the blueprint schema (wrong version) -> status 'invalid' with a LoreError", () => {
    writeFileSync(join(tmpDir, "lore.tree.yaml"), ["version: 2", "root:", "  type: prd", ""].join("\n"));

    const result = loadTreeBlueprint(tmpDir);

    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") throw new Error("expected invalid");
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });
});

// ─── STATE ──────────────────────────────────────────────────────────────────

describe("loadTreeBlueprint — STATE", () => {
  it("path always resolves to <cwd>/lore.tree.yaml regardless of outcome", () => {
    const expectedPath = join(tmpDir, "lore.tree.yaml");

    const missing = loadTreeBlueprint(tmpDir);
    expect(missing.path).toBe(expectedPath);

    writeFileSync(join(tmpDir, "lore.tree.yaml"), "not: valid: yaml: [");
    const invalid = loadTreeBlueprint(tmpDir);
    expect(invalid.path).toBe(expectedPath);

    writeFileSync(join(tmpDir, "lore.tree.yaml"), VALID_BLUEPRINT);
    const ok = loadTreeBlueprint(tmpDir);
    expect(ok.path).toBe(expectedPath);
  });
});

// ─── REGRESSION ─────────────────────────────────────────────────────────────

describe("loadTreeBlueprint — REGRESSION", () => {
  it("calling twice in a row against the same cwd returns deep-equal results (pure, no side effects)", () => {
    writeFileSync(join(tmpDir, "lore.tree.yaml"), VALID_BLUEPRINT);

    const first = loadTreeBlueprint(tmpDir);
    const second = loadTreeBlueprint(tmpDir);

    expect(second).toEqual(first);
  });
});
