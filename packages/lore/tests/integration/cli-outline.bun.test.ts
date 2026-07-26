/**
 * @spec_ref spec-080-prd-as-outline-contract-structured-outline-domain
 *   §C1 (structured outline / `lore outline` verb family), §C4 (plan-close
 *   sync predicate + `lore outline exempt`); task
 *   task-skill-test-t3r-lore-outline-cli-red-scenarios (T3r RED),
 *   paired with task-skill-implement-t3-cli-command-group-lore-outline-set-list.
 *
 * bun test (not vitest): spawns `bun run src/index.ts ...` (SOURCE mode, not the
 * compiled `dist/lore` binary) against a THROWAWAY corpus (`mkdtemp` + `lore init`,
 * cwd inside it) — mirrors `cli-check-tree.bun.test.ts`'s harness, the closest
 * in-repo RED-phase-CLI template: source mode is fresh by construction (no
 * `bun run build` step needed before this suite is meaningful, unlike the
 * `dist/lore`-spawning siblings that need `assertFreshBinary`). ⛔ Never touches the
 * repo's own `.lore/` corpus (project CLAUDE.md hard rule) — every test operates
 * inside its own `mkdtempSync` directory.
 *
 * `lore outline` does not exist yet as of this writing (see
 * `packages/lore/src/adapters/cli/index.ts`'s `subCommands` map — no `outline` key).
 * Every `lore outline ...` invocation below therefore currently falls through
 * citty's own "Unknown command outline" handler (usage text + `ERROR  Unknown
 * command outline`, exit 1) instead of the SPEC-080 §C1/§C4-declared behavior each
 * test asserts — that mismatch (never a harness bug) IS the RED signal. The one
 * scenario that does NOT depend on the `outline` subcommand's existence (direct
 * `CorpusService.set` extra.outline patch rejection, T2's dedicated-writer guard)
 * is exercised in-process against the real store instead of over CLI flags — SPEC-080
 * §C1 explicitly frames this as "`CorpusService.set` rejects direct `extra.outline`
 * patches", i.e. a guard inside the ONE shared service every adapter (CLI/MCP/HTTP)
 * calls, not a CLI-flag-specific behavior; `commands/set.ts` has no generic `--extra`
 * flag to author this patch through the CLI surface directly (confirmed by reading
 * the file — only `--kind`/`--slug` merge single typed extra keys), so an in-process
 * `createApp` + `corpusService.set` call is the only way to exercise this half of
 * AC-080-2 from a CLI-package integration test (the OTHER half — the SAME guard's
 * own unit coverage — belongs to the sibling `outline-writer-guard.test.ts`, task
 * T2r; this is a CLI-package regression pin, not a duplicate authority).
 *
 * Coverage dimensions:
 *   HAPPY      — `lore outline set <prd> --section ... --title ... --tier ...
 *                --direction ...` exits 0, `lore outline list <prd>` shows the
 *                entry; a SECOND `outline set` on a different section leaves the
 *                first entry byte-identical (AC-080-2 "patches exactly one entry,
 *                not a wholesale array replace") — `lore outline exempt <plan>
 *                --reason "..."` exits 0 and the plan's `extra.prd_sync_exempt`
 *                carries `{reason, by, at}` (AC-080-4 CLI half).
 *   BOUNDARY   — `lore outline set` with an undeclared flag exits 2 (SPEC-051
 *                strict-flag seam every lazily-imported command inherits via
 *                `wrapCommandStrict`).
 *   NEGATIVE   — `lore outline exempt <plan>` with no `--reason` exits 2 (mirrors
 *                the required-reason convention `--failing-command`/
 *                `--failing-tail-file` and other CLI-usage-error flag pairs use).
 *   ERROR      — a direct `CorpusService.set` patch touching `extra.outline`
 *                (bypassing the dedicated `lore outline set` writer) is rejected
 *                `VALIDATION_ERROR`, message naming `lore outline` (AC-080-2
 *                dedicated-writer guard, T2's `CorpusService.set` half).
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createApp } from "../../src/app.js";
import type { DocPatch } from "@lore/core";

// ─── Types ──────────────────────────────────────────────────────────────────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

// ─── Paths ──────────────────────────────────────────────────────────────────

// tests/integration/ -> packages/lore/ (2 levels up).
const PROJECT_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PROJECT_ROOT, "src", "index.ts");

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Runs `bun run src/index.ts ...args` in `cwd` — SOURCE mode (always fresh, unlike
 * a spawned `dist/lore` binary, which needs `bun run build` first — not required
 * for this RED suite; see module header). `HOME` is overridden to `cwd` to isolate
 * global config files; `LORE_ACTOR` defaults to a fixed test actor so evidence/audit
 * rows and any `--by`-resolved fields are deterministic.
 */
function runLore(args: string[], cwd: string, extraEnv: Record<string, string> = {}): RunResult {
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, LORE_ACTOR: "agent:t3r-outline-cli-test", ...extraEnv },
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

function dbPath(dir: string): string {
  return join(dir, ".lore", "lore.db");
}

function parseSlug(stdout: string): string {
  const match = stdout.match(/Slug:\s+(\S+)/);
  const slug = match?.[1];
  if (slug === undefined) {
    throw new Error(`could not parse slug from create output: ${stdout}`);
  }
  return slug;
}

function createPrd(dir: string): string {
  const result = runLore(
    ["create", "prd", "--title", "T3r Outline RED PRD", "--content", "PRD body.", "--no-ai"],
    dir,
  );
  expect(result.exitCode).toBe(0);
  return parseSlug(result.stdout);
}

function createPlan(dir: string, prdSlug: string): string {
  const result = runLore(
    ["create", "plan", "--title", "T3r Outline RED Plan", "--parent", prdSlug, "--content", "Plan body.", "--no-ai"],
    dir,
  );
  expect(result.exitCode).toBe(0);
  return parseSlug(result.stdout);
}

// ─── Project-level state ──────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-cli-outline-"));
  initCorpus(tmpDir);
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

// ─── HAPPY — `lore outline set` + `lore outline list` (AC-080-2 CLI half) ─────

describe("HAPPY — lore outline set + list (AC-080-2 CLI half)", () => {
  it("`lore outline set <prd> --section ... --title ... --tier ... --direction ...` exits 0 and `lore outline list <prd>` shows the entry", () => {
    const prdSlug = createPrd(tmpDir);

    const setResult = runLore(
      [
        "outline",
        "set",
        prdSlug,
        "--section",
        "distribution",
        "--title",
        "Distribution Strategy",
        "--tier",
        "domain",
        "--direction",
        "Ship via npm and vendored assets.",
      ],
      tmpDir,
    );
    expect(setResult.exitCode).toBe(0);

    const listResult = runLore(["outline", "list", prdSlug], tmpDir);
    expect(listResult.exitCode).toBe(0);
    expect(listResult.stdout).toContain("distribution");
    expect(listResult.stdout).toContain("Distribution Strategy");
  });

  it("a SECOND outline set on a different section leaves the first entry byte-identical (single-entry CAS, not a wholesale array replace)", () => {
    const prdSlug = createPrd(tmpDir);

    const firstSet = runLore(
      [
        "outline",
        "set",
        prdSlug,
        "--section",
        "distribution",
        "--title",
        "Distribution Strategy",
        "--tier",
        "domain",
        "--direction",
        "Ship via npm and vendored assets.",
      ],
      tmpDir,
    );
    expect(firstSet.exitCode).toBe(0);

    const secondSet = runLore(
      [
        "outline",
        "set",
        prdSlug,
        "--section",
        "domain-taxonomy",
        "--title",
        "Domain Taxonomy",
        "--tier",
        "core",
        "--direction",
        "New first-class domain type deferred with revisit trigger.",
      ],
      tmpDir,
    );
    expect(secondSet.exitCode).toBe(0);

    const listResult = runLore(["outline", "list", prdSlug, "--json"], tmpDir);
    expect(listResult.exitCode).toBe(0);
    const payload = JSON.parse(listResult.stdout) as {
      data: Array<{ section: string; title: string; tier: string; direction: string }>;
    };
    expect(payload.data.length).toBe(2);

    const distributionEntry = payload.data.find((e) => e.section === "distribution");
    expect(distributionEntry).toBeDefined();
    expect(distributionEntry?.title).toBe("Distribution Strategy");
    expect(distributionEntry?.tier).toBe("domain");
    expect(distributionEntry?.direction).toBe("Ship via npm and vendored assets.");

    const taxonomyEntry = payload.data.find((e) => e.section === "domain-taxonomy");
    expect(taxonomyEntry).toBeDefined();
    expect(taxonomyEntry?.title).toBe("Domain Taxonomy");
  });

  it("`lore outline exempt <plan> --reason \"...\"` exits 0 and the plan's extra.prd_sync_exempt carries {reason, by, at}", () => {
    const prdSlug = createPrd(tmpDir);
    const planSlug = createPlan(tmpDir, prdSlug);

    const exemptResult = runLore(["outline", "exempt", planSlug, "--reason", "hotfix, sync deferred"], tmpDir);
    expect(exemptResult.exitCode).toBe(0);

    const getResult = runLore(["get", planSlug, "--json", "--raw"], tmpDir);
    expect(getResult.exitCode).toBe(0);
    const payload = JSON.parse(getResult.stdout) as {
      data: { doc: { extra: { prd_sync_exempt?: { reason: string; by: string; at: string } } } };
    };

    const exempt = payload.data.doc.extra.prd_sync_exempt;
    expect(exempt).toBeDefined();
    expect(exempt?.reason).toBe("hotfix, sync deferred");
    expect(exempt?.by).toBe("agent:t3r-outline-cli-test");
    // `at` must be a real ISO-8601 timestamp, not a placeholder/omitted field.
    expect(exempt?.at !== undefined && !Number.isNaN(Date.parse(exempt.at))).toBe(true);
  });
});

// ─── BOUNDARY — unknown flag on `lore outline set` (SPEC-051 strict-flag seam) ─

describe("BOUNDARY — lore outline set with an undeclared flag exits 2 (strict-flag seam)", () => {
  it("exits 2 naming the unknown option, never silently accepted or a stack trace", () => {
    const prdSlug = createPrd(tmpDir);

    const result = runLore(
      [
        "outline",
        "set",
        prdSlug,
        "--section",
        "distribution",
        "--title",
        "Distribution Strategy",
        "--tier",
        "domain",
        "--direction",
        "Ship via npm and vendored assets.",
        "--bogus-flag-xyz",
        "nope",
      ],
      tmpDir,
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Unknown option: --bogus-flag-xyz");
  });
});

// ─── NEGATIVE — `lore outline exempt` without --reason ────────────────────────

describe("NEGATIVE — lore outline exempt <plan> with no --reason exits 2", () => {
  it("exits 2 (a reason is required, mirroring the codebase's required-reason CLI-usage-error convention)", () => {
    const prdSlug = createPrd(tmpDir);
    const planSlug = createPlan(tmpDir, prdSlug);

    const result = runLore(["outline", "exempt", planSlug], tmpDir);

    expect(result.exitCode).toBe(2);
  });
});

// ─── ERROR — direct CorpusService.set extra.outline patch is rejected ─────────

describe("ERROR — a direct CorpusService.set patch touching extra.outline is rejected (dedicated-writer guard, AC-080-2)", () => {
  it("returns VALIDATION_ERROR naming `lore outline`, never silently accepted", async () => {
    const prdSlug = createPrd(tmpDir);

    const app = createApp(dbPath(tmpDir));
    try {
      const getResult = await app.corpusService.get(prdSlug);
      if (!getResult.ok) throw new Error(`prd get failed: ${JSON.stringify(getResult.error)}`);
      const existingExtra = getResult.value.doc.extra;

      const patch: DocPatch = {
        extra: {
          ...existingExtra,
          outline: [
            {
              section: "distribution",
              title: "Distribution Strategy",
              tier: "domain",
              direction: "Bypasses the dedicated writer verb.",
              decision_pointers: [],
              constraints: [],
              links: [],
            },
          ],
        },
      };

      const setResult = await app.corpusService.set(prdSlug, patch);

      expect(setResult.ok).toBe(false);
      if (!setResult.ok) {
        expect(setResult.error.code).toBe("VALIDATION_ERROR");
        expect(JSON.stringify(setResult.error)).toContain("lore outline");
      }
    } finally {
      app.close();
    }
  });
});
