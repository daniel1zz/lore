/**
 * @spec_ref spec-defect-reports-carry-their-own-context-a-checked-repro AC-RI-3 AC-RI-4
 *
 * Context attachment for a defect report: the named test file's `@spec_ref` lines always, its header only for the
 * upstream repository itself (origin parsed, host github.com), home folder reduced, no symlink escape.
 * Fixtures are throwaway directories; no git, no network.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { isSameGithubRepository, parseGithubRemote } from "../../../src/service/github-remote.js";
import { buildReportContext } from "../../../src/service/report-issue-context.js";
import { redactHomeInText } from "../../../src/service/redact-home.js";

const NONCE = "NONCE-7f3a91c2";
const HOME = "/Users/ri-home-user";
const SPEC_REF_ONE = " * @spec_ref spec-one AC-ONE-1";
const SPEC_REF_TWO = "// @spec_ref spec-two  weird spelling #2";

let root: string;
let outside: string;

/** A 55-line header (2 spec refs, a nonce line, a home path line), then code. */
function fixtureSource(withSpecRefs: boolean): string {
  const header: string[] = [];
  if (withSpecRefs) header.push("/*", SPEC_REF_ONE, " */", SPEC_REF_TWO);
  header.push(`// ${NONCE} this header line must stay inside the upstream repository`);
  header.push(`// reads ${HOME}/project/file.txt`);
  while (header.length < 55) header.push(`// filler header line ${String(header.length + 1)}`);
  return `${header.join("\n")}\nimport { it } from "vitest";\nit("x", () => {});\n`;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "ri-context-root-"));
  outside = mkdtempSync(join(tmpdir(), "ri-context-outside-"));
  mkdirSync(join(root, "tests"));
  writeFileSync(join(root, "tests", "x.test.ts"), fixtureSource(true));
  writeFileSync(join(root, "tests", "bare.test.ts"), fixtureSource(false));
  writeFileSync(join(outside, "secret.test.ts"), fixtureSource(true));
  symlinkSync(join(outside, "secret.test.ts"), join(root, "tests", "escape.test.ts"));
  writeFileSync(join(root, "tests", "notes.txt"), "not a test file");
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

function contextFor(command: string, originUrl: string | undefined, upstream = "owner/repo"): string | undefined {
  return buildReportContext({
    command,
    projectRoot: root,
    home: HOME,
    sameRepository: isSameGithubRepository(originUrl, upstream),
  });
}

describe("AC-RI-3", () => {
  it("same repository: path, both @spec_ref lines, the first 40 header lines, a more-lines note, home reduced to ~", () => {
    const text = contextFor("lore fragments check tests/x.test.ts", "git@github.com:Owner/Repo.git");
    expect(text).toBeDefined();
    expect(text).toContain("tests/x.test.ts");
    expect(text).toContain(SPEC_REF_ONE);
    expect(text).toContain(SPEC_REF_TWO);
    expect(text).toContain(NONCE);
    expect(text).toContain("// filler header line 40");
    expect(text).not.toContain("// filler header line 41");
    expect(text).toContain("… 15 more lines");
    expect(text).toContain("~/project/file.txt");
    expect(text).not.toContain(HOME);
  });

  it("parseGithubRemote reads ssh and https forms and rejects another host", () => {
    expect(parseGithubRemote("git@github.com:Owner/Repo.git")).toEqual({ owner: "Owner", name: "Repo" });
    expect(parseGithubRemote("https://github.com/owner/repo")).toEqual({ owner: "owner", name: "repo" });
    expect(parseGithubRemote("https://github.com/owner/repo.git")).toEqual({ owner: "owner", name: "repo" });
    expect(parseGithubRemote("git@gitlab.com:owner/repo.git")).toBeUndefined();
    expect(parseGithubRemote("not a url")).toBeUndefined();
    expect(isSameGithubRepository("https://github.com/owner/repo", "OWNER/Repo")).toBe(true);
  });

  it("a test file reached through a symlink pointing outside the project root is not read", () => {
    expect(contextFor("lore x tests/escape.test.ts", "git@github.com:owner/repo.git")).toBeUndefined();
  });

  it("a repro command naming no test file, a missing file or a non-test file gives no Context part", () => {
    expect(contextFor("lore assess my-plan", "git@github.com:owner/repo.git")).toBeUndefined();
    expect(contextFor("lore x tests/missing.test.ts", "git@github.com:owner/repo.git")).toBeUndefined();
    expect(contextFor("lore x tests/notes.txt", "git@github.com:owner/repo.git")).toBeUndefined();
  });

  it("redactHomeInText replaces every occurrence and leaves other text alone", () => {
    expect(redactHomeInText(`${HOME}/a and ${HOME}/b`, HOME)).toBe("~/a and ~/b");
    expect(redactHomeInText("nothing here", HOME)).toBe("nothing here");
    expect(redactHomeInText("/x/y", "")).toBe("/x/y");
  });
});

describe("AC-RI-4", () => {
  const cases: ReadonlyArray<[string, string | undefined]> = [
    ["another owner", "git@github.com:someone-else/repo.git"],
    ["gitlab.com with the same owner/name", "git@gitlab.com:owner/repo.git"],
    ["no origin", undefined],
    ["an unparsable origin", "/srv/git/repo.git"],
  ];

  for (const [label, origin] of cases) {
    it(`different repository (${label}): path and both @spec_ref lines, never the header`, () => {
      const text = contextFor("lore fragments check tests/x.test.ts", origin);
      expect(text).toBeDefined();
      expect(text).toContain("tests/x.test.ts");
      expect(text).toContain(SPEC_REF_ONE);
      expect(text).toContain(SPEC_REF_TWO);
      expect(text).not.toContain(NONCE);
      expect(text).not.toContain("filler header line");
      expect(text).not.toContain("more lines");
    });
  }

  it("a test file with a header but no @spec_ref says there is nothing to attach", () => {
    const text = contextFor("lore x tests/bare.test.ts", "git@gitlab.com:owner/repo.git");
    expect(text).toBe("**Context:** nothing to attach from tests/bare.test.ts");
  });

  it("the same repository with a header but no @spec_ref attaches the header, not the nothing-to-attach note", () => {
    const text = contextFor("lore x tests/bare.test.ts", "git@github.com:owner/repo.git");
    expect(text).toContain(NONCE);
    expect(text).not.toContain("nothing to attach");
  });
});
