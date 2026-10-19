// @reads package.json
// @reads packages
// @reads packages/*/package.json
/**
 * task-dashboard-build-runs-the-installed-router-cli-instead-of-a: the check
 * refuses `bunx|bun x|npx <declared dependency>` in any package.json script.
 * Dimensions: HAPPY (real tree clean), NEGATIVE (undeclared pkg and quoted
 * prose allowed), BOUNDARY (scoped + versioned names, flags, chained
 * segments), ERROR (message names file, script, package), REGRESSION (the
 * dashboard router-cli shape).
 */
import { describe, expect, it } from "vitest";
import { findBunxOfDeclaredDeps, loadManifests, main, type PackageManifest } from "../check-no-bunx-of-declared-deps.js";

const pkg = (scripts: Record<string, string>, declared: string[] = []): PackageManifest => ({
  file: "packages/x/package.json",
  name: "@lore/x",
  scripts,
  declared,
});

describe("task-dashboard-build-runs-the-installed-router-cli-instead-of-a", () => {
  it("refuses the dashboard router-cli shape, naming file, script and package", () => {
    const found = findBunxOfDeclaredDeps(
      [pkg({ prebuild: "bunx @tanstack/router-cli generate", typecheck: "bunx @tanstack/router-cli generate && tsc --noEmit" }, ["@tanstack/router-cli"])],
      [],
    );
    expect(found.map((v) => [v.file, v.script, v.packageName, v.dependency])).toEqual([
      ["packages/x/package.json", "prebuild", "@lore/x", "@tanstack/router-cli"],
      ["packages/x/package.json", "typecheck", "@lore/x", "@tanstack/router-cli"],
    ]);
  });

  it("covers bun x, npx, flags, version suffixes and root-declared deps", () => {
    const scripts = { a: "bun x vitest run", b: "npx -y tsc@5.0.0 --noEmit", c: "bunx --bun vitest" };
    expect(findBunxOfDeclaredDeps([pkg(scripts)], ["vitest", "tsc"]).map((v) => v.script)).toEqual(["a", "b", "c"]);
  });

  it("allows undeclared packages and launcher words inside quoted prose", () => {
    const scripts = { a: "bunx some-undeclared-tool", b: "echo 'run bunx vitest; then done' >&2; exit 1", c: "bun --bun vitest" };
    expect(findBunxOfDeclaredDeps([pkg(scripts)], ["vitest"])).toEqual([]);
  });

  it("only flags launcher at command position, per chained segment", () => {
    expect(findBunxOfDeclaredDeps([pkg({ a: "tsc && bunx vitest" })], ["vitest"])).toHaveLength(1);
    expect(findBunxOfDeclaredDeps([pkg({ a: "grep bunx vitest file" })], ["vitest"])).toHaveLength(0);
  });

  it("this repo's real manifests are clean and main exits 0", () => {
    expect(findBunxOfDeclaredDeps(loadManifests(process.cwd()), loadManifests(process.cwd())[0]!.declared)).toEqual([]);
    expect(main()).toBe(0);
  });
});
