// @spawns packages/lore/src/index.ts
// @reads packages/lore/src/service/**
/**
 * RED-phase TDD tests for AC-WIRE-1 and AC-WIRE-2 of
 * `spec-claude-md-governance-content-dimension-checks-wire-the` (the paired
 * implementation task is `task-skill-implement-three-way-split-runmemoryfilechecks`,
 * a sibling in the same plan/phase).
 *
 * ⛔ Both ACs are bound by the spec's own coverage contract: "Every WIRING AC
 * drives the CLI subprocess, never the unit function directly" — a unit-level
 * assertion cannot distinguish "wired into production" from "implemented and
 * permanently dead", which is EXACTLY the defect this spec exists to close
 * (`checkReferenceExistence`/`detectNarrativeSmells` shipped fully unit-tested
 * in `claude-md-check.ts` with zero production call sites). So this file never
 * imports either check function — every scenario below spawns the real CLI
 * (`lore status --check-claude-md --json`) against a `mkdtemp` fixture and
 * reads the JSON payload.
 *
 * RED baseline, confirmed empirically against this worktree before writing
 * this file: `packages/lore/src/adapters/cli/commands/status.ts`'s
 * `--check-claude-md` branch calls ONLY `lintMemoryFiles` (line ~1135) — no
 * `runMemoryFileChecks`, no `checkReferenceExistence`, no
 * `detectNarrativeSmells` anywhere in that branch, and the emitted `--json`
 * payload (`data.claude_md`) carries only `{ findings, headroom, warnings,
 * budget_source, budget_substitution }` — no `advisory` key at all. Every
 * scenario below that asserts an `advisory` entry is present therefore fails
 * today (the array is `undefined`); every scenario asserting one is ABSENT
 * passes today, vacuously, because nothing is wired yet — this is the exact
 * "vacuously true must be distinguishable from true" trap, which is why each
 * describe below pairs a positive (fires) case with a negative (silent) case
 * rather than asserting silence alone.
 *
 * ## Why AC-WIRE-2's threshold is discovered, never imported
 *
 * AC-WIRE-2 requires "the threshold is read from the module constant, never
 * restated in the test." A static import of `ISO_DATE_DENSITY_THRESHOLD`
 * would require guessing which post-split file re-exports it
 * (`claude-md-admission.ts` doesn't exist yet — this task and the split are
 * concurrent siblings) and would touch the admission module directly, in
 * tension with the "never drive the unit function/module directly" binding
 * above. Instead, the boundary is DISCOVERED empirically through the CLI
 * itself: a small bounded search finds the smallest ISO-date count at which
 * `iso_date_density` starts firing, then asserts that count and its immediate
 * predecessor behave as AC-WIRE-2 describes (fires / stays silent). This
 * self-adapts to whatever the real constant is (today 3, in
 * `claude-md-check.ts`), never hardcodes it, and works regardless of where
 * the constant ends up living after the split.
 *
 * ⛔ Measured tension worth flagging for the implementer: `claude-md-check.ts`
 * today compares `isoMatches.length >= ISO_DATE_DENSITY_THRESHOLD` — i.e. a
 * paragraph with EXACTLY the threshold count of dates already fires under the
 * current (pre-split) comparison. AC-WIRE-2's literal text says the opposite
 * ("a paragraph at exactly the threshold emits none"). This suite encodes the
 * AC's literal text, not today's operator — if the split lands with the
 * comparison unchanged (`>=`), the "silent at the boundary" scenario below
 * will surface that mismatch rather than silently accepting it, which is the
 * point of an adversarial oracle: the AC is the contract, not whatever the
 * pre-existing unit does.
 *
 * Coverage dimensions: HAPPY (reference_missing / iso_date_density /
 * status_word each fire) / NEGATIVE (existing reference and at-threshold
 * ISO-date count both stay silent) / BOUNDARY (the discovered threshold
 * vs. threshold+1 pair) / ERROR (empty CLAUDE.md never crashes) / STATE (exit
 * code stays exactly 0 across every advisory combination, even several at
 * once, and even alongside a REAL deterministic breach) / REGRESSION
 * (reference_missing never reappears in the deterministic `findings` array;
 * `MemoryFileFindingKind` no longer declares it while `AdvisoryFindingKind`
 * does — the N13 type migration).
 *
 * @spec_ref spec-claude-md-governance-content-dimension-checks-wire-the
 * @ac_ref AC-WIRE-1
 * @ac_ref AC-WIRE-2
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ─── Path setup (mirrors tests/integration/status-claude-md.test.ts) ───────

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const SERVICE_DIR = join(PACKAGE_ROOT, "src", "service");

/**
 * The five required root H2 sections: limits are always enforced, so a root file missing one is a deterministic
 * `section_missing` finding (exit 3) and would drown out the property each case below is about. Every fixture
 * root file is prefixed with them.
 */
const SECTIONS_PREFIX =
  ["What This Is", "Commands", "Architecture", "Module Index", "Finding Live Project State"]
    .map((name) => `## ${name}\n\nbody of ${name}\n`)
    .join("\n") + "\n";

/** Writes `<dir>/CLAUDE.md` as the required sections followed by `body`. */
function writeClaudeMd(dir: string, body: string): void {
  writeFileSync(join(dir, "CLAUDE.md"), SECTIONS_PREFIX + body);
}

// ─── CLI subprocess harness ─────────────────────────────────────────────────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Spawn `bun run <INDEX_TS> ...args` in `cwd` with an isolated HOME dir.
 * MOCK RISK: none — spawns the real CLI, same pattern as
 * `status-claude-md.test.ts`. `CLAUDECODE=1` puts the surface into "agent"
 * mode (AI default off) — irrelevant to this deterministic, non-AI check,
 * kept for parity with the repo's established fixture convention.
 */
function runLore(args: string[], cwd: string): RunResult {
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    env: {
      ...process.env,
      HOME: cwd,
      EDITOR: "true",
      CLAUDECODE: "1",
    },
    encoding: "utf8",
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

function makeTempDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `lore-claude-md-wiring-${label}-`));
}

function cleanupDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

// ─── --json payload shape (deliberately partial — a CLI-output assertion
// helper, not a mirror of MemoryFileFinding/AdvisoryFinding, which stay
// owned by the service layer) ────────────────────────────────────────────

interface ClaudeMdFindingJson {
  kind: string;
  path?: string;
  message?: string;
}

interface AdvisoryFindingJson {
  kind: string;
  measured?: number;
  message?: string;
}

interface CheckClaudeMdJson {
  data?: {
    claude_md?: {
      findings?: ClaudeMdFindingJson[];
      advisory?: AdvisoryFindingJson[];
    };
  };
}

function runCheckClaudeMdJson(cwd: string): { result: RunResult; parsed: CheckClaudeMdJson } {
  const result = runLore(["status", "--check-claude-md", "--json"], cwd);
  let parsed: CheckClaudeMdJson;
  try {
    parsed = JSON.parse(result.stdout) as CheckClaudeMdJson;
  } catch (error) {
    throw new Error(
      `--check-claude-md --json produced non-JSON stdout (exit ${result.exitCode}): ${error instanceof Error ? error.message : String(error)}\n` +
        `stdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  }
  return { result, parsed };
}

function advisoryKinds(parsed: CheckClaudeMdJson): string[] {
  return (parsed.data?.claude_md?.advisory ?? []).map((f) => f.kind);
}

function findingKinds(parsed: CheckClaudeMdJson): string[] {
  return (parsed.data?.claude_md?.findings ?? []).map((f) => f.kind);
}

/** A CLAUDE.md body of exactly `lineCount` non-empty lines (root ceiling is 300 lines, D3). */
function nLineBody(lineCount: number): string {
  const lines: string[] = [];
  for (let i = 1; i <= lineCount; i++) {
    lines.push(`Line ${i}: standing discipline entry, not a status narrative.`);
  }
  return lines.join("\n") + "\n";
}

/** A paragraph containing exactly `count` distinct ISO-8601 calendar-date tokens. */
function isoDatesParagraph(count: number): string {
  const dates: string[] = [];
  for (let i = 0; i < count; i++) {
    const day = String((i % 27) + 1).padStart(2, "0");
    dates.push(`2026-01-${day}`);
  }
  return `Status notes — ${dates.map((d) => `updated ${d}`).join(", ")}.\n`;
}

// ─── Structural scan for the N13 type migration (glob-based — does not
// assume which post-split file ends up declaring the two union types) ──────

function findTypeDeclaration(typeName: string): string | undefined {
  if (!existsSync(SERVICE_DIR)) return undefined;
  const files = readdirSync(SERVICE_DIR).filter((f) => f.startsWith("claude-md-") && f.endsWith(".ts"));
  const pattern = new RegExp(`type\\s+${typeName}\\s*=[^;]*;`, "s");
  for (const file of files) {
    const content = readFileSync(join(SERVICE_DIR, file), "utf8");
    const match = content.match(pattern);
    if (match) return match[0];
  }
  return undefined;
}

// ─── AC-WIRE-1: reference_missing reaches the CLI as advisory ──────────────

describe("claude-md wiring — an unresolved reference reaches the CLI as a deterministic finding", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("reference-missing");
  });

  afterEach(() => cleanupDir(tmpDir));

  it("HAPPY: a dangling backtick-quoted repo-relative path is a reference_unresolved finding (never advisory), exit code exactly 3", () => {
    writeClaudeMd(tmpDir, "See `packages/lore/src/definitely-missing-file-xyz-123.ts` for the mechanism.\n",
    );

    const { result, parsed } = runCheckClaudeMdJson(tmpDir);

    expect(result.exitCode).toBe(3);
    expect(findingKinds(parsed)).toContain("reference_unresolved");
    expect(advisoryKinds(parsed)).not.toContain("reference_missing");
  });

  it("NEGATIVE: reports no reference_unresolved for a backtick-quoted path that actually exists, exit code exactly 0", () => {
    mkdirSync(join(tmpDir, "notes"), { recursive: true });
    writeFileSync(join(tmpDir, "notes", "present.md"), "real file\n");
    writeClaudeMd(tmpDir, "See `notes/present.md` for the mechanism.\n");

    const { result, parsed } = runCheckClaudeMdJson(tmpDir);

    expect(findingKinds(parsed)).not.toContain("reference_unresolved");
    expect(result.exitCode).toBe(0);
  });

  it("REGRESSION: MemoryFileFindingKind declares reference_unresolved, AdvisoryFindingKind no longer declares reference_missing", () => {
    const deterministicDecl = findTypeDeclaration("MemoryFileFindingKind");
    const advisoryDecl = findTypeDeclaration("AdvisoryFindingKind");

    expect(deterministicDecl, "MemoryFileFindingKind declaration not found under src/service/claude-md-*.ts").toBeDefined();
    expect(advisoryDecl, "AdvisoryFindingKind declaration not found under src/service/claude-md-*.ts").toBeDefined();

    expect(deterministicDecl as string).toContain("reference_unresolved");
    expect(advisoryDecl as string).not.toContain("reference_missing");
  });

  it("STATE: a dangling reference alongside a REAL deterministic ceiling breach still reports both — advisory is not crowded out by a real finding", () => {
    const oversized = nLineBody(400); // root ceiling is 300 lines — real breach
    writeClaudeMd(tmpDir, oversized + "See `packages/lore/src/definitely-missing-file-xyz-456.ts` too.\n",
    );

    const { result, parsed } = runCheckClaudeMdJson(tmpDir);

    expect(result.exitCode).toBe(3); // the real breach still decides the exit code
    expect(findingKinds(parsed)).toContain("max_lines");
    expect(findingKinds(parsed)).toContain("reference_unresolved");
  });
});

// ─── AC-WIRE-2: narrative smells reach the CLI without affecting exit ──────

describe("claude-md wiring — narrative smells reach the CLI without affecting exit", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("narrative-smells");
  });

  afterEach(() => cleanupDir(tmpDir));

  const ISO_SEARCH_MAX = 10;

  it("BOUNDARY: iso_date_density fires at the module's own boundary count and stays silent one date below it — exit code exactly 0 in both runs", () => {
    let lastSilent: number | undefined;
    let lastSilentExit: number | undefined;
    let firstFiring: number | undefined;
    let firstFiringExit: number | undefined;

    for (let n = 1; n <= ISO_SEARCH_MAX; n++) {
      const dir = makeTempDir(`iso-density-probe-${n}`);
      writeClaudeMd(dir, isoDatesParagraph(n));
      const { result, parsed } = runCheckClaudeMdJson(dir);
      cleanupDir(dir);

      if (advisoryKinds(parsed).includes("iso_date_density")) {
        firstFiring = n;
        firstFiringExit = result.exitCode;
        break;
      }
      lastSilent = n;
      lastSilentExit = result.exitCode;
    }

    if (firstFiring === undefined) {
      throw new Error(
        `iso_date_density never fired for any ISO-date count from 1 to ${ISO_SEARCH_MAX} in ` +
          "'lore status --check-claude-md --json' — detectNarrativeSmells is not reaching the CLI's advisory output.",
      );
    }
    if (lastSilent === undefined || firstFiring !== lastSilent + 1) {
      throw new Error(
        `expected a consecutive (silent, firing) pair — got lastSilent=${String(lastSilent)}, firstFiring=${firstFiring}. ` +
          "iso_date_density should flip on exactly one MORE ISO date than the module's threshold.",
      );
    }

    expect(firstFiringExit).toBe(0);
    expect(lastSilentExit).toBe(0);
  });

  it("HAPPY: status_word fires for status-narrative wording (e.g. 'not yet', 'pending', TODO markers), exit code exactly 0", () => {
    writeClaudeMd(tmpDir, "This feature is not yet implemented. TODO: revisit once pending work lands.\n",
    );

    const { result, parsed } = runCheckClaudeMdJson(tmpDir);

    expect(result.exitCode).toBe(0);
    expect(advisoryKinds(parsed)).toContain("status_word");
  });

  it("ERROR (no crash): an empty CLAUDE.md produces zero advisory findings and exit code exactly 0", () => {
    writeClaudeMd(tmpDir, "");

    const { result, parsed } = runCheckClaudeMdJson(tmpDir);

    expect(result.exitCode).toBe(0);
    // Narrowed (Phase 4 re-baseline): this case exists to prove the NARRATIVE-SMELL
    // detectors do not fire on empty content. The always-on advisories added by
    // AC-ADV-1 (`line_length`, `target_distance`) are emitted for EVERY discovered
    // file including an empty one, by design, so asserting the whole array is empty
    // asserts a property this case never intended to cover.
    const narrativeKinds = ["iso_date_density", "status_word"];
    const narrative = (parsed.data?.claude_md?.advisory ?? []).filter((a: { kind: string }) =>
      narrativeKinds.includes(a.kind),
    );
    expect(narrative).toEqual([]);
  });

  it("STATE: several advisory kinds firing at once (dense ISO dates + status wording) never change the exit code", () => {
    const content =
      isoDatesParagraph(8) +
      "This is not yet done — TODO: pending review.\n";
    writeClaudeMd(tmpDir, content);

    const { result, parsed } = runCheckClaudeMdJson(tmpDir);

    expect(result.exitCode).toBe(0);
    const kinds = new Set(advisoryKinds(parsed));
    expect(kinds.has("iso_date_density")).toBe(true);
    expect(kinds.has("status_word")).toBe(true);
  });
});
