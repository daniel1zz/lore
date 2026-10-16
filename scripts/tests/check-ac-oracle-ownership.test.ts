/**
 * AC-TG-5 (`spec-test-governance-guards-that-refuse-bad-tests-declared`; cites AS-17):
 * `scripts/check-ac-oracle-ownership.ts` exits EXACTLY 1 naming rule, spec, AC id and path
 * when a script AC's first test file is missing or a file's unqualified AC reference is
 * ambiguous/unowned, and exits 0 when every script AC has one existing owning test file.
 *
 * Layers: pure `evaluateOwnership` cases, plus an end-to-end fixture (mkdtemp + `lore init`,
 * never this repo's own .lore/) asserting the exact exit code of the real script.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateOwnership, extractAcReferences } from "../check-ac-oracle-ownership.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LORE_ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const CHECKER = join(REPO_ROOT, "scripts", "check-ac-oracle-ownership.ts");

const cmd = (p: string): string => `bunx vitest run ${p}`;
const exists = (...present: string[]) => (p: string) => present.includes(p);

describe("check-ac-oracle-ownership — AC-TG-5 pure rules", () => {
  it("HAPPY: every script AC owns one existing file and nothing is ambiguous -> no findings", () => {
    const r = evaluateOwnership(
      [{ spec: "spec-a", id: "AC-A-1", command: cmd("scripts/tests/a.test.ts") }],
      [{ path: "scripts/tests/a.test.ts", content: 'describe("AC-A-1 holds", () => {});' }],
      exists("scripts/tests/a.test.ts"),
    );
    expect(r.findings).toEqual([]);
  });

  it("NEGATIVE: a missing owning file is reported with spec, AC id and path", () => {
    const r = evaluateOwnership(
      [{ spec: "spec-a", id: "AC-A-1", command: cmd("scripts/tests/gone.test.ts") }],
      [],
      exists(),
    );
    expect(r.findings).toEqual([
      { rule: "missing-owner-file", spec: "spec-a", acId: "AC-A-1", path: "scripts/tests/gone.test.ts" },
    ]);
  });

  it("NEGATIVE: the same AC id owned by two specs in one file, referenced unqualified, is ambiguous for both specs", () => {
    const f = "scripts/tests/shared.test.ts";
    const r = evaluateOwnership(
      [
        { spec: "spec-a", id: "AC-SD-1", command: cmd(f) },
        { spec: "spec-b", id: "AC-SD-1", command: cmd(f) },
      ],
      [{ path: f, content: 'it("AC-SD-1 works", () => {});' }],
      exists(f),
    );
    expect(r.findings.map((x) => [x.rule, x.spec, x.acId, x.path])).toEqual([
      ["ambiguous-ac-id", "spec-a", "AC-SD-1", f],
      ["ambiguous-ac-id", "spec-b", "AC-SD-1", f],
    ]);
  });

  it("BOUNDARY: spec-qualified references resolve the same duplicate id without findings", () => {
    const f = "scripts/tests/shared.test.ts";
    const r = evaluateOwnership(
      [
        { spec: "spec-a", id: "AC-SD-1", command: cmd(f) },
        { spec: "spec-b", id: "AC-SD-1", command: cmd(f) },
      ],
      [{ path: f, content: 'it("spec-a#AC-SD-1 works", () => {});\n// @spec_ref spec-b#AC-SD-1' }],
      exists(f),
    );
    expect(r.findings).toEqual([]);
  });

  it("NEGATIVE: a file referencing an AC it does not own is unowned-ac-reference, unless an @layer tag declares another entry point", () => {
    const owner = "scripts/tests/a.test.ts";
    const other = "scripts/tests/b.test.ts";
    const acs = [{ spec: "spec-a", id: "AC-A-1", command: cmd(owner) }];
    const bad = evaluateOwnership(
      acs,
      [{ path: other, content: 'it("AC-A-1 again", () => {});' }],
      exists(owner, other),
    );
    expect(bad.findings).toEqual([{ rule: "unowned-ac-reference", spec: "spec-a", acId: "AC-A-1", path: other }]);
    const tagged = evaluateOwnership(
      acs,
      [{ path: other, content: '// @layer cli\nit("AC-A-1 again", () => {});' }],
      exists(owner, other),
    );
    expect(tagged.findings).toEqual([]);
  });

  it("BOUNDARY: an id that belongs to no live spec is ignored; a command with no test file is counted, not failed", () => {
    const r = evaluateOwnership(
      [{ spec: "spec-a", id: "AC-A-1", command: "bun run typecheck" }],
      [{ path: "scripts/tests/c.test.ts", content: 'it("AC-ZZ-9 stray", () => {});' }],
      exists(),
    );
    expect(r.findings).toEqual([]);
    expect(r.acsWithoutTestFile).toBe(1);
  });

  it("extractAcReferences reads describe/it names and @spec_ref lines, marking qualified ones", () => {
    const refs = extractAcReferences('// @spec_ref spec-x#AC-Q-2\ndescribe("AC-Q-1 case", () => {});');
    expect(refs).toContainEqual({ acId: "AC-Q-2", spec: "spec-x" });
    expect(refs).toContainEqual({ acId: "AC-Q-1", spec: undefined });
  });
});

// ─── End-to-end: the real script against a throwaway corpus ─────────────────

function lore(args: string[], cwd: string): { status: number; stdout: string; stderr: string } {
  const r = spawnSync("bun", ["run", LORE_ENTRY, ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, CLAUDECODE: "1" },
  });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function mustLore(args: string[], cwd: string): void {
  const r = lore(args, cwd);
  if (r.status !== 0) throw new Error(`fixture: lore ${args.join(" ")} -> ${r.status}: ${r.stderr}${r.stdout}`);
}

function fixtureCorpus(): string {
  const dir = mkdtempSync(join(tmpdir(), "lore-ac-ownership-"));
  mustLore(["init", "--json"], dir);
  return dir;
}

const SPEC_BODY = "## Overview/Goal\n\nFixture.\n\n## Scope\n\nFixture.\n\n## Acceptance Criteria\n\nSee ac list.\n";

function addSpec(dir: string, title: string, acId: string, command: string): string {
  const created = lore(["create", "spec", "--title", title, "--content", SPEC_BODY, "--json"], dir);
  if (created.status !== 0) throw new Error(`fixture: create spec: ${created.stderr}${created.stdout}`);
  const slug = (JSON.parse(created.stdout) as { data: { slug: string } }).data.slug;
  mustLore(
    ["ac", "add", slug, acId, "--statement", "The fixture command exits with code 0", "--mode", "script", "--oracle", "test", "--command", command, "--allow-missing-path", "fixture: path may be absent", "--json"],
    dir,
  );
  return slug;
}

function runMainAt(dir: string): { status: number; out: string } {
  const driver = `import { main } from ${JSON.stringify(CHECKER)}; process.exit(main(${JSON.stringify(dir)}, ${JSON.stringify(dir)}, ${JSON.stringify(LORE_ENTRY)}));`;
  const driverPath = join(dir, "driver.mts");
  writeFileSync(driverPath, driver, "utf8");
  const r = spawnSync("bun", [driverPath], { cwd: dir, encoding: "utf8", env: { ...process.env, CLAUDECODE: "1" } });
  return { status: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

describe("check-ac-oracle-ownership — AC-TG-5 end to end (mkdtemp + lore init)", () => {
  it("package.json declares the check:ac-oracle-ownership script", () => {
    const pkg = JSON.parse(
      spawnSync("cat", [join(REPO_ROOT, "package.json")], { encoding: "utf8" }).stdout,
    ) as { scripts: Record<string, string> };
    expect(pkg.scripts["check:ac-oracle-ownership"]).toBe("bun scripts/check-ac-oracle-ownership.ts");
  });

  it("NEGATIVE: a script AC naming a missing test file exits exactly 1 naming rule, spec, AC id and path", () => {
    const dir = fixtureCorpus();
    try {
      const slug = addSpec(dir, "Ownership fixture missing", "AC-FX-1", cmd("scripts/tests/absent.test.ts"));
      const r = runMainAt(dir);
      expect(r.status).toBe(1);
      expect(r.out).toContain("rule=missing-owner-file");
      expect(r.out).toContain(`spec=${slug}`);
      expect(r.out).toContain("ac=AC-FX-1");
      expect(r.out).toContain("path=scripts/tests/absent.test.ts");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);

  it("NEGATIVE: two specs owning the same AC id in one file, referenced unqualified, exit exactly 1 with ambiguous-ac-id", () => {
    const dir = fixtureCorpus();
    try {
      const rel = "scripts/tests/shared.test.ts";
      mkdirSync(join(dir, "scripts", "tests"), { recursive: true });
      writeFileSync(join(dir, rel), 'it("AC-FX-2 works", () => {});\n', "utf8");
      const a = addSpec(dir, "Ownership fixture A", "AC-FX-2", cmd(rel));
      const b = addSpec(dir, "Ownership fixture B", "AC-FX-2", cmd(rel));
      const r = runMainAt(dir);
      expect(r.status).toBe(1);
      expect(r.out).toContain("rule=ambiguous-ac-id");
      expect(r.out).toContain(`spec=${a}`);
      expect(r.out).toContain(`spec=${b}`);
      expect(r.out).toContain(`path=${rel}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);

  it("HAPPY: one script AC with one existing owning file exits exactly 0", () => {
    const dir = fixtureCorpus();
    try {
      const rel = "scripts/tests/ok.test.ts";
      mkdirSync(join(dir, "scripts", "tests"), { recursive: true });
      writeFileSync(join(dir, rel), 'it("AC-FX-3 holds", () => {});\n', "utf8");
      addSpec(dir, "Ownership fixture ok", "AC-FX-3", cmd(rel));
      const r = runMainAt(dir);
      expect(r.out).toContain("OK");
      expect(r.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);

  it("ERROR (AS-17): a corpus with zero script ACs exits 1 with rule=nothing-scanned, never a clean 0", () => {
    const dir = fixtureCorpus();
    try {
      const r = runMainAt(dir);
      expect(r.status).toBe(1);
      expect(r.out).toContain("rule=nothing-scanned");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
});
