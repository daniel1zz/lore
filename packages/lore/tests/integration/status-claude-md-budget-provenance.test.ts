// @spawns packages/lore/src/index.ts
/**
 * `lore status --check-claude-md` (and its parallel consumer `lore context
 * refresh`) must never measure a project against budgets it silently
 * substituted — task-lore-status-check-claude-md-silently-runs-on-schema.
 *
 * ─── The proxy this file removes ──────────────────────────────────────────
 * "`lore status --check-claude-md` exited 0" was a proxy for "every memory
 * file is within the OPERATOR'S configured budget". Scenario 2 below is a
 * concrete input that satisfied the proxy while violating the property: a
 * CLAUDE.md of 6000 bytes under a configured `root.max_bytes: 5000` — a
 * breach — reported as exit 0 with no signal anywhere, because the config's
 * `context` block was unparseable and the check quietly fell back to the
 * 30720-byte schema default. Scenario 1 is the same file and the same
 * ceiling with a config that PARSES, and it exits 3: the two scenarios differ
 * in nothing but config validity, which is what makes the silence visible.
 *
 * ─── RED baseline (recorded against this worktree's pre-fix HEAD) ──────────
 * Scenario 2 produced exit 0, stdout `CLAUDE.md: within budget (0 findings).`,
 * an EMPTY stderr, and `--json` `data.claude_md` carrying only
 * `{findings, headroom, warnings}` — no `budget_source`, no
 * `budget_substitution`. Scenario 6 (`lore context refresh`) likewise wrote
 * nothing to stderr about the substitution. Every assertion on the two lone
 * tokens and on the two new JSON keys therefore failed.
 *
 * ─── Why the per-doc BYTE NUMBERS, never the summary line ──────────────────
 * `CLAUDE.md: within budget (0 findings).` printed green while the
 * eviction-floor defect was live. A summary-only assertion proves nothing
 * about WHICH ceiling was applied, so every scenario below asserts
 * `headroom[0].bytes.ceiling` — the number that actually differs between the
 * operator's budgets and the substituted ones.
 *
 * ─── Two INDEPENDENT lone tokens ──────────────────────────────────────────
 * A single remembered sentence degrades silently to no-match when reworded.
 * The assertions key on `SUBSTITUTED` (our own banner word — proves the
 * notice fired) and `evict_threshold_fraction` (the zod path of the refusal
 * `contextConfigSchema`'s ordered-pair `superRefine` raised — proves the
 * swallowed refusal is being relayed, not replaced by a generic banner).
 * Neither token is a substring of the other and they originate in different
 * modules.
 *
 * MOCK RISK: none — spawns the real CLI (`bun run src/index.ts`) against real
 * `mkdtemp` fixtures, same pattern as `status-claude-md.test.ts`. ⛔ Every
 * corpus here is a throwaway temp dir; the repo's own `.lore/` is never
 * touched.
 *
 * Coverage dimensions: HAPPY (valid config honoured, verdict differs from the
 * default-threshold verdict) / NEGATIVE (unparseable `context` announced on
 * both stderr and `--json`) / BOUNDARY (valid config without `context`;
 * invalid config whose `context` still salvages) / ERROR (no config at all is
 * not an error) / STATE (the parallel `lore context` consumer announces the
 * same substitution) / REGRESSION (exit codes and per-doc numbers unchanged
 * when the config is valid).
 *
 * @spec_ref spec-project-claude-md-content-contract-governance-injected
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { patchLoreConfig } from "../helpers/patch-lore-config.js";
import { join } from "path";
import { tmpdir } from "os";

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Spawn `bun run <INDEX_TS> ...args` in `cwd` with an isolated HOME. */
function runLore(args: string[], cwd: string): RunResult {
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true", CLAUDECODE: "1" },
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

function makeTempDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `lore-budget-provenance-${label}-`));
}

function cleanupDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort temp cleanup; a leaked temp dir must never fail a run
  }
}

/** Writes `<dir>/.lore/config.yaml` verbatim, creating `.lore/` if needed. */
function writeConfig(dir: string, yamlText: string): void {
  patchLoreConfig(dir, yamlText, { replace: true });
}

/** A CLAUDE.md body of exactly `byteCount` UTF-8 bytes with a ceiling-safe line count. */
function nByteBody(byteCount: number): string {
  // The five required root H2 sections come first so that the ONLY finding a
  // 6000-byte root can raise is the byte ceiling under test — never
  // `section_missing` (spec-claude-md-root-section-structure-check-and-adoption-mode).
  const sections =
    ["What This Is", "Commands", "Architecture", "Module Index", "Finding Live Project State"]
      .map((name) => `## ${name}\n\nbody of ${name}\n`)
      .join("\n") + "\n";
  const base =
    sections + Array.from({ length: 20 }, (_unused, i) => `Line ${i + 1}: standing discipline entry.`).join("\n") + "\n";
  const baseBytes = Buffer.byteLength(base, "utf8");
  if (baseBytes > byteCount) throw new Error(`nByteBody: base (${baseBytes}B) exceeds requested ${byteCount}B`);
  return base.slice(0, -1) + "x".repeat(byteCount - baseBytes) + "\n";
}

/** The fixture size: over the configured 5000-byte ceiling, well under the 30720-byte default. */
const FIXTURE_BYTES = 6000;
const CONFIGURED_ROOT_MAX_BYTES = 5000;
const SCHEMA_DEFAULT_ROOT_MAX_BYTES = 30720;

const VALID_PROJECT_YAML = `project:\n  name: fixture\n  author: fixture-author\n`;
/** A `context` block whose ordered warn/evict pair is inverted — refused at parse time. */
const INVERTED_CONTEXT_YAML =
  `context:\n  memory_files:\n    root:\n      max_bytes: ${CONFIGURED_ROOT_MAX_BYTES}\n    warn_threshold_fraction: 1\n`;
const VALID_STRICT_CONTEXT_YAML =
  `context:\n  memory_files:\n    root:\n      max_bytes: ${CONFIGURED_ROOT_MAX_BYTES}\n`;

interface HeadroomJson {
  path: string;
  role: string;
  lines: { used: number; ceiling: number; remaining: number; warn: boolean };
  bytes: { used: number; ceiling: number; remaining: number; warn: boolean };
}

interface CheckClaudeMdJson {
  data?: {
    claude_md?: {
      findings?: Array<{ kind: string; path: string; message: string }>;
      headroom?: HeadroomJson[];
      budget_source?: string;
      budget_substitution?: string | null;
    };
  };
}

function parseCheckJson(stdout: string): NonNullable<NonNullable<CheckClaudeMdJson["data"]>["claude_md"]> {
  const payload = JSON.parse(stdout) as CheckClaudeMdJson;
  const claudeMd = payload.data?.claude_md;
  if (claudeMd === undefined) throw new Error(`--json payload carried no data.claude_md: ${stdout}`);
  return claudeMd;
}

/** The single root-CLAUDE.md headroom row — fails loud rather than silently reading `undefined`. */
function rootHeadroom(stdout: string): HeadroomJson {
  const rows = parseCheckJson(stdout).headroom ?? [];
  const root = rows.find((row) => row.role === "root");
  if (root === undefined) throw new Error(`no root headroom row in: ${stdout}`);
  return root;
}

// ─── Scenario 1 (HAPPY + CONTROL a): a VALID config is demonstrably in effect ──

describe("check-claude-md: a valid config's thresholds are provably in effect", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("valid-config");
    writeFileSync(join(tmpDir, "CLAUDE.md"), nByteBody(FIXTURE_BYTES), "utf8");
    writeConfig(tmpDir, VALID_PROJECT_YAML + VALID_STRICT_CONTEXT_YAML);
  });

  afterEach(() => cleanupDir(tmpDir));

  it("applies the operator's 5000-byte ceiling, producing a per-doc verdict the DEFAULT ceiling would not", () => {
    const result = runLore(["status", "--check-claude-md", "--json"], tmpDir);
    const bytes = rootHeadroom(result.stdout).bytes;

    // The operator's number, not the default it replaced.
    expect(bytes.ceiling).toBe(CONFIGURED_ROOT_MAX_BYTES);
    expect(bytes.used).toBe(FIXTURE_BYTES);
    expect(bytes.remaining).toBe(CONFIGURED_ROOT_MAX_BYTES - FIXTURE_BYTES);
    // ⛔ Load-bearing: under the 30720-byte SCHEMA DEFAULT this same file is
    // within budget. The breach verdict below therefore exists only because
    // the config was honoured — "the config was in effect" is proven, not assumed.
    expect(FIXTURE_BYTES).toBeLessThan(SCHEMA_DEFAULT_ROOT_MAX_BYTES);
    expect(result.exitCode).toBe(3);
  });

  it("reports budget_source 'config' and an explicitly null substitution", () => {
    const claudeMd = parseCheckJson(runLore(["status", "--check-claude-md", "--json"], tmpDir).stdout);

    expect(claudeMd.budget_source).toBe("config");
    // Always PRESENT, `null` included — an omitted key would let a consumer
    // read "absent" as "nothing was substituted" by accident.
    expect(claudeMd).toHaveProperty("budget_substitution");
    expect(claudeMd.budget_substitution).toBeNull();
  });

  it("emits no substitution notice on stderr", () => {
    expect(runLore(["status", "--check-claude-md"], tmpDir).stderr).not.toContain("SUBSTITUTED");
  });
});

// ─── Scenario 2 (NEGATIVE): the defect — unparseable `context`, defaults substituted ──

describe("check-claude-md: an unparseable `context` block is announced, never silently substituted", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("inverted-context");
    writeFileSync(join(tmpDir, "CLAUDE.md"), nByteBody(FIXTURE_BYTES), "utf8");
    writeConfig(tmpDir, VALID_PROJECT_YAML + INVERTED_CONTEXT_YAML);
  });

  afterEach(() => cleanupDir(tmpDir));

  it("names the substitution on stderr with two independent lone tokens", () => {
    const stderr = runLore(["status", "--check-claude-md"], tmpDir).stderr;

    // Token 1 — our own banner: a substitution happened.
    expect(stderr).toContain("SUBSTITUTED");
    // Token 2 — the zod path of the refusal contextConfigSchema raised, relayed
    // rather than swallowed. Independent origin, not a substring of token 1.
    expect(stderr).toContain("evict_threshold_fraction");
  });

  it("carries the substitution in the --json payload, so machine consumers can observe it too", () => {
    const claudeMd = parseCheckJson(runLore(["status", "--check-claude-md", "--json"], tmpDir).stdout);

    expect(claudeMd.budget_source).toBe("substituted-defaults");
    expect(claudeMd.budget_substitution).toContain("evict_threshold_fraction");
  });

  it("proves the substitution by the per-doc BYTE NUMBERS, never by the summary line", () => {
    const bytes = rootHeadroom(runLore(["status", "--check-claude-md", "--json"], tmpDir).stdout).bytes;

    // The operator asked for 5000; the check is running on 30720.
    expect(bytes.ceiling).toBe(SCHEMA_DEFAULT_ROOT_MAX_BYTES);
    expect(bytes.ceiling).not.toBe(CONFIGURED_ROOT_MAX_BYTES);
    expect(bytes.used).toBe(FIXTURE_BYTES);
  });

  it("keeps the exit-code contract intact — warn-and-proceed, so hooks/pre-push keeps its verdict", () => {
    // reason: `hooks/pre-push` blocks the push on any non-zero exit, and
    // `assets/hooks/stop-turn-review.mjs` finding (c) (which replaced the
    // retired `claude-md-guard.sh`) reads the --json headroom and treats an
    // unreadable report as "not measured". A refusal exit code would turn
    // "measured against the wrong budgets" into "not measured at all",
    // silently, at the surface whose whole job is to block. The notice above
    // is the signal; the exit code stays a measurement of the files.
    expect(runLore(["status", "--check-claude-md"], tmpDir).exitCode).toBe(0);
  });
});

// ─── Scenario 3 (BOUNDARY): valid config, no `context:` section ────────────

describe("check-claude-md: a valid config without a `context:` section", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("no-context-key");
    writeFileSync(join(tmpDir, "CLAUDE.md"), nByteBody(FIXTURE_BYTES), "utf8");
    writeConfig(tmpDir, VALID_PROJECT_YAML);
  });

  afterEach(() => cleanupDir(tmpDir));

  it("uses the schema defaults, reports source 'config', and stays silent", () => {
    const result = runLore(["status", "--check-claude-md", "--json"], tmpDir);
    const claudeMd = parseCheckJson(result.stdout);

    expect(claudeMd.budget_source).toBe("config");
    expect(claudeMd.budget_substitution).toBeNull();
    expect(rootHeadroom(result.stdout).bytes.ceiling).toBe(SCHEMA_DEFAULT_ROOT_MAX_BYTES);
    expect(result.exitCode).toBe(0);
    expect(runLore(["status", "--check-claude-md"], tmpDir).stderr).not.toContain("SUBSTITUTED");
  });
});

// ─── Scenario 4 (BOUNDARY): invalid ELSEWHERE, `context` still parses ──────

describe("check-claude-md: the config-only salvage path still salvages, and stays silent", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("salvage");
    writeFileSync(join(tmpDir, "CLAUDE.md"), nByteBody(FIXTURE_BYTES), "utf8");
    // No `project:` block at all → whole-LoreConfig validation fails, while the
    // `context:` block below is perfectly well-formed on its own.
    writeConfig(tmpDir, VALID_STRICT_CONTEXT_YAML);
  });

  afterEach(() => cleanupDir(tmpDir));

  it("applies the operator's ceiling from a config that fails validation everywhere else", () => {
    const result = runLore(["status", "--check-claude-md", "--json"], tmpDir);

    expect(parseCheckJson(result.stdout).budget_source).toBe("context-salvage");
    expect(rootHeadroom(result.stdout).bytes.ceiling).toBe(CONFIGURED_ROOT_MAX_BYTES);
    expect(result.exitCode).toBe(3);
  });

  it("says nothing about a substitution, because nothing was substituted", () => {
    const result = runLore(["status", "--check-claude-md"], tmpDir);

    expect(result.stderr).not.toContain("SUBSTITUTED");
    expect(parseCheckJson(runLore(["status", "--check-claude-md", "--json"], tmpDir).stdout).budget_substitution).toBeNull();
  });
});

// ─── Scenario 5 (ERROR + CONTROL b): no config at all is not an error ──────

describe("check-claude-md: an absent config is the legitimate default case", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("no-config");
    writeFileSync(join(tmpDir, "CLAUDE.md"), nByteBody(FIXTURE_BYTES), "utf8");
  });

  afterEach(() => cleanupDir(tmpDir));

  it("runs on the schema defaults, reports 'no-config', exits 0, and never warns", () => {
    const result = runLore(["status", "--check-claude-md", "--json"], tmpDir);

    expect(parseCheckJson(result.stdout).budget_source).toBe("no-config");
    expect(parseCheckJson(result.stdout).budget_substitution).toBeNull();
    expect(rootHeadroom(result.stdout).bytes.ceiling).toBe(SCHEMA_DEFAULT_ROOT_MAX_BYTES);
    expect(result.exitCode).toBe(0);

    const textRun = runLore(["status", "--check-claude-md"], tmpDir);
    expect(textRun.stderr).not.toContain("SUBSTITUTED");
    expect(textRun.exitCode).toBe(0);
  });
});

// ─── Scenario 6 (STATE): the PARALLEL consumer announces the same substitution ──

describe("lore context refresh: the second budget-resolution consumer is not left silent", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("context-verb");
    // `lore context` resolves its repo root via findLoreDbPath(), so this
    // scenario needs a real (throwaway) corpus. ⛔ Never the repo's own .lore/.
    const init = runLore(["init", "--name", "fixture", "--author", "fixture-author"], tmpDir);
    if (init.exitCode !== 0) throw new Error(`fixture setup failed: lore init exited ${init.exitCode}\n${init.stderr}`);
    writeFileSync(join(tmpDir, "CLAUDE.md"), nByteBody(FIXTURE_BYTES), "utf8");
    // `lore init` writes its own config.yaml — overwrite it with the unparseable one.
    writeConfig(tmpDir, VALID_PROJECT_YAML + INVERTED_CONTEXT_YAML);
  });

  afterEach(() => cleanupDir(tmpDir));

  it("announces the substituted budgets with the same two independent lone tokens", () => {
    const result = runLore(["context", "refresh"], tmpDir);

    expect(result.stderr).toContain("SUBSTITUTED");
    expect(result.stderr).toContain("evict_threshold_fraction");
  });

  it("stays silent when the same corpus carries a config that parses", () => {
    writeConfig(tmpDir, VALID_PROJECT_YAML + VALID_STRICT_CONTEXT_YAML);

    expect(runLore(["context", "refresh"], tmpDir).stderr).not.toContain("SUBSTITUTED");
  });
});
