/**
 * Unit suite for `collectContextFacts`
 * (`packages/lore/src/service/context-facts.ts`,
 * spec-context-verb-family-two-zone-claude-md-anatomy-lore). Exercises the
 * FsReadPort-injected walk against `InMemoryFsPort` (`@lore/core`) — pure,
 * no real `node:fs` touched (D9).
 *
 * @spec_ref spec-context-verb-family-two-zone-claude-md-anatomy-lore
 *   §Public Interface, §Module Boundary; task
 *   task-skill-implement-context-facts-collection-flow.
 */

import { describe, expect, it } from "vitest";
import { InMemoryFsPort, resolveMemoryFileBudgets } from "@lore/core";
import { collectContextFacts } from "../../../src/service/context-facts.js";

const DEFAULT_BUDGETS = resolveMemoryFileBudgets(undefined);

describe("collectContextFacts", () => {
  it("HAPPY: discovers nested module directories and their memory-file presence, plus package.json scripts", async () => {
    const fs = new InMemoryFsPort({
      "package.json": JSON.stringify({ scripts: { build: "bun run build", test: "bun test" } }),
      "packages/core/CLAUDE.md": "# core",
      "packages/core/src/index.ts": "export {};",
      "packages/lore/src/index.ts": "export {};",
    });

    const result = await collectContextFacts(fs, "", DEFAULT_BUDGETS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.commands).toEqual({ build: "bun run build", test: "bun test" });

    const byPath = new Map(result.value.moduleIndex.map((entry) => [entry.path, entry.hasMemoryFile]));
    expect(byPath.get("packages")).toBe(false);
    expect(byPath.get("packages/core")).toBe(true);
    expect(byPath.get("packages/core/src")).toBe(false);
    expect(byPath.get("packages/lore")).toBe(false);
  });

  it("NEGATIVE: a malformed (non-JSON) root package.json degrades commands to {} rather than failing collection", async () => {
    const fs = new InMemoryFsPort({ "package.json": "{ not valid json", "packages/a/CLAUDE.md": "x" });
    const result = await collectContextFacts(fs, "", DEFAULT_BUDGETS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.commands).toEqual({});
    expect(result.value.moduleIndex.some((e) => e.path === "packages/a")).toBe(true);
  });

  it("NEGATIVE: a schema-invalid package.json.scripts (non-string values) degrades commands to {}", async () => {
    const fs = new InMemoryFsPort({ "package.json": JSON.stringify({ scripts: { build: 123 } }) });
    const result = await collectContextFacts(fs, "", DEFAULT_BUDGETS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.commands).toEqual({});
  });

  it("BOUNDARY: an absent package.json degrades commands to {} and an empty tree yields an empty moduleIndex", async () => {
    const fs = new InMemoryFsPort({});
    const result = await collectContextFacts(fs, "", DEFAULT_BUDGETS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.commands).toEqual({});
    expect(result.value.moduleIndex).toEqual([]);
  });

  it("ERROR: a root with a leading '/' fails loud with VALIDATION_ERROR before any fs call", async () => {
    const fs = new InMemoryFsPort({ "package.json": "{}" });
    const result = await collectContextFacts(fs, "/abs", DEFAULT_BUDGETS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("ERROR: a root containing a '..' segment fails loud with VALIDATION_ERROR", async () => {
    const fs = new InMemoryFsPort({});
    const result = await collectContextFacts(fs, "packages/../etc", DEFAULT_BUDGETS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("STATE: excluded directory basenames (node_modules, .git) are never walked", async () => {
    const fs = new InMemoryFsPort({
      "node_modules/some-pkg/CLAUDE.md": "x",
      ".git/hooks/pre-commit": "x",
      "packages/real/CLAUDE.md": "x",
    });
    const result = await collectContextFacts(fs, "", DEFAULT_BUDGETS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const paths = result.value.moduleIndex.map((e) => e.path);
    expect(paths.some((p) => p.startsWith("node_modules"))).toBe(false);
    expect(paths.some((p) => p.startsWith(".git"))).toBe(false);
    expect(paths).toContain("packages/real");
  });

  it("REGRESSION: two consecutive calls over unchanged fs state return structurally equal facts", async () => {
    const fs = new InMemoryFsPort({
      "package.json": JSON.stringify({ scripts: { build: "x" } }),
      "packages/core/CLAUDE.md": "y",
    });
    const first = await collectContextFacts(fs, "", DEFAULT_BUDGETS);
    const second = await collectContextFacts(fs, "", DEFAULT_BUDGETS);
    expect(first).toEqual(second);
  });
});
