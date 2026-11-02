// @spawns packages/lore/src/index.ts
/**
 * @spec_ref spec-080-prd-as-outline-contract-structured-outline-domain
 *   AC-080-3: "lore create spec --kind domain-overview --parent <prd> passes the
 *   spec-create gate (exit 0); an unrecognized kind value exits 4."
 *
 * bun test (not vitest): spawns `bun run src/index.ts ...` (SOURCE mode, not the
 * compiled `dist/lore` binary) against a THROWAWAY corpus (`mkdtemp` + `lore init`,
 * cwd inside it) — mirrors `cli-outline.bun.test.ts`'s harness (the in-repo template
 * this AC's own test-authoring task pointed at): source mode is fresh by construction
 * (no `bun run build` step needed before this suite is meaningful). ⛔ Never touches
 * the repo's own `.lore/` corpus (project CLAUDE.md hard rule) — every test operates
 * inside its own `mkdtempSync` directory.
 *
 * `"domain-overview"` is a real member of `SPEC_KINDS` (`packages/core/src/spec-kind.ts`)
 * as of SPEC-080 T1 — `lore create spec --kind domain-overview` is expected to succeed
 * the same way `--kind design`/`--kind tech` already do (this is a GREEN oracle, the
 * behavior already landed; this file was simply never written, see the RED signal that
 * `bun test tests/integration/cli-domain-overview-kind.bun.test.ts` fails with "no test
 * files found" prior to this commit). An unrecognized `--kind` value is validated by
 * `createDocInputSchema`'s `specExtraSchema.safeParse` (`packages/core/src/schemas.ts`)
 * — CorpusService's `_createImpl` maps the resulting Zod issue to `VALIDATION_ERROR`
 * (`field: "extra.spec_kind"`), which the CLI's `exitCode()` maps to exit 4 and
 * `formatError()` renders as `Error: Validation failed on field 'extra.spec_kind': ...`.
 *
 * Coverage dimensions:
 *   HAPPY    — `lore create spec --kind domain-overview --parent <prd>` exits 0;
 *              `lore get --json` on the resulting doc shows `extra.spec_kind ===
 *              "domain-overview"`.
 *   NEGATIVE — `lore create spec --kind bogus --parent <prd>` exits 4, stderr names
 *              the `extra.spec_kind` validation failure.
 *   BOUNDARY — `lore create spec --kind design --parent <prd>` (a pre-existing kind)
 *              still exits 0 — the new taxonomy member does not disturb the old ones.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { templatedFieldsArgs } from "../helpers/templated-create.js";

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
 * here; see module header). `HOME` is overridden to `cwd` to isolate global config
 * files; `LORE_ACTOR` defaults to a fixed test actor so evidence/audit rows and any
 * `--by`-resolved fields are deterministic.
 */
function runLore(args: string[], cwd: string, extraEnv: Record<string, string> = {}): RunResult {
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, LORE_ACTOR: "agent:domain-overview-kind-cli-test", ...extraEnv },
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

function createPrd(dir: string): string {
  const result = runLore(
    ["create", "prd", "--title", "Domain-Overview Kind RED PRD", ...templatedFieldsArgs("prd", { refTarget: "problem" }), "--no-ai"],
    dir,
  );
  expect(result.exitCode).toBe(0);
  return parseSlug(result.stdout);
}

// ─── Project-level state ──────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-cli-domain-overview-kind-"));
  initCorpus(tmpDir);
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

// ─── HAPPY — --kind domain-overview passes the spec-create gate (AC-080-3) ────

describe("HAPPY — lore create spec --kind domain-overview --parent <prd> (AC-080-3)", () => {
  it("exits 0 and the created doc's extra.spec_kind is 'domain-overview'", () => {
    const prdSlug = createPrd(tmpDir);

    const createResult = runLore(
      [
        "create",
        "spec",
        "--kind",
        "domain-overview",
        "--title",
        "Domain Overview: Outline Contract",
        ...templatedFieldsArgs("spec", { kind: "domain-overview", refTarget: prdSlug }),
        "--no-ai",
      ],
      tmpDir,
    );
    expect(createResult.exitCode).toBe(0);

    const specSlug = parseSlug(createResult.stdout);
    const getResult = runLore(["get", specSlug, "--json", "--raw"], tmpDir);
    expect(getResult.exitCode).toBe(0);

    const payload = JSON.parse(getResult.stdout) as {
      data: { doc: { extra: { spec_kind?: string } } };
    };
    expect(payload.data.doc.extra.spec_kind).toBe("domain-overview");
  });
});

// ─── NEGATIVE — an unrecognized --kind value exits 4 (AC-080-3) ──────────────

describe("NEGATIVE — lore create spec --kind bogus --parent <prd> exits 4 (AC-080-3)", () => {
  it("exits 4 and stderr names the extra.spec_kind validation failure, never silently accepted", () => {
    const prdSlug = createPrd(tmpDir);

    const createResult = runLore(
      [
        "create",
        "spec",
        "--kind",
        "bogus",
        "--title",
        "Bogus Kind Spec",
        // reason: no template exists for the bogus kind, so the fields come from a real one; the refusal under test is the kind itself.
        ...templatedFieldsArgs("spec", { kind: "feature", refTarget: prdSlug }),
        "--no-ai",
      ],
      tmpDir,
    );

    expect(createResult.exitCode).toBe(4);
    expect(createResult.stderr).toContain("spec_kind");
  });
});

// ─── BOUNDARY — pre-existing --kind design still exits 0 (AC-080-3) ──────────

describe("BOUNDARY — lore create spec --kind design --parent <prd> still exits 0 (pre-existing kinds unbroken)", () => {
  it("exits 0 — the new domain-overview taxonomy member does not disturb existing kinds", () => {
    const prdSlug = createPrd(tmpDir);

    const createResult = runLore(
      [
        "create",
        "spec",
        "--kind",
        "design",
        "--title",
        "Design Kind Spec",
        ...templatedFieldsArgs("spec", { kind: "design", refTarget: prdSlug }),
        "--no-ai",
      ],
      tmpDir,
    );

    expect(createResult.exitCode).toBe(0);
  });
});
