// @spawns packages/lore/src/index.ts
/**
 * `lore status --check-claude-md` reports an unresolved code reference in a CONSUMER repo: a
 * throwaway git repo with no lore-repo layout (no `.lore/`, no packages, no scripts), just a
 * CLAUDE.md with one bad and one good reference (N3 of
 * spec-claude-md-governance-content-dimension-checks-wire-the: arming reference findings needs
 * evidence outside this repo).
 *
 * Where a finding LANDS depends on adoption mode (BR-427): under the default `warn` it is a
 * `downgraded` advisory carrying `downgraded_kind: reference_unresolved` (exit 0, `findings: []`);
 * under `enforce` it is a deterministic finding (exit 3). The check must report it in one of the two
 * places in every mode; an empty `findings` array alone is NOT "no finding".
 *
 * Coverage: HAPPY (bad reference reported with its line, good one never) / NEGATIVE (a repo whose
 * references all resolve reports none) / BOUNDARY (warn vs enforce placement; the human output also
 * names it) / ERROR (no `package.json`: a `bun run` reference is reported as unresolved, not skipped).
 *
 * @spec_ref spec-claude-md-governance-content-dimension-checks-wire-the
 * @spec_ref spec-prose-about-code-is-bound-to-what-it-describes-one
 */

import { afterEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

const scratch: string[] = [];
afterEach(() => {
  while (scratch.length > 0) {
    const dir = scratch.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

function put(dir: string, rel: string, content: string): void {
  const full = join(dir, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

/** A plain git repo with a source file and a CLAUDE.md; nothing of lore's own layout. */
function consumerRepo(claudeMd: string): string {
  const dir = mkdtempSync(join(tmpdir(), "lore-consumer-refs-"));
  scratch.push(dir);
  const git = spawnSync("git", ["init", "-q", dir]);
  if (git.status !== 0) throw new Error(`git init failed: ${String(git.stderr)}`);
  put(dir, "src/real.ts", "export const Real = 1;\n");
  put(dir, "CLAUDE.md", claudeMd);
  return dir;
}

interface CheckJson {
  data: {
    claude_md: {
      findings: Array<{ kind: string; drift_kind?: string; line?: number; reference?: string }>;
      advisory: Array<{ kind: string; downgraded_kind?: string; reference?: string }>;
      adoption: { mode: string };
    };
  };
}

function check(dir: string): { exitCode: number; json: CheckJson["data"]["claude_md"]; human: string } {
  const env = { ...process.env, HOME: dir, EDITOR: "true", CLAUDECODE: "1" };
  const json = spawnSync("bun", ["run", INDEX_TS, "status", "--check-claude-md", "--json"], { cwd: dir, env, encoding: "utf8" });
  const human = spawnSync("bun", ["run", INDEX_TS, "status", "--check-claude-md"], { cwd: dir, env, encoding: "utf8" });
  return {
    exitCode: json.status ?? 1,
    json: (JSON.parse(json.stdout ?? "") as CheckJson).data.claude_md,
    human: `${human.stdout ?? ""}${human.stderr ?? ""}`,
  };
}

const BAD_AND_GOOD = "# Project\n\nSee `src/missing.ts` and `src/real.ts#Real`.\n";

/** Every place a would-be reference finding can appear, normalized. */
function referenceFindings(json: ReturnType<typeof check>["json"]): string[] {
  return [
    ...json.findings.filter((f) => f.kind === "reference_unresolved").map((f) => f.reference ?? ""),
    ...json.advisory.filter((f) => f.kind === "downgraded" && f.downgraded_kind === "reference_unresolved").map((f) => f.reference ?? ""),
  ];
}

describe("consumer repo: lore status --check-claude-md reports unresolved references", () => {
  it("HAPPY: under the default warn mode the bad reference is a downgraded reference_unresolved (exit 0); the good one is never reported", () => {
    const dir = consumerRepo(BAD_AND_GOOD);

    const { exitCode, json, human } = check(dir);

    expect(json.adoption.mode).toBe("warn");
    expect(exitCode).toBe(0);
    expect(referenceFindings(json)).toEqual(["src/missing.ts"]);
    expect(human).toContain("reference_unresolved");
    expect(human).toContain("CLAUDE.md:3");
    expect(human).not.toContain("src/real.ts");
  });

  it("HAPPY: under enforce the same reference is a deterministic finding with its line, exit exactly 3", () => {
    const dir = consumerRepo(BAD_AND_GOOD);
    put(dir, ".lore/config.yaml", "context:\n  memory_files:\n    adoption: enforce\n");

    const { exitCode, json } = check(dir);

    expect(exitCode).toBe(3);
    expect(json.findings.filter((f) => f.kind === "reference_unresolved")).toEqual([
      expect.objectContaining({ drift_kind: "file_missing", line: 3, reference: "src/missing.ts" }),
    ]);
  });

  it("NEGATIVE: a repo whose references all resolve reports none in either place", () => {
    const dir = consumerRepo("# Project\n\nSee `src/real.ts#Real` and `src/`.\n");

    expect(referenceFindings(check(dir).json)).toEqual([]);
  });

  it("BOUNDARY: a symbol the file does not export is reported even though the file exists", () => {
    const dir = consumerRepo("# Project\n\nSee `src/real.ts#Fake`.\n");

    expect(referenceFindings(check(dir).json)).toEqual(["src/real.ts#Fake"]);
  });

  it("ERROR: with no package.json a `bun run <script>` reference is reported, never skipped", () => {
    const dir = consumerRepo("# Project\n\nRun `bun run build`.\n");

    expect(referenceFindings(check(dir).json)).toEqual(["bun run build"]);
  });

  it("STATE: appending a bad reference after existing content is picked up on the next run", () => {
    const dir = consumerRepo("# Project\n\nSee `src/real.ts`.\n");
    expect(referenceFindings(check(dir).json)).toEqual([]);

    appendFileSync(join(dir, "CLAUDE.md"), "See `src/definitely-missing-file.ts` and `package.json#nope`.\n");

    expect(referenceFindings(check(dir).json)).toEqual(["src/definitely-missing-file.ts"]);
  }, 120_000); // 4 CLI spawns (two runs x json + human), each a cold `bun run`
});
