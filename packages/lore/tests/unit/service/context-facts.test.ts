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
import { collectContextFacts, extractPurposeSentence } from "../../../src/service/context-facts.js";

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

  // ─── AC-CTX-9: module-index walk hygiene (gitignore-aware + dot-dir skip) ──
  // Pins the incident in knowledge-retro-context-refresh-module-index-walk-
  // pollutes: `lore context refresh` on the lore repo itself indexed
  // `dist-npm/**` and `.serena/cache/typescript` as "modules" because the walk
  // only ever consulted the static EXCLUDED_DIR_BASENAMES denylist. These
  // cases are RED against current src (which has no dot-dir or .gitignore
  // awareness at all) except where noted.

  it("STATE: every dot-directory is skipped by default, at any depth, even when not in the static denylist", async () => {
    const fs = new InMemoryFsPort({
      ".serena/cache/typescript/x.ts": "x",
      "packages/real/CLAUDE.md": "y",
    });
    const result = await collectContextFacts(fs, "", DEFAULT_BUDGETS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const paths = result.value.moduleIndex.map((e) => e.path);
    // RED under current src: ".serena" is not in EXCLUDED_DIR_BASENAMES, so
    // today's walk records ".serena" and ".serena/cache" as modules.
    expect(paths.some((p) => p === ".serena" || p.startsWith(".serena/"))).toBe(false);
    expect(paths).toContain("packages/real");
  });

  it("STATE: a root .gitignore entry excludes the matching directory tree while a sibling stays indexed", async () => {
    const fs = new InMemoryFsPort({
      ".gitignore": "dist-npm/\n",
      "dist-npm/bin/lore": "x",
      "dist-npm/assets/skills/foo.md": "x",
      "packages/real/CLAUDE.md": "y",
    });
    const result = await collectContextFacts(fs, "", DEFAULT_BUDGETS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const paths = result.value.moduleIndex.map((e) => e.path);
    // RED under current src: no .gitignore is ever consulted, so today's walk
    // records "dist-npm", "dist-npm/bin", "dist-npm/assets", etc. — the exact
    // incident payload (dist-npm/** as "modules").
    expect(paths.some((p) => p === "dist-npm" || p.startsWith("dist-npm/"))).toBe(false);
    expect(paths).toContain("packages/real");
  });

  it("STATE: a nested .gitignore only excludes its own subtree, leaving a same-named sibling elsewhere indexed", async () => {
    const fs = new InMemoryFsPort({
      "packages/a/.gitignore": "generated/\n",
      "packages/a/generated/file.ts": "x",
      "packages/a/src/index.ts": "x",
      "packages/b/generated/file.ts": "x",
    });
    const result = await collectContextFacts(fs, "", DEFAULT_BUDGETS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const paths = result.value.moduleIndex.map((e) => e.path);
    // RED under current src: no per-directory .gitignore is ever read, so
    // "packages/a/generated" is recorded today exactly like "packages/b/generated".
    expect(paths.some((p) => p === "packages/a/generated" || p.startsWith("packages/a/generated/"))).toBe(false);
    expect(paths).toContain("packages/a/src");
    expect(paths).toContain("packages/b/generated");
  });

  it("BOUNDARY: a directory-level exclusion cannot be re-included by a nested negation pattern (real gitignore semantics)", async () => {
    // gitignore(5): "It is not possible to re-include a file if a parent
    // directory of that file is excluded." The `ignore` npm package (a
    // mature, spec-compliant .gitignore matcher) confirms this: given
    // `build/` + `!build/keep/`, `ignore().ignores("build/keep/")` is still
    // `true` — the negation on `build/keep/` never takes effect because
    // `build/` already excludes the whole subtree. A naive negation resolver
    // that re-includes `build/keep` here would be a spec-incompliant
    // implementation, not the intended fix.
    const fs = new InMemoryFsPort({
      ".gitignore": "build/\n!build/keep/\n",
      "build/tmp/file.ts": "x",
      "build/keep/file.ts": "x",
    });
    const result = await collectContextFacts(fs, "", DEFAULT_BUDGETS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const paths = result.value.moduleIndex.map((e) => e.path);
    // RED under current src: no .gitignore is consulted, so "build",
    // "build/tmp", and "build/keep" are all recorded today.
    expect(paths.some((p) => p === "build" || p.startsWith("build/"))).toBe(false);
  });

  it("REGRESSION: with no .gitignore anywhere, the static denylist fallback stays exact-match (no over-broad look-alike exclusion)", async () => {
    // Already green under current src (no .gitignore in play at all) AND
    // must stay green post-fix — pins that adding .gitignore-awareness never
    // widens the static EXCLUDED_DIR_BASENAMES fallback into prefix/substring
    // matching. "dist-npm" resembles the denylisted "dist" but is a distinct
    // basename and must remain indexed when there is no .gitignore to say
    // otherwise (the exact contiguous-substring-assumption trap named in
    // knowledge-retro-context-refresh-module-index-walk-pollutes).
    const fs = new InMemoryFsPort({
      "dist-npm/bin/lore": "x",
      "packages/real/CLAUDE.md": "y",
    });
    const result = await collectContextFacts(fs, "", DEFAULT_BUDGETS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const paths = result.value.moduleIndex.map((e) => e.path);
    expect(paths).toContain("dist-npm");
    expect(paths).toContain("packages/real");
  });
});

describe("module index = memory-file folders (spec-module-index-lists-only-folders-with-a-memory-file-managed)", () => {
  it("HAPPY: memoryModules carries link target + first Purpose sentence; the rest are counted, not listed", async () => {
    const fs = new InMemoryFsPort({
      "a/CLAUDE.md": "# A\n\n## Purpose\n\nA does x. Then y.\n",
      "b/src/index.ts": "export {};",
    });
    const result = await collectContextFacts(fs, "", DEFAULT_BUDGETS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.memoryModules).toEqual([{ path: "a", memoryFilePath: "a/CLAUDE.md", purpose: "A does x." }]);
    expect(result.value.modulesWithoutMemoryFile).toBe(2); // b, b/src
    expect(result.value.walkTruncated).toBe(false);
  });

  it("BOUNDARY: a memory file without a Purpose section is kept with purpose null", async () => {
    const fs = new InMemoryFsPort({ "a/CLAUDE.md": "# A\n\n## Notes\n\nx\n" });
    const result = await collectContextFacts(fs, "", DEFAULT_BUDGETS);
    expect(result.ok && result.value.memoryModules).toEqual([{ path: "a", memoryFilePath: "a/CLAUDE.md", purpose: null }]);
  });
});

describe("extractPurposeSentence", () => {
  it("HAPPY: first sentence of the first paragraph, multi-line paragraph joined", () => {
    expect(extractPurposeSentence("# T\n\n## Purpose\n\nOne two\nthree. Four.\n")).toBe("One two three.");
  });
  it("BOUNDARY: no sentence end keeps the paragraph; stops at the next heading", () => {
    expect(extractPurposeSentence("## Purpose\nNo end here\n## Other\nz.\n")).toBe("No end here");
  });
  it("NEGATIVE: absent or empty Purpose section is null", () => {
    expect(extractPurposeSentence("# T\n\n## Other\n\nx.\n")).toBeNull();
    expect(extractPurposeSentence("## Purpose\n\n## Next\n")).toBeNull();
  });
  it("BOUNDARY: an over-long sentence is cut with an ellipsis", () => {
    const out = extractPurposeSentence(`## Purpose\n\n${"w".repeat(300)}.\n`);
    expect(out?.length).toBe(160);
    expect(out?.endsWith("…")).toBe(true);
  });
});
