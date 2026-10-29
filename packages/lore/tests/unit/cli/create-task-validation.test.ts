/**
 * create-task-validation.test.ts — SPEC-065 D4, AC-065-5/AC-065-6: single-pass
 * `lore create task` required-flag aggregation + `--parent`-from-`--plan-id`
 * inference. `commands/create.ts` transitively imports `loader.ts`
 * (`bun:sqlite`), which vitest cannot resolve, so this suite exercises the
 * pure units `commands/create.ts` calls verbatim
 * (`packages/lore/src/adapters/cli/create-task-validation.ts`):
 *   - `checkTaskCreateRequiredFlags` / `formatTaskCreateMissingFlagsError` —
 *     the single-pass missing-flag check + its exit-2 message.
 *   - `inferTaskParentId` — the `--parent`-defaults-to-`--plan-id` rule.
 *
 * These three pure functions FULLY determine the CLI-observable behavior
 * AC-065-5/6 describe: `commands/create.ts`'s `run()` handler does nothing
 * more than (1) call `checkTaskCreateRequiredFlags`, exit 2 with
 * `formatTaskCreateMissingFlagsError`'s output on a non-empty result, else
 * (2) call `inferTaskParentId` and pass its result straight through as
 * `CreateDocInput.parent_id` to `CorpusService.create` unchanged.
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
 *
 * @spec_ref AC-065-5, AC-065-6 — SPEC-065 D4
 */

import { describe, it, expect } from "vitest";
import {
  checkTaskCreateRequiredFlags,
  formatTaskCreateMissingFlagsError,
  inferTaskParentId,
} from "../../../src/adapters/cli/create-task-validation.js";

describe("checkTaskCreateRequiredFlags — SPEC-065 D4 single-pass aggregation", () => {
  // ── HAPPY ──────────────────────────────────────────────────────────────

  it("both --plan-id and --parent present → nothing missing", () => {
    const missing = checkTaskCreateRequiredFlags({ planId: "plan-x", parent: "plan-x", kind: "code" });
    expect(missing).toEqual([]);
  });

  it("AC-065-5 precondition: --plan-id present, --parent absent → nothing missing (parent will be inferred)", () => {
    const missing = checkTaskCreateRequiredFlags({ planId: "plan-x", parent: undefined, kind: "code" });
    expect(missing).toEqual([]);
  });

  // ── NEGATIVE ───────────────────────────────────────────────────────────

  it("AC-065-6: neither --plan-id nor --parent present → BOTH reported in one result", () => {
    const missing = checkTaskCreateRequiredFlags({ planId: undefined, parent: undefined, kind: "code" });
    expect(missing).toEqual(["--plan-id", "--parent"]);
  });

  it("--parent present, --plan-id absent → only --plan-id is missing (--plan-id is unconditionally required)", () => {
    const missing = checkTaskCreateRequiredFlags({ planId: undefined, parent: "some-parent", kind: "code" });
    expect(missing).toEqual(["--plan-id"]);
  });

  it("AC-DCS1-4: a missing or empty kind is reported with every other missing flag, in one result, last", () => {
    expect(checkTaskCreateRequiredFlags({ planId: "plan-x", parent: undefined })).toEqual(["kind"]);
    expect(checkTaskCreateRequiredFlags({ planId: "plan-x", parent: undefined, kind: "" })).toEqual(["kind"]);
    expect(checkTaskCreateRequiredFlags({ planId: undefined, parent: undefined })).toEqual(["--plan-id", "--parent", "kind"]);
  });

  it("AC-DCS1-4: --adhoc relaxes --plan-id and --parent but not the kind", () => {
    expect(checkTaskCreateRequiredFlags({ planId: undefined, parent: undefined, adhoc: true })).toEqual(["kind"]);
    expect(checkTaskCreateRequiredFlags({ planId: undefined, parent: undefined, adhoc: true, kind: "check" })).toEqual([]);
  });

  // ── BOUNDARY ───────────────────────────────────────────────────────────

  it("BOUNDARY: an empty-string --plan-id is treated as absent, same as undefined", () => {
    const missing = checkTaskCreateRequiredFlags({ planId: "", parent: undefined, kind: "code" });
    expect(missing).toEqual(["--plan-id", "--parent"]);
  });

  it("BOUNDARY: a whitespace-only --parent is treated as absent, same as undefined", () => {
    const missing = checkTaskCreateRequiredFlags({ planId: undefined, parent: "   ", kind: "code" });
    expect(missing).toEqual(["--plan-id", "--parent"]);
  });

  // ── ERROR (message rendering) ─────────────────────────────────────────

  it("AC-DCS1-4: a missing kind is rendered as --kind with the three kinds named", () => {
    const message = formatTaskCreateMissingFlagsError(["kind"]);
    expect(message).toContain("--kind");
    for (const kind of ["code", "check", "corpus"]) expect(message).toContain(kind);
    expect(message).not.toContain("--plan-id");
  });

  it("AC-065-6: the formatted message names BOTH --plan-id and --parent in ONE string", () => {
    const missing = checkTaskCreateRequiredFlags({ planId: undefined, parent: undefined, kind: "code" });
    const message = formatTaskCreateMissingFlagsError(missing);
    expect(message).toContain("--plan-id");
    expect(message).toContain("--parent");
    // single message, not two — no double "Error:" prefix
    expect(message.match(/Error:/g)?.length).toBe(1);
  });

  it("a --plan-id-only miss formats without mentioning --parent as missing", () => {
    const missing = checkTaskCreateRequiredFlags({ planId: undefined, parent: "some-parent", kind: "code" });
    const message = formatTaskCreateMissingFlagsError(missing);
    expect(message).toContain("--plan-id");
    // the specific "--parent is required because..." explanatory line must be absent
    expect(message).not.toContain("--parent <id-or-slug> is required");
  });

  // ── STATE ──────────────────────────────────────────────────────────────

  it("STATE: result order is stable — --plan-id always precedes --parent when both are missing", () => {
    const missing = checkTaskCreateRequiredFlags({ planId: undefined, parent: undefined, kind: "code" });
    expect(missing.indexOf("--plan-id")).toBeLessThan(missing.indexOf("--parent"));
  });

  // ── REGRESSION ─────────────────────────────────────────────────────────

  it("REGRESSION: --plan-id was always mandatory pre-D4 — that invariant is unchanged", () => {
    // every combination lacking --plan-id must report it, regardless of --parent
    expect(checkTaskCreateRequiredFlags({ planId: undefined, parent: undefined, kind: "code" })).toContain("--plan-id");
    expect(checkTaskCreateRequiredFlags({ planId: undefined, parent: "x", kind: "code" })).toContain("--plan-id");
  });
});

describe("inferTaskParentId — SPEC-065 D4 --parent-defaults-to---plan-id", () => {
  // ── HAPPY ──────────────────────────────────────────────────────────────

  it("AC-065-5: --parent omitted, --plan-id resolved → parent_id defaults to the resolved plan id", () => {
    const result = inferTaskParentId(undefined, "01HZRESOLVEDPLANIDAAAAAAAA");
    expect(result).toBe("01HZRESOLVEDPLANIDAAAAAAAA");
  });

  // ── NEGATIVE ───────────────────────────────────────────────────────────

  it("an explicit --parent always wins over --plan-id, even when they differ (task parented elsewhere)", () => {
    const result = inferTaskParentId("explicit-other-parent", "01HZRESOLVEDPLANIDAAAAAAAA");
    expect(result).toBe("explicit-other-parent");
  });

  // ── BOUNDARY ───────────────────────────────────────────────────────────

  it("BOUNDARY: both absent → undefined (no parent to infer — the CLI's required-flags check refuses this case for type task before this fn is ever called, but the fn stays pure/total)", () => {
    const result = inferTaskParentId(undefined, undefined);
    expect(result).toBeUndefined();
  });

  it("BOUNDARY: --parent explicitly the SAME string as the resolved plan id is a no-op passthrough", () => {
    const result = inferTaskParentId("01HZSAMEAAAAAAAAAAAAAAAAAA", "01HZSAMEAAAAAAAAAAAAAAAAAA");
    expect(result).toBe("01HZSAMEAAAAAAAAAAAAAAAAAA");
  });

  // ── STATE / REGRESSION ─────────────────────────────────────────────────

  it("REGRESSION: for every non-task doc type, resolvedPlanId is always undefined (create.ts only computes it for type 'task') — this fn transparently reduces to the pre-D4 args.parent passthrough", () => {
    // simulates a spec/prd/adr/knowledge/plan create call: resolvedPlanId is
    // never computed for these types, so the second arg is always undefined.
    expect(inferTaskParentId("some-parent-id", undefined)).toBe("some-parent-id");
    expect(inferTaskParentId(undefined, undefined)).toBeUndefined();
  });
});
