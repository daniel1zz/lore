// @spawns packages/lore/src/index.ts
/**
 * AC-BIND-2 (spec-prose-about-code-is-bound-to-what-it-describes-one, D1): a memory file or
 * fragment naming a package.json script that does not exist (`bun run <name>` form) yields
 * the missing-script finding; an existing script yields none.
 *
 * Drives the real CLI (`lore status --check-claude-md --json`) against mkdtemp fixtures; the
 * resolver-level cases pin the same behavior without a spawn.
 *
 * Coverage: HAPPY (missing script in a memory file and in a fragment -> exit 3,
 * drift_kind script_missing) / NEGATIVE (existing script, and `bun run <file path>`, yield
 * none) / BOUNDARY (script names with `:`, extra args after the name, npm/pnpm forms, a
 * prose mention without `run`) / ERROR (package.json missing or without scripts ->
 * probe_error, never "no finding") / STATE (a script added to package.json clears the
 * finding on the next run) / REGRESSION (a bare backticked existing script name is a
 * binding for the index, never a finding).
 *
 * @spec_ref spec-prose-about-code-is-bound-to-what-it-describes-one
 * @ac_ref AC-BIND-2
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveCodeReferences, type FsProbe } from "@lore/core";
import { extractCodeReferences } from "../../../src/service/claude-md-admission.js";
import { renderRulesFile } from "../../../src/service/context-fragments/section.js";

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

function runCheck(cwd: string): { exitCode: number; findings: Array<{ kind: string; drift_kind?: string; path?: string; line?: number; reference?: string }> } {
  const result = spawnSync("bun", ["run", INDEX_TS, "status", "--check-claude-md", "--json"], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true", CLAUDECODE: "1" },
    encoding: "utf8",
  });
  const parsed = JSON.parse(result.stdout ?? "") as { data: { claude_md: { findings: never[] } } };
  return { exitCode: result.status ?? 1, findings: parsed.data.claude_md.findings };
}

function writePackageJson(dir: string, scripts: Record<string, string>): void {
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture", scripts }, null, 2));
}

/**
 * The memory file under test. A `.claude/rules/` file is a memory file with no root-section
 * structure requirement, so the exit code reflects ONLY the reference finding.
 */
const RULES_FILE = ".claude/rules/notes.md";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lore-bind-script-"));
  mkdirSync(join(dir, ".claude", "rules"), { recursive: true });
  mkdirSync(join(dir, ".lore", "context"), { recursive: true });
  writePackageJson(dir, { build: "tsc", "test:file": "vitest run" });
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function unresolved(findings: ReturnType<typeof runCheck>["findings"]) {
  return findings.filter((f) => f.kind === "reference_unresolved");
}

describe("AC-BIND-2: bun run <script> in a memory file", () => {
  it("HAPPY: a script missing from package.json is a script_missing finding, exit exactly 3, with file:line", () => {
    writeFileSync(join(dir, RULES_FILE), "# Notes\n\nRun `bun run no-such-script` first.\n");

    const { exitCode, findings } = runCheck(dir);

    expect(exitCode).toBe(3);
    expect(unresolved(findings)).toEqual([
      expect.objectContaining({ drift_kind: "script_missing", path: RULES_FILE, line: 3, reference: "bun run no-such-script" }),
    ]);
  });

  it("NEGATIVE: an existing script (with a colon, and with trailing arguments) yields no finding, exit exactly 0", () => {
    writeFileSync(join(dir, RULES_FILE), "Run `bun run build` or `bun run test:file <path> -t <name>`.\n");

    const { exitCode, findings } = runCheck(dir);

    expect(unresolved(findings)).toEqual([]);
    expect(exitCode).toBe(0);
  });

  it("BOUNDARY: `bun run <file path>` runs a file, not a script, and a prose mention without `run` is not a reference", () => {
    writeFileSync(join(dir, RULES_FILE), "Use `bun run scripts/x.ts` or `bun run x.ts`; `bun install` and `bun test` are not scripts.\n");

    const { exitCode, findings } = runCheck(dir);

    expect(unresolved(findings).filter((f) => f.drift_kind === "script_missing")).toEqual([]);
    expect(exitCode).toBe(0);
  });

  it("STATE: adding the script to package.json clears the finding on the next run", () => {
    writeFileSync(join(dir, RULES_FILE), "Run `bun run later` first.\n");
    expect(runCheck(dir).exitCode).toBe(3);

    writePackageJson(dir, { build: "tsc", later: "echo ok" });

    const after = runCheck(dir);
    expect(unresolved(after.findings)).toEqual([]);
    expect(after.exitCode).toBe(0);
  });
});

describe("AC-BIND-2: bun run <script> in a context fragment", () => {
  const fragment = (body: string): string =>
    ["---", "id: project-fragment-under-test", "title: Fragment under test", "inject: [subagent-start]", "---", body, ""].join("\n");

  it("HAPPY: a fragment naming a missing script is a script_missing finding at its FILE line, exit exactly 3", () => {
    writeFileSync(join(dir, ".lore", "context", "frag.md"), fragment("Run `bun run no-such-script` first."));

    const { exitCode, findings } = runCheck(dir);

    expect(exitCode).toBe(3);
    expect(unresolved(findings)).toEqual([
      expect.objectContaining({ drift_kind: "script_missing", path: ".lore/context/frag.md", line: 6 }),
    ]);
  });

  it("NEGATIVE: a fragment naming an existing script yields no finding, exit exactly 0", () => {
    writeFileSync(join(dir, ".lore", "context", "frag.md"), fragment("Run `bun run build` first."));

    const { exitCode, findings } = runCheck(dir);

    expect(unresolved(findings)).toEqual([]);
    expect(exitCode).toBe(0);
  });
});

describe("AC-BIND-2: generated rules files are checked at their fragment, not at the copy", () => {
  const fragmentSource = (): string =>
    ["---", "id: gen-frag", "title: Generated", "inject: [launch]", "---", "Run `bun run no-such-script`.", ""].join("\n");

  it("NEGATIVE: a lore-managed rules file naming a missing script is not a finding; the same text hand-written is", () => {
    const rendered = renderRulesFile({
      frontmatter: { id: "gen-frag", title: "Generated", inject: ["launch"] },
      body: "Run `bun run no-such-script`.\n",
      layer: "project",
      path: ".lore/context/gen-frag.md",
      bodyLineOffset: 7,
    });
    if (!rendered.ok) throw new Error("fixture fragment must render");
    writeFileSync(join(dir, ".claude", "rules", rendered.value.fileName), rendered.value.content);

    const generated = runCheck(dir);
    expect(unresolved(generated.findings)).toEqual([]);
    expect(generated.exitCode).toBe(0);

    writeFileSync(join(dir, RULES_FILE), "Run `bun run no-such-script`.\n");
    expect(unresolved(runCheck(dir).findings)).toHaveLength(1);
    expect(fragmentSource()).toContain("no-such-script");
  });

  it("the fragment source that produced the generated file IS checked at its own line", () => {
    writeFileSync(join(dir, ".lore", "context", "gen-frag.md"), fragmentSource());

    const { exitCode, findings } = runCheck(dir);

    expect(exitCode).toBe(3);
    expect(unresolved(findings)).toEqual([expect.objectContaining({ path: ".lore/context/gen-frag.md", line: 6 })]);
  });
});

describe("AC-BIND-2: resolver-level behavior", () => {
  const withPackageJson = (content: string | null): FsProbe => ({
    stat: (p) => (p === "package.json" ? "file" : "missing"),
    readFile: () => content,
    listDir: () => [],
  });

  it("ERROR: an unparseable package.json is a probe_error finding, not 'no finding'", () => {
    const findings = resolveCodeReferences(extractCodeReferences("Run `bun run build`."), withPackageJson("{not json"));

    expect(findings.map((f) => f.kind)).toEqual(["probe_error"]);
  });

  it("ERROR: a package.json without a scripts object is a probe_error finding", () => {
    const findings = resolveCodeReferences(extractCodeReferences("Run `bun run build`."), withPackageJson('{"name":"x"}'));

    expect(findings.map((f) => f.kind)).toEqual(["probe_error"]);
  });

  it("ERROR: a missing package.json is a file_missing finding for the script reference", () => {
    const missing: FsProbe = { stat: () => "missing", readFile: () => null, listDir: () => null };

    const findings = resolveCodeReferences(extractCodeReferences("Run `bun run build`."), missing);

    expect(findings.map((f) => f.kind)).toEqual(["file_missing"]);
  });

  it("BOUNDARY: npm and pnpm spellings name scripts too; the same missing script reports once", () => {
    const findings = resolveCodeReferences(
      extractCodeReferences("`npm run gone`, `pnpm run gone`, `bun run gone` and `bun run gone --flag`."),
      withPackageJson('{"scripts":{"build":"x"}}'),
    );

    expect(findings.map((f) => f.kind)).toEqual(["script_missing"]);
    expect(findings[0]?.reference.script).toBe("gone");
  });

  it("REGRESSION: a bare backticked script name is a reference only when the script is known, and then never a finding", () => {
    const content = "See `build` and `nonscript`.";
    expect(extractCodeReferences(content)).toEqual([]);

    const references = extractCodeReferences(content, undefined, new Set(["build"]));

    expect(references.map((r) => r.script)).toEqual(["build"]);
    expect(resolveCodeReferences(references, withPackageJson('{"scripts":{"build":"x"}}'))).toEqual([]);
  });
});
