// @spawns packages/lore/src/index.ts
/**
 * `lore outline` CLI regression pins AFTER the write retirement (slice 3a, BR-985).
 *
 * @spec_ref spec-080-prd-as-outline-contract-structured-outline-domain §C1; updated by
 *   spec-baseline-slice-3a-architecture-tree-baseline-root (Design "Outline", AC-BLS3-6).
 *
 * This suite began as the SPEC-080 T3r RED for `lore outline set | list | exempt`. `set`, `rm` and `exempt`
 * are now retired (exit 4, nothing written — pinned in depth by `cli/outline-retired.bun.test.ts`); what
 * this file keeps are the scenarios whose truth survives, now asserting the NEW behaviour:
 *   HAPPY      — `lore outline list` on a PRD with no outline exits 0 and says so (read verb intact).
 *   BOUNDARY   — an undeclared flag on a retired verb still exits 2 (SPEC-051 strict-flag seam fires
 *                before the verb body, so a mistyped retired invocation is a usage error, not a refusal).
 *   NEGATIVE   — `lore outline exempt <plan>` with NO `--reason` now exits 4 (the retirement refusal runs
 *                first), no longer 2.
 *   ERROR      — a direct `CorpusService.set` patch touching `extra.outline` is rejected VALIDATION_ERROR,
 *                the message naming the retirement and `lore baseline add` (no dead `lore outline set` hint).
 *
 * bun test (not vitest): spawns `bun run src/index.ts ...` (SOURCE mode) against a THROWAWAY corpus
 * (`mkdtemp` + `lore init`, cwd inside it). Never touches the repo's own `.lore/`.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createApp } from "../../src/app.js";
import type { DocPatch } from "@lore/core";
import { liveAmbient } from "../live-invocation.js";

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

// ─── HAPPY — `lore outline list` (read verb intact) ───────────────────────────

describe("HAPPY — lore outline list still reads (spec-baseline-slice-3a-architecture-tree-baseline-root#AC-BLS3-6)", () => {
  it("exits 0 and reports an empty outline on a fresh PRD", () => {
    const prdSlug = createPrd(tmpDir);

    const listResult = runLore(["outline", "list", prdSlug], tmpDir);

    expect(listResult.exitCode).toBe(0);
    expect(listResult.stdout).toContain("No outline entries");
  });
});

// ─── BOUNDARY — unknown flag on the retired `lore outline set` (SPEC-051 strict-flag seam) ─

describe("BOUNDARY — retired lore outline set with an undeclared flag still exits 2 (strict-flag seam)", () => {
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

describe("NEGATIVE — lore outline exempt <plan> with no --reason exits 4 (retired check runs first)", () => {
  it("exits 4 naming `lore baseline add`, not the former usage error 2", () => {
    const prdSlug = createPrd(tmpDir);
    const planSlug = createPlan(tmpDir, prdSlug);

    const result = runLore(["outline", "exempt", planSlug], tmpDir);

    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("lore baseline add");
  });
});

// ─── ERROR — direct CorpusService.set extra.outline patch is rejected ─────────

describe("ERROR — a direct CorpusService.set patch touching extra.outline is rejected (guard, AC-080-2 / BR-985)", () => {
  it("returns VALIDATION_ERROR naming the retirement and `lore baseline add`, never silently accepted", async () => {
    const prdSlug = createPrd(tmpDir);

    const app = createApp(dbPath(tmpDir), undefined, liveAmbient());
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
        expect(JSON.stringify(setResult.error)).toContain("lore baseline add");
      }
    } finally {
      app.close();
    }
  });
});
