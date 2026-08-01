/**
 * REGRESSION oracle for the ONE-IMPLEMENTATION property of the contract-edit
 * demotion rule — *"an `approved` doc whose governing contract content changes
 * resets to `draft`"* (`@lore/core::resolveStatusAfterContractEdit`, declared
 * beside `VALID_TRANSITIONS` in `packages/core/src/schemas.ts`).
 *
 * ## What this file pins, and why it is not the demotion tests
 *
 * Two other suites already assert that each path demotes:
 *   - `corpus-service.test.ts` AC-SVC-004.02/.03/.13 — `CorpusService.set`
 *   - `ac-set.test.ts` AC-ACS-4 — `AcService.setCriterion`
 *
 * Both of those PASS on a MIRRORED implementation (one copy of the rule per
 * service, which is what shipped until 2026-08-01) and therefore prove nothing
 * about SSOT. The property this file pins is strictly stronger and cannot be
 * expressed by asserting either path alone:
 *
 *   **the two call sites cannot be made to disagree.**
 *
 * Method: stub the ONE shared rule so it returns a status that NO hardcoded copy
 * of the rule could ever produce (`"in-review"` — a real `DocStatus`, so types
 * stay honest, but unreachable from any literal `"draft"`), then assert BOTH
 * paths move to it TOGETHER. Re-inline the rule at either call site and that call
 * site stops following the stub while the other keeps following it — red. Add a
 * second copy in `@lore/core` and whichever site reads the un-stubbed copy stops
 * moving — red.
 *
 * ## Measured RED, pre-extraction (this is why the stub is the mechanism)
 *
 * Against the mirrored implementation this file fails at the ASSERTION, not at an
 * import error: the mock factory installs an export nothing imports, both services
 * run their own inline `"draft"` literal, and `demotionRuleSpy` records ZERO calls.
 *
 * ## Interceptor liveness controls (non-negotiable)
 *
 * "The rule was never consulted" and "the module mock never installed" produce the
 * IDENTICAL observation (0 spy calls, status `"draft"`). Distinguishing them needs
 * an independent probe, so the factory ALSO wraps two exports that are definitely
 * consumed on the exercised paths, each delegating to the real implementation:
 *   - `canonicaliseBody`  — called by `CorpusService.set` on a content patch
 *   - `lintAcQuantifiability` — called by `AcService.addCriterion` in the fixture
 * Both must have fired before any verdict is read. That is what makes a 0-call
 * `resolveStatusAfterContractEdit` provably the mirrored state rather than a
 * silently broken interceptor (CLAUDE.md, fifth false-oracle vector: an oracle
 * must prove its own instrument is live).
 *
 * Dimensions: REGRESSION (the cannot-disagree property) + NEGATIVE (the
 * `contentChanged` argument is threaded honestly, never hardcoded `true`, at the
 * `CorpusService.set` call site). The pure predicate's own HAPPY / BOUNDARY /
 * ERROR / STATE dimensions live with the code, in `tests/unit/core/schemas.test.ts`.
 *
 * @spec_ref AC-ACS-4
 * Source: spec-lore-ac-set-in-place-edit-of-a-declared-acceptance D2;
 *   task-the-approved-to-draft-demotion-rule-is-mirrored-in-ac.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CreateDocInput, DocStatus } from "@lore/core";

// ─── The stubbed SSOT + its liveness controls ──────────────────────────────────

/**
 * A status no hardcoded copy of the demotion rule can produce. It is a real
 * `DocStatus` so nothing downstream has to special-case it, and it is reached
 * ONLY by a call site that actually consulted the shared rule.
 */
const SENTINEL_DEMOTED_STATUS: DocStatus = "in-review";

const { demotionRuleSpy, canonicaliseBodySpy, lintAcQuantifiabilitySpy } = vi.hoisted(() => ({
  demotionRuleSpy: vi.fn(),
  canonicaliseBodySpy: vi.fn(),
  lintAcQuantifiabilitySpy: vi.fn(),
}));

vi.mock("@lore/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lore/core")>();
  // reason: `canonicaliseBody`/`lintAcQuantifiability` are wrapped, NOT replaced —
  // they delegate to the real implementation so behaviour on both exercised paths
  // is unchanged. Their only job is to prove this factory is the module both
  // services actually resolved (see "Interceptor liveness controls" above).
  canonicaliseBodySpy.mockImplementation(actual.canonicaliseBody);
  lintAcQuantifiabilitySpy.mockImplementation(actual.lintAcQuantifiability);
  return {
    ...actual,
    canonicaliseBody: canonicaliseBodySpy,
    lintAcQuantifiability: lintAcQuantifiabilitySpy,
    resolveStatusAfterContractEdit: demotionRuleSpy,
  };
});

const { InMemoryStore } = await import("../../../src/store/in-memory-store.js");
const { CorpusService } = await import("../../../src/service/corpus-service.js");
const { AcService } = await import("../../../src/service/ac-service.js");

// ─── Fixtures (mirrors ac-set.test.ts) ─────────────────────────────────────────

type Services = {
  store: InstanceType<typeof InMemoryStore>;
  corpusService: InstanceType<typeof CorpusService>;
  acService: InstanceType<typeof AcService>;
};

function makeServices(): Services {
  const store = new InMemoryStore();
  return { store, corpusService: new CorpusService(store), acService: new AcService(store) };
}

/** An APPROVED spec carrying one script-mode criterion (`AC-X-1`). */
async function createApprovedSpec(services: Services, titleSuffix: string): Promise<string> {
  const { corpusService, acService } = services;
  const prd = await corpusService.create({
    type: "prd",
    title: `Demotion SSOT PRD ${titleSuffix}`,
    content: "root",
  } as CreateDocInput);
  if (!prd.ok) throw new Error(`prd create failed: ${JSON.stringify(prd.error)}`);

  const spec = await corpusService.create({
    type: "spec",
    title: `Demotion SSOT Spec ${titleSuffix}`,
    parent_id: prd.value.id,
    content: "spec body",
  } as CreateDocInput);
  if (!spec.ok) throw new Error(`spec create failed: ${JSON.stringify(spec.error)}`);

  const added = await acService.addCriterion(spec.value.id, {
    id: "AC-X-1",
    statement: "Rejects malformed input with a named field",
    verify: { mode: "script", oracle: "test", command: "bun test x" },
  });
  if (!added.ok) throw new Error(`addCriterion failed: ${JSON.stringify(added.error)}`);

  const promoted = await corpusService.set(spec.value.id, { status: "approved" });
  if (!promoted.ok) throw new Error(`promote failed: ${JSON.stringify(promoted.error)}`);
  if (promoted.value.status !== "approved") throw new Error(`fixture spec is ${promoted.value.status}, not approved`);
  return spec.value.id;
}

async function statusOf(services: Services, id: string): Promise<DocStatus> {
  const found = await services.store.find(id);
  if (!found.ok || found.value === null) throw new Error(`re-fetch of ${id} failed`);
  return found.value.status;
}

/** Asserts the module mock is the `@lore/core` BOTH services resolved. */
function expectInterceptorIsLive(): void {
  expect(
    canonicaliseBodySpy,
    "liveness control: CorpusService.set did not reach the mocked @lore/core — a 0-call demotion spy would be uninterpretable",
  ).toHaveBeenCalled();
  expect(
    lintAcQuantifiabilitySpy,
    "liveness control: AcService did not reach the mocked @lore/core — a 0-call demotion spy would be uninterpretable",
  ).toHaveBeenCalled();
}

beforeEach(() => {
  demotionRuleSpy.mockReset();
  canonicaliseBodySpy.mockClear();
  lintAcQuantifiabilitySpy.mockClear();
  // The real rule, with a DIFFERENT target status — see SENTINEL_DEMOTED_STATUS.
  demotionRuleSpy.mockImplementation((currentStatus: DocStatus, contentChanged: boolean): DocStatus =>
    currentStatus === "approved" && contentChanged ? SENTINEL_DEMOTED_STATUS : currentStatus,
  );
});

// ─── REGRESSION ────────────────────────────────────────────────────────────────

describe("REGRESSION — the two demotion call sites cannot be made to disagree (AC-2)", () => {
  it("stubbing the ONE shared rule moves BOTH CorpusService.set and AcService.setCriterion together", async () => {
    const services = makeServices();
    const contentEditSpecId = await createApprovedSpec(services, "content-edit");
    const acEditSpecId = await createApprovedSpec(services, "ac-edit");

    // ── Path A: a content edit through CorpusService.set ──
    const callsBeforeContentEdit = demotionRuleSpy.mock.calls.length;
    const contentEdit = await services.corpusService.set(contentEditSpecId, {
      content: "an edited spec body",
    });
    expect(contentEdit.ok, `CorpusService.set failed: ${JSON.stringify(contentEdit)}`).toBe(true);
    const contentEditRuleCalls = demotionRuleSpy.mock.calls.slice(callsBeforeContentEdit);

    // ── Path B: an in-place acceptance-criterion edit through AcService ──
    const callsBeforeAcEdit = demotionRuleSpy.mock.calls.length;
    const acEdit = await services.acService.setCriterion(acEditSpecId, "AC-X-1", {
      statement: "An edited statement that changes the governing contract",
    });
    expect(acEdit.ok, `AcService.setCriterion failed: ${JSON.stringify(acEdit)}`).toBe(true);
    const acEditRuleCalls = demotionRuleSpy.mock.calls.slice(callsBeforeAcEdit);

    // ── The instrument is live before any verdict is read ──
    expectInterceptorIsLive();

    // ── Each path CONSULTED the shared rule, with the arguments its own
    //    contract owes: `set` reports its measured content/title change; an AC
    //    edit is a contract change by construction, so it passes a literal true.
    expect(contentEditRuleCalls, "CorpusService.set did not consult the shared demotion rule").toContainEqual([
      "approved",
      true,
    ]);
    expect(acEditRuleCalls, "AcService.setCriterion did not consult the shared demotion rule").toContainEqual([
      "approved",
      true,
    ]);

    // ── And BOTH landed on the stub's status. This is the cannot-disagree
    //    property: on a mirrored implementation both read "draft" instead.
    expect(await statusOf(services, contentEditSpecId), "CorpusService.set ignored the shared rule").toBe(
      SENTINEL_DEMOTED_STATUS,
    );
    expect(await statusOf(services, acEditSpecId), "AcService.setCriterion ignored the shared rule").toBe(
      SENTINEL_DEMOTED_STATUS,
    );
  });
});

// ─── NEGATIVE ──────────────────────────────────────────────────────────────────

describe("NEGATIVE — a metadata-only patch reaches the shared rule with contentChanged=false", () => {
  it("leaves an approved spec approved, and never hardcodes the contentChanged argument to true", async () => {
    const services = makeServices();
    const specId = await createApprovedSpec(services, "metadata-only");

    const callsBefore = demotionRuleSpy.mock.calls.length;
    const patched = await services.corpusService.set(specId, { priority: "high" });
    expect(patched.ok, `CorpusService.set failed: ${JSON.stringify(patched)}`).toBe(true);

    expect(
      demotionRuleSpy.mock.calls.slice(callsBefore),
      "a priority-only patch must reach the shared rule with contentChanged=false",
    ).toContainEqual(["approved", false]);
    expect(await statusOf(services, specId)).toBe("approved");
  });
});
