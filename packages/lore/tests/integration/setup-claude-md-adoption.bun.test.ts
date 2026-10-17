/**
 * @spec_ref AC-STR-4 (spec-claude-md-root-section-structure-check-and-adoption-mode)
 *
 * RED-phase e2e for `lore setup --project` adoption handling — task
 * `task-skill-test-setup-adoption-both-ends-fresh-install-red` (paired
 * implementation: I4 "setup skeleton + managed-block reshape + adoption write").
 * Decision record: adr-claude-md-root-h2-structure-is-deterministic-with-one.
 *
 * Spec contract exercised (D4, D7, AC-STR-4):
 *   - NEW root file  -> skeleton (What This Is / Commands / Architecture) + managed
 *     block (Module Index / Finding Live Project State): all five H2, in order,
 *     `context.memory_files.adoption: enforce` written, check exits 0 with JSON
 *     `adoption.mode === "enforce"`.
 *   - EXISTING root file -> managed block appended; the adoption mode is judged on
 *     the POST-SPLICE content (never the pre-splice file): zero would-be
 *     deterministic findings of ALL kinds -> enforce, else warn + a printed
 *     migration checklist naming the missing sections.
 *   - The key is written ONLY when absent: an explicit value is never overwritten.
 *   - Re-running setup over an install made with the OLD template keeps
 *     `## Module Index` (exactly one copy).
 *
 * Harness: spawns the REAL CLI from source (`bun run src/index.ts ...`, source-fresh
 * by construction, no dist/ needed). Every scenario lives in its own `mkdtemp` git
 * repo with HOME pointed at it — never touches the repo's own `.lore/` corpus nor the
 * real `~/.claude`. `CLAUDECODE=1` => agent surface (no nested Claude call).
 *
 * Coverage: HAPPY (fresh, conforming no-overlap), NEGATIVE (non-conforming, duplicate),
 * BOUNDARY (post-splice vs pre-splice judgement), STATE (explicit value preserved,
 * re-run idempotent), REGRESSION (old-template re-run keeps Module Index).
 *
 * RED expectation on the current base: nothing writes `adoption`, no skeleton exists,
 * no checklist is printed, and `--check-claude-md --json` has no `adoption` block.
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";

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
  const init = Bun.spawnSync(["git", "init", "-q", dir]);
  if (init.exitCode !== 0) throw new Error(`fixture: git init failed: ${init.stderr.toString()}`);
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

/** Writes `context.memory_files.adoption` into an already-initialised corpus config (test seeding only). */
function seedAdoption(cwd: string, value: "enforce" | "warn"): void {
  const path = join(cwd, ".lore", "config.yaml");
  const cfg = (parse(readFileSync(path, "utf-8")) ?? {}) as Record<string, any>;
  cfg["context"] = cfg["context"] ?? {};
  cfg["context"]["memory_files"] = { ...(cfg["context"]["memory_files"] ?? {}), adoption: value };
  writeFileSync(path, stringify(cfg));
}

interface AdoptionBlock {
  mode: string;
  mode_source: string;
  downgraded_count: number;
  promotable: boolean;
}
interface CheckResult {
  readonly exitCode: number;
  readonly adoption: AdoptionBlock | undefined;
  readonly advisory: Array<{ kind: string; downgraded_kind?: string }>;
  readonly findings: Array<{ kind: string }>;
}

/** `lore status --check-claude-md --json`, exit measured un-piped (spawnSync). */
function checkClaudeMd(cwd: string): CheckResult {
  const run = runLore(["status", "--check-claude-md", "--json"], cwd);
  const parsed = JSON.parse(run.stdout) as {
    data: { claude_md: { adoption?: AdoptionBlock; advisory: CheckResult["advisory"]; findings: CheckResult["findings"] } };
  };
  const cm = parsed.data.claude_md;
  return { exitCode: run.exitCode, adoption: cm.adoption, advisory: cm.advisory, findings: cm.findings };
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

describe("lore setup --project adoption — fresh install (no CLAUDE.md)", () => {
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

  it("writes context.memory_files.adoption: enforce into .lore/config.yaml", () => {
    const repo = makeRepo();
    setupProject(repo);
    expect(readMemoryFilesConfig(repo)["adoption"]).toBe("enforce");
  });

  it("then `status --check-claude-md --json` exits 0 with adoption.mode enforce (config-sourced)", () => {
    const repo = makeRepo();
    setupProject(repo);
    const check = checkClaudeMd(repo);
    expect({ exit: check.exitCode, mode: check.adoption?.mode, source: check.adoption?.mode_source }).toEqual({
      exit: 0,
      mode: "enforce",
      source: "config",
    });
  });

  it("a fresh install has zero deterministic findings and zero downgraded findings", () => {
    const repo = makeRepo();
    setupProject(repo);
    const check = checkClaudeMd(repo);
    expect({ findings: check.findings.length, downgraded: check.adoption?.downgraded_count }).toEqual({
      findings: 0,
      downgraded: 0,
    });
  });
});

describe("lore setup --project adoption — existing NON-conforming root file", () => {
  it("writes adoption: warn (never enforce) for a file with only '## Notes'", () => {
    const repo = makeRepo(NON_CONFORMING_FILE);
    setupProject(repo);
    expect(readMemoryFilesConfig(repo)["adoption"]).toBe("warn");
  });

  it("prints a migration checklist naming every section the user's file is missing", () => {
    const repo = makeRepo(NON_CONFORMING_FILE);
    const run = setupProject(repo);
    const missing = ["What This Is", "Commands", "Architecture"].filter((s) => !run.all.includes(s));
    expect(missing).toEqual([]);
  });

  it("does NOT list sections the managed block supplies (Module Index / Finding Live Project State) as missing", () => {
    const repo = makeRepo(NON_CONFORMING_FILE);
    const run = setupProject(repo);
    // The checklist is the only place section names are enumerated as TODO; the
    // block-supplied ones must not appear next to a "missing" marker.
    const lines = run.all.split("\n").filter((l) => /missing/i.test(l));
    const leaked = lines.filter((l) => /Module Index|Finding Live Project State/.test(l));
    expect(leaked).toEqual([]);
  });

  it("keeps the user's own prose intact (no silent rewrite of '## Notes')", () => {
    const repo = makeRepo(NON_CONFORMING_FILE);
    setupProject(repo);
    expect(readClaudeMd(repo)).toContain("## Notes\n\nSome notes.");
  });

  it("then the check exits 0 with adoption.mode warn, mode_source config", () => {
    const repo = makeRepo(NON_CONFORMING_FILE);
    setupProject(repo);
    const check = checkClaudeMd(repo);
    expect({ exit: check.exitCode, mode: check.adoption?.mode, source: check.adoption?.mode_source }).toEqual({
      exit: 0,
      mode: "warn",
      source: "config",
    });
  });

  it("the check reports the missing sections as DOWNGRADED section_missing (not silent)", () => {
    const repo = makeRepo(NON_CONFORMING_FILE);
    setupProject(repo);
    const check = checkClaudeMd(repo);
    const kinds = check.advisory.filter((a) => a.kind === "downgraded").map((a) => a.downgraded_kind);
    expect(kinds).toContain("section_missing");
  });
});

describe("lore setup --project adoption — judged on POST-SPLICE content (D4)", () => {
  it("existing file with all five sections (no block) -> warn, because the spliced block would duplicate two", () => {
    const repo = makeRepo(FIVE_SECTION_FILE);
    setupProject(repo);
    expect(readMemoryFilesConfig(repo)["adoption"]).toBe("warn");
  });

  it("...and the check lists section_duplicate as a downgraded finding", () => {
    const repo = makeRepo(FIVE_SECTION_FILE);
    setupProject(repo);
    const check = checkClaudeMd(repo);
    const kinds = check.advisory.filter((a) => a.kind === "downgraded").map((a) => a.downgraded_kind);
    expect(kinds).toContain("section_duplicate");
  });

  it("...exits 0 under warn despite the duplicate", () => {
    const repo = makeRepo(FIVE_SECTION_FILE);
    setupProject(repo);
    expect(checkClaudeMd(repo).exitCode).toBe(0);
  });

  it("existing 3-section file with no overlap -> enforce (pre-splice it lacks two sections, post-splice it is clean)", () => {
    const repo = makeRepo(THREE_SECTION_FILE);
    setupProject(repo);
    expect(readMemoryFilesConfig(repo)["adoption"]).toBe("enforce");
  });

  it("...and the check on that install exits 0 with adoption.mode enforce and no findings", () => {
    const repo = makeRepo(THREE_SECTION_FILE);
    setupProject(repo);
    const check = checkClaudeMd(repo);
    expect({ exit: check.exitCode, mode: check.adoption?.mode, findings: check.findings.length }).toEqual({
      exit: 0,
      mode: "enforce",
      findings: 0,
    });
  });

  it("existing 3-section file keeps its own sections ahead of the block (order holds: block is appended last)", () => {
    const repo = makeRepo(THREE_SECTION_FILE);
    setupProject(repo);
    const seq = h2Sequence(readClaudeMd(repo)).filter((h) => (REQUIRED as readonly string[]).includes(h));
    expect(seq).toEqual([...REQUIRED]);
  });

  it("an over-ceiling-free but otherwise conforming file is NOT forced to warn (capacity counts, structure alone does not)", () => {
    // Contrast pair with the non-conforming case: same setup path, different content,
    // different mode — defeats an implementation that hardcodes one value.
    const a = makeRepo(THREE_SECTION_FILE);
    const b = makeRepo(NON_CONFORMING_FILE);
    setupProject(a);
    setupProject(b);
    expect([readMemoryFilesConfig(a)["adoption"], readMemoryFilesConfig(b)["adoption"]]).toEqual(["enforce", "warn"]);
  });
});

describe("lore setup --project adoption — over-ceiling root file counts as a would-be finding (ALL kinds)", () => {
  it("a structurally-complete 3-section file over the 300-line ceiling -> warn, not enforce", () => {
    const filler = Array.from({ length: 330 }, (_, i) => `- item ${i}`).join("\n");
    const repo = makeRepo(`${THREE_SECTION_FILE}\n${filler}\n`);
    setupProject(repo);
    expect(readMemoryFilesConfig(repo)["adoption"]).toBe("warn");
  });
});

describe("lore setup --project adoption — explicit value is never overwritten (write-only-when-absent)", () => {
  it("explicit `warn` + conforming-after-splice file -> stays warn", () => {
    const repo = makeRepo();
    setupProject(repo); // creates .lore/config.yaml (fresh -> enforce)
    seedAdoption(repo, "warn");
    writeFileSync(join(repo, "CLAUDE.md"), THREE_SECTION_FILE);
    setupProject(repo);
    expect(readMemoryFilesConfig(repo)["adoption"]).toBe("warn");
  });

  it("explicit `warn` is honoured by the check (mode_source config, mode warn)", () => {
    const repo = makeRepo();
    setupProject(repo);
    seedAdoption(repo, "warn");
    writeFileSync(join(repo, "CLAUDE.md"), THREE_SECTION_FILE);
    setupProject(repo);
    const a = checkClaudeMd(repo).adoption;
    expect({ mode: a?.mode, source: a?.mode_source }).toEqual({ mode: "warn", source: "config" });
  });

  it("explicit `enforce` + non-conforming file -> stays enforce (setup never silently weakens it)", () => {
    const repo = makeRepo();
    setupProject(repo);
    seedAdoption(repo, "enforce");
    writeFileSync(join(repo, "CLAUDE.md"), NON_CONFORMING_FILE);
    setupProject(repo);
    expect(readMemoryFilesConfig(repo)["adoption"]).toBe("enforce");
  });
});

describe("lore setup --project adoption — re-run semantics", () => {
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

  it("re-running setup twice is idempotent: CLAUDE.md bytes and the adoption value do not change on run 2", () => {
    const repo = makeRepo(THREE_SECTION_FILE);
    setupProject(repo);
    const afterFirst = { md: readClaudeMd(repo), mode: readMemoryFilesConfig(repo)["adoption"] };
    setupProject(repo);
    const afterSecond = { md: readClaudeMd(repo), mode: readMemoryFilesConfig(repo)["adoption"] };
    expect(afterSecond).toEqual(afterFirst);
  });

  it("an old-template install with no adoption key and a non-conforming outside prose -> warn after re-run (never enforce)", () => {
    const repo = makeRepo(OLD_TEMPLATE_INSTALL);
    setupProject(repo);
    // '## Overview' is user prose; What This Is / Commands / Architecture are absent.
    expect(readMemoryFilesConfig(repo)["adoption"]).toBe("warn");
  });
});
