// @reads packages/core/src/**
// @reads packages/lore/src/**
// @reads scripts/**
/**
 * AC-BIA-6 (spec-baseline-approval-is-per-item-an-edit-adds-a-pending, BR-1340): every reader that decides
 * something reads a baseline node's rules, commands, label, glossary and depends_on through the approved-version
 * accessor (`service/baseline-items.ts`); only the accessor and the write path read those keys of `extra` directly.
 *
 * Coverage:
 *   HAPPY      the accessor returns the approved versions, and `pendingRevisionsOf` the pending ones.
 *   NEGATIVE   a pending add is not in the approved rules; a pending revision does not change the approved statement.
 *   BOUNDARY   missing / malformed / wrongly typed fields read as empty, never throw.
 *   STATE      `baselineExtraSchema` accepts a node with approved + pending items and refuses a pending rule keyed
 *              under another id.
 *   REGRESSION the source scan: no file outside the allowlist reads those keys of an `extra` directly.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { baselineExtraSchema } from "@lore/core";
import {
  approvedCommandsOf,
  approvedDependsOnOf,
  approvedGlossaryOf,
  approvedLabelOf,
  approvedRuleIdsOf,
  approvedRulesOf,
  pendingRevisionsOf,
} from "../../../src/service/baseline-items";

const REPO_ROOT = join(new URL("../../../../../", import.meta.url).pathname);

const approvedRule = {
  id: "BR-1",
  statement: "An approved statement.",
  confidence: "established",
  enforced_by: "guaranteed",
  examples: ["e"],
  lifecycle: "live",
};

const nodeWithPending = {
  node: "leaf",
  label: "Approved label",
  depends_on: ["BR-9"],
  commands: ["ac add"],
  rules: [approvedRule],
  pending: {
    rules: {
      "BR-1": { revision_id: "rev-1", rule: { ...approvedRule, statement: "A pending rewrite." } },
      "BR-2": { revision_id: "rev-2", rule: { ...approvedRule, id: "BR-2", statement: "A pending add." } },
    },
    node: { revision_id: "rev-3", label: "Pending label", commands: ["ac add", "ac list"] },
  },
};

describe("the approved-version accessor", () => {
  it("HAPPY: returns the approved versions of every item", () => {
    expect(approvedRuleIdsOf({ extra: nodeWithPending })).toEqual(["BR-1"]);
    expect(approvedLabelOf({ extra: nodeWithPending })).toBe("Approved label");
    expect(approvedDependsOnOf({ extra: nodeWithPending })).toEqual(["BR-9"]);
    expect(approvedCommandsOf({ extra: nodeWithPending })).toEqual(["ac add"]);
    expect(approvedGlossaryOf({ extra: { glossary: [{ term: "t", meaning: "m" }] } })).toHaveLength(1);
  });

  it("NEGATIVE: a pending revision never replaces the approved statement and a pending add is not approved", () => {
    const statements = approvedRulesOf({ extra: nodeWithPending }).map((r) => (r as { statement: string }).statement);
    expect(statements).toEqual(["An approved statement."]);
    expect(approvedRuleIdsOf({ extra: nodeWithPending })).not.toContain("BR-2");
    expect(approvedLabelOf({ extra: nodeWithPending })).not.toBe("Pending label");
  });

  it("HAPPY: pendingRevisionsOf returns the pending rule revisions and the node revision", () => {
    const pending = pendingRevisionsOf({ extra: nodeWithPending });
    expect(Object.keys(pending.rules).sort()).toEqual(["BR-1", "BR-2"]);
    expect(pending.rules["BR-2"]?.rule.statement).toBe("A pending add.");
    expect(pending.node?.label).toBe("Pending label");
  });

  it("BOUNDARY: missing, malformed or wrongly typed fields read as empty and never throw", () => {
    const malformed = { rules: "x", commands: [1, "ok"], depends_on: {}, glossary: 3, label: 7, pending: "nope" };
    expect(approvedRulesOf({ extra: malformed })).toEqual([]);
    expect(approvedRuleIdsOf({ extra: { rules: [null, 3, { id: 4 }, { id: "BR-5" }] } })).toEqual(["BR-5"]);
    expect(approvedCommandsOf({ extra: malformed })).toEqual(["ok"]);
    expect(approvedDependsOnOf({ extra: malformed })).toEqual([]);
    expect(approvedGlossaryOf({ extra: malformed })).toEqual([]);
    expect(approvedLabelOf({ extra: malformed })).toBeUndefined();
    expect(pendingRevisionsOf({ extra: malformed })).toEqual({ rules: {}, node: undefined });
    expect(pendingRevisionsOf({ extra: {} })).toEqual({ rules: {}, node: undefined });
  });
});

describe("baselineExtraSchema carries pending revisions beside the approved versions", () => {
  it("STATE: accepts approved + pending items", () => {
    expect(baselineExtraSchema.safeParse(nodeWithPending).success).toBe(true);
  });

  it("STATE: refuses a pending rule keyed under another id", () => {
    const bad = { ...nodeWithPending, pending: { rules: { "BR-7": { revision_id: "r", rule: approvedRule } } } };
    const parsed = baselineExtraSchema.safeParse(bad);
    expect(parsed.success).toBe(false);
    expect(parsed.success ? "" : parsed.error.issues[0]?.message).toContain("BR-7");
  });
});

/** Files that may read these keys of a baseline `extra` directly, each with the reason. */
const DIRECT_READ_ALLOWLIST: Record<string, string> = {
  "packages/lore/src/service/baseline-items.ts": "the accessor",
  "packages/core/src/baseline.ts": "the schema that defines the keys",
  "packages/lore/src/service/rule-service.ts": "write path: `lore rule add|set`, `lore baseline set-label|depends|glossary|map`",
  "packages/lore/src/service/rule-change-service.ts": "write path: `lore rule apply` writes approved versions",
  "packages/lore/src/service/corpus-service.ts": "write path: a baseline create / wholesale write guard",
  "packages/lore/src/store/index-rows.ts": "index derivation: the registry and rule_depends rows follow the approved versions stored in these keys",
  "packages/lore/src/store/migrations/migration-028.ts": "the one-time conversion that splits stored items into approved and pending versions",
  "packages/lore/src/ai/review-template.ts":"review bundle renderer; reworked per item by the review/approve task",
  "packages/core/src/review-checks.ts":"review-time checks on the node under review; reworked per item by the review/approve task",
};

const KEYS = "rules|commands|label|glossary|depends_on";
/** `extra.rules`, `extra?.rules` (dotted, checked with string literals blanked) and `extra["rules"]`, `extra?.["rules"]`. */
const DOTTED_READ = new RegExp(`\\bextra\\??\\.(${KEYS})\\b`);
const INDEXED_READ = new RegExp(`\\bextra\\??\\.?\\[\\s*"(${KEYS})"\\s*\\]`);

/** The code of a line: inline block comments, line comments and string literal contents removed. */
function codeOf(line: string): string {
  return line.replace(/\/\*.*?\*\//g, "").replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""').replace(/\/\/.*$/, "");
}

function readsDirectly(line: string): boolean {
  return DOTTED_READ.test(codeOf(line)) || INDEXED_READ.test(line.replace(/\/\*.*?\*\//g, ""));
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "tests") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (path.endsWith(".ts") || path.endsWith(".tsx")) out.push(path);
  }
  return out;
}

describe("AC-BIA-6: no deciding reader reads a baseline node's items from extra directly", () => {
  const roots = ["packages/core/src", "packages/lore/src", "scripts"].map((r) => join(REPO_ROOT, r));

  it("REGRESSION: only the allowlisted accessor and write-path files match a direct read", () => {
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of sourceFiles(root)) {
        const rel = relative(REPO_ROOT, file);
        if (rel in DIRECT_READ_ALLOWLIST) continue;
        const lines = readFileSync(file, "utf8").split("\n");
        lines.forEach((line, index) => {
          if (/^\s*(\*|\/\/)/.test(line)) return;
          if (readsDirectly(line)) offenders.push(`${rel}:${index + 1}: ${line.trim()}`);
        });
      }
    }
    expect(offenders).toEqual([]);
  });

  it("BOUNDARY: every allowlisted file exists (a rename must not leave a dead exemption)", () => {
    for (const rel of Object.keys(DIRECT_READ_ALLOWLIST)) {
      expect(() => statSync(join(REPO_ROOT, rel))).not.toThrow();
    }
  });
});
