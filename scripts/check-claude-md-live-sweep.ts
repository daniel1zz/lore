#!/usr/bin/env bun
/**
 * Live-repo sweep of the CLAUDE.md content dimensions — AC-EMPH-2 and AC-SLUG-2 of
 * `spec-claude-md-governance-content-dimension-checks-wire-the` (`bun scripts/check-claude-md-live-sweep.ts`).
 *
 * PURPOSE: assert that THIS repository's own memory files trip neither `emphasis_saturated` nor
 * `slug_pointer_missing`, and that the sweep actually walked more than zero memory files. These
 * checks read the repo's live `.lore/` corpus and memory-file tree, so they run here — from a
 * check script — rather than inside the unit suite (task-skill-test-tg-2). The positive controls
 * (a fixture that MUST trip each metric) stay in the vitest files
 * `packages/lore/tests/integration/claude-md-emphasis.test.ts` and `claude-md-slug-pointers.test.ts`,
 * which also drive THIS script against mkdtemp fixtures so the logic below is itself tested.
 *
 * Read-only: only `lore status --check-claude-md --json` and `lore status --check-memory-pointers
 * --json` are spawned; both are lints and write nothing.
 *
 * Usage: `bun scripts/check-claude-md-live-sweep.ts [--root <dir>]` — `--root` defaults to this
 * repository; tests pass a throwaway `lore init` corpus. The CLI under test is ALWAYS this
 * repository's own source entry, never `dist/lore`.
 *
 * Exit codes:
 *   0 — no emphasis_saturated / slug_pointer_missing finding (nor a downgraded copy of either)
 *       and the sweep walked >= 1 memory file.
 *   1 — at least one finding, or a vacuous sweep (zero memory files walked).
 *   2 — a precondition failed loudly (non-JSON output, bad argv). Never reported as clean.
 */
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LORE_ENTRY = join(SCRIPT_REPO_ROOT, "packages", "lore", "src", "index.ts");

export const EXIT_CLEAN = 0;
export const EXIT_VIOLATION = 1;
export const EXIT_PRECONDITION = 2;

/** One finding-shaped object found anywhere in a parsed `--json` payload. */
interface JsonFinding {
  kind?: unknown;
  [key: string]: unknown;
}

/**
 * Recursively collects every object whose `kind` equals `kind`. The `--check-memory-pointers`
 * envelope nests findings at a path this script deliberately does not pin.
 */
export function collectByKind(value: unknown, kind: string, out: JsonFinding[] = []): JsonFinding[] {
  if (Array.isArray(value)) {
    for (const item of value) collectByKind(item, kind, out);
  } else if (value !== null && typeof value === "object") {
    const record = value as JsonFinding;
    if (record.kind === kind) out.push(record);
    for (const nested of Object.values(record)) collectByKind(nested, kind, out);
  }
  return out;
}

/** `data.claude_md.headroom` length — the walked-file count, the sweep's non-vacuity witness. */
export function headroomCount(payload: unknown): number {
  const headroom = (payload as { data?: { claude_md?: { headroom?: unknown } } }).data?.claude_md?.headroom;
  return Array.isArray(headroom) ? headroom.length : 0;
}

function runStatusJson(root: string, flag: string): unknown {
  const res = spawnSync("bun", ["run", LORE_ENTRY, "status", flag, "--json"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    // reason: CLAUDECODE=1 keeps the CLI on its agent surface (no editor / AI nesting).
    env: { ...process.env, CLAUDECODE: "1" },
  });
  if (res.error !== undefined || res.status === null) {
    throw new Error(`lore status ${flag} --json did not complete: ${String(res.error?.message ?? res.signal)}`);
  }
  try {
    return JSON.parse(res.stdout);
  } catch (cause) {
    throw new Error(
      `lore status ${flag} --json produced non-JSON stdout (exit ${res.status}): ${res.stdout.slice(0, 300)} ${res.stderr.slice(0, 300)}`,
      { cause },
    );
  }
}

/** Pure verdict over the two parsed payloads: every violation as one line, empty when clean. */
export function violationsOf(claudeMd: unknown, pointers: unknown): string[] {
  const violations: string[] = [];
  const emphasis = collectByKind(claudeMd, "emphasis_saturated");
  if (emphasis.length > 0) violations.push(`emphasis_saturated: ${emphasis.length} finding(s) at the shipped default`);
  const slugs = collectByKind(pointers, "slug_pointer_missing");
  if (slugs.length > 0) violations.push(`slug_pointer_missing: ${slugs.length} finding(s)`);
  if (headroomCount(claudeMd) === 0) violations.push("vacuous sweep: --check-claude-md walked zero memory files");
  return violations;
}

function parseRoot(argv: readonly string[]): string {
  const i = argv.indexOf("--root");
  if (i === -1) return SCRIPT_REPO_ROOT;
  const value = argv[i + 1];
  if (value === undefined || value.startsWith("--")) throw new Error("--root requires a directory argument");
  return resolve(value);
}

export function main(argv: readonly string[]): number {
  let root: string;
  let claudeMd: unknown;
  let pointers: unknown;
  try {
    root = parseRoot(argv);
    claudeMd = runStatusJson(root, "--check-claude-md");
    pointers = runStatusJson(root, "--check-memory-pointers");
  } catch (e) {
    console.error(`check-claude-md-live-sweep: precondition failed — ${e instanceof Error ? e.message : String(e)}`);
    return EXIT_PRECONDITION;
  }
  const violations = violationsOf(claudeMd, pointers);
  if (violations.length > 0) {
    for (const v of violations) console.error(`check-claude-md-live-sweep: ${v}`);
    return EXIT_VIOLATION;
  }
  console.log(
    `check-claude-md-live-sweep: OK — ${headroomCount(claudeMd)} memory file(s) walked under ${root}; zero emphasis_saturated, zero slug_pointer_missing`,
  );
  return EXIT_CLEAN;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
