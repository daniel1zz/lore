// @spawns packages/lore/src/index.ts
/**
 * AC-LG-11 / BR-1371 — command output is bounded: help fits the terminal width with no padding, an unknown
 * subcommand prints a short usage, `bootstrap` stays within 3 KB however many plans exist, `status` prints
 * list-shaped findings as counts, and `list --json` caps its rows.
 *
 * Dimensions: HAPPY (help fits, bootstrap short), NEGATIVE (unknown command is short, not the full help), BOUNDARY
 * (200 vs 201 rows; 8 vs 9 busy plans), REGRESSION (explicit --limit unaffected, small listings unchanged),
 * ERROR (width fitting never emits a line over the width).
 *
 * @spec_ref AC-LG-11
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { formatBootstrapReport, BOOTSTRAP_MAX_BYTES } from "../../src/adapters/cli/commands/bootstrap.js";
import { boundedJsonPage, DEFAULT_JSON_LIMIT } from "../../src/adapters/cli/list-json-page.js";
import { fitUsageToWidth, formatUnknownCommandUsage } from "../../src/adapters/cli/usage-render.js";

const ENTRY = new URL("../../src/index.ts", import.meta.url).pathname;
const WIDTH = 100;

function runLore(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const home = mkdtempSync(join(tmpdir(), "ctxb-"));
  const env = { ...process.env, HOME: home, CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "bc4a5e57-aaaa-bbbb-cccc-111111111111" };
  delete (env as Record<string, string | undefined>)["COLUMNS"];
  const proc = Bun.spawnSync(["bun", "run", ENTRY, ...args], { cwd: home, env });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function plan(slug: string, ready: number, claimed: number) {
  return {
    slug,
    title: `Plan ${slug} with a fairly long descriptive title that used to be printed in full`,
    task_counts: { ready, claimed, done: 3 },
    last_activity_at: "2026-10-01T00:00:00.000Z",
  };
}

function report(plans: ReturnType<typeof plan>[], handoffCount: number) {
  return {
    root: { slug: "root", title: "Root" },
    architecture: null,
    active_plans: plans,
    pending_reviews: { count: 535, slugs: Array.from({ length: 40 }, (_, i) => `pending-review-slug-number-${i}`) },
    my_claims: [],
    armed_gates: [],
    latest_handoffs: Array.from({ length: handoffCount }, (_, i) => ({
      plan_slug: `plan-${i}`,
      handoff_slug: `handoff-${i}`,
      by: "agent:session-aaaaaaaa",
      at: "2026-10-01T00:00:00.000Z",
    })),
    resume_hint: { plan_slug: "plan-7", handoff_slug: "handoff-7" },
    corpus: { total_docs: 900, last_updated: "2026-10-01", open_stale_candidates: 0, code_anchor_specs: 0 },
    plan_acceptance: { summary: { complete: 0, awaitingReview: 0, awaitingOwner: 0, oldestAgeMs: null }, complete_slugs: [] },
  } as never;
}

describe("AC-LG-11 bounded output", () => {
  it("bounded output: lore --help has no line over 100 columns and no trailing padding", () => {
    const r = runLore(["--help"]);
    expect(r.exitCode, r.stderr).toBe(0);
    const lines = r.stdout.split("\n");
    expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(WIDTH);
    expect(lines.filter((l) => /\s$/.test(l))).toEqual([]);
    expect(r.stdout.length).toBeLessThan(30_000);
  });

  it("bounded output: lore migrate --help still carries the per-action detail, fitted to the width", () => {
    const r = runLore(["migrate", "--help"]);
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stdout).toContain("audit-backfill");
    expect(Math.max(...r.stdout.split("\n").map((l) => l.length))).toBeLessThanOrEqual(WIDTH);
  });

  it("bounded output: an unknown subcommand prints its usage line and a --help pointer in under 600 bytes", () => {
    for (const args of [["bogus-command"], ["phase", "bogus-sub"]]) {
      const r = runLore(args);
      expect(r.exitCode).toBe(1);
      const text = r.stdout + r.stderr;
      expect(Buffer.byteLength(text)).toBeLessThanOrEqual(600);
      expect(text).toContain("--help");
      expect(text).toContain("Usage: lore");
    }
    expect(formatUnknownCommandUsage(["phase"], "Unknown command bogus")).toContain("lore phase --help");
  });

  it("bounded output: fitUsageToWidth wraps an over-wide row under its description column (boundary and error)", () => {
    const row = `  \`name\`    ${"word ".repeat(60)}${" ".repeat(500)}`;
    const fitted = fitUsageToWidth(row, 60).split("\n");
    expect(Math.max(...fitted.map((l) => l.length))).toBeLessThanOrEqual(60);
    expect(fitted.length).toBeGreaterThan(1);
    expect(fitted.some((l) => /\s$/.test(l))).toBe(false);
    expect(fitted[1]?.startsWith("            ")).toBe(true);
    // a row that already fits is untouched apart from trailing spaces
    expect(fitUsageToWidth("  short row   ", 60)).toBe("  short row");
  });

  it("bounded output: bootstrap with 60 plans (40 idle) and 25 handoffs stays within 3 KB and counts idle plans", () => {
    const plans = [
      ...Array.from({ length: 20 }, (_, i) => plan(`plan-busy-with-a-long-slug-number-${i}`, 2, 1)),
      ...Array.from({ length: 40 }, (_, i) => plan(`plan-idle-with-a-long-slug-number-${i}`, 0, 0)),
    ];
    const text = formatBootstrapReport(report(plans, 25), "agent:session-bbbbbbbb");
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(BOOTSTRAP_MAX_BYTES);
    expect(text).toContain("60; 40 idle");
    expect(text).not.toContain("plan-idle-with-a-long-slug-number-0");
    expect(text).toContain("(+12 more busy plans");
    expect(text).toContain("Pending reviews: 535");
    expect(text).not.toContain("pending-review-slug-number-0");
    // the seat's own handoff plus the newest three, not all 25
    expect(text).toContain("Latest handoffs (4 of 25)");
    expect(text).toContain("handoff-7");
    expect(text).not.toContain("handoff-20");
  });

  it("bounded output: bootstrap with exactly 8 busy plans names them all and adds no 'more' line (boundary)", () => {
    const plans = Array.from({ length: 8 }, (_, i) => plan(`plan-${i}`, 1, 0));
    const text = formatBootstrapReport(report(plans, 2), "agent:session-bbbbbbbb");
    expect(text).not.toContain("more busy plans");
    expect(text).toContain("plan-7 —");
  });

  it("bounded output: list --json caps at 200 rows with truncated and the full total; an explicit limit is untouched", () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({ id: i }));
    const capped = boundedJsonPage(rows, undefined);
    expect(capped.docs).toHaveLength(DEFAULT_JSON_LIMIT);
    expect(capped).toMatchObject({ total: 250, truncated: true, limit: 200 });
    const explicit = boundedJsonPage(rows, 250);
    expect(explicit.docs).toHaveLength(250);
    expect("truncated" in explicit).toBe(false);
    const exactly = boundedJsonPage(rows.slice(0, 200), undefined);
    expect(exactly.docs).toHaveLength(200);
    expect("truncated" in exactly).toBe(false);
  });
});
