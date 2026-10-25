/**
 * checkReproCommand: one shell-lexable line whose program is lore, a builtin, on the injected PATH, or an existing path.
 *
 * @spec_ref spec-defect-reports-carry-their-own-context-a-checked-repro AC-RI-1
 */

import { describe, expect, it } from "vitest";

import { checkReproCommand, type ReproCheckDeps } from "../../../src/service/report-issue-repro.js";

/** `which` reading ONLY the given PATH list — never the test process's own PATH. */
function depsWithPath(onPath: readonly string[], existing: readonly string[] = ["./scripts/x.sh"]): ReproCheckDeps {
  return {
    which: (name) => onPath.includes(name),
    selfName: "lore",
    pathExists: (path) => existing.includes(path),
  };
}

const WITH_BUN = depsWithPath(["bun", "date", "echo"]);

describe("AC-RI-1", () => {
  it("accepts commands whose program resolves", () => {
    const accepted = [
      "bun run test:file a.test.ts",
      "FOO=1 bun test",
      "lore assess my-plan",
      "lore assess ",
      "cd sub && lore x",
      "echo `date`",
      "echo $(date)",
      "./scripts/x.sh",
    ];
    for (const cmd of accepted) expect(checkReproCommand(cmd, WITH_BUN), cmd).toEqual({ ok: true });
  });

  it("refuses a two-line command as multi_line", () => {
    const result = checkReproCommand("lore a\nlore b", WITH_BUN);
    expect(result).toMatchObject({ ok: false, reason: "multi_line" });
  });

  it("refuses unbalanced quotes and a trailing backslash as unlexable", () => {
    expect(checkReproCommand("echo 'unclosed", WITH_BUN)).toMatchObject({ ok: false, reason: "unlexable" });
    expect(checkReproCommand("lore x \\", WITH_BUN)).toMatchObject({ ok: false, reason: "unlexable" });
    // quoting in a LATER segment is validated too
    expect(checkReproCommand('lore x && echo "oops', WITH_BUN)).toMatchObject({ ok: false, reason: "unlexable" });
  });

  it("refuses assignments alone, and an empty command, as no_program", () => {
    expect(checkReproCommand("FOO=1", WITH_BUN)).toMatchObject({ ok: false, reason: "no_program" });
    expect(checkReproCommand("   ", WITH_BUN)).toMatchObject({ ok: false, reason: "no_program" });
  });

  it("refuses prose, naming the first word", () => {
    expect(checkReproCommand("with an old fragment: lore integrate x", WITH_BUN)).toEqual({
      ok: false,
      reason: "program_not_found",
      detail: "with",
    });
  });

  it("refuses a program missing from the injected PATH even though the test process has it", () => {
    expect(process.env["PATH"]?.length).toBeGreaterThan(0);
    expect(checkReproCommand("bun x", depsWithPath([]))).toEqual({
      ok: false,
      reason: "program_not_found",
      detail: "bun",
    });
  });

  it("refuses a slash program that does not exist, and quoted words stay one word", () => {
    expect(checkReproCommand("./missing.sh", WITH_BUN)).toMatchObject({ ok: false, detail: "./missing.sh" });
    expect(checkReproCommand('"lore" x', WITH_BUN)).toEqual({ ok: true });
    expect(checkReproCommand("'with spaces' x", WITH_BUN)).toMatchObject({ ok: false, detail: "with spaces" });
  });
});
