// @reads .gitattributes
// @reads .gitignore
// @reads .lore-bootstrap/**
// @reads .lore/**
// @reads .serena/**
// @reads CHANGELOG.md
// @reads CLAUDE.md
// @reads README.md
// @reads assets/**
// @reads bun.lock
// @reads bunfig.toml
// @reads dist-npm/**
// @reads docs/**
// @reads hooks/**
// @reads lore.tree.yaml
// @reads lore.tree.yaml.example
// @reads npm-pkg/**
// @reads package.json
// @reads packages/**
// @reads scripts/**
// @reads tsconfig.base.json
// @reads tsconfig.json
// @reads vitest.config.ts
// @reads vitest.node-files.ts
// @reads vitest.node.config.ts
// @reads vitest.shared.ts
// @reads workspace-aliases.ts
/**
 * @spec_ref spec-lore-owned-agent-context-is-generated-from-templates-and AC-CV-6 (D8, D9)
 *
 * RED: the literal-duplication lint. Every LORE_CONTEXT_VARIABLES entry with
 * `literalPatterns` must have zero matches across the declared scan set.
 *   HAPPY:      capture_tail_chars patterns match each fixed spelling; repo scan set has zero hits.
 *   BOUNDARY:   scanned file count > 0; every named src file exists (a rename fails loud, never shrinks the set).
 *   NEGATIVE:   agent-name variables (implementer_agent, reader_agent) never scan any .mjs file.
 *   REGRESSION: a literal planted into a temp copy is reported as file:line + variable (self-falsifying).
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { LORE_CONTEXT_VARIABLES } from "../../../src/service/context-variables-registry.js";

const REPO_ROOT = join(new URL("../../../", import.meta.url).pathname.replace(/\/$/, ""), "..", "..");

/** Variables that must never scan any .mjs file (hook tests import those sources unexpanded). */
const NO_MJS_VARIABLES = new Set(["implementer_agent", "reader_agent"]);

const NAMED_SRC_FILES = [
  "packages/core/src/session.ts",
  "packages/core/src/task-workflow.ts",
  "packages/core/src/truncate.ts",
  "packages/lore/src/adapters/cli/evidence-precheck.ts",
  "packages/lore/src/adapters/cli/commands/evidence.ts",
  "packages/lore/src/service/verify-executor.ts",
  "packages/lore/src/service/verify-runner-service.ts",
  "packages/lore/src/service/verify-spawn.ts",
  "packages/lore/src/service/merged-stream-command.ts",
];

const FIXED_SPELLINGS = ["4000-char", "4000 char", "4000 chars", "max(4000)", "tailChars(x, 4000)", "= 4000;"];

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".claude", ".next", "coverage"]);

interface RegistryEntry {
  readonly name: string;
  readonly literalPatterns: readonly RegExp[];
}

/** Reads the registry whether it is a record keyed by name or an array of entries carrying `name`. */
function patternedEntries(): RegistryEntry[] {
  const registry = LORE_CONTEXT_VARIABLES as unknown;
  const pairs: [string, { literalPatterns?: readonly RegExp[] }][] = Array.isArray(registry)
    ? (registry as { name: string; literalPatterns?: readonly RegExp[] }[]).map((e) => [e.name, e])
    : Object.entries(registry as Record<string, { literalPatterns?: readonly RegExp[] }>);
  return pairs
    .filter(([, e]) => e.literalPatterns !== undefined && e.literalPatterns.length > 0)
    .map(([name, e]) => ({ name, literalPatterns: e.literalPatterns as readonly RegExp[] }));
}

function walk(dir: string, accept: (rel: string) => boolean, root: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, accept, root, out);
    else if (accept(relative(root, p).split(sep).join("/"))) out.push(p);
  }
}

/** The declared AC-CV-6 scan set, per variable. `.mjs` files are excluded for NO_MJS_VARIABLES. */
function scanSet(root: string, variable: string): string[] {
  const files: string[] = [];
  walk(join(root, "assets"), (rel) => rel.endsWith(".md") || (rel.endsWith(".mjs") && !NO_MJS_VARIABLES.has(variable)), root, files);
  walk(join(root, ".lore", "context"), (rel) => rel.endsWith(".md"), root, files);
  walk(root, (rel) => rel === "CLAUDE.md" || rel.endsWith("/CLAUDE.md"), root, files);
  for (const rel of NAMED_SRC_FILES) {
    const p = join(root, rel);
    if (existsSync(p)) files.push(p);
  }
  return [...new Set(files)];
}

interface Hit {
  readonly file: string;
  readonly line: number;
  readonly variable: string;
}

function lineMatches(pattern: RegExp, line: string): boolean {
  return new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, "")).test(line);
}

/** Scans `root`; returns every hit (file:line + variable) and the number of distinct files scanned. */
function scan(root: string): { hits: Hit[]; scanned: number } {
  const hits: Hit[] = [];
  const scannedFiles = new Set<string>();
  for (const entry of patternedEntries()) {
    for (const file of scanSet(root, entry.name)) {
      scannedFiles.add(file);
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((text, i) => {
        if (entry.literalPatterns.some((p) => lineMatches(p, text))) {
          hits.push({ file: relative(root, file), line: i + 1, variable: entry.name });
        }
      });
    }
  }
  return { hits, scanned: scannedFiles.size };
}

const format = (hits: Hit[]) => hits.map((h) => `${h.file}:${h.line} ${h.variable}`);

const scratch: string[] = [];
afterEach(() => {
  while (scratch.length > 0) {
    const d = scratch.pop();
    if (d !== undefined) rmSync(d, { recursive: true, force: true });
  }
});

describe("AC-CV-6 registered-literal lint", () => {
  it("the registry has at least one entry with literalPatterns, including capture_tail_chars", () => {
    const names = patternedEntries().map((e) => e.name);
    expect(names).toContain("capture_tail_chars");
  });

  it.each(FIXED_SPELLINGS)("capture_tail_chars patterns match the fixed spelling %j", (spelling) => {
    const entry = patternedEntries().find((e) => e.name === "capture_tail_chars");
    expect(entry, "capture_tail_chars must declare literalPatterns").toBeDefined();
    expect(entry?.literalPatterns.some((p) => lineMatches(p, spelling))).toBe(true);
  });

  it("every named packages/*/src file in the scan set exists (rename fails loud)", () => {
    const missing = NAMED_SRC_FILES.filter((rel) => !existsSync(join(REPO_ROOT, rel)));
    expect(missing).toEqual([]);
  });

  it("zero literal hits across the declared scan set; scanned file count > 0", () => {
    const { hits, scanned } = scan(REPO_ROOT);
    expect(scanned).toBeGreaterThan(0);
    expect(format(hits)).toEqual([]);
  });

  it("agent-name variables never scan any .mjs file", () => {
    const mjsInSet = [...NO_MJS_VARIABLES].flatMap((v) => scanSet(REPO_ROOT, v).filter((f) => f.endsWith(".mjs")));
    expect(mjsInSet).toEqual([]);
  });

  it("a literal planted into a temp copy is reported as file:line + variable (self-falsifying)", () => {
    const root = mkdtempSync(join(tmpdir(), "lore-literal-lint-"));
    scratch.push(root);
    mkdirSync(join(root, "assets", "skills", "x"), { recursive: true });
    writeFileSync(join(root, "assets", "skills", "x", "SKILL.md"), "line one\nCaptured output keeps the last 4000-char tail.\n");
    writeFileSync(join(root, "assets", "skills", "x", "hook.mjs"), "const a = 1;\nconst TAIL = 4000;\n");
    writeFileSync(join(root, "CLAUDE.md"), "clean\n");
    const { hits, scanned } = scan(root);
    expect(scanned).toBeGreaterThan(0);
    expect(format(hits)).toContain("assets/skills/x/SKILL.md:2 capture_tail_chars");
    expect(format(hits)).toContain("assets/skills/x/hook.mjs:2 capture_tail_chars");
    expect(format(hits).some((h) => h.startsWith("CLAUDE.md"))).toBe(false);
  });

  it("a clean temp copy reports zero hits (reverse control)", () => {
    const root = mkdtempSync(join(tmpdir(), "lore-literal-lint-clean-"));
    scratch.push(root);
    mkdirSync(join(root, "assets"), { recursive: true });
    writeFileSync(join(root, "assets", "a.md"), "tail is {{lore:capture_tail_chars}} chars\n");
    expect(scan(root).hits).toEqual([]);
  });
});
