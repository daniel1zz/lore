// @reads package.json
// @reads packages/**
// @reads tsconfig.json
/**
 * RED-first test: a subcommand built by a local factory function is a declarable census entry.
 *
 * `regenerableVerb(name)` in autonomy.ts returns a command object that is assigned into `subCommands`; the census
 * must follow the call to the factory's declaration and its returned object literal. A command that is not
 * declared at all keeps failing loud with entry-symbol-missing.
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listSites, listSitesMany, resolveCommandEntry, SiteCensusError } from "../../../src/service/site-census.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../../..");
const FIXTURE_ROOT = path.resolve(HERE, "../../fixtures/site-census-factory");

describe("census follows a factory-built subcommand", () => {
  it("fixture: the factory subcommand's run body is found and its refusal site listed", () => {
    const entry = resolveCommandEntry({ rootDir: FIXTURE_ROOT, command: "demo group rm" });
    const sites = listSites({ rootDir: FIXTURE_ROOT, entry });
    expect(sites.some((s) => s.key.endsWith("#FACTORY_REFUSAL"))).toBe(true);
  });

  it("fixture: the sibling built by the same factory resolves too", () => {
    const entry = resolveCommandEntry({ rootDir: FIXTURE_ROOT, command: "demo group add" });
    expect(() => listSites({ rootDir: FIXTURE_ROOT, entry })).not.toThrow();
  });

  it("negative: an undeclared subcommand still fails loud with entry-symbol-missing", () => {
    const entry = resolveCommandEntry({ rootDir: FIXTURE_ROOT, command: "demo group nope" });
    expect(() => listSites({ rootDir: FIXTURE_ROOT, entry })).toThrow(SiteCensusError);
    expect(() => listSites({ rootDir: FIXTURE_ROOT, entry })).toThrow(/entry-symbol-missing/);
  });

  it("real tree: autonomy regenerable add and rm succeed and list at least one site each (before the fix: entry-symbol-missing)", () => {
    const commands = ["autonomy regenerable add", "autonomy regenerable rm"];
    const lists = listSitesMany({ rootDir: REPO_ROOT, commands });
    for (const command of commands) expect(lists.get(command)?.length ?? 0).toBeGreaterThan(0);
  });
});
