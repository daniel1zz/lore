/**
 * T1 core-contracts tests for SPEC-072 (upstream issue reporting):
 *   - `feedback.upstream` config schema (`FeedbackConfigSchema`, `@lore/core`)
 *   - pure predicates `matchRootPrd` / `buildIssueReportExtra`
 *     (`@lore/core` — `packages/core/src/issue-report.ts`)
 *   - `LATEST_SCHEMA_VERSION` (the pure `schema-version.ts` module, imported
 *     WITHOUT touching `bun:sqlite` — this file runs under vitest)
 *
 * Runner: vitest (no `bun:sqlite` import anywhere in this file or its
 * transitive imports — `schema-version.ts` is deliberately bun:sqlite-free).
 *
 * Six-dimension coverage is spread across the four `-t`-filterable groups
 * below (each group's own JSDoc states which dimensions it covers) rather
 * than one dimension per top-level `describe` — the task's oracle scope is
 * per-group matched-count, not per-dimension.
 */

import { describe, it, expect } from "vitest";
import {
  FeedbackConfigSchema,
  LoreConfigSchema,
  matchRootPrd,
  buildIssueReportExtra,
  type IssueReportPayload,
} from "@lore/core";
import { LATEST_SCHEMA_VERSION } from "../../../src/store/schema-version.js";

// ─── feedback-schema ────────────────────────────────────────────────────────
// HAPPY: a fully-populated feedback.upstream config parses.
// NEGATIVE: an unknown key nested under feedback.upstream is rejected (strict).
describe("feedback-schema", () => {
  it("feedback-schema: parses a valid feedback.upstream config, and it wires into the root LoreConfigSchema", () => {
    const raw = {
      upstream: {
        corpus_path: "/Users/dev/upstream-repo",
        root_prd: "prd-lore-internal-first-ai-team-knowledge-platform",
      },
    };
    const result = FeedbackConfigSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      // reason: `upstream` is now a union of the legacy SQLite shape and the
      // GitHub shape (spec-the-defect-channel-reaches-no-machine-but-its-own-
      // github P2) — `raw` above is the legacy shape, so a presence check on
      // `corpus_path` narrows without weakening either assertion.
      const upstream = result.data.upstream;
      expect(upstream !== undefined && "corpus_path" in upstream).toBe(true);
      if (upstream !== undefined && "corpus_path" in upstream) {
        expect(upstream.corpus_path).toBe("/Users/dev/upstream-repo");
        expect(upstream.root_prd).toBe(
          "prd-lore-internal-first-ai-team-knowledge-platform",
        );
      }
    }

    // absence of feedback entirely is also valid (unconfigured, no consent yet)
    expect(FeedbackConfigSchema.safeParse({}).success).toBe(true);

    // and the root LoreConfigSchema accepts an optional `feedback` section
    const rootResult = LoreConfigSchema.safeParse({
      project: { name: "x", author: "y" },
      feedback: raw,
    });
    expect(rootResult.success).toBe(true);
  });

  it("feedback-schema: rejects an unknown key nested under feedback.upstream (strict)", () => {
    // ⛔ REWRITTEN (P4, spec-the-defect-channel-reaches-no-machine-but-its-
    // own-github): the ORIGINAL fixture used `transport: "http"` as its
    // "unknown key" probe, commented "P2 seam, not yet a real field — must
    // reject as a typo today". P4 makes `transport` a real (retired,
    // parses-but-ignored) field — `z.enum(["sqlite","http"]).optional()` on
    // `FeedbackConfigSchema`'s legacy branch, AC-GI-14 — so `{..., transport:
    // "http"}` now parses SUCCESSFULLY. Re-running the original assertion
    // against unchanged code (measured, confirmed): `expect(result.success
    // ).toBe(false)` fails with `expected true to be false`. This is a
    // correction, not a weakening: the STRICT-MODE property this case exists
    // to guard (an unrecognised key is still rejected) is unaffected by
    // retiring `transport` — the probe just needs a key that is STILL
    // genuinely unknown, so it now uses `totally_unrelated_typo` (mirroring
    // `transport-config-compat.test.ts`'s own NEGATIVE scenario, which pins
    // the identical strict-mode-survives-the-targeted-exemptions property).
    const withUnknownKey = {
      upstream: {
        corpus_path: "/Users/dev/upstream-repo",
        root_prd: "prd-x",
        totally_unrelated_typo: "oops",
      },
    };
    const result = FeedbackConfigSchema.safeParse(withUnknownKey);
    expect(result.success).toBe(false);

    // and an unknown TOP-LEVEL key under feedback itself is also rejected
    const withUnknownTopLevelKey = {
      upstream: { corpus_path: "/x", root_prd: "y" },
      extra_top_level_key: true,
    };
    expect(FeedbackConfigSchema.safeParse(withUnknownTopLevelKey).success).toBe(false);
  });
});

// ─── matchRootPrd ───────────────────────────────────────────────────────────
// HAPPY: match by slug; match by id.
// NEGATIVE: mismatch carries the found upstream slug.
// STATE: no upstream root doc at all (null) carries found: null.
describe("matchRootPrd", () => {
  const root = { id: "01ABCDEFGHJKMNPQRSTVWXYZ01", slug: "prd-lore" };

  it("matchRootPrd: matches when expected equals the upstream root's slug", () => {
    expect(matchRootPrd(root, "prd-lore")).toStrictEqual({ ok: true });
  });

  it("matchRootPrd: matches when expected equals the upstream root's id", () => {
    expect(matchRootPrd(root, "01ABCDEFGHJKMNPQRSTVWXYZ01")).toStrictEqual({ ok: true });
  });

  it("matchRootPrd: mismatch carries the found upstream slug in the failure result", () => {
    expect(matchRootPrd(root, "prd-some-other-project")).toStrictEqual({
      ok: false,
      found: "prd-lore",
    });
  });

  it("matchRootPrd: null upstream root carries found: null (empty/malformed upstream corpus)", () => {
    expect(matchRootPrd(null, "prd-lore")).toStrictEqual({ ok: false, found: null });
  });
});

// ─── buildIssueReportExtra (uncaptured by any grouped -t filter above, but
// still exercised — pins the payload-assembly contract without diluting the
// grouped matched counts, since it names none of the four required tokens) ──
describe("buildIssueReportExtra", () => {
  it("wraps the payload verbatim under extra.issue_report with adhoc: true and an EXPLICIT empty ac_scope", () => {
    const payload: IssueReportPayload = {
      reporter_project: "consumer-project-a",
      reporter_actor: "agent:x",
      lore_version: "0.5.0",
      expected: "exit 0",
      actual: "exit 4 VALIDATION_ERROR",
      reported_at: "2026-07-24T00:00:00.000Z",
      possible_duplicates: ["01ABC"],
    };
    const extra = buildIssueReportExtra(payload);
    // reason: task-the-ac-scope-re-keying-left-the-red-first-floor-unarmed face 2 —
    // this write site reaches `extra.adhoc: true` WITHOUT the CLI `--adhoc` flag
    // the ad-hoc `--ac-scope` requiredness is keyed on, so a report used to land
    // with the key ABSENT. It now declares the empty scope explicitly: a
    // reporting project genuinely claims no upstream criterion, and saying so is
    // an auditable decision rather than a silence.
    expect(extra).toStrictEqual({ adhoc: true, ac_scope: [], issue_report: payload });
    // Asserted as its own fact, independent of the whole-object comparison
    // above: an empty ARRAY, never `undefined` and never a synthesized fake id.
    expect(extra["ac_scope"]).toStrictEqual([]);
    expect(extra["ac_scope"]).not.toBeUndefined();
    // and it's a deep copy, not the same object reference (mutating input after
    // the call must not affect the built extra)
    expect(extra["issue_report"]).not.toBe(payload);
  });

  it("the declared scope is EMPTY, never derived from the payload — a reporting project cannot know the upstream's AC ids", () => {
    const extra = buildIssueReportExtra({
      reporter_project: "consumer-project-b",
      reporter_actor: "agent:y",
      lore_version: "0.5.0",
      // A description-shaped field that mentions an AC id must NOT be mined for one.
      expected: "AC-072-6 to hold",
      actual: "it did not",
      reported_at: "2026-07-24T00:00:00.000Z",
      possible_duplicates: [],
    });
    expect(extra["ac_scope"]).toStrictEqual([]);
    expect((extra["ac_scope"] as string[]).length).toBe(0);
  });

  it("carries repro_command through when present, and omits it when absent (optional field)", () => {
    const withRepro = buildIssueReportExtra({
      reporter_project: "p",
      reporter_actor: "a",
      lore_version: "0.5.0",
      repro_command: "lore create task --bad-flag",
      expected: "e",
      actual: "a",
      reported_at: "2026-07-24T00:00:00.000Z",
      possible_duplicates: [],
    });
    expect((withRepro["issue_report"] as IssueReportPayload).repro_command).toBe(
      "lore create task --bad-flag",
    );

    const withoutRepro = buildIssueReportExtra({
      reporter_project: "p",
      reporter_actor: "a",
      lore_version: "0.5.0",
      expected: "e",
      actual: "a",
      reported_at: "2026-07-24T00:00:00.000Z",
      possible_duplicates: [],
    });
    expect("repro_command" in (withoutRepro["issue_report"] as object)).toBe(false);
  });
});

// ─── LATEST_SCHEMA_VERSION ──────────────────────────────────────────────────
// STATE: the constant equals the highest migration number applied by
// sqlite-store.ts::runMigrations — confirmed by reading the migration chain
// directly (`if (currentVersion < N)` runs through migration-012 as of
// spec-issue-closure-loop-computed-resolution-agent-reachable's "resolves"
// link-type CHECK widening, so the ceiling is 12).
describe("LATEST_SCHEMA_VERSION", () => {
  it("LATEST_SCHEMA_VERSION equals 21 — the highest migration number in sqlite-store.ts's runMigrations chain", () => {
    expect(LATEST_SCHEMA_VERSION).toBe(34);
  });

  it("LATEST_SCHEMA_VERSION is importable without touching bun:sqlite (pure module)", () => {
    // this assertion is really about the IMPORT above succeeding at all under
    // vitest (which externalizes bun:sqlite) — if schema-version.ts ever grew
    // a bun:sqlite import, this whole test FILE would fail to load, not just
    // this one assertion.
    expect(typeof LATEST_SCHEMA_VERSION).toBe("number");
  });
});
