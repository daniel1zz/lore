/**
 * `lore get` structured-`extra` loss-notice projection tests
 * (task-lore-get-s-default-render-silently-omits-structured-extra, AC-1..AC-6).
 *
 * The defect under test: `lore get <slug>`'s human render printed `content` + Navigation
 * and DROPPED every structured `extra` value (`issue_report`'s
 * `expected`/`actual`/`repro_command`, `file_anchors`, `verification_evidence`, …) with NO
 * marker that anything was withheld — a reader could not distinguish "this doc has no
 * `extra`" from "this doc's `extra` was not shown". Measured cost:
 * `knowledge-lore-get-s-human-view-hides-extra-issue-report-so-a`.
 *
 * Unit under test is the PURE trio in `src/adapters/cli/get-render.ts`
 * (`findExtraKeysAlreadyRendered` / `findHiddenStructuredExtra` /
 * `formatStructuredExtraNotice`) plus a source-text WIRING assertion against
 * `commands/get.ts` — that command file transitively imports `loader.ts` → `bun:sqlite`,
 * which vitest cannot resolve, so it can never be imported here (same constraint
 * documented on `assess-render.ts` / `handoff-input.ts`). The end-to-end proof that the
 * notice reaches real stdout, and that `--json` gained no bytes, lives in
 * `cli-get-structured-extra.bun.test.ts`, which spawns the compiled binary. A pure-unit
 * suite alone would pass against a render function that is never called — the
 * silently-inert false-oracle vector.
 *
 * ⛔ Assertions key on INDEPENDENT LONE TOKENS (`issue_report`, `repro_command`,
 * `--json`, the doc slug), never on one remembered sentence: a contiguous-substring
 * matcher degrades silently to no-match when the wording is reflowed (root CLAUDE.md
 * standing lesson).
 *
 * Coverage:
 *   HAPPY:      AC-1 — a doc carrying `extra.issue_report` yields a notice naming the key,
 *               its child key names (incl. `expected`/`actual`/`repro_command`), and the
 *               exact `--json` command; every structured key on one doc is inventoried
 *   NEGATIVE:   AC-2 — a doc with NO structured `extra` (empty bag, and a scalars-only bag:
 *               `plan_id`/`sub_type`/`decision_status`/`adhoc`/`phase`) yields NO notice at
 *               all; without this control an always-print implementation would satisfy
 *               AC-1 vacuously
 *   BOUNDARY:   empty container values (`[]`, `{}`) announce nothing (no content withheld);
 *               a 13-key object caps the child-key list at 12 and reports the overflow
 *               count; exactly 12 keys adds no overflow suffix
 *   ERROR:      `null` (whose `typeof` is "object" — the classic JS trap) is a scalar, not
 *               a structured field; a mixed-element array degrades to `mixed` rather than
 *               guessing; nested arrays and null elements never throw
 *   STATE:      AC-5 — `extra.validity` is excluded ONLY when the SPEC-043 banner actually
 *               rendered (resolved path + `isInvalidated`); under `--raw`, where no banner
 *               is printed, `validity` IS announced; a spec's projected
 *               `acceptance_criteria` / `code_anchors` are excluded on the resolved path
 *               and announced under `--raw`
 *   REGRESSION: AC-4 — the wiring site sits AFTER `commands/get.ts`'s `args.json` early
 *               return (so `--json` output can gain no bytes) and BEFORE
 *               `formatNavigation`, and is inside no `args.raw` conditional
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  findExtraKeysAlreadyRendered,
  findHiddenStructuredExtra,
  formatStructuredExtraNotice,
  MAX_CHILD_KEYS_LISTED,
  type RenderedBodyFacts,
} from "../../../src/adapters/cli/get-render.js";
import type { DocRecord, Slug } from "@lore/core";

const GET_COMMAND_PATH = new URL("../../../src/adapters/cli/commands/get.ts", import.meta.url).pathname;

const NOW_ISO = "2026-08-06T00:00:00.000Z";
const PAST_ISO = "2026-07-01T00:00:00.000Z";

/** Default render facts: the non-`--raw` path with no spec projection appended. */
const RESOLVED_NO_PROJECTIONS: RenderedBodyFacts = {
  mdxResolved: true,
  acceptanceCriteriaProjected: false,
  codeAnchorsProjected: false,
  nowIso: NOW_ISO,
};

/** `--raw`: no MDX resolution, no banner, no spec projections — everything is withheld. */
const RAW_FACTS: RenderedBodyFacts = { ...RESOLVED_NO_PROJECTIONS, mdxResolved: false };

/** Minimal projection input — the formatter reads only `slug` + `extra`. */
function makeSubject(slug: string, extra: Record<string, unknown>): Pick<DocRecord, "slug" | "extra"> {
  return { slug: slug as Slug, extra };
}

/** The real `extra.issue_report` shape written by `lore report-issue`, key order verbatim. */
const ISSUE_REPORT_FIXTURE = {
  reporter_project: "guyin (/Users/apple/Projects/zz/guyin)",
  reporter_actor: "agent:main-orchestrator",
  lore_version: "0.1.0",
  expected: "fail loud on a non-plan doc",
  actual: "silently succeeded for every doc type",
  reported_at: "2026-07-30T12:46:56.498Z",
  possible_duplicates: [],
  repro_command: "lore uat record <any-knowledge-slug> --json-file verdict.json",
} as const;

// ─── HAPPY (AC-1): issue_report becomes observable ──────────────────────────

describe("formatStructuredExtraNotice — AC-1 HAPPY (extra.issue_report is observable)", () => {
  it("AC-1 names the key, its child keys, and the exact --json command", () => {
    const notice = formatStructuredExtraNotice(
      makeSubject("task-uat-record-accepts-any-doc-type", { issue_report: ISSUE_REPORT_FIXTURE }),
      RESOLVED_NO_PROJECTIONS,
    );

    expect(notice).toBeDefined();
    const text = notice ?? "";
    // Independent lone tokens — no single sentence is load-bearing.
    expect(text).toContain("issue_report");
    expect(text).toContain("expected");
    expect(text).toContain("actual");
    expect(text).toContain("repro_command");
    expect(text).toContain("--json");
    expect(text).toContain("task-uat-record-accepts-any-doc-type");
  });

  it("AC-1 announces the field WITHOUT leaking its values (bounded output)", () => {
    const text =
      formatStructuredExtraNotice(
        makeSubject("task-uat-record-accepts-any-doc-type", { issue_report: ISSUE_REPORT_FIXTURE }),
        RESOLVED_NO_PROJECTIONS,
      ) ?? "";
    // Values stay behind --json — the notice is an inventory, not a second renderer.
    expect(text).not.toContain("silently succeeded for every doc type");
    expect(text).not.toContain("agent:main-orchestrator");
  });

  it("AC-1 inventories EVERY structured key on one doc, not just issue_report", () => {
    const fields = findHiddenStructuredExtra(
      {
        adhoc: true,
        issue_report: ISSUE_REPORT_FIXTURE,
        file_anchors: ["packages/lore/src/service/uat-service.ts", "packages/lore/src/adapters/cli/commands/uat.ts"],
        verification_evidence: [
          { oracle: "tsc", result: "pass" },
          { oracle: "test", result: "pass" },
        ],
      },
      [],
    );

    expect([...fields].map((field) => field.key).sort()).toEqual([
      "file_anchors",
      "issue_report",
      "verification_evidence",
    ]);
    expect(fields.find((field) => field.key === "file_anchors")).toMatchObject({
      kind: "array",
      length: 2,
      elementKind: "string",
    });
    expect(fields.find((field) => field.key === "verification_evidence")).toMatchObject({
      kind: "array",
      length: 2,
      elementKind: "object",
    });
    expect(fields.find((field) => field.key === "issue_report")).toMatchObject({
      kind: "object",
      hiddenChildKeyCount: 0,
    });
  });
});

// ─── NEGATIVE (AC-2): the vacuity guard ────────────────────────────────────

describe("formatStructuredExtraNotice — AC-2 NEGATIVE control (no structured extra → no notice)", () => {
  it("AC-2 an empty extra bag emits nothing", () => {
    expect(formatStructuredExtraNotice(makeSubject("knowledge-plain", {}), RESOLVED_NO_PROJECTIONS)).toBeUndefined();
    expect(findHiddenStructuredExtra({}, [])).toEqual([]);
  });

  it("AC-2 a scalars-only extra bag emits nothing (plan_id / sub_type / decision_status / phase / adhoc)", () => {
    const scalarsOnly = {
      plan_id: "01KZ0000000000000000000000",
      sub_type: "retro",
      decision_status: "accepted",
      spec_kind: "tech",
      phase: "P1",
      adhoc: true,
      red_first: false,
      some_count: 3,
      some_null: null,
    };
    expect(findHiddenStructuredExtra(scalarsOnly, [])).toEqual([]);
    expect(formatStructuredExtraNotice(makeSubject("task-scalars-only", scalarsOnly), RESOLVED_NO_PROJECTIONS)).toBeUndefined();
  });
});

// ─── BOUNDARY: empty containers, child-key cap ─────────────────────────────

describe("findHiddenStructuredExtra — BOUNDARY (empty containers and the child-key cap)", () => {
  it("empty array and empty object values withhold no content, so they are not announced", () => {
    expect(findHiddenStructuredExtra({ file_anchors: [], claim: {} }, [])).toEqual([]);
    expect(
      formatStructuredExtraNotice(makeSubject("task-empty-containers", { file_anchors: [], claim: {} }), RESOLVED_NO_PROJECTIONS),
    ).toBeUndefined();
  });

  it("a 13-key object lists 12 child key names and reports the overflow count", () => {
    const wide: Record<string, unknown> = {};
    for (let index = 1; index <= MAX_CHILD_KEYS_LISTED + 1; index += 1) wide[`field_${index}`] = index;

    const fields = findHiddenStructuredExtra({ wide_bag: wide }, []);
    expect(fields).toHaveLength(1);
    const field = fields[0]!;
    expect(field.kind).toBe("object");
    if (field.kind !== "object") return;
    expect(field.childKeys).toHaveLength(MAX_CHILD_KEYS_LISTED);
    expect(field.hiddenChildKeyCount).toBe(1);

    const text = formatStructuredExtraNotice(makeSubject("task-wide", { wide_bag: wide }), RESOLVED_NO_PROJECTIONS) ?? "";
    expect(text).toContain("field_12");
    expect(text).toContain("+1");
    expect(text).not.toContain("field_13");
  });

  it("exactly 12 keys reports zero overflow and no overflow suffix", () => {
    const exact: Record<string, unknown> = {};
    for (let index = 1; index <= MAX_CHILD_KEYS_LISTED; index += 1) exact[`field_${index}`] = index;

    const field = findHiddenStructuredExtra({ exact_bag: exact }, [])[0]!;
    expect(field.kind).toBe("object");
    if (field.kind !== "object") return;
    expect(field.childKeys).toHaveLength(MAX_CHILD_KEYS_LISTED);
    expect(field.hiddenChildKeyCount).toBe(0);
    expect(formatStructuredExtraNotice(makeSubject("task-exact", { exact_bag: exact }), RESOLVED_NO_PROJECTIONS)).not.toContain("more");
  });
});

// ─── ERROR: hostile / malformed values degrade, never throw ────────────────

describe("findHiddenStructuredExtra — ERROR (malformed values degrade, never throw)", () => {
  it("null is a scalar even though `typeof null === 'object'`", () => {
    expect(typeof null).toBe("object"); // pins the trap this case exists for
    expect(findHiddenStructuredExtra({ validity_probe: null }, [])).toEqual([]);
  });

  it("a mixed-element array reports elementKind 'mixed' rather than guessing", () => {
    const field = findHiddenStructuredExtra({ mixed_bag: [1, "two", { three: 3 }] }, [])[0]!;
    expect(field.kind).toBe("array");
    if (field.kind !== "array") return;
    expect(field.elementKind).toBe("mixed");
    expect(field.length).toBe(3);
  });

  it("nested arrays and null elements never throw", () => {
    expect(() =>
      formatStructuredExtraNotice(makeSubject("task-nested", { nested: [[1, 2], null, { a: 1 }] }), RESOLVED_NO_PROJECTIONS),
    ).not.toThrow();
    const field = findHiddenStructuredExtra({ nulls: [null, null] }, [])[0]!;
    expect(field.kind).toBe("array");
    if (field.kind !== "array") return;
    expect(field.elementKind).toBe("null");
  });
});

// ─── STATE (AC-5): exclusions follow what THIS render actually showed ──────

describe("findExtraKeysAlreadyRendered — AC-5 STATE (only actually-rendered keys are excluded)", () => {
  const invalidated = { extra: { validity: { invalid_at: PAST_ISO, reason: "obsolete" } } };

  it("AC-5 an invalidated doc on the resolved path excludes validity (the banner shows it)", () => {
    expect(findExtraKeysAlreadyRendered(invalidated, RESOLVED_NO_PROJECTIONS)).toEqual(["validity"]);
  });

  it("AC-5 the SAME doc under --raw excludes nothing — no banner is printed there", () => {
    expect(findExtraKeysAlreadyRendered(invalidated, RAW_FACTS)).toEqual([]);
  });

  it("AC-5 a doc whose validity is present but NOT invalidating is not excluded", () => {
    expect(findExtraKeysAlreadyRendered({ extra: { validity: { valid_at: PAST_ISO } } }, RESOLVED_NO_PROJECTIONS)).toEqual([]);
  });

  it("AC-5 a spec's projected acceptance_criteria / code_anchors are excluded when the blocks rendered", () => {
    const facts: RenderedBodyFacts = { ...RESOLVED_NO_PROJECTIONS, acceptanceCriteriaProjected: true, codeAnchorsProjected: true };
    expect(findExtraKeysAlreadyRendered({ extra: {} }, facts)).toEqual(["acceptance_criteria", "code_anchors"]);
  });
});

describe("formatStructuredExtraNotice — AC-5 STATE (banner keys never double-reported)", () => {
  it("AC-5 extra.validity alone produces NO notice on the resolved path", () => {
    const validityOnly = { validity: { invalid_at: PAST_ISO, invalidated_by: "01J0000000000000000000SUCC", reason: "obsolete" } };
    expect(formatStructuredExtraNotice(makeSubject("knowledge-invalidated", validityOnly), RESOLVED_NO_PROJECTIONS)).toBeUndefined();
  });

  it("AC-5 an invalidated doc that also carries issue_report announces issue_report only", () => {
    const text =
      formatStructuredExtraNotice(
        makeSubject("knowledge-invalidated-with-report", {
          validity: { invalid_at: PAST_ISO },
          issue_report: ISSUE_REPORT_FIXTURE,
        }),
        RESOLVED_NO_PROJECTIONS,
      ) ?? "";
    expect(text).toContain("issue_report");
    expect(text).not.toContain("validity");
  });

  it("AC-5 under --raw the same doc DOES announce validity (nothing rendered it)", () => {
    const text =
      formatStructuredExtraNotice(
        makeSubject("knowledge-invalidated-with-report", {
          validity: { invalid_at: PAST_ISO },
          issue_report: ISSUE_REPORT_FIXTURE,
        }),
        RAW_FACTS,
      ) ?? "";
    expect(text).toContain("validity");
    expect(text).toContain("issue_report");
  });

  it("AC-5 a spec whose acceptance_criteria block rendered announces only the other keys", () => {
    const text =
      formatStructuredExtraNotice(
        makeSubject("spec-example", {
          acceptance_criteria: [{ id: "AC-1", text: "…" }],
          code_anchors: ["packages/lore/src/x.ts"],
          requirements: [{ id: "R-1" }],
        }),
        { ...RESOLVED_NO_PROJECTIONS, acceptanceCriteriaProjected: true, codeAnchorsProjected: true },
      ) ?? "";
    expect(text).toContain("requirements");
    expect(text).not.toContain("acceptance_criteria");
    expect(text).not.toContain("code_anchors");
  });
});

// ─── REGRESSION (AC-4): wiring position keeps --json byte-identical ────────

describe("commands/get.ts wiring — AC-4 REGRESSION (json path untouched, navigation last)", () => {
  const source = readFileSync(GET_COMMAND_PATH, "utf8");

  // ⛔ The wiring moved in task-the-shared-renderdocmarkdown-seam-still-drops-structured:
  // the notice is now produced at the SHARED seam (`flows/feed-flow.ts::renderDocMarkdown`)
  // so `lore feed` and a `lore gate` DENIAL pack inherit it. `commands/get.ts` calls the
  // seam's NON-announcing entry point and welds the notice itself through THIS module's
  // `composeWithStructuredExtraNotice`, because `(no content)` has to sit between body and
  // notice and because `--raw` never reaches the seam. AC-4's three properties below are
  // UNCHANGED — only the identifier they key on moved.
  it("AC-4 imports the notice joiner from the pure sibling module", () => {
    expect(source).toContain("composeWithStructuredExtraNotice");
    expect(source).toContain("get-render.js");
  });

  it("AC-4 the notice is emitted AFTER the args.json early return and BEFORE formatNavigation", () => {
    const jsonBranchIndex = source.indexOf("if (args.json)");
    const noticeCallIndex = source.indexOf("composeWithStructuredExtraNotice(displayBody");
    const navigationIndex = source.indexOf("formatNavigation(navigation)");

    expect(jsonBranchIndex).toBeGreaterThan(-1);
    expect(noticeCallIndex).toBeGreaterThan(-1);
    expect(navigationIndex).toBeGreaterThan(-1);
    // The args.json branch prints and returns immediately, so a call site strictly after
    // it cannot add a byte to the --json payload (AC-4).
    expect(noticeCallIndex).toBeGreaterThan(jsonBranchIndex);
    expect(noticeCallIndex).toBeLessThan(navigationIndex);
  });

  it("AC-4 the notice sits inside no args.raw conditional — a raw read is equally blind", () => {
    const humanRenderSection = source.slice(source.indexOf("if (args.json)"), source.indexOf("formatNavigation(navigation)"));
    expect(humanRenderSection).toContain("composeWithStructuredExtraNotice");
    expect(humanRenderSection).not.toMatch(/if\s*\(\s*!?\s*args\.raw\s*\)/);
  });

  it("AC-4 get.ts uses the loss-notice-FREE seam entry point — never the announcing one", () => {
    // Calling `renderDocMarkdown` here would print the notice twice. Comment lines are
    // dropped first: this file's own header documents the rule by quoting the identifier.
    const codeOnly = source
      .split("\n")
      .filter((line) => {
        const trimmed = line.trimStart();
        return !trimmed.startsWith("*") && !trimmed.startsWith("//") && !trimmed.startsWith("/*");
      })
      .join("\n");
    expect(codeOnly).toContain("renderDocBodyWithoutLossNotice");
    expect(codeOnly).not.toMatch(/\brenderDocMarkdown\s*\(/);
  });
});
