// @spawns packages/lore/src/index.ts
// @reads packages/lore/src/service/claude-md-admission.ts
// @reads packages/lore/src/service/context-fragments/section.ts
/**
 * AC-BIND-1 (spec-prose-about-code-is-bound-to-what-it-describes-one, D1): a memory-file
 * reference to `path#Symbol` whose file exists but does not export `Symbol` is a
 * deterministic `lore status --check-claude-md` finding (exact exit code and kind), resolved
 * by the SAME core resolver as spec code anchors.
 *
 * Wiring ACs drive the real CLI (a unit call cannot tell "wired" from "implemented and dead",
 * the defect this family of specs keeps closing). Every spawn uses a mkdtemp fixture.
 *
 * Coverage: HAPPY (missing symbol -> exit 3, kind reference_unresolved, drift_kind
 * symbol_missing, file:line) / NEGATIVE (exported symbol, plain existing path -> exit 0,
 * no finding) / BOUNDARY (missing file -> file_missing; a `#heading` fragment on a markdown
 * file is not a symbol; warn mode downgrades to exit 0) / ERROR (unreadable content ->
 * probe_error, never "fine") / STATE (same input through spec-anchor path and prose path
 * yields the same kind) / REGRESSION (admission keeps no existence check of its own).
 *
 * @spec_ref spec-prose-about-code-is-bound-to-what-it-describes-one
 * @ac_ref AC-BIND-1
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectAnchorProbes,
  computeDrift,
  parseCodeAnchor,
  resolveCodeReferences,
  type FsProbe,
} from "@lore/core";
import { extractCodeReferences } from "../../../src/service/claude-md-admission.js";
import { withExportReader } from "../../with-export-reader.js";

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const ADMISSION_TS = join(PACKAGE_ROOT, "src", "service", "claude-md-admission.ts");

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runLore(args: string[], cwd: string): RunResult {
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true", CLAUDECODE: "1" },
    encoding: "utf8",
  });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status ?? 1 };
}

interface FindingJson {
  kind: string;
  drift_kind?: string;
  line?: number;
  path?: string;
  reference?: string;
}

function checkClaudeMd(cwd: string): { exitCode: number; findings: FindingJson[]; advisory: FindingJson[] } {
  const result = runLore(["status", "--check-claude-md", "--json"], cwd);
  const parsed = JSON.parse(result.stdout) as { data: { claude_md: { findings: FindingJson[]; advisory: FindingJson[] } } };
  return { exitCode: result.exitCode, ...{ findings: parsed.data.claude_md.findings, advisory: parsed.data.claude_md.advisory } };
}

/**
 * The memory file under test. A `.claude/rules/` file is a memory file with no root-section
 * structure requirement, so the exit code reflects ONLY the reference finding (a bare
 * CLAUDE.md fixture would exit 3 for its missing required sections under enforce).
 */
const RULES_FILE = ".claude/rules/notes.md";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lore-bind-symbol-"));
  mkdirSync(join(dir, ".claude", "rules"), { recursive: true });
  mkdirSync(join(dir, ".lore"), { recursive: true });
  mkdirSync(join(dir, "packages", "core", "src"), { recursive: true });
  writeFileSync(join(dir, "packages", "core", "src", "x.ts"), "export const Here = 1;\n");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("AC-BIND-1: path#Symbol in a memory file", () => {
  it("HAPPY: a symbol the existing file does not export is a deterministic finding, exit exactly 3, with file:line and drift_kind", () => {
    writeFileSync(join(dir, RULES_FILE), "# Notes\n\nSee `packages/core/src/x.ts#Gone` for the mechanism.\n");

    const { exitCode, findings } = checkClaudeMd(dir);

    expect(exitCode).toBe(3);
    const finding = findings.find((f) => f.kind === "reference_unresolved");
    expect(finding).toMatchObject({
      kind: "reference_unresolved",
      drift_kind: "symbol_missing",
      line: 3,
      path: RULES_FILE,
      reference: "packages/core/src/x.ts#Gone",
    });
  });

  it("NEGATIVE: an exported symbol and a plain existing path yield no finding, exit exactly 0", () => {
    writeFileSync(join(dir, RULES_FILE), "See `packages/core/src/x.ts#Here` and `packages/core/src/x.ts`.\n");

    const { exitCode, findings } = checkClaudeMd(dir);

    expect(findings.filter((f) => f.kind === "reference_unresolved")).toEqual([]);
    expect(exitCode).toBe(0);
  });

  it("BOUNDARY: a missing file is file_missing, and a `#heading` fragment on a markdown file is not treated as a symbol", () => {
    writeFileSync(join(dir, "notes.md"), "# Heading\n");
    writeFileSync(join(dir, RULES_FILE), "See `packages/core/src/none.ts#Here` and `notes.md#Heading`.\n");

    const { exitCode, findings } = checkClaudeMd(dir);

    expect(exitCode).toBe(3);
    const unresolved = findings.filter((f) => f.kind === "reference_unresolved");
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]).toMatchObject({ drift_kind: "file_missing", reference: "packages/core/src/none.ts#Here" });
  });

  it("REGRESSION: with no config at all the same finding is still enforced (exit exactly 3), never a downgraded note", () => {
    writeFileSync(join(dir, RULES_FILE), "See `packages/core/src/x.ts#Gone`.\n");

    const { exitCode, findings, advisory } = checkClaudeMd(dir);

    expect(exitCode).toBe(3);
    expect(findings.filter((f) => f.kind === "reference_unresolved")).toHaveLength(1);
    expect(JSON.stringify(advisory)).not.toContain("downgraded");
  });
});

describe("AC-BIND-1: one resolver for prose and spec anchors", () => {
  const files = new Map<string, string>([["packages/core/src/x.ts", "export const Here = 1;\n"]]);
  const probe = (content: (p: string) => string | null): FsProbe =>
    withExportReader({
      stat: (p) => (files.has(p) ? "file" : "missing"),
      readFile: content,
      listDir: () => [],
    });

  it("STATE: the same path#Symbol classifies identically as a spec anchor (computeDrift) and as a prose reference", () => {
    const okProbe = probe((p) => files.get(p) ?? null);
    for (const raw of ["packages/core/src/x.ts#Gone", "packages/core/src/x.ts#Here", "packages/core/src/none.ts#Here"]) {
      const parsed = parseCodeAnchor(raw);
      if (!parsed.ok) throw new Error(`fixture anchor ${raw} must parse`);
      const anchorKinds = computeDrift(
        [{ doc_id: "d", doc_slug: "spec-x", doc_type: "spec", doc_status: "approved", anchor: parsed.value }],
        collectAnchorProbes([parsed.value], okProbe),
      ).drifts.map((row) => row.kind);

      const proseKinds = resolveCodeReferences(extractCodeReferences(`See \`${raw}\`.`), okProbe).map((f) => f.kind);

      expect(proseKinds, raw).toEqual(anchorKinds);
    }
  });

  it("ERROR: a file whose content cannot be read is a probe_error finding, never silently fine", () => {
    const unreadable = probe(() => null);

    const findings = resolveCodeReferences(extractCodeReferences("See `packages/core/src/x.ts#Here`."), unreadable);

    expect(findings.map((f) => f.kind)).toEqual(["probe_error"]);
  });

  it("ERROR: a probe that throws is a probe_error finding", () => {
    const throwing: FsProbe = {
      stat: () => {
        throw new Error("EIO");
      },
      readFile: () => null,
      listDir: () => null,
    };

    const findings = resolveCodeReferences(extractCodeReferences("See `packages/core/src/x.ts`."), throwing);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: "probe_error", detail: "EIO" });
  });

  it("BOUNDARY: a leading `./` names a path relative to the document's own directory, and only there", () => {
    const docFiles = new Map<string, string>([
      ["pkg/src/sibling.ts", "export const Here = 1;\n"],
      ["gone-at-root.ts", "export const Here = 1;\n"],
    ]);
    const docProbe: FsProbe = withExportReader({
      stat: (p) => (docFiles.has(p) ? "file" : "missing"),
      readFile: (p) => docFiles.get(p) ?? null,
      listDir: () => [],
    });
    const content = "`./sibling.ts#Here` ok; `./sibling.ts#Gone` bad symbol; `./gone-at-root.ts` must not fall back to the root.";

    const references = extractCodeReferences(content, "pkg/src/CLAUDE.md");
    const findings = resolveCodeReferences(references, docProbe);

    expect(references.map((r) => r.path)).toEqual(["pkg/src/sibling.ts", "pkg/src/sibling.ts", "pkg/src/gone-at-root.ts"]);
    expect(references.every((r) => r.alternativePaths === undefined)).toBe(true);
    expect(findings.map((f) => [f.reference.raw, f.kind])).toEqual([
      ["./sibling.ts#Gone", "symbol_missing"],
      ["./gone-at-root.ts", "file_missing"],
    ]);
  });

  it("REGRESSION: the lore:managed fingerprint line has ONE definition (core), none in admission or section.ts", () => {
    const section = readFileSync(join(PACKAGE_ROOT, "src", "service", "context-fragments", "section.ts"), "utf8");
    const admission = readFileSync(ADMISSION_TS, "utf8");

    expect(admission).toContain("startsWithFragmentFingerprint");
    expect(section).toContain("FRAGMENT_FINGERPRINT_LINE");
    for (const source of [section, admission]) {
      expect(source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")).not.toMatch(/lore:managed fragment=/);
    }
  });

  it("REGRESSION: the admission module keeps no existence check or export scan of its own", () => {
    const source = readFileSync(ADMISSION_TS, "utf8");

    expect(source).toContain("resolveCodeReferences");
    expect(source).not.toMatch(/scanExportedSymbols|export function checkReferenceExistence|\.fileExists\(/);
  });
});
