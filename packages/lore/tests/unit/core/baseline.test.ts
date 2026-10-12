/**
 * @spec_ref spec-baseline-slice-1-rules-with-permanent-ids-ac-citations §C1, §C3, §C4
 *
 * RED-phase tests for task-skill-test-core-baseline-schema-rule-lint-and-guard-table [A1].
 * Covers AC-BLS1-7 (rule-statement lint) and AC-BLS1-9 (schema invariants).
 *
 * Every export is read through a guarded accessor so the file always loads and each
 * `it` fails with a message naming the MISSING BEHAVIOUR, never an import crash.
 *
 * Contract names the implementers (A2a: `describe("baseline schema and lint")`,
 * A2b: `describe("dedicated keys and cites")`) must provide from `@lore/core`:
 *   baselineExtraSchema            zod schema: { node, label?, rules?, depends_on?, glossary? }
 *   validateBaselineParent(extra, parent)   -> { ok: boolean }   parent = { type, node? }
 *   isLawfulRuleLifecycleTransition(from, to) -> boolean          (forward-only)
 *   lintRuleStatement(statement, { pathExists }) -> { token, kind }[]
 *   DEDICATED_EXTRA_KEYS           Record<DocType, { key, writer }[]>
 *   acceptanceCriterionSchema.cites  optional string[] of BR-n, unique, <= 10
 * Dimensions: HAPPY / NEGATIVE / BOUNDARY (id grammar, examples 0..4, cites 10/11).
 */
import { describe, it, expect } from "vitest";
import * as core from "@lore/core";

type Mod = Record<string, unknown>;
const mod = core as unknown as Mod;

/** Fetch an export or fail naming the missing behaviour. */
function need<T>(name: string, behaviour: string): T {
  const v = mod[name];
  if (v === undefined) {
    throw new Error(`${name} not exported from @lore/core — missing behaviour: ${behaviour}`);
  }
  return v as T;
}

interface SafeParse {
  success: boolean;
  data?: unknown;
}
interface ZodLike {
  safeParse(v: unknown): SafeParse;
}

const baselineSchema = (): ZodLike =>
  need<ZodLike>("baselineExtraSchema", "baseline extra schema (node, rules, depends_on, glossary, label)");

const rule = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "BR-1",
  statement: "A claimed task is visible to every other session.",
  confidence: "established",
  enforced_by: "guaranteed",
  examples: ["Two sessions list tasks and both see the claim."],
  lifecycle: "live",
  ...over,
});

const leaf = (rules: unknown[]): Record<string, unknown> => ({ node: "leaf", rules });

const accepts = (extra: unknown): boolean => baselineSchema().safeParse(extra).success;

type ParentCheck = (extra: unknown, parent: unknown) => { ok: boolean };
const parentCheck = (): ParentCheck =>
  need<ParentCheck>("validateBaselineParent", "node/parent consistency check for baseline docs");

type Transition = (from: string, to: string) => boolean;
const transition = (): Transition =>
  need<Transition>("isLawfulRuleLifecycleTransition", "forward-only rule lifecycle transition helper");

describe("baseline schema and lint", () => {
  describe("node / parent rules", () => {
    it("refuses rules on a branch node (rules only on leaves)", () => {
      expect(accepts({ node: "branch", rules: [rule()] })).toBe(false);
    });

    it("accepts rules on a leaf node (control)", () => {
      expect(accepts(leaf([rule()]))).toBe(true);
    });

    it("refuses node=root whose parent type is baseline", () => {
      const v = parentCheck();
      expect(v({ node: "root" }, { type: "baseline", node: "root" }).ok).toBe(false);
      expect(v({ node: "root" }, { type: "prd" }).ok).toBe(true);
    });

    it("refuses node=branch|leaf whose parent type is prd", () => {
      const v = parentCheck();
      expect(v({ node: "branch" }, { type: "prd" }).ok).toBe(false);
      expect(v({ node: "leaf" }, { type: "prd" }).ok).toBe(false);
      expect(v({ node: "branch" }, { type: "baseline", node: "root" }).ok).toBe(true);
      expect(v({ node: "leaf" }, { type: "baseline", node: "branch" }).ok).toBe(true);
    });
  });

  describe("lifecycle", () => {
    it("refuses a retired rule with no retired_note", () => {
      expect(accepts(leaf([rule({ lifecycle: "retired" })]))).toBe(false);
      expect(accepts(leaf([rule({ lifecycle: "retired", retired_note: "superseded by BR-9" })]))).toBe(true);
    });

    it("transition helper refuses retired->live and deprecated->live", () => {
      const t = transition();
      expect(t("retired", "live")).toBe(false);
      expect(t("deprecated", "live")).toBe(false);
    });

    it("transition helper accepts live->retired and deprecated->retired, and refuses live->deprecated (D4)", () => {
      const t = transition();
      expect(t("live", "retired")).toBe(true);
      expect(t("deprecated", "retired")).toBe(true);
      expect(t("live", "deprecated")).toBe(false);
    });
  });

  describe("rule id grammar", () => {
    it.each(["BR-1", "BR-10", "BR-999"])("accepts %s", (id) => {
      expect(accepts(leaf([rule({ id })]))).toBe(true);
    });

    it.each(["BR-0", "BR-01", "br-3", "BR-3a"])("refuses %s", (id) => {
      expect(accepts(leaf([rule({ id })]))).toBe(false);
    });
  });

  describe("examples count", () => {
    it.each([1, 2, 3])("accepts %i example(s)", (n) => {
      const examples = Array.from({ length: n }, (_, i) => `example ${i}`);
      expect(accepts(leaf([rule({ examples })]))).toBe(true);
    });

    it.each([0, 4])("refuses %i example(s)", (n) => {
      const examples = Array.from({ length: n }, (_, i) => `example ${i}`);
      expect(accepts(leaf([rule({ examples })]))).toBe(false);
    });
  });

  describe("rule statement lint", () => {
    type Flag = { token: string; kind: string };
    type Lint = (s: string, o: { pathExists: (p: string) => boolean }) => Flag[];
    const lint = (): Lint => need<Lint>("lintRuleStatement", "BL-11 rule-statement lint");
    const pathExists = (p: string): boolean => p === "packages/lore/src/app.ts";

    const FORBIDDEN: Array<[string, string]> = [
      ["The handler lives in packages/lore/src/app.ts today.", "packages/lore/src/app.ts"],
      ["It is implemented by #Foo in the store.", "#Foo"],
      ["The service calls doThing( on every write.", "doThing("],
      ["Pass --force to override the check.", "--force"],
      ["Set LORE_X=1 before running.", "LORE_X=1"],
      ["Enabled through workflow.gates.enabled in config.", "workflow.gates.enabled"],
    ];

    it.each(FORBIDDEN)("flags the forbidden token in: %s", (statement, token) => {
      const flags = lint()(statement, { pathExists });
      const hit = flags.find((f) => f.token === token);
      expect(hit, `expected token ${token}; got ${JSON.stringify(flags)}`).toBeDefined();
      expect(typeof hit?.kind).toBe("string");
      expect(hit?.kind.length).toBeGreaterThan(0);
    });

    it("assigns a distinct kind to each of the six forbidden token classes", () => {
      const kinds = new Set(FORBIDDEN.flatMap(([s]) => lint()(s, { pathExists }).map((f) => f.kind)));
      expect(kinds.size).toBe(6);
    });

    it("does not flag a path-like token the injected pathExists denies", () => {
      const flags = lint()("The handler lives in packages/lore/src/app.ts today.", {
        pathExists: () => false,
      });
      expect(flags.find((f) => f.token === "packages/lore/src/app.ts")).toBeUndefined();
    });

    it.each(["the user's test file", "exit code 3", "a spec"])(
      "flags 0 tokens in allowed fixture: %s",
      (statement) => {
        expect(lint()(statement, { pathExists })).toEqual([]);
      },
    );
  });
});

describe("dedicated keys and cites", () => {
  describe("DEDICATED_EXTRA_KEYS", () => {
    it("registers node, rules, depends_on, glossary, label for baseline, each with a writer hint", () => {
      const table = need<Record<string, Array<{ key: string; writer: string }>>>(
        "DEDICATED_EXTRA_KEYS",
        "guard table of extra keys that need a dedicated writer verb",
      );
      const entries = table["baseline"];
      expect(entries, "DEDICATED_EXTRA_KEYS has no baseline entry").toBeDefined();
      const byKey = new Map((entries ?? []).map((e) => [e.key, e.writer]));
      for (const key of ["node", "rules", "depends_on", "glossary", "label"]) {
        expect(byKey.has(key), `baseline key ${key} not registered`).toBe(true);
        expect((byKey.get(key) ?? "").length, `baseline key ${key} has no writer hint`).toBeGreaterThan(0);
      }
    });
  });

  describe("AcceptanceCriterion.cites", () => {
    const ac = (cites?: unknown): Record<string, unknown> => ({
      id: "AC-X-1",
      statement: "something holds",
      verify: { mode: "human" },
      ...(cites === undefined ? {} : { cites }),
    });
    const parse = (cites?: unknown): SafeParse =>
      need<ZodLike>("acceptanceCriterionSchema", "AC schema").safeParse(ac(cites));
    const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `BR-${i + 1}`);

    it("accepts a valid cites list and preserves it", () => {
      const r = parse(["BR-1", "BR-2"]);
      expect(r.success).toBe(true);
      expect((r.data as { cites?: string[] }).cites, "cites field not on AcceptanceCriterion schema").toEqual([
        "BR-1",
        "BR-2",
      ]);
    });

    it("refuses duplicate cites [BR-1, BR-1] (unique)", () => {
      expect(parse(["BR-1", "BR-1"]).success, "cites uniqueness not enforced").toBe(false);
    });

    it("refuses 11 cited ids (max 10) and accepts exactly 10", () => {
      expect(parse(ids(11)).success, "cites max 10 not enforced").toBe(false);
      const ten = parse(ids(10));
      expect(ten.success).toBe(true);
      expect(
        (ten.data as { cites?: string[] }).cites,
        "cites field not on AcceptanceCriterion schema",
      ).toHaveLength(10);
    });

    it.each(["BR-0", "br-1", "BR-1a", "X-1"])("refuses malformed cite id %s", (id) => {
      expect(parse([id]).success, "cites id grammar not enforced").toBe(false);
    });
  });
});
