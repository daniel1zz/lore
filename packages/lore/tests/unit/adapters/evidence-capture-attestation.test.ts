// @spawns packages/lore/src/index.ts
/**
 * PRODUCTION WIRING oracle for SPEC-143 AC-CT-2 — "NO FALSE TRUST LABEL": zero
 * evidence rows may carry `capture_source: "runner"` without an `attestation`
 * block.
 *
 * WHY THIS FILE EXISTS (measured 2026-08-17): `lore evidence --capture` stamps
 * the `capture_source: "runner"` label and produces NO `attestation` block. An
 * implementer sincerely reported its pass as attested because the row said
 * `runner`; it had no second source to catch that with. A row that LOOKS
 * compliant is therefore more dangerous than a bare self-report, and the
 * A/B separation is total on this corpus: every `attestation` block came from
 * `lore verify`, never from `--capture`.
 *
 * ⛔ THIS FILE MUST DRIVE THE REAL CAPTURE PATH END TO END. AC-CT-2 is explicit
 * that "a schema inspection" and "a grep" do NOT satisfy it — the defect being
 * closed is a WRITE-THROUGH gap, not a missing measurement:
 * `src/adapters/evidence-capture.ts::captureOracleCommand` ALREADY measures
 * `spawnResult.status`, `elapsedMs` and its own timeout outcome, and the CLI
 * ALREADY forwards `captureSource`; nothing carries the measured numbers onto
 * the persisted row. So asserting anything about the SCHEMA, or about
 * `captureOracleCommand`'s in-memory return value, is exactly the false-green
 * this criterion exists to prevent — the numbers are measured today and still
 * never stored. Scenario 4 below makes that non-discrimination EXECUTABLE
 * rather than leaving it as prose.
 *
 * SUBPROCESS TARGET: `bun run <PACKAGE_ROOT>/src/index.ts` — the SOURCE entry —
 * never the bare `lore` binary and never `dist/lore`. The global `lore` symlink
 * points at the MAIN checkout's `dist/`, which does not carry this worktree's
 * diff; a `dist/lore` inside this worktree would ALSO be stale unless freshly
 * rebuilt. Spawning the source entry is the only way this oracle measures the
 * code actually changed in this diff, with zero build step. It is also what
 * keeps `bun:sqlite` OUT of the vitest process: `commands/evidence.ts`
 * transitively imports `loader.ts` → `app.ts` → `bun:sqlite`, which vitest
 * marks SSR-external and cannot resolve as a direct import. Mirrors
 * `ac-allow-missing-path-cli.test.ts`'s proven pattern for the same two reasons.
 *
 * Uses a throwaway `mkdtemp` + `lore init` corpus — NEVER this repo's own
 * `.lore/` (project CLAUDE.md hard rule; canonical pattern:
 * `packages/dashboard/tests/e2e/global-setup.ts`). `HOME` is redirected into the
 * temp dir so no user-level lore state is read or written either.
 *
 * COVERAGE — AC-CT-2's four declared scenarios, one `it` each:
 *   1. HAPPY — a PASSING oracle run recorded through the real `--capture` path
 *      stores `capture_source: "runner"` AND an `attestation` carrying a
 *      measured `exit_code` of exactly 0.
 *   2. STATE/BOUNDARY — the same run's `attestation` carries the elapsed time
 *      and the `timed_out` flag the adapter already measures, asserted
 *      DIFFERENTIALLY: two captures whose commands sleep ~0.05s and ~0.6s must
 *      yield `duration_ms` values that ORDER correctly, which no placeholder
 *      constant can satisfy. `timed_out` is asserted `=== false`, never
 *      falsy — `undefined` must not pass.
 *   3. NEGATIVE — a FAILING run (exit EXACTLY 3, deliberately not 1) still
 *      carries an `attestation` with that real code, so attestation presence
 *      is NOT conditional on success and the code is not a hard-coded 1.
 *   4. REGRESSION/ERROR — the schema-only inspection AC-CT-2 forbids is proven
 *      NON-DISCRIMINATING: `evidenceEntrySchema` returns the SAME verdict for a
 *      compliant row and for the false-trust row (runner label, no
 *      attestation), so only the driven row — identified by a runtime nonce
 *      that could only have come from a command this test spawned — decides.
 *
 * RED-FIRST NOTE: before the paired implementation lands, scenarios 1-4 fail on
 * their `attestation` assertions AFTER the row has been written and read back
 * with `capture_source: "runner"` — never on setup. Each attestation assertion
 * carries the full stored row in its failure message so the distinction between
 * "attestation absent" and "the test is malformed" is visible in the output
 * itself, not inferred.
 *
 * @spec_ref SPEC-143 AC-CT-2
 * @spec_ref task-skill-test-evidence-capture-attestation-red-test-scenarios
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { evidenceEntrySchema } from "@lore/core";
import { templatedFieldsArgs } from "../../helpers/templated-create.js";

// tests/unit/adapters/ → tests/unit/ → tests/ → packages/lore/
const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

/**
 * Floor for scenario 2's LONG capture, in ms. The command sleeps 0.6s; a 250ms
 * floor leaves >2x headroom for a loaded host while still refusing any
 * placeholder in the 0-100ms range. Deliberately loose — the DIFFERENTIAL
 * assertion (long > short) is what actually discriminates a measurement from a
 * constant, and it needs no threshold at all.
 */
const LONG_CAPTURE_FLOOR_MS = 250;

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Spawn `bun run <INDEX_TS> ...args` in `cwd` with an isolated HOME dir. */
function runLore(args: string[], cwd: string): RunResult {
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true" },
    encoding: "utf8",
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

/**
 * Runs a FIXTURE command and throws on any non-zero exit.
 *
 * Throwing here (rather than asserting) is deliberate: a setup failure must
 * read as an infrastructure error naming the failing command, so it can never
 * be mistaken for the "attestation is absent" red this file is written to
 * produce (the governing task's explicit RED-for-the-right-reason clause).
 */
function mustRun(args: string[], cwd: string): RunResult {
  const result = runLore(args, cwd);
  if (result.exitCode !== 0) {
    throw new Error(
      `FIXTURE FAILURE (not the assertion under test) — \`lore ${args.join(" ")}\` ` +
        `exited ${result.exitCode}: ${result.stderr || result.stdout}`,
    );
  }
  return result;
}

/** One persisted `verification_evidence` row, typed as it comes back off `--json`. */
interface StoredAttestation {
  readonly runner?: unknown;
  readonly exit_code?: unknown;
  readonly duration_ms?: unknown;
  readonly timed_out?: unknown;
}

interface StoredEvidenceRow {
  readonly oracle: string;
  readonly command: string;
  readonly result: string;
  readonly output_tail?: string;
  readonly recorded_at: string;
  readonly recorded_by: string;
  readonly capture_source?: string;
  readonly attestation?: StoredAttestation;
}

/** Reads a task's persisted evidence rows back through the real `lore get --json`. */
function readEvidenceRows(slug: string, cwd: string): StoredEvidenceRow[] {
  const got = mustRun(["get", slug, "--json"], cwd);
  const parsed = JSON.parse(got.stdout) as {
    data: { doc: { extra?: { verification_evidence?: StoredEvidenceRow[] } } };
  };
  return parsed.data.doc.extra?.verification_evidence ?? [];
}

/**
 * Creates a planless (`--adhoc`) task and returns its slug.
 *
 * `--ac-scope ""` is REQUIRED on the ad-hoc branch (an ad-hoc creation without
 * it exits 4). The ad-hoc shape deliberately sidesteps the plan→spec→ac-scope
 * chain: this file's subject is the capture write-through, not the task-create
 * or task-claim gates, which have their own coverage. Measured: `lore evidence`
 * needs no claim on the task, so no lease is taken either.
 */
function createAdhocTask(cwd: string, title: string): string {
  const created = mustRun(
    ["create", "task", "--title", title, "--kind", "code", "--adhoc", "--ac-scope", "", ...templatedFieldsArgs("task"), "--no-ai", "--json"],
    cwd,
  );
  return (JSON.parse(created.stdout) as { data: { slug: string } }).data.slug;
}

/** A per-run token that can only reach a stored `output_tail` via a REAL spawn. */
function nonce(): string {
  return `ac-ct-2-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * The failure message every `attestation` assertion carries.
 *
 * It prints the row VERBATIM, so a red from this file shows on its face that
 * the row was written and read back — labelled `runner` — and that only the
 * `attestation` block is missing. Without this, "attestation absent" and "the
 * test never got that far" are indistinguishable in the output.
 */
function attestationMissingMessage(label: string, row: StoredEvidenceRow): string {
  return (
    `AC-CT-2 (${label}): the row WAS written and read back with ` +
    `capture_source="${row.capture_source ?? "<absent>"}" but carries NO attestation block. ` +
    "A runner label with nothing behind it is the false trust label this criterion refuses. " +
    `Stored row: ${JSON.stringify(row)}`
  );
}

let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-evidence-capture-attestation-"));
  // 2 CLI spawns. An `--adhoc` task parents to the corpus root PRD
  // (CorpusService._createImpl), so one must exist before any task is created.
  mustRun(["init"], tmpDir);
  mustRun(["create", "prd", "--title", "AC-CT-2 Root", ...templatedFieldsArgs("prd"), "--no-ai"], tmpDir);
}, 60_000);

afterAll(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore cleanup errors */
  }
});

describe("PRODUCTION WIRING — lore evidence --capture must persist a real attestation (SPEC-143 AC-CT-2)", () => {
  // 3 CLI spawns (create task + evidence --capture + get --json).
  it(
    "scenario 1: a captured PASS row carries capture_source runner AND an attestation with a measured exit_code",
    { timeout: 60_000 },
    () => {
      const token = nonce();
      const slug = createAdhocTask(tmpDir, "AC-CT-2 captured pass");

      mustRun(
        [
          "evidence",
          slug,
          "--oracle",
          "test",
          "--command",
          `echo '${token} 1 passed'`,
          "--result",
          "pass",
          "--capture",
        ],
        tmpDir,
      );

      const rows = readEvidenceRows(slug, tmpDir);
      expect(rows).toHaveLength(1);
      const row = rows[0] as StoredEvidenceRow;

      // The write happened, and it happened through the RUNNER path — asserted
      // BEFORE the attestation check so a red below can only mean "the block is
      // absent", never "nothing was recorded".
      expect(row.capture_source).toBe("runner");
      // The tail is the CHILD's real output: the nonce was generated in this
      // process and never passed to the store — only a real spawn of the real
      // command could have carried it onto the row.
      expect(row.output_tail ?? "").toContain(token);

      expect(row.attestation, attestationMissingMessage("captured pass", row)).toBeDefined();
      expect(typeof row.attestation?.exit_code).toBe("number");
      // EXACTLY 0 — never "falsy", never "not undefined": a passing capture's
      // measured code is 0 and nothing else.
      expect(row.attestation?.exit_code).toBe(0);

      // Whatever the write path puts in the block must be a SCHEMA-VALID
      // attestation, not an ad-hoc object shape the rest of the codebase
      // cannot read. Asserted last so it never masks the presence check above.
      const reparsed = evidenceEntrySchema.safeParse(row);
      expect(reparsed.success, `stored row is not a valid EvidenceEntry: ${JSON.stringify(row)}`).toBe(
        true,
      );
    },
  );

  // 4 CLI spawns (create task + 2× evidence --capture + get --json).
  it(
    "scenario 2: attestation carries the measured elapsed time and timed_out flag, not placeholders",
    { timeout: 60_000 },
    () => {
      const token = nonce();
      const slug = createAdhocTask(tmpDir, "AC-CT-2 measured duration");

      // Two captures whose ONLY material difference is how long the child runs.
      // A placeholder `duration_ms` (0, or any constant) satisfies neither the
      // ordering assertion nor the floor; a real `elapsedMs` write-through
      // satisfies both. Measured on this repo: 64ms vs 610ms.
      for (const [label, sleepSeconds] of [
        ["short", "0.05"],
        ["long", "0.6"],
      ] as const) {
        mustRun(
          [
            "evidence",
            slug,
            "--oracle",
            "test",
            "--command",
            `sleep ${sleepSeconds}; echo '${token} ${label} 1 passed'`,
            "--result",
            "pass",
            "--capture",
          ],
          tmpDir,
        );
      }

      const rows = readEvidenceRows(slug, tmpDir);
      expect(rows).toHaveLength(2);
      // Selected by command content, never by array index — append order is not
      // this criterion's subject and must not be able to make it flap.
      const shortRow = rows.find((r) => r.command.includes("short")) as StoredEvidenceRow;
      const longRow = rows.find((r) => r.command.includes("long")) as StoredEvidenceRow;
      expect(shortRow, "the short capture row is missing").toBeDefined();
      expect(longRow, "the long capture row is missing").toBeDefined();

      expect(shortRow.capture_source).toBe("runner");
      expect(longRow.capture_source).toBe("runner");

      expect(shortRow.attestation, attestationMissingMessage("short capture", shortRow)).toBeDefined();
      expect(longRow.attestation, attestationMissingMessage("long capture", longRow)).toBeDefined();

      expect(typeof shortRow.attestation?.duration_ms).toBe("number");
      expect(typeof longRow.attestation?.duration_ms).toBe("number");

      const shortMs = shortRow.attestation?.duration_ms as number;
      const longMs = longRow.attestation?.duration_ms as number;
      expect(longMs).toBeGreaterThanOrEqual(LONG_CAPTURE_FLOOR_MS);
      // THE DISCRIMINATOR: a constant survives the floor above but never this.
      expect(
        longMs,
        `duration_ms did not order with real elapsed time (short=${JSON.stringify(shortRow.attestation?.duration_ms)}, long=${JSON.stringify(longRow.attestation?.duration_ms)}) — a placeholder constant looks exactly like this`,
      ).toBeGreaterThan(shortMs);

      // `=== false`, never falsy: an ABSENT flag is a missing measurement, and
      // the adapter already knows the answer on every successful capture.
      expect(shortRow.attestation?.timed_out).toBe(false);
      expect(longRow.attestation?.timed_out).toBe(false);
    },
  );

  // 3 CLI spawns (create task + evidence --capture + get --json).
  it(
    "scenario 3: a captured FAIL row still carries an attestation with the real non-zero exit code",
    { timeout: 60_000 },
    () => {
      const token = nonce();
      const slug = createAdhocTask(tmpDir, "AC-CT-2 captured fail");

      // Exit 3, deliberately NOT 1: a hard-coded "1" would be indistinguishable
      // from a measured failure code, and 1 is the value a placeholder would
      // most plausibly carry.
      mustRun(
        [
          "evidence",
          slug,
          "--oracle",
          "test",
          "--command",
          // RE-BASELINED (issue #53, BR-1077, AC-EH-8 i). ORIGINAL command:
          //   `echo '${token} 1 failed'; exit 3` — no runner summary at all, which the
          // captured-red proof now refuses (a red needs a recognised runner summary with
          // a failed test in the stored tail). The command now prints a vitest summary
          // failure line before exiting 3; exit code, attestation and token assertions
          // below are unchanged.
          `echo '${token}'; printf 'Tests  1 failed (1)\\n'; exit 3`,
          "--result",
          "fail",
          "--capture",
        ],
        tmpDir,
      );

      const rows = readEvidenceRows(slug, tmpDir);
      expect(rows).toHaveLength(1);
      const row = rows[0] as StoredEvidenceRow;

      expect(row.result).toBe("fail");
      expect(row.capture_source).toBe("runner");
      expect(row.output_tail ?? "").toContain(token);
      expect(row.output_tail ?? "").toContain("Tests  1 failed (1)");

      // Attestation presence must NOT be conditional on success.
      expect(row.attestation, attestationMissingMessage("captured fail", row)).toBeDefined();
      // EXACTLY 3 — the measured code, not "non-zero".
      expect(row.attestation?.exit_code).toBe(3);
      expect(row.attestation?.timed_out).toBe(false);
    },
  );

  // 3 CLI spawns (create task + evidence --capture + get --json).
  it(
    "scenario 4: a schema-only inspection returns the SAME verdict for a compliant and a false-trust row — only the driven row decides",
    { timeout: 60_000 },
    () => {
      const base = {
        oracle: "test",
        command: "echo probe",
        result: "pass",
        recorded_at: "2026-08-23T00:00:00.000Z",
        recorded_by: "agent:ct-t1-test-attest",
        capture_source: "runner",
      } as const;
      const falseTrustRow = { ...base };
      const compliantRow = {
        ...base,
        attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 5, timed_out: false },
      };

      const falseTrustVerdict = evidenceEntrySchema.safeParse(falseTrustRow).success;
      const compliantVerdict = evidenceEntrySchema.safeParse(compliantRow).success;

      // Both parse. The schema therefore CANNOT refuse a runner label with
      // nothing behind it — `attestation` is `.optional()` by construction, and
      // load-bearingly so (making it required would fail-close every array
      // holding one pre-SPEC-039 legacy row and silently zero a task's whole
      // evidence log).
      expect(falseTrustVerdict).toBe(true);
      expect(compliantVerdict).toBe(true);
      // ⛔ The point of this scenario: identical verdicts for the compliant and
      // the false-trust shape means a schema inspection has ZERO discriminating
      // power over AC-CT-2's property. Anything relying on it passes vacuously.
      expect(
        falseTrustVerdict,
        "the schema is expected to be NON-discriminating here; if it ever refuses the " +
          "false-trust shape, AC-CT-2's driven-wiring requirement should be re-examined, " +
          "not this assertion loosened",
      ).toBe(compliantVerdict);

      // THE ACTUAL DISCRIMINATOR: a row produced by the real capture path,
      // identified by a nonce that only a command this test spawned could have
      // put in the tail. This half is what the schema half cannot decide.
      const token = nonce();
      const slug = createAdhocTask(tmpDir, "AC-CT-2 driven row discriminates");
      mustRun(
        [
          "evidence",
          slug,
          "--oracle",
          "test",
          "--command",
          `echo '${token} 1 passed'`,
          "--result",
          "pass",
          "--capture",
        ],
        tmpDir,
      );

      const rows = readEvidenceRows(slug, tmpDir);
      expect(rows).toHaveLength(1);
      const drivenRow = rows[0] as StoredEvidenceRow;

      expect(drivenRow.capture_source).toBe("runner");
      expect(
        drivenRow.output_tail ?? "",
        "the stored tail does not carry this run's nonce — the row was not produced by a real spawn",
      ).toContain(token);
      expect(
        drivenRow.attestation,
        attestationMissingMessage("driven row (the schema half above passed vacuously)", drivenRow),
      ).toBeDefined();
      expect(typeof drivenRow.attestation?.exit_code).toBe("number");
    },
  );
});
