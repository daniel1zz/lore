/**
 * @layer script-unit (recorder wrapper modules; the AC's oracle is the changed-tests declared-inputs suite)
 * Guards for the declared-input recorder's wrapper modules (task-skill-implement-tg-13, AC-TG-7):
 * the alias targets must export every name the real module exports (a missing name would turn a
 * named import into `undefined` without any error), the alias regexes must match exactly the
 * module specifiers tests use, and the mock redirect must point `vi.mock("node:fs")` at the wrapper.
 *
 * Coverage: HAPPY (export parity, alias match, redirect rewrite), NEGATIVE (unrelated specifiers and
 * unrelated vi.mock targets untouched), BOUNDARY (`node:` prefix optional, `fs` vs `fs/promises`),
 * STATE (wrapped readers record, pass-through values are identical), REGRESSION (`util.promisify.custom`
 * of fs.exists survives wrapping).
 */
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import * as recordedChildProcess from "../test-recorded-child-process";
import * as recordedFs from "../test-recorded-fs";
import * as recordedFsPromises from "../test-recorded-fs-promises";
import { RECORDED_MODULES, readRecorderAliases, readRecorderMockRedirect } from "../test-read-aliases";
import { clearEvents, setCurrentLabel, takeUndeclaredInputs, wrapFsModule } from "../test-read-log";

const nodeRequire = createRequire(import.meta.url);
const REPO = "/repo";

describe("AC-TG-7 recorder wrappers export everything the real module exports", () => {
  const cases = [
    ["node:fs", recordedFs],
    ["node:fs/promises", recordedFsPromises],
    ["node:child_process", recordedChildProcess],
  ] as const;
  for (const [name, wrapper] of cases) {
    it(`AC-TG-7 HAPPY: every identifier-named export of ${name} on this runtime is exported by its wrapper`, () => {
      const real = nodeRequire(name) as Record<string, unknown>;
      const missing = Object.keys(real).filter((key) => /^[A-Za-z$][\w$]*$/.test(key) && !(key in wrapper));
      expect(missing).toEqual([]);
    });
  }
});

describe("AC-TG-7 alias entries and mock redirect", () => {
  const aliases = readRecorderAliases(REPO);
  const aliasFor = (specifier: string) => aliases.find((a) => a.find.test(specifier))?.replacement;

  it("AC-TG-7 HAPPY/BOUNDARY: fs, fs/promises and child_process match with and without the node: prefix, each to its own wrapper", () => {
    expect(aliasFor("fs")).toBe("/repo/scripts/test-recorded-fs.ts");
    expect(aliasFor("node:fs")).toBe("/repo/scripts/test-recorded-fs.ts");
    expect(aliasFor("fs/promises")).toBe("/repo/scripts/test-recorded-fs-promises.ts");
    expect(aliasFor("node:fs/promises")).toBe("/repo/scripts/test-recorded-fs-promises.ts");
    expect(aliasFor("child_process")).toBe("/repo/scripts/test-recorded-child-process.ts");
    expect(RECORDED_MODULES).toHaveLength(3);
  });

  it("AC-TG-7 NEGATIVE: look-alike specifiers (fs-extra, node:fsx, ./fs) are not aliased", () => {
    for (const specifier of ["fs-extra", "node:fsx", "./fs", "node:path", "node:os"]) expect(aliasFor(specifier)).toBeUndefined();
  });

  it("AC-TG-7 HAPPY: vi.mock / vi.doMock of node:fs, fs/promises, child_process are rewritten to the wrapper path", () => {
    const plugin = readRecorderMockRedirect(REPO);
    // reason: the receiver is spliced in so this file's own source does not match the plugin's pattern
    // (the plugin rewrites test sources, including string literals that look like a mock call).
    const vi = "vi";
    const out = plugin.transform(`${vi}.mock("node:fs", () => ({}));\n${vi}.doMock('fs/promises');\n${vi}.unmock("child_process");`);
    expect(out?.code).toContain('vi.mock("/repo/scripts/test-recorded-fs.ts"');
    expect(out?.code).toContain("vi.doMock('/repo/scripts/test-recorded-fs-promises.ts'");
    expect(out?.code).toContain('vi.unmock("/repo/scripts/test-recorded-child-process.ts"');
  });

  it("AC-TG-7 NEGATIVE: a vi.mock of another module, and a file with no vi.mock, are left alone (null = untouched)", () => {
    const plugin = readRecorderMockRedirect(REPO);
    expect(plugin.transform(`${"vi"}.mock("node:path");`)).toBeNull();
    expect(plugin.transform("const a = 1;")).toBeNull();
  });
});

describe("AC-TG-7 wrapped fs readers", () => {
  it("AC-TG-7 STATE: a wrapped reader records the path, then returns exactly what the real call returns", () => {
    clearEvents();
    setCurrentLabel("wrapped-reader");
    const realFs = nodeRequire("node:fs") as typeof import("node:fs");
    const wrapped = wrapFsModule(realFs);
    const text = wrapped.readFileSync(new URL("../test-read-log.ts", import.meta.url), "utf8");
    expect(text).toContain("takeUndeclaredInputs");
    // this very test file declares nothing, so the read of scripts/test-read-log.ts is reported undeclared
    const groups = takeUndeclaredInputs(new URL(import.meta.url).pathname);
    expect(groups).toEqual([{ label: "wrapped-reader", undeclared: [{ kind: "read", path: "scripts/test-read-log.ts" }] }]);
    expect(wrapped.constants).toBe(realFs.constants);
  });

  it("AC-TG-7 REGRESSION: fs.exists keeps its util.promisify.custom behaviour through the wrapper", async () => {
    const realFs = nodeRequire("node:fs") as typeof import("node:fs");
    const wrapped = wrapFsModule(realFs);
    clearEvents();
    expect(await promisify(wrapped.exists)("/definitely/not/here/ever")).toBe(false);
  });
});
