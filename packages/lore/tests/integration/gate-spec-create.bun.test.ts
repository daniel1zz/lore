/**
 * @spec_ref IoC vertical-slice tech-spec §4.1/§11 — `lore gate spec-create` (deterministic
 * zone + active feeding)
 *
 * bun test (not vitest): every scenario spawns the real `lore` CLI (`bun run src/index.ts`)
 * against a throwaway corpus (mkdtemp'd temp dir + `lore init`), mirroring
 * `tests/integration/cli-check-tree.bun.test.ts`'s harness. ⛔ Never touches the repo's own
 * `.lore/` corpus (project CLAUDE.md hard rule).
 *
 * Acceptance criteria under test (spec AC1 / AC2 / AC5):
 *   AC1 — no-parent candidate → exit 4, stdout carries `[source:` + a rule slice.
 *   AC2 — compliant candidate (legal prd parent + spec_kind=tech + `## `-headed content)
 *         → exit 0.
 *   AC5 — LORE_GATE_BYPASS=1 short-circuits ANY input (even non-compliant) to exit 0.
 *   Plus: bad spec_kind → exit 4 with INVALID_SPEC_KIND in the missing list.
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ─── Types ──────────────────────────────────────────────────────────────────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

// ─── Paths ──────────────────────────────────────────────────────────────────

const PROJECT_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PROJECT_ROOT, "src", "index.ts");
const SEED_SCRIPT = join(PROJECT_ROOT, "..", "..", "scripts", "seed-write-spec-rule.ts");

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Run `bun run src/index.ts ...args` in `cwd`. HOME is overridden to isolate global config. */
function runLore(args: string[], cwd: string, extraEnv: Record<string, string> = {}): RunResult {
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, ...extraEnv },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

/** Create a unique temp directory for an isolated test suite. */
function makeTempDir(label: string): string {
  const dir = join(tmpdir(), `lore-gate-spec-create-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Remove a temp directory, ignoring errors (best-effort cleanup). */
function cleanupDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

/** Bootstrap a fresh lore corpus. */
function initCorpus(tmpDir: string): void {
  const result = runLore(["init"], tmpDir);
  if (result.exitCode !== 0) {
    throw new Error(`lore init failed: ${result.stderr}`);
  }
}

/** Seed the approved "Write-spec rules" reference doc via the real seed script. */
function seedRuleDoc(tmpDir: string): void {
  const proc = Bun.spawnSync(["bun", "run", SEED_SCRIPT], {
    cwd: tmpDir,
    env: { ...process.env, HOME: tmpDir },
  });
  if (proc.exitCode !== 0) {
    throw new Error(`seed-write-spec-rule failed: ${proc.stderr.toString()}`);
  }
}

/** Seed a PRD document, return its slug (parsed from `create`'s stdout). */
function createPrd(tmpDir: string, title: string): string {
  // reason: --no-ai bypasses AI generation (SPEC-017 default) so setup is not blocked
  // by absence of the claude binary in CI.
  const result = runLore(["create", "prd", "--title", title, "--no-ai"], tmpDir);
  const match = result.stdout.match(/Slug:\s+(\S+)/);
  const slug = match?.[1];
  if (slug === undefined) {
    throw new Error(`could not parse PRD slug from create output: ${result.stdout}`);
  }
  return slug;
}

const COMPLIANT_CONTENT = "## Overview\n\nSome text.\n\n## Scope\n\nIn scope.\n\n## Acceptance Criteria\n\n- AC1\n";

function compliantPayload(parentSlug: string): Record<string, unknown> {
  return {
    type: "spec",
    title: "A well-formed spec",
    parent_id: parentSlug,
    content: COMPLIANT_CONTENT,
    extra: { spec_kind: "tech" },
  };
}

function runGate(tmpDir: string, payload: Record<string, unknown>, extraEnv: Record<string, string> = {}): RunResult {
  return runLore(["gate", "spec-create", "--input-json", JSON.stringify(payload)], tmpDir, extraEnv);
}

// ─── Suite: fully seeded corpus (rule doc + valid PRD parent) ──────────────

describe("lore gate spec-create", () => {
  let tmpDir: string;
  let prdSlug: string;

  beforeEach(() => {
    tmpDir = makeTempDir("main");
    initCorpus(tmpDir);
    seedRuleDoc(tmpDir);
    prdSlug = createPrd(tmpDir, "main-prd");
  });

  afterEach(() => cleanupDir(tmpDir));

  // HAPPY — AC2: compliant candidate passes all three predicates.
  it("AC2: exits 0 for a compliant candidate (legal prd parent, spec_kind=tech, skeleton content)", () => {
    const result = runGate(tmpDir, compliantPayload(prdSlug));
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("gate: pass");
  });

  // NEGATIVE — AC1: omitting parent_id entirely fails parentLegal → PARENT_REQUIRED.
  it("AC1: exits 4 and feeds back [source:...] + a rule slice when parent_id is omitted", () => {
    const payload = compliantPayload(prdSlug);
    delete payload["parent_id"];
    const result = runGate(tmpDir, payload);
    expect(result.exitCode).toBe(4);
    expect(result.stdout).toContain("[source:");
    expect(result.stdout).toContain("trust: team-authored");
    expect(result.stdout).toContain("PARENT_REQUIRED");
    expect(result.stdout).toContain("## Rule");
  });

  // NEGATIVE — bad spec_kind fails specKindValid → INVALID_SPEC_KIND.
  it("exits 4 with INVALID_SPEC_KIND in the missing list for spec_kind='x'", () => {
    const payload = compliantPayload(prdSlug);
    payload["extra"] = { spec_kind: "x" };
    const result = runGate(tmpDir, payload);
    expect(result.exitCode).toBe(4);
    expect(result.stdout).toContain("INVALID_SPEC_KIND");
  });

  // BOUNDARY — parent_id set but does not resolve to any doc → treated as no parent.
  it("BOUNDARY: exits 4 with PARENT_REQUIRED when parent_id does not resolve to any doc", () => {
    const payload = compliantPayload(prdSlug);
    payload["parent_id"] = "does-not-exist-slug";
    const result = runGate(tmpDir, payload);
    expect(result.exitCode).toBe(4);
    expect(result.stdout).toContain("PARENT_REQUIRED");
  });

  // BOUNDARY — content present but carries no `## ` heading → MISSING_SKELETON.
  it("BOUNDARY: exits 4 with MISSING_SKELETON when content has no level-2 heading", () => {
    const payload = compliantPayload(prdSlug);
    payload["content"] = "just some prose, no headings at all";
    const result = runGate(tmpDir, payload);
    expect(result.exitCode).toBe(4);
    expect(result.stdout).toContain("MISSING_SKELETON");
  });

  // BOUNDARY — every predicate fails simultaneously → all three reasons present.
  it("BOUNDARY: reports all three violations together when every predicate fails", () => {
    const result = runGate(tmpDir, {
      type: "spec",
      title: "Broken spec",
      content: "no headings",
      extra: { spec_kind: "bogus" },
    });
    expect(result.exitCode).toBe(4);
    expect(result.stdout).toContain("PARENT_REQUIRED");
    expect(result.stdout).toContain("INVALID_SPEC_KIND");
    expect(result.stdout).toContain("MISSING_SKELETON");
  });

  // ERROR — malformed JSON syntax.
  it("ERROR: exits 2 when --input-json is not valid JSON", () => {
    const result = runLore(["gate", "spec-create", "--input-json", "{not valid json"], tmpDir);
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toLowerCase()).toContain("json");
  });

  // ERROR — valid JSON but missing required fields (type/title).
  it("ERROR: exits 2 when --input-json is valid JSON but missing required fields", () => {
    const result = runLore(["gate", "spec-create", "--input-json", "{}"], tmpDir);
    expect(result.exitCode).toBe(2);
  });

  // STATE — AC5: bypass short-circuits even a maximally non-compliant candidate.
  it("AC5: LORE_GATE_BYPASS=1 exits 0 for a non-compliant candidate", () => {
    const result = runGate(
      tmpDir,
      { type: "spec", title: "Broken spec", content: "no headings", extra: { spec_kind: "bogus" } },
      { LORE_GATE_BYPASS: "1" },
    );
    expect(result.exitCode).toBe(0);
  });

  // STATE — bypass takes priority even over malformed JSON (no parsing occurs at all).
  it("STATE: LORE_GATE_BYPASS=1 exits 0 even when --input-json is malformed", () => {
    const result = runLore(
      ["gate", "spec-create", "--input-json", "{not valid json"],
      tmpDir,
      { LORE_GATE_BYPASS: "1" },
    );
    expect(result.exitCode).toBe(0);
  });

  // REGRESSION — the gate is read-only: it must never create/mutate corpus documents.
  it("REGRESSION: does not create any corpus documents, pass or fail", () => {
    const before = runLore(["status", "--json"], tmpDir);
    const beforeTotal = (JSON.parse(before.stdout) as { data: { total_docs: number } }).data.total_docs;

    runGate(tmpDir, compliantPayload(prdSlug)); // exit 0 path
    const payload = compliantPayload(prdSlug);
    delete payload["parent_id"];
    runGate(tmpDir, payload); // exit 4 path

    const after = runLore(["status", "--json"], tmpDir);
    const afterTotal = (JSON.parse(after.stdout) as { data: { total_docs: number } }).data.total_docs;

    expect(afterTotal).toBe(beforeTotal);
  });
});

// ─── Suite: rule doc not seeded — feeding pack degrades to a placeholder ────

describe("lore gate spec-create: no seeded rule doc", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("no-rule-doc");
    initCorpus(tmpDir);
    // Deliberately skip seedRuleDoc(tmpDir).
  });

  afterEach(() => cleanupDir(tmpDir));

  it("BOUNDARY: still exits 4 with missing reasons even when no approved rule doc exists", () => {
    const result = runGate(tmpDir, { type: "spec", title: "x", content: "no headings" });
    expect(result.exitCode).toBe(4);
    expect(result.stdout).toContain("PARENT_REQUIRED");
    expect(result.stdout).toContain("MISSING_SKELETON");
    expect(result.stdout).toContain("[source:");
    expect(result.stdout.toLowerCase()).toContain("seed-write-spec-rule");
  });
});
