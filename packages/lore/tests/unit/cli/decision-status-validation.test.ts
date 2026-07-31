/**
 * decision-status-validation.test.ts — AC-DS-8: the pure closed-value-set
 * restriction `lore set --decision-status` will delegate to
 * (`packages/lore/src/adapters/cli/decision-status-validation.ts`).
 * `commands/set.ts` transitively imports `loader.ts` (`bun:sqlite`), which
 * vitest cannot resolve, so this suite exercises the pure units directly:
 *   - `checkDecisionStatusValue` — classifies a raw `--decision-status`
 *     value as accepted / refused (owned-transition / unrecognised-value).
 *   - `formatDecisionStatusRefusal` — renders a refused classification into
 *     the exact stderr message text.
 *
 * These two pure functions FULLY determine AC-DS-8's observable behavior —
 * no store, no spawn, no filesystem: every assertion below runs against
 * plain function calls with plain string inputs.
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
 *
 * @spec_ref AC-DS-8 — spec-adr-decision-status-has-a-create-surface-and-no-cli-update D1, D6
 */

import { describe, it, expect } from "vitest";
import {
  ACCEPTED_DECISION_STATUS_VALUE,
  checkDecisionStatusValue,
  formatDecisionStatusRefusal,
  type DecisionStatusRefusal,
} from "../../../src/adapters/cli/decision-status-validation.js";

describe("decision-status-validation — closed value set (AC-DS-8)", () => {
  // ── HAPPY ──────────────────────────────────────────────────────────────

  it("accepts the literal value 'accepted'", () => {
    const result = checkDecisionStatusValue("accepted");
    expect(result).toEqual({ kind: "accepted" });
  });

  it("ACCEPTED_DECISION_STATUS_VALUE is itself the literal 'accepted' — the module's own SSOT constant round-trips", () => {
    expect(ACCEPTED_DECISION_STATUS_VALUE).toBe("accepted");
    expect(checkDecisionStatusValue(ACCEPTED_DECISION_STATUS_VALUE)).toEqual({ kind: "accepted" });
  });

  // ── NEGATIVE (owned transitions refused, naming lore invalidate) ───────

  it("refuses 'deprecated' as an owned-transition, carrying the offending value verbatim", () => {
    const result = checkDecisionStatusValue("deprecated");
    expect(result).toEqual({ kind: "refused", reason: "owned-transition", value: "deprecated" });
  });

  it("refuses 'superseded' as an owned-transition, carrying the offending value verbatim", () => {
    const result = checkDecisionStatusValue("superseded");
    expect(result).toEqual({ kind: "refused", reason: "owned-transition", value: "superseded" });
  });

  it("the formatted message for 'deprecated' names 'lore invalidate' and its --reason flag", () => {
    const refusal = checkDecisionStatusValue("deprecated") as DecisionStatusRefusal;
    const message = formatDecisionStatusRefusal(refusal);
    expect(message).toContain("lore invalidate");
    expect(message).toContain("--reason");
  });

  it("the formatted message for 'superseded' names 'lore invalidate' and its --superseded-by flag", () => {
    const refusal = checkDecisionStatusValue("superseded") as DecisionStatusRefusal;
    const message = formatDecisionStatusRefusal(refusal);
    expect(message).toContain("lore invalidate");
    expect(message).toContain("--superseded-by");
  });

  // ── BOUNDARY (exact match only — no trim, no case-fold) ────────────────

  it("BOUNDARY: an empty string is refused as unrecognised, not owned-transition", () => {
    const result = checkDecisionStatusValue("");
    expect(result).toEqual({ kind: "refused", reason: "unrecognised-value", value: "" });
  });

  it("BOUNDARY: a whitespace-only value is refused as unrecognised (not silently trimmed to 'accepted')", () => {
    const result = checkDecisionStatusValue("   ");
    expect(result).toEqual({ kind: "refused", reason: "unrecognised-value", value: "   " });
  });

  it("BOUNDARY: wrong-case 'Accepted' is refused as unrecognised (no case-folding)", () => {
    const result = checkDecisionStatusValue("Accepted");
    expect(result).toEqual({ kind: "refused", reason: "unrecognised-value", value: "Accepted" });
  });

  it("BOUNDARY: 'accepted' with surrounding whitespace is refused as unrecognised (no trimming)", () => {
    const result = checkDecisionStatusValue(" accepted ");
    expect(result).toEqual({ kind: "refused", reason: "unrecognised-value", value: " accepted " });
  });

  // ── ERROR (unrecognised value, message lists the accepted value) ──────

  it("refuses an arbitrary unrecognised value", () => {
    const result = checkDecisionStatusValue("bogus");
    expect(result).toEqual({ kind: "refused", reason: "unrecognised-value", value: "bogus" });
  });

  it("the formatted message for an unrecognised value lists the accepted value and does NOT mention lore invalidate", () => {
    const refusal = checkDecisionStatusValue("bogus") as DecisionStatusRefusal;
    const message = formatDecisionStatusRefusal(refusal);
    expect(message).toContain(ACCEPTED_DECISION_STATUS_VALUE);
    expect(message).not.toContain("lore invalidate");
  });

  it("'proposed' — a legal ADR decision_status value elsewhere in the schema — is refused here as unrecognised, not owned-transition (D1/D6: this module draws exactly three buckets, not four)", () => {
    const result = checkDecisionStatusValue("proposed");
    expect(result).toEqual({ kind: "refused", reason: "unrecognised-value", value: "proposed" });
  });

  // ── STATE (module is pure and stateless — no store, no IO, no spawn) ──

  it("STATE: this module holds no internal state — repeated calls with the same input are deterministic and referentially transparent", () => {
    // No test double, no mock, no fixture is constructed anywhere in this
    // file: checkDecisionStatusValue/formatDecisionStatusRefusal take only
    // plain strings and return only plain data, so purity is asserted
    // directly by calling twice and comparing, not by inspecting a store.
    const first = checkDecisionStatusValue("deprecated");
    const second = checkDecisionStatusValue("deprecated");
    expect(first).toEqual(second);

    const firstMessage = formatDecisionStatusRefusal(first as DecisionStatusRefusal);
    const secondMessage = formatDecisionStatusRefusal(second as DecisionStatusRefusal);
    expect(firstMessage).toBe(secondMessage);
  });

  it("STATE: classifying an owned-transition value does not affect a subsequent accepted classification (no shared mutable module state)", () => {
    checkDecisionStatusValue("superseded");
    const result = checkDecisionStatusValue("accepted");
    expect(result).toEqual({ kind: "accepted" });
  });

  // ── REGRESSION (literal message contents pinned) ───────────────────────

  it("REGRESSION: owned-transition and unrecognised-value messages are genuinely different text, not the same generic refusal reused for both branches", () => {
    const ownedMessage = formatDecisionStatusRefusal(
      checkDecisionStatusValue("deprecated") as DecisionStatusRefusal,
    );
    const unrecognisedMessage = formatDecisionStatusRefusal(
      checkDecisionStatusValue("bogus") as DecisionStatusRefusal,
    );
    expect(ownedMessage).not.toBe(unrecognisedMessage);
    expect(ownedMessage).toContain("lore invalidate");
    expect(unrecognisedMessage).not.toContain("lore invalidate");
  });

  it("REGRESSION: every refused reason is one of exactly the two documented values — no undocumented third bucket has crept in", () => {
    const reasons = new Set(
      ["deprecated", "superseded", "proposed", "bogus", "", "Accepted"].map(
        (value) => (checkDecisionStatusValue(value) as DecisionStatusRefusal).reason,
      ),
    );
    expect(reasons).toEqual(new Set(["owned-transition", "unrecognised-value"]));
  });
});
