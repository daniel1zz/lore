/**
 * Unit + repo-state suite for the EVICTION FLOOR — the third band added to
 * `packages/lore/src/service/claude-md-check.ts`'s `lintMemoryFiles`
 * (task-a-module-claude-md-at-its-byte-ceiling-silently-relocates).
 *
 * WHY THIS EXISTS. `warn_threshold_fraction` (0.9) produced an ADVISORY-only
 * warning. Four module docs sat in that band for an unknown number of
 * sessions and the count went UP, not down: `service/CLAUDE.md` was
 * compressed to 10548 bytes on 2026-07-27 and was back at 16374/16384 (10
 * bytes of runway) ten days later. At zero runway the ceiling guard blocks
 * the ONE correct write — recording a new service module in the service doc —
 * so the fact gets recorded in a NEIGHBOURING module's doc instead:
 * `service/anchor-resolution.ts` is documented in `packages/core/src`,
 * `adapters/cli` and `adapters/mcp` and is ABSENT from `service/`'s own doc.
 * An advisory nobody is obligated to act on is what produced that state, so
 * the floor is DETERMINISTIC and exit-relevant: it rides `lintMemoryFiles`,
 * the single seam `lore status --check-claude-md`'s exit code, the
 * `claude-md-guard.sh` PostToolUse hook, `hooks/pre-push`, and
 * `flows/context-flow.ts`'s pre-write admission all already consume.
 *
 * RED BASELINE (this file is authored BEFORE the implementation). Against
 * HEAD without the change:
 *   - every `eviction_required` scenario fails, because `lintMemoryFiles`
 *     emits only `max_lines`/`max_bytes` and `budgets.evict_threshold_fraction`
 *     is `undefined` (missing feature, not a test bug);
 *   - the two REPO-STATE scenarios fail on measured numbers: `service` 16374
 *     and `store` 16255 both sit above the module floor, and
 *     `grep -c anchor-resolution service/CLAUDE.md` is 0.
 *
 * BAND ORDERING. The three bands are ordered and mutually exclusive per
 * metric: below `warn_threshold_fraction` silent; `[warn, evict)` advisory
 * (`computeHeadroomWarnings`, unchanged, never exit-relevant); `[evict,
 * ceiling]` deterministic `eviction_required`; `> ceiling` the pre-existing
 * `max_lines`/`max_bytes` breach, which SUPPRESSES `eviction_required` for
 * that same metric so a breach never double-reports (the REGRESSION case
 * below pins that a file over both ceilings still yields exactly the two
 * historical findings).
 *
 * Coverage dimensions: HAPPY (a comfortably-small file stays silent) /
 * NEGATIVE (a file in the advisory band alone produces NO deterministic
 * finding — the floor must not collapse into "always fires") / BOUNDARY
 * (exactly at the floor fires, one byte under does not; exactly at the
 * ceiling still fires as eviction, one byte over flips to a breach) / ERROR
 * (empty input, empty content) / STATE (`enabled: false` short-circuits) /
 * REGRESSION (`max_lines`/`max_bytes` findings and `computeHeadroom`'s
 * advisory band are byte-identical to before; a breach does not
 * double-report) / CONFIGURATION (the fraction comes from `budgets`, never a
 * module constant — a custom fraction measurably moves the boundary, and an
 * inverted pair is refused at config-parse time) / REPO STATE (the four
 * anchored docs clear the floor, and the displaced `anchor-resolution.ts`
 * entry actually landed).
 *
 * @spec_ref task-a-module-claude-md-at-its-byte-ceiling-silently-relocates
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { resolveMemoryFileBudgets, contextConfigSchema, type MemoryFileBudgets } from "@lore/core";
import {
  computeHeadroom,
  computeHeadroomWarnings,
  lintMemoryFiles,
  type MemoryFileRecord,
} from "../../../src/service/claude-md-check.js";

// ─── Fixture builder (same convention as claude-md-check/headroom suites) ───

/** Text with an EXACT line count and an EXACT `Buffer.byteLength`, ASCII-padded. */
function buildFixture(lineCount: number, byteCount: number): string {
  const rows: string[] = [];
  for (let i = 1; i <= lineCount; i++) rows.push(`Line ${i}: standing discipline entry, not a status narrative.`);
  let content = rows.join("\n") + "\n";
  const baseBytes = Buffer.byteLength(content, "utf8");
  if (baseBytes > byteCount) {
    throw new Error(`buildFixture: base content (${baseBytes} bytes) exceeds requested byteCount (${byteCount})`);
  }
  const deficit = byteCount - baseBytes;
  if (deficit > 0) content = content.slice(0, -1) + "x".repeat(deficit) + "\n";
  return content;
}

const budgets: MemoryFileBudgets = resolveMemoryFileBudgets(undefined);

/** Smallest byte size that trips the MODULE byte floor, derived from config — never a literal. */
function moduleByteFloor(b: MemoryFileBudgets): number {
  return Math.ceil(b.module.max_bytes * b.evict_threshold_fraction);
}

/** One module-role record holding `bytes` bytes on a single-digit line count (lines stay far from their own bands). */
function moduleFile(bytes: number, path = "packages/x/CLAUDE.md"): MemoryFileRecord {
  return { path, role: "module", content: buildFixture(4, bytes) };
}

describe("lintMemoryFiles — eviction floor (deterministic, exit-relevant)", () => {
  it("HAPPY: a comfortably-small module file produces zero findings of any kind", () => {
    const findings = lintMemoryFiles([moduleFile(2000)], budgets);
    expect(findings).toEqual([]);
  });

  it("NEGATIVE/CONTROL: a file in the ADVISORY band only (>=warn, <evict) produces NO deterministic finding", () => {
    // Sits above warn_threshold_fraction but below evict_threshold_fraction —
    // the band that must stay advisory-only. Guards against the floor
    // degrading into "any near-ceiling file blocks", which would make the
    // whole three-band design collapse back into one.
    const bytes = Math.ceil(budgets.module.max_bytes * budgets.warn_threshold_fraction) + 1;
    expect(bytes).toBeLessThan(moduleByteFloor(budgets));

    const file = moduleFile(bytes);
    expect(lintMemoryFiles([file], budgets)).toEqual([]);
    // ...and the advisory layer DOES still see it (proving the fixture really
    // is in the near-ceiling band, not merely small).
    expect(computeHeadroomWarnings(computeHeadroom([file], budgets)).length).toBeGreaterThan(0);
  });

  it("BOUNDARY: exactly AT the byte floor fires eviction_required; one byte under stays silent", () => {
    const floor = moduleByteFloor(budgets);

    const atFindings = lintMemoryFiles([moduleFile(floor)], budgets);
    expect(atFindings).toHaveLength(1);
    const at = atFindings[0];
    expect(at?.kind).toBe("eviction_required");
    expect(at?.role).toBe("module");
    expect(at?.measured).toBe(floor);
    expect(at?.ceiling).toBe(budgets.module.max_bytes);
    expect(at?.path).toBe("packages/x/CLAUDE.md");

    expect(lintMemoryFiles([moduleFile(floor - 1)], budgets)).toEqual([]);
  });

  it("BOUNDARY: exactly AT the ceiling is eviction_required, not a breach; one byte OVER flips to max_bytes", () => {
    const ceiling = budgets.module.max_bytes;

    const atCeiling = lintMemoryFiles([moduleFile(ceiling)], budgets);
    expect(atCeiling.map((f) => f.kind)).toEqual(["eviction_required"]);

    const overCeiling = lintMemoryFiles([moduleFile(ceiling + 1)], budgets);
    expect(overCeiling.map((f) => f.kind)).toEqual(["max_bytes"]);
  });

  it("BOUNDARY: the floor is measured per METRIC — a line-only saturation reports lines, bytes stay silent", () => {
    const lineFloor = Math.ceil(budgets.module.max_lines * budgets.evict_threshold_fraction);
    // Lines in the eviction band, bytes deliberately below their own floor
    // (0.75 of the byte ceiling still comfortably accommodates `lineFloor`
    // rows of filler, which 0.5 does not).
    const byteTarget = Math.ceil(budgets.module.max_bytes * 0.75);
    expect(byteTarget).toBeLessThan(moduleByteFloor(budgets));
    const content = buildFixture(lineFloor, byteTarget);
    const findings = lintMemoryFiles([{ path: "m/CLAUDE.md", role: "module", content }], budgets);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("eviction_required");
    expect(findings[0]?.measured).toBe(lineFloor);
    expect(findings[0]?.ceiling).toBe(budgets.module.max_lines);
    expect(findings[0]?.message).toContain("max_lines");
  });

  it("BOUNDARY: each ROLE uses its OWN floor — the module floor never governs a root file", () => {
    // A byte count that trips the MODULE floor but is nowhere near the looser
    // root ceiling: the same content must fire as module and stay silent as root.
    const bytes = moduleByteFloor(budgets);
    expect(bytes).toBeLessThan(Math.ceil(budgets.root.max_bytes * budgets.evict_threshold_fraction));

    const content = buildFixture(4, bytes);
    expect(lintMemoryFiles([{ path: "m/CLAUDE.md", role: "module", content }], budgets)).toHaveLength(1);
    expect(lintMemoryFiles([{ path: "CLAUDE.md", role: "root", content }], budgets)).toEqual([]);
  });

  it("STATE: budgets.enabled=false short-circuits the floor exactly as it does the ceilings", () => {
    const disabled: MemoryFileBudgets = { ...budgets, enabled: false };
    expect(lintMemoryFiles([moduleFile(budgets.module.max_bytes)], disabled)).toEqual([]);
  });

  it("ERROR: an empty files array and an empty-content file neither throw nor fabricate a finding", () => {
    expect(lintMemoryFiles([], budgets)).toEqual([]);
    expect(lintMemoryFiles([{ path: "m/CLAUDE.md", role: "module", content: "" }], budgets)).toEqual([]);
  });

  it("REGRESSION: a file over BOTH ceilings still yields exactly the two historical breach findings", () => {
    // The pre-existing contract (claude-md-check.test.ts's own REGRESSION
    // case): both metrics measured independently, two findings, no eviction
    // row added on top — a breach suppresses the floor for that metric.
    const content = buildFixture(budgets.root.max_lines + 1, budgets.root.max_bytes + 1);
    const findings = lintMemoryFiles([{ path: "CLAUDE.md", role: "root", content }], budgets);

    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.kind).sort()).toEqual(["max_bytes", "max_lines"]);
  });

  it("REGRESSION: the advisory band is untouched — computeHeadroom still reports warn on a near-ceiling file", () => {
    const file = moduleFile(budgets.module.max_bytes - 5);
    const [report] = computeHeadroom([file], budgets);
    expect(report?.bytes.remaining).toBe(5);
    expect(report?.bytes.warn).toBe(true);
  });

  it("CONFIGURATION: the fraction comes from budgets — a looser custom value measurably moves the boundary", () => {
    // Same content, two configs: silent under the default floor, firing under
    // a deliberately loose one. Proves no module-level constant is consulted.
    const bytes = Math.ceil(budgets.module.max_bytes * 0.5);
    const file = moduleFile(bytes);

    expect(lintMemoryFiles([file], budgets)).toEqual([]);

    const loose: MemoryFileBudgets = { ...budgets, evict_threshold_fraction: 0.4 };
    expect(lintMemoryFiles([file], loose).map((f) => f.kind)).toEqual(["eviction_required"]);
  });

  it("NEGATIVE: an inverted band pair (evict <= warn) is refused at config-parse time, never silently clamped", () => {
    // A floor at or below the advisory threshold would make the advisory band
    // empty and unreachable — a silent semantic inversion. Fail loud instead.
    const inverted = contextConfigSchema.safeParse({
      memory_files: { warn_threshold_fraction: 0.9, evict_threshold_fraction: 0.9 },
    });
    expect(inverted.success).toBe(false);

    const ordered = contextConfigSchema.safeParse({
      memory_files: { warn_threshold_fraction: 0.5, evict_threshold_fraction: 0.6 },
    });
    expect(ordered.success).toBe(true);
  });

  it("CONFIGURATION: the default floor sits strictly between the advisory band and the ceiling", () => {
    expect(budgets.evict_threshold_fraction).toBeGreaterThan(budgets.warn_threshold_fraction);
    expect(budgets.evict_threshold_fraction).toBeLessThanOrEqual(1);
  });
});

// ─── REPO STATE — the realized harm, and the four anchored docs ─────────────
// These read the repo's OWN memory files. They are the assertions the task's
// oracle names: per-doc BYTE NUMBERS, never a "0 findings" summary line (the
// summary was already green while the defect was live, so a summary-only
// assertion proves nothing).

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");

/** The four docs this task is anchored to, repo-relative. */
const ANCHORED_MODULE_DOCS = [
  "packages/lore/src/service/CLAUDE.md",
  "packages/lore/src/store/CLAUDE.md",
  "packages/lore/src/ai/CLAUDE.md",
  "packages/lore/src/adapters/http/CLAUDE.md",
] as const;

describe("repo state — the four anchored module docs", () => {
  it.each(ANCHORED_MODULE_DOCS)("%s clears the eviction floor with runway to spare", (relPath) => {
    const content = readFileSync(join(REPO_ROOT, relPath), "utf8");
    const used = Buffer.byteLength(content, "utf8");
    const floor = moduleByteFloor(budgets);

    // Asserted on the NUMBER, so the failure message names the real margin.
    expect({ path: relPath, used, floor, ceiling: budgets.module.max_bytes }).toMatchObject({ path: relPath });
    expect(used).toBeLessThan(floor);

    // ...and the deterministic oracle agrees, from the same measurement seam.
    expect(lintMemoryFiles([{ path: relPath, role: "module", content }], budgets)).toEqual([]);
  });

  it("REGRESSION (the realized harm): service/CLAUDE.md records its own anchor-resolution.ts module", () => {
    // `grep -c anchor-resolution packages/lore/src/service/CLAUDE.md` -> 0 at
    // HEAD before this task: a merged SERVICE-layer module documented in three
    // OTHER module docs and absent from its own. This is the displacement the
    // eviction floor exists to stop recurring.
    const servicePath = "packages/lore/src/service/CLAUDE.md";
    const content = readFileSync(join(REPO_ROOT, servicePath), "utf8");
    expect(content).toContain("anchor-resolution.ts");
  });

  it("CONTROL: the floor is not vacuous — the pre-fix service doc size WOULD have tripped it", () => {
    // Negative control for the assertion above: had the floor been armed at
    // the measured pre-fix size (16374 bytes on a 16384-byte module ceiling),
    // it would have fired. Without this, "the docs clear the floor" could pass
    // simply because the floor is unreachable.
    const preFixServiceBytes = 16374;
    const findings = lintMemoryFiles(
      [{ path: "packages/lore/src/service/CLAUDE.md", role: "module", content: buildFixture(4, preFixServiceBytes) }],
      budgets,
    );
    expect(findings.map((f) => f.kind)).toEqual(["eviction_required"]);
  });
});
