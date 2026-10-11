/**
 * Compiled-binary e2e suite proving spec-context-provenance-injected-corpus-global-state-and-a
 * end-to-end, from a consumer's position — a throwaway corpus AND a throwaway
 * install dir, never this repo's own `.lore/` or a stubbed `lore` binary.
 *
 * task-t5-compiled-e2e-suite-proving-every-surface-from-a is the FINAL task of
 * its plan (T1-T4 already landed the mechanism); this file's job is not to
 * re-prove those mechanisms in isolation (T1/T2/T3/T4 already have unit and
 * compiled coverage of their own pieces) but to prove the COMPOSITION across
 * surfaces actually holds once every piece is assembled: the verb + the
 * injection + the hook's own rendering (framing line), both the CLI and MCP
 * render paths for one shared render function (scope closure), the governance
 * FEED prose against the SSOT array it must track (governance rule), a
 * genuinely out-of-tree fresh corpus (fresh install), and the DISTRIBUTION —
 * not merely storage — of both assets T2 and T4 edited (manifest parity).
 *
 * Two named ACs were RETIRED and replaced during implementation (a spec v46
 * design correction, not test churn): AC-CP-3 -> AC-CP-10 (the framing line is
 * served by `lore governance bootstrap-framing`, never `--injection` stdout —
 * an earlier draft had `--injection` print the line itself, which broke
 * SPEC-080 AC-080-3's bare-JSON contract) and AC-CP-5 -> AC-CP-9 (the
 * governance-rule iteration excludes `resume_hint`, which
 * spec-session-start-handoff-neutrality separately pins to ZERO literal
 * occurrences in the same asset — naming all ten keys and naming zero
 * occurrences of one of them are mutually exclusive). `lore ac list` reports
 * dangling refs for the two retired ids — that is the intended, loud outcome
 * per that spec's own D4 note, not a regression here.
 *
 * D6 discipline: every assertion below is pinned to one of an identity match
 * against an exported `@lore/core` constant, a zero-hit literal-string search,
 * or an exhaustive iteration over an exported key/token set — never a
 * remembered paraphrase of any prose.
 *
 * Freshness guard (repo CLAUDE.md "four false-oracle vectors" #4 — a stale
 * `dist/lore` is a false oracle; this file also needs a FRESH embedded assets
 * manifest, #3-adjacent — building is what regenerates
 * `packages/lore/src/generated/assets-manifest.ts`, this task's second
 * deliverable): `beforeAll` calls `assertFreshBinary`. Run `bun run build`
 * (repo root) first.
 *
 * Never touches the repo's own `.lore/` corpus for WRITES (project CLAUDE.md
 * hard rule) — every scenario that creates docs seeds a THROWAWAY `mkdtemp`
 * corpus outside this repo's tree (`bootstrap-injection-compiled.bun.test.ts`
 * precedent). Two tests below (`governance rule`, and the isolation half of
 * `fresh install`) issue a single READ-ONLY `lore get`/`lore governance`
 * against the repo's real corpus/assets — never a write.
 *
 * The "scope closure" test's MCP half is a REAL `SQLiteStore`-backed `App`
 * (`createApp(dbPath)` against the SAME `.lore/lore.db` the compiled CLI just
 * wrote to) with `registerTools` run against a real `McpServer` and its
 * handler extracted from `_registeredTools` — the same registration/handler-
 * extraction shape `mcp-tools-feed.test.ts`/`mcp-session-tools.test.ts`
 * already use, upgraded from their `InMemoryStore` fixture to the real
 * on-disk corpus this suite's compiled CLI calls just populated. This proves
 * cross-surface consistency on genuinely shared, disk-backed state rather
 * than two independently-seeded fixtures that happen to agree.
 *
 * Coverage (one test per AC, matching the task's five `-t` filter strings —
 * each unique in this file):
 *   "framing line"    (AC-CP-10) — `lore governance bootstrap-framing` stdout
 *                      is `BOOTSTRAP_FRAMING_LINE` by identity (no trailing
 *                      newline); `lore bootstrap --injection` stdout is bare,
 *                      unsplit compact JSON (SPEC-080 AC-080-3); the REAL
 *                      session-start hook, spawning the REAL compiled binary
 *                      via a PATH shim (never a stub), composes the framing
 *                      line OUTSIDE the markdown fence with the injection
 *                      JSON INSIDE it, and that fenced JSON deep-equals a
 *                      direct `--injection` call in the same corpus; both
 *                      retired strings are absent from the hook source.
 *   "scope closure"    (AC-CP-4) — see MCP-surface note above.
 *   "governance rule"  (AC-CP-9) — the governance FEED text names every
 *                      `BOOTSTRAP_INJECTION_KNOWN_KEYS` member except
 *                      `resume_hint` (excluded by the handoff-neutrality
 *                      zero-occurrence invariant) and every
 *                      `SOURCE_CATEGORY_TOKENS` member; paired assertion that
 *                      `resume_hint` is still absent from the asset.
 *   "fresh install"    (AC-CP-6) — an out-of-tree `mkdtemp` corpus resolves
 *                      to itself (never this repo's `.lore/`), and both
 *                      `BOOTSTRAP_SCOPE_DECLARATION`/`RESUME_SCOPE_CLOSURE`
 *                      reproduce there by identity.
 *   "manifest parity"  (AC-CP-7) — the embedded manifest's sha256 for both
 *                      T2/T4-edited assets matches their CURRENT SSOT bytes
 *                      (proves the regeneration actually covers both, not
 *                      just one); `lore setup --claude-dir <throwaway>`
 *                      installs `hooks/session-start-resume.mjs`
 *                      byte-identical to its SSOT (storage parity is not
 *                      distribution — the oracle is the installed file);
 *                      `governance/corpus-workflow.md` is retired from the
 *                      machine install set (SPEC-083 D3) — asserted absent
 *                      from the install dir — so ITS distribution oracle is
 *                      instead the compiled binary's own `lore governance`
 *                      verb, asserted byte-identical to the same SSOT.
 *
 * @spec_ref spec-context-provenance-injected-corpus-global-state-and-a
 *   §Design Decisions D1-D6, §Acceptance Criteria AC-CP-4, AC-CP-6, AC-CP-7,
 *   AC-CP-9, AC-CP-10. Task task-t5-compiled-e2e-suite-proving-every-surface-from-a.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  BOOTSTRAP_FRAMING_LINE,
  BOOTSTRAP_INJECTION_KNOWN_KEYS,
  BOOTSTRAP_SCOPE_DECLARATION,
  RESUME_SCOPE_CLOSURE,
  SOURCE_CATEGORY_TOKENS,
} from "@lore/core";
import { createApp } from "../../src/app.js";
import type { App } from "../../src/app.js";
import { registerTools } from "../../src/adapters/mcp/tools.js";
import { EMBEDDED_ASSETS_MANIFEST } from "../../src/generated/assets-manifest.js";
import { assertFreshBinary } from "../integration/helpers/assert-fresh-binary";

// ─── Path / spawn setup ─────────────────────────────────────────────────────

// tests/e2e/ -> tests/ -> packages/lore/ -> packages/ -> repo root (4 levels up),
// mirrors every sibling compiled-binary e2e suite's own REPO_ROOT derivation.
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");
const HOOK_PATH = join(REPO_ROOT, "assets", "hooks", "session-start-resume.mjs");
const HOOK_SSOT_PATH = join(REPO_ROOT, "assets", "hooks", "session-start-resume.mjs");
// RE-BASELINE (task-skill-implement-hooks-new-session-start-fragments-thin): the
// governance prose moved from the retired assets/governance/corpus-workflow.md
// to assets/context/corpus-workflow-*.md fragments
// (spec-context-fragments-config-driven-layered-rule-injection D9), delivered to
// the project CLAUDE.md Z1 by `lore context refresh`.
// D15 RE-BASELINE (task-skill-test-d15-red-static-fragments-as-lore-rules-files, owner
// decision 2026-10-07): the delivery surface is now the lore-owned rules file
// `.claude/rules/lore-corpus-workflow-feed.md`; the same ACCOUNT-token assertion moves there.
const CONTEXT_ASSETS_DIR = join(REPO_ROOT, "assets", "context");
const GOVERNANCE_FRAGMENT_FILES: readonly string[] = readdirSync(CONTEXT_ASSETS_DIR)
  .filter((f) => f.startsWith("corpus-workflow-") && f.endsWith(".md"))
  .sort();
/** Concatenated corpus-workflow fragment sources — the successor of the retired single SSOT asset. */
function governanceFragmentText(): string {
  return GOVERNANCE_FRAGMENT_FILES.map((f) => readFileSync(join(CONTEXT_ASSETS_DIR, f), "utf8")).join("\n");
}

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Spawns the COMPILED `dist/lore` binary. `CLAUDECODE=1` resolves the "agent" caller surface (SPEC-024) — no create/handoff call risks a nested AI invocation. */
function runLore(args: string[], cwd: string, envOverrides: Record<string, string> = {}): RunResult {
  const proc = Bun.spawnSync([LORE_BIN, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, CLAUDECODE: "1", ...envOverrides },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

function initCorpus(dir: string): void {
  const result = runLore(["init"], dir);
  if (result.exitCode !== 0) {
    throw new Error(`lore init failed: ${result.stderr}`);
  }
}

function parseSlug(stdout: string): string {
  const match = stdout.match(/Slug:\s+(\S+)/);
  const slug = match?.[1];
  if (slug === undefined) {
    throw new Error(`could not parse slug from create output: ${stdout}`);
  }
  return slug;
}

const cleanupDirs: string[] = [];

function trackDir(dir: string): string {
  cleanupDirs.push(dir);
  return dir;
}

function cleanupAll(): void {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop()!;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
}

beforeAll(() => {
  assertFreshBinary(LORE_BIN, [
    join(REPO_ROOT, "packages", "lore", "src"),
    join(REPO_ROOT, "packages", "core", "src"),
  ]);
});

afterAll(() => {
  cleanupAll();
});

// ─── "framing line" (AC-CP-10) ──────────────────────────────────────────────

/**
 * Writes an executable `lore` shim on its own dir that `exec`s the REAL
 * compiled `dist/lore` binary — never a stub with canned output (contrast
 * `tests/unit/hooks/session-bootstrap-injection.test.ts`, which deliberately
 * DOES use a stub to isolate the hook's fail-open contract; that file already
 * covers those isolated cases). Returned dir is meant to be PREPENDED to
 * PATH so it shadows any real `lore` earlier in resolution order.
 */
function makeRealLoreShimDir(): string {
  const dir = trackDir(mkdtempSync(join(tmpdir(), "lore-t5-real-shim-")));
  const shimPath = join(dir, "lore");
  writeFileSync(shimPath, `#!/bin/sh\nexec "${LORE_BIN}" "$@"\n`);
  chmodSync(shimPath, 0o755);
  return dir;
}

/** Spawns the REAL checked-in hook file as a `node` subprocess, PATH-shimmed to the REAL compiled binary, cwd inside a real `.lore/`-bearing corpus. `LORE_SETUP_NO_CHECK=1` disables the unrelated Phase F detached refresh (this suite is scoped to Phase C/E only). */
function runHookAgainstRealBinary(corpusDir: string): { additionalContext: string; raw: string } {
  const shimDir = makeRealLoreShimDir();
  const stateBase = trackDir(mkdtempSync(join(tmpdir(), "lore-t5-hook-state-")));
  const claudeDir = trackDir(mkdtempSync(join(tmpdir(), "lore-t5-hook-claude-")));

  const proc = Bun.spawnSync(["node", HOOK_PATH], {
    cwd: corpusDir,
    env: {
      ...process.env,
      PATH: `${shimDir}:${process.env["PATH"] ?? ""}`,
      CLAUDE_SESSION_ID: `t5-context-provenance-${Math.random().toString(36).slice(2)}`,
      CLAUDE_STATE_BASE_OVERRIDE: stateBase,
      CLAUDE_AGENTS_DIR_OVERRIDE: join(claudeDir, "agents"),
      LORE_SETUP_NO_CHECK: "1",
    },
  });

  const stdout = proc.stdout.toString();
  const stderr = proc.stderr.toString();
  if (proc.exitCode !== 0) {
    throw new Error(`hook did not exit 0: exit=${proc.exitCode} stderr=${stderr}`);
  }
  const parsed = JSON.parse(stdout) as { hookSpecificOutput?: { additionalContext?: string } };
  return { additionalContext: parsed.hookSpecificOutput?.additionalContext ?? "", raw: stdout };
}

describe("AC-CP-10: verb + injection + hook composition, end-to-end against the REAL compiled binary (D2)", () => {
  let dir: string;

  beforeAll(() => {
    dir = trackDir(mkdtempSync(join(tmpdir(), "lore-t5-framing-line-")));
    expect(dir.startsWith(REPO_ROOT)).toBe(false);
    initCorpus(dir);
  });

  it("framing line — governance verb identity, bare unsplit injection JSON, and the real hook's outside-fence/inside-fence composition", () => {
    // (a) `lore governance bootstrap-framing` stdout === BOOTSTRAP_FRAMING_LINE by identity.
    const framingResult = runLore(["governance", "bootstrap-framing"], dir);
    expect(framingResult.exitCode).toBe(0);
    expect(framingResult.stdout).toBe(BOOTSTRAP_FRAMING_LINE);
    expect(BOOTSTRAP_FRAMING_LINE.endsWith("\n")).toBe(false);
    expect(framingResult.stdout.endsWith("\n")).toBe(false);

    // (b) `lore bootstrap --injection` stdout is bare compact JSON, JSON.parse
    // accepts it whole with NO splitting (SPEC-080 AC-080-3) — a prose prefix
    // would make JSON.parse throw entirely, and a re-stringify mismatch would
    // reveal any surrounding text JSON.parse tolerated (leading/trailing
    // whitespace only).
    const directInjection = runLore(["bootstrap", "--injection"], dir);
    expect(directInjection.exitCode).toBe(0);
    const rawInjection = directInjection.stdout.trim();
    const directParsed = JSON.parse(rawInjection) as Record<string, unknown>;
    expect(JSON.stringify(directParsed)).toBe(rawInjection);
    expect(rawInjection).not.toContain("\n");

    // (d) both retired strings are gone from the checked-in hook source.
    const hookSource = readFileSync(HOOK_PATH, "utf8");
    expect(hookSource).not.toContain("## Lore Bootstrap (hook-injected)");
    expect(hookSource).not.toContain("Corpus pointer set");

    // (c) the REAL hook, spawning the REAL binary, composes the framing line
    // OUTSIDE a ```json fence with the injection JSON INSIDE it.
    const { additionalContext } = runHookAgainstRealBinary(dir);

    const framingIndex = additionalContext.indexOf(BOOTSTRAP_FRAMING_LINE);
    expect(framingIndex).toBeGreaterThanOrEqual(0);

    const fenceMatch = additionalContext.match(/```json\n([\s\S]*?)\n```/);
    expect(fenceMatch).not.toBeNull();
    const fenceStartIndex = additionalContext.indexOf(fenceMatch![0]);
    expect(framingIndex).toBeLessThan(fenceStartIndex);

    const fencedJson = fenceMatch![1]!;
    expect(fencedJson).not.toContain(BOOTSTRAP_FRAMING_LINE);
    const fencedParsed = JSON.parse(fencedJson) as Record<string, unknown>;
    expect(fencedParsed).toHaveProperty("scope_declaration");
    // Ties the hook's relayed JSON back to the SAME real binary output —
    // proves the hook relayed the REAL injection, not a stub's canned text.
    expect(fencedParsed).toEqual(directParsed);
  });
});

// ─── "scope closure" (AC-CP-4) ──────────────────────────────────────────────

type McpServerInternal = {
  _registeredTools: Record<
    string,
    { handler: (args: Record<string, unknown>, extra: unknown) => Promise<CallToolResult> }
  >;
};

function getToolHandler(
  server: McpServer,
  name: string,
): (args: Record<string, unknown>) => Promise<CallToolResult> {
  const internal = server as unknown as McpServerInternal;
  const tool = internal._registeredTools[name];
  if (!tool) throw new Error(`Tool not registered: ${name}`);
  return (args) => tool.handler(args, {} as unknown);
}

function parseToolResult(result: CallToolResult): unknown {
  const content = result.content[0];
  if (!content || content.type !== "text") throw new Error("Expected text content");
  return JSON.parse(content.text);
}

describe("AC-CP-4: resume ticket scope closure on BOTH the compiled CLI stdout and the in-process MCP response (D3)", () => {
  let dir: string;
  let planSlug: string;
  let app: App;
  let server: McpServer;

  beforeAll(() => {
    dir = trackDir(mkdtempSync(join(tmpdir(), "lore-t5-scope-closure-")));
    expect(dir.startsWith(REPO_ROOT)).toBe(false);
    initCorpus(dir);

    const prdResult = runLore(
      ["create", "prd", "--title", "T5 Scope Closure PRD", "--content", "root", "--no-ai"],
      dir,
    );
    expect(prdResult.exitCode).toBe(0);
    const prdSlug = parseSlug(prdResult.stdout);

    const planResult = runLore(
      ["create", "plan", "--title", "T5 Scope Closure Plan", "--parent", prdSlug, "--content", "x", "--no-ai"],
      dir,
    );
    expect(planResult.exitCode).toBe(0);
    planSlug = parseSlug(planResult.stdout);

    const handoffResult = runLore(
      ["handoff", "--plan", planSlug, "--next", "next step", "--decision", "decision@80"],
      dir,
    );
    expect(handoffResult.exitCode).toBe(0);

    // Real SQLiteStore-backed App against the SAME db the compiled CLI just
    // wrote to — never InMemoryStore — so the MCP surface and the CLI stdout
    // above operate on genuinely shared, disk-backed state.
    app = createApp(join(dir, ".lore", "lore.db"));
    server = new McpServer({ name: "t5-scope-closure", version: "0.0.0" });
    registerTools(server, app);
  });

  afterAll(() => {
    app.close();
  });

  it("scope closure — RESUME_SCOPE_CLOSURE verbatim on both surfaces, naming every BOOTSTRAP_INJECTION_KNOWN_KEYS member", async () => {
    const cliResult = runLore(["feed", "session-resume", "--plan", planSlug], dir);
    expect(cliResult.exitCode).toBe(0);
    expect(cliResult.stdout).toContain(RESUME_SCOPE_CLOSURE);

    const call = getToolHandler(server, "lore_feed");
    const mcpResult = await call({ checkpoint: "session-resume", plan: planSlug });
    expect(mcpResult.isError).toBeFalsy();
    const data = parseToolResult(mcpResult) as { feed: string };
    expect(data.feed).toContain(RESUME_SCOPE_CLOSURE);

    expect(BOOTSTRAP_INJECTION_KNOWN_KEYS.size).toBeGreaterThan(0);
    for (const key of BOOTSTRAP_INJECTION_KNOWN_KEYS) {
      expect(RESUME_SCOPE_CLOSURE).toContain(key);
    }
  });
});

// ─── "governance rule" (AC-CP-9) ────────────────────────────────────────────

describe("AC-CP-9: compiled dist/lore governance FEED rule names every injected key (except resume_hint) + every source category (D4)", () => {
  it("governance rule — FEED text names every BOOTSTRAP_INJECTION_KNOWN_KEYS member except resume_hint, every SOURCE_CATEGORY_TOKENS member, and resume_hint stays absent from the asset", () => {
    // RE-BASELINE: originally `lore governance` stdout (the retired
    // corpus-workflow topic; now exits non-zero, D9) — the same assertions run
    // against the fragment sources that replaced it. Not a weakening: the
    // retired verb is asserted to REFUSE, and the fragment text must still name
    // every key / category.
    const retired = runLore(["governance"], REPO_ROOT);
    expect(retired.exitCode).not.toBe(0);
    expect(retired.stderr).toContain("retired");
    expect(GOVERNANCE_FRAGMENT_FILES.length).toBeGreaterThan(0);
    const result = { stdout: governanceFragmentText() };

    // The exclusion is MANDATORY, not incidental: spec-session-start-handoff-neutrality
    // pins resume_hint to ZERO literal occurrences in this SAME asset, so an
    // unconditional ten-key iteration is unsatisfiable — checked directly below.
    expect(BOOTSTRAP_INJECTION_KNOWN_KEYS.has("resume_hint")).toBe(true);
    let namedCount = 0;
    for (const key of BOOTSTRAP_INJECTION_KNOWN_KEYS) {
      if (key === "resume_hint") continue;
      expect(result.stdout).toContain(key);
      namedCount += 1;
    }
    expect(namedCount).toBe(BOOTSTRAP_INJECTION_KNOWN_KEYS.size - 1);

    expect(SOURCE_CATEGORY_TOKENS.length).toBeGreaterThan(0);
    for (const token of SOURCE_CATEGORY_TOKENS) {
      expect(result.stdout).toContain(token);
    }

    // Paired assertion — prevents the carve-out from silently widening to a
    // second key: resume_hint has zero literal occurrences in the SSOT asset.
    expect(result.stdout).not.toContain("resume_hint");

    // D15 RE-BASELINE (task-skill-test-d15-red-static-fragments-as-lore-rules-files, owner
    // decision 2026-10-07): the sources above are not the delivery surface. After
    // `lore context refresh` the same keys/categories must be readable in the project's
    // lore-owned `.claude/rules/lore-corpus-workflow-*.md` files (and resume_hint still absent).
    const corpusDir = trackDir(mkdtempSync(join(tmpdir(), "lore-t5-cp9-rules-")));
    initCorpus(corpusDir);
    expect(runLore(["context", "init"], corpusDir).exitCode).toBe(0);
    expect(runLore(["context", "refresh"], corpusDir).exitCode).toBe(0);
    const rulesDir = join(corpusDir, ".claude", "rules");
    const ruleFiles = existsSync(rulesDir)
      ? readdirSync(rulesDir).filter((f) => f.startsWith("lore-corpus-workflow-") && f.endsWith(".md"))
      : [];
    expect(ruleFiles.length).toBe(GOVERNANCE_FRAGMENT_FILES.length);
    const delivered = ruleFiles.map((f) => readFileSync(join(rulesDir, f), "utf8")).join("\n");
    for (const key of BOOTSTRAP_INJECTION_KNOWN_KEYS) {
      if (key !== "resume_hint") expect(delivered).toContain(key);
    }
    for (const token of SOURCE_CATEGORY_TOKENS) {
      expect(delivered).toContain(token);
    }
    expect(delivered).not.toContain("resume_hint");
  }, 120_000);
});

// ─── "fresh install" (AC-CP-6) ──────────────────────────────────────────────

describe("AC-CP-6: throwaway out-of-tree corpus reproduces both boundary declarations, resolved to itself (D1, D3, D5)", () => {
  it("fresh install — resolved corpus root is the temp path (never this repo's .lore/), both boundary declarations match their exported constants by identity", () => {
    const dir = trackDir(mkdtempSync(join(tmpdir(), "lore-t5-fresh-install-")));
    expect(dir.startsWith(REPO_ROOT)).toBe(false);

    initCorpus(dir);
    expect(existsSync(join(dir, ".lore", "lore.db"))).toBe(true);

    const markerTitle = `T5 Fresh Install Marker ${Math.random().toString(36).slice(2)}`;
    const prdResult = runLore(["create", "prd", "--title", markerTitle, "--content", "root", "--no-ai"], dir);
    expect(prdResult.exitCode).toBe(0);
    const prdSlug = parseSlug(prdResult.stdout);

    const planResult = runLore(
      ["create", "plan", "--title", "T5 Fresh Install Plan", "--parent", prdSlug, "--content", "x", "--no-ai"],
      dir,
    );
    expect(planResult.exitCode).toBe(0);
    const planSlug = parseSlug(planResult.stdout);

    const handoffResult = runLore(
      ["handoff", "--plan", planSlug, "--next", "next step", "--decision", "decision@80"],
      dir,
    );
    expect(handoffResult.exitCode).toBe(0);

    // (a) resolved corpus root IS the temp path.
    const getInTemp = runLore(["get", prdSlug], dir);
    expect(getInTemp.exitCode).toBe(0);
    expect(getInTemp.stdout).toContain(markerTitle);

    // ... and never this repo's OWN `.lore/` — the marker doc created only in
    // the temp corpus is invisible from a READ-ONLY lookup against the repo's
    // real corpus (this would only pass by accident if resolution genuinely
    // fell back to some shared root instead of the temp path).
    const getInRepo = runLore(["get", prdSlug], REPO_ROOT);
    expect(getInRepo.exitCode).toBe(3); // SLUG_NOT_FOUND
    expect(getInRepo.stderr).toContain("not found");

    // (b) both boundary declarations reproduce here, matching their exported
    // constants by identity.
    const injectionResult = runLore(["bootstrap", "--injection"], dir);
    expect(injectionResult.exitCode).toBe(0);
    const parsedInjection = JSON.parse(injectionResult.stdout.trim()) as { scope_declaration: string };
    expect(parsedInjection.scope_declaration).toBe(BOOTSTRAP_SCOPE_DECLARATION);

    const resumeResult = runLore(["feed", "session-resume", "--plan", planSlug], dir);
    expect(resumeResult.exitCode).toBe(0);
    expect(resumeResult.stdout).toContain(RESUME_SCOPE_CLOSURE);
  });
});

// ─── "manifest parity" (AC-CP-7) ────────────────────────────────────────────

describe("AC-CP-7: embedded manifest + lore setup distribution parity for both T2/T4-edited assets (D5)", () => {
  it("manifest parity — the embedded manifest reflects both edited assets' CURRENT bytes; the hook installs byte-identical; corpus-workflow.md (retired from machine install) is byte-identical via the binary's own governance verb instead", () => {
    const hookSsotBytes = readFileSync(HOOK_SSOT_PATH);

    // The manifest only stores a sha256 (not raw content) — this is the
    // strongest form of "byte-compare" available against the EMBEDDED
    // manifest itself, and directly verifies this task's OTHER deliverable
    // (regenerating the manifest) actually reflects BOTH edited assets,
    // rather than assuming the `bun run build` side effect was complete.
    const hookSha = createHash("sha256").update(hookSsotBytes).digest("hex");
    const hookEntry = EMBEDDED_ASSETS_MANIFEST.entries.find((e) => e.path === "hooks/session-start-resume.mjs");
    expect(hookEntry).toBeDefined();
    expect(hookEntry?.sha256).toBe(hookSha);

    // RE-BASELINE: the retired `governance/corpus-workflow.md` manifest entry is
    // replaced by one entry PER fragment file (non-empty set asserted so an
    // empty loop cannot pass vacuously), each digest-equal to its CURRENT bytes.
    expect(GOVERNANCE_FRAGMENT_FILES.length).toBeGreaterThan(0);
    for (const f of GOVERNANCE_FRAGMENT_FILES) {
      const entry = EMBEDDED_ASSETS_MANIFEST.entries.find((e) => e.path === `context/${f}`);
      expect(entry).toBeDefined();
      expect(entry?.sha256).toBe(createHash("sha256").update(readFileSync(join(CONTEXT_ASSETS_DIR, f))).digest("hex"));
    }
    expect(EMBEDDED_ASSETS_MANIFEST.entries.some((e) => e.path === "governance/corpus-workflow.md")).toBe(false);

    const scratch = trackDir(mkdtempSync(join(tmpdir(), "lore-t5-setup-")));
    const targetDir = join(scratch, ".claude");

    // PATH="" forces `claude` ENOENT deterministically (mcp registration
    // fails, exit 1) — never reaches this dev machine's real `claude` CLI
    // (setup.test.ts's own established convention). Files still write.
    const setupResult = Bun.spawnSync([LORE_BIN, "setup", "--claude-dir", targetDir, "--yes"], {
      cwd: scratch,
      env: { ...process.env, PATH: "" },
    });
    expect(setupResult.stdout.toString()).toContain("lore setup complete");

    // Storage parity is not distribution — the oracle is the installed file,
    // read back from the throwaway claude-dir.
    const installedHookPath = join(targetDir, "hooks", "session-start-resume.mjs");
    expect(existsSync(installedHookPath)).toBe(true);
    const installedHookBytes = readFileSync(installedHookPath);
    expect(installedHookBytes.equals(hookSsotBytes)).toBe(true);

    // governance/corpus-workflow.md is RETIRED from the machine install set
    // (SPEC-083 D3, packages/lore/src/adapters/real-asset-source.ts) — the
    // runtime `lore governance` verb reads it from the binary's own assets
    // root instead, so it must be ABSENT here, never a stale installed copy.
    const installedGovernancePath = join(targetDir, "governance", "corpus-workflow.md");
    expect(existsSync(installedGovernancePath)).toBe(false);

    // RE-BASELINE: the retired verb topic must now REFUSE (was: byte-equal stdout);
    // the fragments' delivery surface is the project .claude/rules/lore-corpus-workflow-feed.md (D15).
    const governanceVerbResult = Bun.spawnSync([LORE_BIN, "governance"], { cwd: REPO_ROOT });
    expect(governanceVerbResult.exitCode).not.toBe(0);
    expect(governanceVerbResult.stderr.toString()).toContain("retired");

    const corpusDir = trackDir(mkdtempSync(join(tmpdir(), "lore-t5-z1-")));
    initCorpus(corpusDir);
    expect(runLore(["context", "init"], corpusDir).exitCode).toBe(0);
    expect(runLore(["context", "refresh"], corpusDir).exitCode).toBe(0);
    const feedRules = join(corpusDir, ".claude", "rules", "lore-corpus-workflow-feed.md");
    expect(existsSync(feedRules)).toBe(true);
    expect(readFileSync(feedRules, "utf8")).toContain("ACCOUNT, not to complete");
  }, 120_000);
});
