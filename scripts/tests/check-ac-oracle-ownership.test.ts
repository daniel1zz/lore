// @spawns packages/lore/src/index.ts
// @reads scripts/check-ac-oracle-ownership.ts -- the AC-c case asserts nothing in it names the deleted JSON ledger
// @reads package.json -- the AC-c case asserts the chain does not name the deleted JSON ledger
// @reads scripts/ac-oracle-not-built-ledger.json -- the AC-c case asserts this file is gone
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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { extractTestFilePaths } from "../check-unclaimed-oracle.js";
import { collectScriptAcs, evaluateOwnership, extractAcReferences, mainChanged } from "../check-ac-oracle-ownership.js";
import type { ChangedFile } from "../changed-files.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LORE_ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const CHECKER = join(REPO_ROOT, "scripts", "check-ac-oracle-ownership.ts");

const cmd = (p: string): string => `bunx vitest run ${p}`;
const exists = (...present: string[]) => (p: string) => present.includes(p);

describe("check-ac-oracle-ownership — superseded criteria are not live (#313)", () => {
  it("REGRESSION: a superseded criterion naming a missing file yields no finding", () => {
    const r = evaluateOwnership(
      [{ spec: "spec-a", id: "AC-A-1", command: cmd("scripts/tests/gone.test.ts"), superseded: true }],
      [],
      exists(),
    );
    expect(r.findings).toEqual([]);
    expect(r.ledgered).toEqual([]);
  });

  it("NEGATIVE: a live criterion naming a missing file still yields missing-owner-file", () => {
    const r = evaluateOwnership(
      [
        { spec: "spec-a", id: "AC-A-1", command: cmd("scripts/tests/gone.test.ts"), superseded: true },
        { spec: "spec-a", id: "AC-A-2", command: cmd("scripts/tests/gone.test.ts") },
      ],
      [],
      exists(),
    );
    expect(r.findings).toEqual([{ rule: "missing-owner-file", spec: "spec-a", acId: "AC-A-2", path: "scripts/tests/gone.test.ts" }]);
  });

  it("BOUNDARY: a test file referencing only a superseded AC id is not reported as owned by it", () => {
    const f = "scripts/tests/a.test.ts";
    const r = evaluateOwnership(
      [{ spec: "spec-a", id: "AC-A-1", command: cmd(f), superseded: true }],
      [{ path: f, content: 'it("AC-A-1 retired", () => {});' }],
      exists(f),
    );
    expect(r.findings).toEqual([]);
    expect(r.scannedScriptAcs).toBe(0);
  });

  it("BOUNDARY: a superseded duplicate id does not make a live id ambiguous", () => {
    const f = "scripts/tests/shared.test.ts";
    const r = evaluateOwnership(
      [
        { spec: "spec-a", id: "AC-SD-1", command: cmd(f) },
        { spec: "spec-b", id: "AC-SD-1", command: cmd(f), superseded: true },
      ],
      [{ path: f, content: 'it("AC-SD-1 works", () => {});' }],
      exists(f),
    );
    expect(r.findings).toEqual([]);
  });
});

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

  it("NEGATIVE: a file referencing an AC it does not own is unowned-ac-reference, unless an @layer tag AC-SD-1 AC-TG-9 declares another entry point", () => {
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
      [{ path: other, content: '// @layer cli AC-A-1 (another entry point)\nit("AC-A-1 again", () => {});' }],
      exists(owner, other),
    );
    expect(tagged.findings).toEqual([]);
  });

  it("NEGATIVE: an @layer tag silences only the ACs it names; a bare tag and an unnamed AC still fail", () => {
    const owner = "scripts/tests/a.test.ts";
    const other = "scripts/tests/b.test.ts";
    const acs = [
      { spec: "spec-a", id: "AC-A-1", command: cmd(owner) },
      { spec: "spec-a", id: "AC-A-2", command: cmd(owner) },
    ];
    const partial = evaluateOwnership(
      acs,
      [{ path: other, content: '// @layer cli AC-A-1\nit("AC-A-1 and AC-A-2", () => {});' }],
      exists(owner, other),
    );
    expect(partial.findings).toEqual([{ rule: "unowned-ac-reference", spec: "spec-a", acId: "AC-A-2", path: other }]);
    const bare = evaluateOwnership(
      acs,
      [{ path: other, content: '// @layer cli\nit("AC-A-1", () => {});' }],
      exists(owner, other),
    );
    expect(bare.findings).toEqual([{ rule: "unowned-ac-reference", spec: "spec-a", acId: "AC-A-1", path: other }]);
    const twoTags = evaluateOwnership(
      acs,
      [{ path: other, content: '// @layer cli AC-A-1\n// @layer svc AC-A-2 (why)\nit("AC-A-1 AC-A-2", () => {});' }],
      exists(owner, other),
    );
    expect(twoTags.findings).toEqual([]);
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

describe("check-ac-oracle-ownership — deprecated specs are skipped, counted and named (AS-17)", () => {
  // a deprecated spec cannot be built in a throwaway corpus (approval needs a baseline rule chain), so the lister is injected
  const fakeRunner = ((args: readonly string[]) => {
    if (args[0] === "list") {
      return {
        ok: true,
        data: {
          docs: [
            { slug: "spec-live", status: "approved" },
            { slug: "spec-dead", status: "deprecated" },
          ],
        },
      };
    }
    const slug = args[2];
    return {
      ok: true,
      data: { criteria: [{ id: `AC-${slug === "spec-live" ? "L" : "D"}-1`, verify: { mode: "script", command: "bunx vitest run scripts/tests/x.test.ts" } }] },
    };
  }) as unknown as Parameters<typeof collectScriptAcs>[2];

  it("HAPPY: the deprecated spec's criteria are not collected; its slug is returned", () => {
    const r = collectScriptAcs("/unused", "/unused", fakeRunner);
    expect(r.acs.map((a) => `${a.spec}#${a.id}`)).toEqual(["spec-live#AC-L-1"]);
    expect(r.skippedDeprecatedSpecs).toEqual(["spec-dead"]);
  });
});

describe("check-ac-oracle-ownership — red-first declarations from the corpus (pure classifier)", () => {
  const gone = cmd("scripts/tests/gone.test.ts");

  it("AC-a: missing owner file + live allow-missing-path declaration -> ledgered with the reason, no finding", () => {
    const r = evaluateOwnership([{ spec: "spec-a", id: "AC-A-1", command: gone, allowMissingReason: "oracle not written yet" }], [], exists());
    expect(r.findings).toEqual([]);
    expect(r.ledgered).toEqual([{ spec: "spec-a", acId: "AC-A-1", path: "scripts/tests/gone.test.ts", reason: "oracle not written yet" }]);
  });

  it("AC-b: missing owner file, no declaration -> missing-owner-file finding (exit 1 path)", () => {
    const r = evaluateOwnership([{ spec: "spec-a", id: "AC-A-1", command: gone }], [], exists());
    expect(r.findings).toEqual([{ rule: "missing-owner-file", spec: "spec-a", acId: "AC-A-1", path: "scripts/tests/gone.test.ts" }]);
    expect(r.ledgered).toEqual([]);
  });

  it("BOUNDARY: a declaration whose owner file now exists is not ledgered (a redeemed declaration needs nothing)", () => {
    const r = evaluateOwnership(
      [{ spec: "spec-a", id: "AC-A-1", command: gone, allowMissingReason: "was red-first" }],
      [{ path: "scripts/tests/gone.test.ts", content: 'it("AC-A-1 holds", () => {});' }],
      exists("scripts/tests/gone.test.ts"),
    );
    expect(r.findings).toEqual([]);
    expect(r.ledgered).toEqual([]);
  });

  it("BOUNDARY: a declaration never hides an unowned-ac-reference", () => {
    const r = evaluateOwnership(
      [
        { spec: "spec-a", id: "AC-A-1", command: gone, allowMissingReason: "red-first" },
        { spec: "spec-a", id: "AC-A-2", command: cmd("scripts/tests/b.test.ts") },
      ],
      [{ path: "scripts/tests/b.test.ts", content: 'it("AC-A-1 holds", () => {});' }],
      exists("scripts/tests/b.test.ts"),
    );
    expect(r.findings.map((f) => f.rule)).toEqual(["unowned-ac-reference"]);
  });

  it("AC-c: the JSON ledger file is gone and no script or test reads it", () => {
    const name = ["ac-oracle", "not-built", "ledger.json"].join("-");
    expect(existsSync(join(REPO_ROOT, "scripts", name))).toBe(false);
    const sources = [join(REPO_ROOT, "scripts", "check-ac-oracle-ownership.ts"), join(REPO_ROOT, "package.json")];
    for (const f of sources) expect(readFileSync(f, "utf8")).not.toContain(name);
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

function addSpec(dir: string, title: string, acId: string, command: string, declare = true): string {
  const created = lore(["create", "spec", "--title", title, "--content", SPEC_BODY, "--json"], dir);
  if (created.status !== 0) throw new Error(`fixture: create spec: ${created.stderr}${created.stdout}`);
  const slug = (JSON.parse(created.stdout) as { data: { slug: string } }).data.slug;
  mustLore(
    ["ac", "add", slug, acId, "--statement", "The fixture command exits with code 0", "--mode", "script", "--oracle", "test", "--command", command, ...(declare ? ["--allow-missing-path", "fixture: path may be absent"] : []), "--json"],
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
      const absent = "scripts/tests/absent.test.ts";
      mkdirSync(join(dir, "scripts", "tests"), { recursive: true });
      writeFileSync(join(dir, absent), 'it("AC-FX-1 holds", () => {});\n', "utf8");
      const slug = addSpec(dir, "Ownership fixture missing", "AC-FX-1", cmd(absent), false);
      rmSync(join(dir, absent)); // no declaration was made, and the file is now gone
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

describe("check-ac-oracle-ownership — deprecated specs and ledger end to end", () => {
  it("declaration: a red-first AC passes and is named with its reason; once the file exists it needs nothing", () => {
    const dir = fixtureCorpus();
    try {
      const rel = "scripts/tests/later.test.ts";
      const slug = addSpec(dir, "Ownership fixture declared", "AC-FX-6", cmd(rel));
      const before = runMainAt(dir);
      expect(before.out).toContain(`ledgered spec=${slug} ac=AC-FX-6`);
      expect(before.out).toContain("reason=fixture: path may be absent");
      expect(before.status).toBe(0);
      mkdirSync(join(dir, "scripts", "tests"), { recursive: true });
      writeFileSync(join(dir, rel), 'it("AC-FX-6 holds", () => {});\n', "utf8");
      const after = runMainAt(dir);
      expect(after.out).not.toContain("ledgered spec=");
      expect(after.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
});

describe("check-ac-oracle-ownership — AC-OW-1 owners are every test file the verify command executes", () => {
  const a = "scripts/tests/a.test.ts";
  const b = "scripts/tests/b.test.ts";
  const c = "scripts/tests/c.test.ts";
  const two = `bunx vitest run ${a} ${b} -t AC-OW-X && bunx vitest run ${b} && echo 'AC-OW-X PASS: both'`;

  it("AC-OW-1 pure: both files of a two-path command may name the criterion untagged", () => {
    const r = evaluateOwnership(
      [{ spec: "spec-a", id: "AC-OW-X", command: two }],
      [
        { path: a, content: 'it("AC-OW-X holds", () => {});' },
        { path: b, content: 'it("AC-OW-X also holds", () => {});' },
      ],
      exists(a, b),
    );
    expect(r.findings).toEqual([]);
  });

  it("AC-OW-1 pure: a file outside every command naming the id is unowned-ac-reference, silenced by an @layer tag", () => {
    const acs = [{ spec: "spec-a", id: "AC-OW-X", command: `bunx vitest run ${a} ${b}` }];
    const bad = evaluateOwnership(acs, [{ path: c, content: 'it("AC-OW-X again", () => {});' }], exists(a, b, c));
    expect(bad.findings).toEqual([{ rule: "unowned-ac-reference", spec: "spec-a", acId: "AC-OW-X", path: c }]);
    const tagged = evaluateOwnership(acs, [{ path: c, content: '// @layer cli AC-OW-X\nit("AC-OW-X again", () => {});' }], exists(a, b, c));
    expect(tagged.findings).toEqual([]);
  });

  it("AC-OW-1 pure: a missing second path is missing-owner-file naming that path; echo text names no owner", () => {
    const r = evaluateOwnership(
      [{ spec: "spec-a", id: "AC-OW-X", command: `bunx vitest run ${a} ${b} && echo 'see scripts/tests/zzz.test.ts'` }],
      [{ path: a, content: 'it("AC-OW-X", () => {});' }],
      exists(a),
    );
    expect(r.findings).toEqual([{ rule: "missing-owner-file", spec: "spec-a", acId: "AC-OW-X", path: b }]);
  });

  it("AC-OW-1 pure: a red-first declaration ledgers the missing second path", () => {
    const r = evaluateOwnership(
      [{ spec: "spec-a", id: "AC-OW-X", command: `bunx vitest run ${a} ${b}`, allowMissingReason: "later" }],
      [{ path: a, content: 'it("AC-OW-X", () => {});' }],
      exists(a),
    );
    expect(r.findings).toEqual([]);
    expect(r.ledgered).toEqual([{ spec: "spec-a", acId: "AC-OW-X", path: b, reason: "later" }]);
  });

  it("AC-OW-1 pure: the same id in two specs, both running one file, stays ambiguous when referenced unqualified", () => {
    const r = evaluateOwnership(
      [
        { spec: "spec-a", id: "AC-OW-X", command: `bunx vitest run ${a} ${b}` },
        { spec: "spec-b", id: "AC-OW-X", command: `bunx vitest run ${b}` },
      ],
      [{ path: b, content: 'it("AC-OW-X", () => {});' }],
      exists(a, b),
    );
    expect(r.findings.map((f) => [f.rule, f.spec, f.path])).toEqual([
      ["ambiguous-ac-id", "spec-a", b],
      ["ambiguous-ac-id", "spec-b", b],
    ]);
  });

  it("AC-OW-1 --changed: touched b.test.ts (second path) is owned; touched c.test.ts is not", () => {
    const acs = [{ spec: "spec-a", id: "AC-OW-X", command: `bunx vitest run ${a} ${b}` }];
    const run = (path: string): { code: number; lines: string[] } => {
      const lines: string[] = [];
      const code = mainChanged(
        { changed: () => [{ path, status: "M" } as ChangedFile], scriptAcs: () => acs, readTestFile: () => 'it("AC-OW-X", () => {});' },
        (l) => lines.push(l),
      );
      return { code, lines };
    };
    expect(run(b).code).toBe(0);
    const bad = run(c);
    expect(bad.code).toBe(1);
    expect(bad.lines.join("\n")).toContain(`rule=unowned-ac-reference spec=spec-a ac=AC-OW-X path=${c}`);
  });

  it("AC-OW-1 e2e: exact exit codes of the real script over a fixture corpus", () => {
    const dir = fixtureCorpus();
    try {
      mkdirSync(join(dir, "scripts", "tests"), { recursive: true });
      for (const f of [a, b]) writeFileSync(join(dir, f), 'it("AC-FX-7 holds", () => {});\n', "utf8");
      addSpec(dir, "Ownership fixture two files", "AC-FX-7", `bunx vitest run ${a} -t AC-FX-7 && bunx vitest run ${b}`);
      expect(runMainAt(dir).status).toBe(0);
      writeFileSync(join(dir, c), 'it("AC-FX-7 elsewhere", () => {});\n', "utf8");
      const bad = runMainAt(dir);
      expect(bad.status).toBe(1);
      expect(bad.out).toContain("rule=unowned-ac-reference");
      expect(bad.out).toContain(`path=${c}`);
      writeFileSync(join(dir, c), '// @layer cli AC-FX-7\nit("AC-FX-7 elsewhere", () => {});\n', "utf8");
      expect(runMainAt(dir).status).toBe(0);
      rmSync(join(dir, b));
      const missing = runMainAt(dir);
      expect(missing.status).toBe(0); // declared red-first by addSpec: ledgered, not failed
      expect(missing.out).toContain(`path=${b}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);

  it("AC-OW-1 e2e: an undeclared missing second path exits 1 with missing-owner-file", () => {
    const dir = fixtureCorpus();
    try {
      mkdirSync(join(dir, "scripts", "tests"), { recursive: true });
      writeFileSync(join(dir, a), 'it("AC-FX-8 holds", () => {});\n', "utf8");
      writeFileSync(join(dir, b), 'it("AC-FX-8 holds", () => {});\n', "utf8");
      addSpec(dir, "Ownership fixture second missing", "AC-FX-8", `bunx vitest run ${a} ${b}`, false);
      rmSync(join(dir, b));
      const r = runMainAt(dir);
      expect(r.status).toBe(1);
      expect(r.out).toContain("rule=missing-owner-file");
      expect(r.out).toContain(`path=${b}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
});

describe("extractTestFilePaths — git pathspec exclusions are never an oracle's owner", () => {
  it("skips a quoted ':!' exclusion and returns only the real owner", () => {
    expect(
      extractTestFilePaths("git grep x -- a ':!packages/x/y.test.ts' && bun run test:file packages/z.test.ts"),
    ).toEqual(["packages/z.test.ts"]);
  });

  it("skips ':^' and ':(exclude)' magic tokens", () => {
    expect(extractTestFilePaths("git grep x -- :^p.test.ts")).toEqual([]);
    expect(extractTestFilePaths("git grep x -- ':(exclude)p.test.ts'")).toEqual([]);
  });

  it("still returns ordinary test file tokens", () => {
    expect(extractTestFilePaths("bun run test:file packages/z.test.ts")).toEqual(["packages/z.test.ts"]);
  });
});
