// @spawns packages/lore/src/index.ts
/**
 * @spec_ref AC-STR-4 (spec-claude-md-root-section-structure-check-and-adoption-mode)
 *
 * `lore setup --project` and the root memory file. The adoption mode AC-STR-4 once judged and wrote is retired
 * (task-memory-file-limits-are-always-enforced-the-warn-adoption): setup writes NO memory-file setting, and instead
 * REPORTS whether the POST-SPLICE root file conforms (`Memory file: conforms|findings`), printing the checklist of what
 * a person must fix. Limits are always enforced, so `status --check-claude-md` fails until they do.
 *
 *   - NEW root file  -> skeleton (What This Is / Commands / Architecture) + managed block (Module Index / Finding
 *     Live Project State): all five H2 in order, no `adoption` key written, check exits 0.
 *   - EXISTING root file -> managed block appended; judged on the POST-SPLICE content (never the pre-splice file):
 *     zero deterministic findings of ALL kinds -> `conforms`, else `findings` + a printed checklist naming each.
 *   - Re-running setup over an install made with the OLD template keeps `## Module Index` (exactly one copy).
 *
 * Harness: spawns the REAL CLI from source (`bun run src/index.ts ...`). Every scenario lives in its own `mkdtemp` git
 * repo with HOME pointed at it, never touching the repo's own `.lore/` corpus nor the real `~/.claude`.
 *
 * Coverage: HAPPY (fresh, conforming no-overlap), NEGATIVE (non-conforming, duplicate), BOUNDARY (post-splice vs
 * pre-splice judgement; over-ceiling), STATE (re-run idempotent, no key written), REGRESSION (old-template re-run).
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { initRepoWithMainCommit } from "./support/main-guard-repo.js";

// ─── Harness ────────────────────────────────────────────────────────────────

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const BUN_BIN = (() => {
  const resolved = Bun.which("bun");
  if (resolved === null) throw new Error("setup-claude-md-adoption.bun.test.ts: bun not found on PATH");
  return resolved;
})();

const REQUIRED = [
  "What This Is",
  "Commands",
  "Architecture",
  "Module Index",
  "Finding Live Project State",
] as const;

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  /** stdout + stderr, for "was this printed anywhere" assertions. */
  readonly all: string;
}

function runLore(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync([BUN_BIN, "run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, CLAUDECODE: "1" },
  });
  const stdout = proc.stdout.toString();
  const stderr = proc.stderr.toString();
  return { stdout, stderr, exitCode: proc.exitCode ?? 1, all: `${stdout}\n${stderr}` };
}

const scratch: string[] = [];

/** A throwaway git repo; optionally seeded with a root CLAUDE.md. */
function makeRepo(claudeMd?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "lore-setup-adoption-"));
  scratch.push(dir);
  initRepoWithMainCommit(dir); // setup refuses a main with no commit (BR-1343)
  if (claudeMd !== undefined) writeFileSync(join(dir, "CLAUDE.md"), claudeMd);
  return dir;
}

afterEach(() => {
  while (scratch.length > 0) {
    const dir = scratch.pop();
    if (dir === undefined) continue;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

function setupProject(cwd: string): RunResult {
  return runLore(["setup", "--project", "--yes"], cwd);
}

function readClaudeMd(cwd: string): string {
  return readFileSync(join(cwd, "CLAUDE.md"), "utf-8");
}

/** H2 headings outside fenced code, in file order (independent re-implementation of the spec rule). */
function h2Sequence(content: string): string[] {
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of content.split("\n")) {
    const f = /^(```|~~~)/.exec(line);
    if (f !== null) {
      fence = fence === null ? f[1] ?? null : fence === f[1] ? null : fence;
      continue;
    }
    if (fence !== null) continue;
    const m = /^## (.*)$/.exec(line);
    if (m !== null) out.push((m[1] ?? "").trim());
  }
  return out;
}

function readMemoryFilesConfig(cwd: string): Record<string, unknown> {
  const cfg = parse(readFileSync(join(cwd, ".lore", "config.yaml"), "utf-8")) as {
    context?: { memory_files?: Record<string, unknown> };
  } | null;
  return cfg?.context?.memory_files ?? {};
}

interface CheckResult {
  readonly exitCode: number;
  readonly report: Record<string, unknown>;
  readonly findings: Array<{ kind: string }>;
}

/** `lore status --check-claude-md --json`, exit measured un-piped (spawnSync). */
function checkClaudeMd(cwd: string): CheckResult {
  const run = runLore(["status", "--check-claude-md", "--json"], cwd);
  const parsed = JSON.parse(run.stdout) as { data: { claude_md: { findings: CheckResult["findings"] } } };
  return { exitCode: run.exitCode, report: parsed.data.claude_md, findings: parsed.data.claude_md.findings };
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

/** Three skeleton sections only: conforming once the managed block (sections 4-5) is appended. */
const THREE_SECTION_FILE = [
  "# My Project",
  "",
  "## What This Is",
  "",
  "A billing service.",
  "",
  "## Commands",
  "",
  "- `make test`",
  "",
  "## Architecture",
  "",
  "Hexagonal.",
  "",
].join("\n");

/** Already has ALL five required sections, no managed block: splicing the block duplicates two of them. */
const FIVE_SECTION_FILE = [
  "# My Project",
  "",
  ...REQUIRED.flatMap((s) => [`## ${s}`, "", `${s} body.`, ""]),
].join("\n");

const NON_CONFORMING_FILE = "# My Project\n\n## Notes\n\nSome notes.\n";

/** The managed block exactly as the pre-reshape (OLD) template installs it (Module Index inside). */
const OLD_TEMPLATE_INSTALL = `# Legacy Project

## Overview

Pre-existing prose.

# ─── lore governance (managed) ───
<!-- lore:managed section=governance hash=bb4d6012 -->
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Lore-governed workflow

This repository's shared knowledge, plans, and tasks live in the local Lore corpus (\`.lore/\`), not in this file. Query it via the \`lore\` CLI rather than reading files by path:

- \`lore search <query>\` — full-text search the corpus
- \`lore get <id-or-slug>\` — read a document
- \`lore tree\` — view the document hierarchy
- \`lore bootstrap\` — session pointer set (root PRD, active plans, pending reviews, your claims)
- \`lore status\` — corpus health snapshot

This file's content contract (what belongs here vs. the corpus, and the line/byte ceiling) is printed by \`lore governance claude-md\` — read it before editing this file by hand.

Instructions that should not load every session belong in \`.claude/rules/*.md\` (path-scoped via \`paths:\` frontmatter), not in this file — see the content contract above for the full rule.

If the \`lore-*\` skills, agents, or governance hooks are not installed on this machine (e.g. a fresh clone on a new machine), run \`lore setup\` first — it installs the machine-level assets that inject the full corpus-governed workflow (FEED/PRODUCE/EXECUTE/CLOSE) into every session. If the \`lore\` binary itself is missing, obtain it through your team's install channel before anything else. This stub is only a pointer; the workflow discipline arrives through that injection.

Run \`/lore-init-context\` to populate the module index below once this codebase has real structure worth documenting.

## Module Index

<!-- Populated by /lore-init-context. -->

# ─── end lore governance ───
`;

// ─── Scenarios ──────────────────────────────────────────────────────────────

describe("lore setup --project — fresh install (no CLAUDE.md)", () => {
  it("setup itself succeeds (fixture sanity — a failing setup would be a wrong-reason red)", () => {
    const repo = makeRepo();
    expect(setupProject(repo).exitCode).toBe(0);
  });

  it("writes a root CLAUDE.md whose H2 sequence contains the five required sections in order", () => {
    const repo = makeRepo();
    setupProject(repo);
    const seq = h2Sequence(readClaudeMd(repo)).filter((h) => (REQUIRED as readonly string[]).includes(h));
    expect(seq).toEqual([...REQUIRED]);
  });

  it("writes NO adoption key and reports `Memory file: conforms`", () => {
    const repo = makeRepo();
    const run = setupProject(repo);
    expect(readMemoryFilesConfig(repo)["adoption"]).toBeUndefined();
    expect(run.all).toContain("Memory file: conforms");
  });

  it("then `status --check-claude-md --json` exits 0 with zero findings and no adoption block", () => {
    const repo = makeRepo();
    setupProject(repo);
    const check = checkClaudeMd(repo);
    expect({ exit: check.exitCode, findings: check.findings.length, adoption: check.report["adoption"] }).toEqual({
      exit: 0,
      findings: 0,
      adoption: undefined,
    });
  });
});

describe("lore setup --project — existing NON-conforming root file", () => {
  it("reports findings and writes no adoption key for a file with only '## Notes'", () => {
    const repo = makeRepo(NON_CONFORMING_FILE);
    const run = setupProject(repo);
    expect(readMemoryFilesConfig(repo)["adoption"]).toBeUndefined();
    expect(run.all).toContain("Memory file: findings");
  });

  it("prints a checklist naming every section the user's file is missing", () => {
    const repo = makeRepo(NON_CONFORMING_FILE);
    const run = setupProject(repo);
    const missing = ["What This Is", "Commands", "Architecture"].filter((s) => !run.all.includes(s));
    expect(missing).toEqual([]);
  });

  it("does NOT list sections the managed block supplies (Module Index / Finding Live Project State) as missing", () => {
    const repo = makeRepo(NON_CONFORMING_FILE);
    const run = setupProject(repo);
    const lines = run.all.split("\n").filter((l) => /missing/i.test(l));
    const leaked = lines.filter((l) => /Module Index|Finding Live Project State/.test(l));
    expect(leaked).toEqual([]);
  });

  it("keeps the user's own prose intact (no silent rewrite of '## Notes')", () => {
    const repo = makeRepo(NON_CONFORMING_FILE);
    setupProject(repo);
    expect(readClaudeMd(repo)).toContain("## Notes\n\nSome notes.");
  });

  it("then the check exits EXACTLY 3 with section_missing as an enforced finding (the retired warn exited 0)", () => {
    const repo = makeRepo(NON_CONFORMING_FILE);
    setupProject(repo);
    const check = checkClaudeMd(repo);
    expect(check.exitCode).toBe(3);
    expect(check.findings.map((f) => f.kind)).toContain("section_missing");
  });
});

describe("lore setup --project — judged on POST-SPLICE content", () => {
  it("existing file with all five sections (no block) -> findings, because the spliced block would duplicate two", () => {
    const repo = makeRepo(FIVE_SECTION_FILE);
    const run = setupProject(repo);
    expect(run.all).toContain("Memory file: findings");
    expect(checkClaudeMd(repo).findings.map((f) => f.kind)).toContain("section_duplicate");
  });

  it("...and the check exits 3 on the duplicate", () => {
    const repo = makeRepo(FIVE_SECTION_FILE);
    setupProject(repo);
    expect(checkClaudeMd(repo).exitCode).toBe(3);
  });

  it("existing 3-section file with no overlap -> conforms (pre-splice it lacks two sections, post-splice it is clean)", () => {
    const repo = makeRepo(THREE_SECTION_FILE);
    const run = setupProject(repo);
    expect(run.all).toContain("Memory file: conforms");
    const check = checkClaudeMd(repo);
    expect({ exit: check.exitCode, findings: check.findings.length }).toEqual({ exit: 0, findings: 0 });
  });

  it("existing 3-section file keeps its own sections ahead of the block (order holds: block is appended last)", () => {
    const repo = makeRepo(THREE_SECTION_FILE);
    setupProject(repo);
    const seq = h2Sequence(readClaudeMd(repo)).filter((h) => (REQUIRED as readonly string[]).includes(h));
    expect(seq).toEqual([...REQUIRED]);
  });

  it("contrast pair: same setup path, different content, different verdict (defeats a hardcoded verdict)", () => {
    const a = makeRepo(THREE_SECTION_FILE);
    const b = makeRepo(NON_CONFORMING_FILE);
    expect([setupProject(a).all.includes("Memory file: conforms"), setupProject(b).all.includes("Memory file: findings")]).toEqual([true, true]);
  });
});

describe("lore setup --project — over-ceiling root file counts as a finding (ALL kinds)", () => {
  it("a structurally-complete 3-section file over the 300-line ceiling -> findings naming the ceiling", () => {
    const filler = Array.from({ length: 330 }, (_, i) => `- item ${i}`).join("\n");
    const repo = makeRepo(`${THREE_SECTION_FILE}\n${filler}\n`);
    const run = setupProject(repo);
    expect(run.all).toContain("Memory file: findings");
    expect(run.all).toContain("ceiling");
  });
});

describe("lore setup --project — re-run semantics", () => {
  it("re-running setup over an OLD-template install keeps '## Module Index' (exactly once)", () => {
    const repo = makeRepo(OLD_TEMPLATE_INSTALL);
    setupProject(repo);
    const count = h2Sequence(readClaudeMd(repo)).filter((h) => h === "Module Index").length;
    expect(count).toBe(1);
  });

  it("re-running setup over an OLD-template install also gains '## Finding Live Project State' after Module Index", () => {
    const repo = makeRepo(OLD_TEMPLATE_INSTALL);
    setupProject(repo);
    const seq = h2Sequence(readClaudeMd(repo));
    const mi = seq.indexOf("Module Index");
    const fl = seq.indexOf("Finding Live Project State");
    expect({ hasMi: mi >= 0, flAfterMi: fl > mi }).toEqual({ hasMi: true, flAfterMi: true });
  });

  it("re-running setup twice is idempotent: CLAUDE.md bytes and the config do not change on run 2", () => {
    const repo = makeRepo(THREE_SECTION_FILE);
    setupProject(repo);
    const afterFirst = { md: readClaudeMd(repo), cfg: readFileSync(join(repo, ".lore", "config.yaml"), "utf-8") };
    setupProject(repo);
    const afterSecond = { md: readClaudeMd(repo), cfg: readFileSync(join(repo, ".lore", "config.yaml"), "utf-8") };
    expect(afterSecond).toEqual(afterFirst);
  });
});
