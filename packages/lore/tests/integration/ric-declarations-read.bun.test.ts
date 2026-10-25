/**
 * @spec_ref spec-refusal-sites-declare-their-rule-in-code-baseline-leaf  AC-RIC-1 (BR-1344)
 *
 * Throwaway TS root with one refusal site of each declaration form, driven through the real CLI verb
 * `lore baseline sites probe --json` (in-process, never the repo's own `.lore/`):
 *   1. a refusal literal carrying `rule: "BR-1"`,
 *   2. a rule-taking helper call (`validationError(..., "BR-2")`) inside `err(...)`,
 *   3. an interface method tagged `@lore-site BR-3`, called from the command,
 *   4. a refusal with no declaration (unmapped),
 *   5. a refusal carrying two rules (literal BR-4 + statement tag BR-5): a conflict naming both.
 *
 * SIMPLEST GREEN-BUT-BROKEN CASE (asserted): a census that reads only object-literal err() arguments passes site 1; sites 2 and
 * 3 must report their rules too, so every form is asserted by its own exact (rule, state) pair.
 *
 * Dimensions: HAPPY (each form reports its rule), NEGATIVE (undeclared -> unmapped), BOUNDARY (two rules -> conflict, both named),
 * REGRESSION (the helper's own pass-through literal is not a second site; the site list is exactly the five).
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runLoreInProcess } from "../helpers/run-lore-in-process.js";
import { sessionEnvFor } from "../helpers/session-actor.js";

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

const MINI_CLI = "packages/lore/src/adapters/cli";

const REFUSAL = `export const err = (e: { code: string; rule?: string }) => ({ ok: false as const, code: e.code });\n`;

const HELPERS = `export function validationError(field: string, message: string, value?: unknown, rule?: string) {
  return { code: "VALIDATION_ERROR", field, message, ...(value !== undefined ? { value } : {}), ...(rule !== undefined ? { rule } : {}) };
}
`;

const PORT = `export interface Port {
  /**
   * Persist the record.
   * @lore-site BR-3
   */
  save(): void;
}
`;

const PROBE = `import { err } from "../lib/refusal.js";
import { validationError } from "../lib/helpers.js";
import type { Port } from "../lib/port.js";
export default {
  run(port: Port, mode: string) {
    if (mode === "a") return err({ code: "LITERAL_REFUSAL", rule: "BR-1" });
    if (mode === "b") return err(validationError("name", "bad name", undefined, "BR-2"));
    if (mode === "c") port.save();
    if (mode === "d") return err({ code: "BARE_REFUSAL" });
    if (mode === "e") {
      /** @lore-site BR-5 */
      return err({ code: "DOUBLE_REFUSAL", rule: "BR-4" });
    }
    return undefined;
  },
};
`;

interface SiteRow {
  readonly key: string;
  readonly code?: string;
  readonly dynamic: boolean;
  readonly line: number;
  readonly status: string;
  readonly rule: string | null;
  readonly rules: string[];
}

const SHARED = `import { err } from "./refusal.js";\nexport function sharedRefusal() {\n  return err({ code: "SHARED_REFUSAL" });\n}\n`;
const ONE = `import { sharedRefusal } from "../lib/shared.js";\n/** @lore-site BR-6 */\nfunction checkOne() {\n  return sharedRefusal();\n}\nexport default { run() { return checkOne(); } };\n`;
const TWO = `import { sharedRefusal } from "../lib/shared.js";\n/** @lore-site BR-7 */\nfunction checkSeven() {\n  return sharedRefusal();\n}\n/** @lore-site BR-8 */\nfunction checkEight() {\n  return sharedRefusal();\n}\nexport default { run() { return [checkSeven(), checkEight()]; } };\n`;
const THREE = `import { sharedRefusal } from "../lib/shared.js";\nfunction untaggedCheck() {\n  return sharedRefusal();\n}\nexport default { run() { return untaggedCheck(); } };\n`;

let dir = "";
let run: (command: string) => Promise<SiteRow[]>;
let sites: SiteRow[] = [];

// reason: a bare TS root with no corpus on purpose: the census reads the tree alone, so each declared id reads as declared
// (liveness unchecked) whatever the ids are; rule liveness is the corpus's one contribution and has its own assertions in AC-RIC-5.
beforeAll(async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "ric1-")));
  const home = join(dir, ".home");
  mkdirSync(home, { recursive: true });
  const write = (rel: string, content: string): void => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  };
  write("package.json", JSON.stringify({ name: "ric1-root", private: true }));
  write(`${MINI_CLI}/lib/refusal.ts`, REFUSAL);
  write(`${MINI_CLI}/lib/helpers.ts`, HELPERS);
  write(`${MINI_CLI}/lib/port.ts`, PORT);
  write(`${MINI_CLI}/commands/probe.ts`, PROBE);
  write(`${MINI_CLI}/lib/shared.ts`, SHARED);
  write(`${MINI_CLI}/commands/one.ts`, ONE);
  write(`${MINI_CLI}/commands/two.ts`, TWO);
  write(`${MINI_CLI}/commands/three.ts`, THREE);
  run = async (command) => {
    const r = await runLoreInProcess(["baseline", "sites", command, "--json"], { cwd: dir, home, env: { ...process.env, HOME: home, ...sessionEnvFor("ric1") } });
    expect(r.exitCode, r.stderr + r.stdout).toBe(0);
    return (JSON.parse(r.stdout) as { data: { sites: SiteRow[] } }).data.sites;
  };
  sites = await run("probe");
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const byCode = (code: string): SiteRow | undefined => sites.find((s) => s.code === code);

describe("AC-RIC-1 — the census reads every declaration form from the tree", () => {
  it("(1) a refusal literal reports the rule it carries", () => {
    expect(byCode("LITERAL_REFUSAL")).toMatchObject({ status: "declared", rule: "BR-1", rules: ["BR-1"] });
  });

  it("(2) a rule-taking helper call reports the rule passed at the call", () => {
    expect(byCode("VALIDATION_ERROR")).toMatchObject({ status: "declared", rule: "BR-2", rules: ["BR-2"] });
  });

  it("(3) an interface method tagged '@lore-site BR-3' reports that rule at its declaration", () => {
    const port = sites.find((s) => s.key.endsWith("lib/port.ts#Port#save"));
    expect(port).toMatchObject({ dynamic: true, status: "declared", rule: "BR-3", rules: ["BR-3"] });
    expect(port?.line).toBe(PORT.split("\n").findIndex((l) => l.includes("save(): void")) + 1);
  });

  it("(4) a refusal that declares nothing is unmapped", () => {
    expect(byCode("BARE_REFUSAL")).toMatchObject({ status: "unmapped", rule: null, rules: [] });
  });

  it("(5) a refusal carrying two rules is a conflict naming both", () => {
    expect(byCode("DOUBLE_REFUSAL")).toMatchObject({ status: "conflict", rule: null, rules: ["BR-4", "BR-5"] });
  });

  it("(6) the list is exactly the five sites: the helper's pass-through literal is not a site of its own", () => {
    expect(sites).toHaveLength(5);
    expect(sites.filter((s) => s.code === "VALIDATION_ERROR")).toHaveLength(1);
  });

  it("(7) a shared refusal that declares nothing takes the rule of the one predicate above it, and says where the predicate is written", async () => {
    const [shared] = await run("one");
    expect(shared).toMatchObject({ code: "SHARED_REFUSAL", status: "declared", rule: "BR-6", rules: [] });
    expect((shared as unknown as { via: { line: number } }).via.line).toBe(3);
  });

  it("(8) the same shared refusal reached through predicates of two rules is generic: both listed, none chosen", async () => {
    const [shared] = await run("two");
    expect(shared).toMatchObject({ code: "SHARED_REFUSAL", status: "generic", rule: null, rules: [] });
    expect((shared as unknown as { predicates: { rule: string }[] }).predicates.map((p) => p.rule)).toEqual(["BR-7", "BR-8"]);
  });

  it("(9) reached through no tagged predicate it stays unmapped (never inherited from a neighbour command)", async () => {
    const [shared] = await run("three");
    expect(shared).toMatchObject({ code: "SHARED_REFUSAL", status: "unmapped", rule: null });
  });
});
