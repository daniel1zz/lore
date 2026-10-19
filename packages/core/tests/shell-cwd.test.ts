/**
 * @spec_ref spec-defect-clusters-round-1-done-floors-judge-real-runs-on (AC-DCL-4; D4)
 * @task task-skill-fix-dcl-4-one-cwd-aware-shell-command-parser-used-by
 *
 * Table-driven oracle for the ONE cwd-aware shell parser (`shell-cwd.ts`).
 *
 * HAPPY:      the AC's own commands; a cd in a later chain segment; env-resolved `$VAR`; quoted targets
 * NEGATIVE:   absolute cwd outside the root is `outside`; `..` above the root is `outside`
 * BOUNDARY:   subshell scoping, pipeline / background isolation, `||`, relative cds compose, absolute cd inside the root
 * ERROR:      every not-measured cause names its cause; unbalanced quotes / parens; invalid root throws
 * STATE:      assignments, `export`, not-measured is sticky within a scope and restored after `)`
 * REGRESSION: `2>&1` does not split; single quotes do not expand; a quoted `&&` / `;` does not split
 */
import { describe, expect, it } from "vitest";
import {
  ABSTRACT_ROOT,
  CWD_BUILTINS,
  InvalidShellRootError,
  parseShellCommand,
  resolvePathInSegment,
  type ShellCwd,
  type ShellEnv,
} from "../src/shell-cwd.js";

const ROOT = "/repo";

function parsed(command: string, env: ShellEnv = {}) {
  const result = parseShellCommand(command, { root: ROOT, env });
  if (result.kind !== "parsed") throw new Error(`expected a parse, got not-measured ${result.cause}: ${result.detail}`);
  return result;
}

/** Compact view of a cwd: `inside:<relative>` / `outside:<abs>` / `not-measured:<cause>`. */
function show(cwd: ShellCwd): string {
  if (cwd.kind === "inside") return `inside:${cwd.relative}`;
  if (cwd.kind === "outside") return `outside:${cwd.absolute}`;
  return `not-measured:${cwd.cause}`;
}

describe("AC-DCL-4 shell-cwd — segment cwds (table)", () => {
  const table: { name: string; command: string; env?: ShellEnv; cwds: string[]; argv0?: string[] }[] = [
    {
      name: "HAPPY: a cd in a LATER chain segment applies to what follows (#229)",
      command: "a.test.ts && cd packages/lore && bun test tests/b.bun.test.ts",
      cwds: ["inside:", "inside:", "inside:packages/lore"],
    },
    {
      name: "BOUNDARY: a ( cd … ) subshell scopes its cd (#164)",
      command: "(cd packages/lore && bun test x.bun.test.ts) && bun test y.test.ts",
      cwds: ["inside:", "inside:packages/lore", "inside:"],
    },
    {
      name: "NEGATIVE: an absolute cwd outside the root is reported outside, never resolved (#221)",
      command: "cd /outside && bun test z",
      cwds: ["inside:", "outside:/outside"],
    },
    {
      name: "BOUNDARY: an absolute cd INSIDE the root is relative to it",
      command: "cd /repo/packages/lore && bun test z",
      cwds: ["inside:", "inside:packages/lore"],
    },
    {
      name: "NEGATIVE: .. above the root is outside",
      command: "cd .. && bun test z",
      cwds: ["inside:", "outside:/"],
    },
    {
      name: "BOUNDARY: relative cds compose the way a shell does",
      command: "cd a && cd b && cd ../c && bun test f",
      cwds: ["inside:", "inside:a", "inside:a/b", "inside:a/c"],
    },
    {
      name: "HAPPY: $W given in the env resolves (#211)",
      command: "cd $W && git worktree remove .",
      env: { W: "wts/one" },
      cwds: ["inside:", "inside:wts/one"],
    },
    {
      name: "HAPPY: ${W} and a double-quoted $W resolve too",
      command: 'cd "${W}/sub" && x && cd "$W" && y',
      env: { W: "d" },
      cwds: ["inside:", "inside:d/sub", "inside:d/sub", "inside:d/sub/d"],
    },
    {
      name: "ERROR: an unset $W is not-measured naming the variable (#211)",
      command: "cd $W && git worktree remove .",
      cwds: ["inside:", "not-measured:unset-variable"],
    },
    {
      name: "ERROR: cd - is not-measured",
      command: "cd a && cd - && bun test f",
      cwds: ["inside:", "inside:a", "not-measured:cd-dash"],
    },
    {
      name: "ERROR: command substitution in a cd target is not-measured",
      command: "cd $(git rev-parse --show-toplevel) && bun test f",
      cwds: ["inside:", "not-measured:command-substitution"],
    },
    {
      name: "ERROR: a backtick cd target is not-measured",
      command: "cd `pwd`/x && bun test f",
      cwds: ["inside:", "not-measured:command-substitution"],
    },
    {
      name: "ERROR: pushd / popd are not-measured",
      command: "pushd a && bun test f && popd",
      cwds: ["inside:", "not-measured:stack-builtin", "not-measured:stack-builtin"],
    },
    {
      name: "ERROR: an unquoted glob in a cd target is not-measured",
      command: "cd packages/* && bun test f",
      cwds: ["inside:", "not-measured:glob-in-cd"],
    },
    {
      name: "ERROR: a cd joined by || is not-measured afterwards (conditional)",
      command: "cd a || exit 1; bun test f",
      cwds: ["inside:", "not-measured:conditional-cd", "not-measured:conditional-cd"],
    },
    {
      name: "ERROR: a bare cd with no HOME in the env is not-measured; with HOME it resolves",
      command: "cd && bun test f",
      cwds: ["inside:", "not-measured:unset-variable"],
    },
    {
      name: "HAPPY: a bare cd goes to $HOME",
      command: "cd && bun test f",
      env: { HOME: "/repo/home" },
      cwds: ["inside:", "inside:home"],
    },
    {
      name: "ERROR: compound keywords / groups / eval are not followed",
      command: "if true; then cd a; fi; bun test f",
      cwds: ["inside:", "not-measured:unsupported-grouping", "not-measured:unsupported-grouping", "not-measured:unsupported-grouping"],
    },
    {
      name: "ERROR: eval is not followed",
      command: "eval 'cd a' && bun test f",
      cwds: ["inside:", "not-measured:dynamic-command"],
    },
    {
      name: "ERROR: a cd option the parser does not model is not-measured",
      command: "cd -x a && bun test f",
      cwds: ["inside:", "not-measured:unsupported-cd-option"],
    },
    {
      name: "ERROR: cd with two directory arguments is not-measured",
      command: "cd a b && bun test f",
      cwds: ["inside:", "not-measured:unsupported-cd-option"],
    },
    {
      name: "BOUNDARY: cd -P / -L / -- are modelled",
      command: "cd -P -- a && bun test f",
      cwds: ["inside:", "inside:a"],
    },
    {
      name: "STATE: a not-measured subshell does not poison the outer scope",
      command: "(cd $NOPE && x) && bun test f",
      cwds: ["inside:", "not-measured:unset-variable", "inside:"],
    },
    {
      name: "STATE: a variable assigned earlier in the chain feeds a later cd",
      command: "W=wts/two && cd $W && bun test f",
      cwds: ["inside:", "inside:", "inside:wts/two"],
    },
    {
      name: "STATE: export NAME=value feeds a later cd",
      command: "export W=e && cd $W && bun test f",
      cwds: ["inside:", "inside:", "inside:e"],
    },
    {
      name: "BOUNDARY: a pipeline stage is isolated — its cd does not reach later segments",
      command: "cd a | cat && bun test f",
      cwds: ["inside:", "inside:", "inside:"],
    },
    {
      name: "BOUNDARY: a backgrounded cd is isolated",
      command: "cd a & bun test f",
      cwds: ["inside:", "inside:"],
    },
    {
      name: "BOUNDARY: ; and newline separate like &&",
      command: "cd a; bun test f\nbun test g",
      cwds: ["inside:", "inside:a", "inside:a"],
    },
    {
      name: "BOUNDARY: a quoted target with a separator inside is one word",
      command: 'cd "weird;dir" && bun test f',
      cwds: ["inside:", "inside:weird;dir"],
    },
    {
      name: "BOUNDARY: a cd to the root itself is inside with an empty relative path",
      command: "cd a && cd /repo && bun test f",
      cwds: ["inside:", "inside:a", "inside:"],
    },
    {
      name: "REGRESSION: 2>&1 is a redirection, not a background operator",
      command: "bun test f > out.txt 2>&1 && bun test g",
      cwds: ["inside:", "inside:"],
    },
    {
      name: "REGRESSION: a comment is not a segment",
      command: "cd a # then run\nbun test f",
      cwds: ["inside:", "inside:a"],
    },
  ];

  it.each(table)("$name", ({ command, env, cwds }) => {
    const parse = parsed(command, env ?? {});
    expect(parse.segments.map((segment) => show(segment.cwd))).toEqual(cwds);
  });
});

describe("AC-DCL-4 shell-cwd — the AC's named examples, end to end", () => {
  it("a.test.ts && cd packages/lore && bun test tests/b.bun.test.ts → b at packages/lore/tests/b.bun.test.ts", () => {
    const parse = parsed("a.test.ts && cd packages/lore && bun test tests/b.bun.test.ts");
    const last = parse.segments[2]!;
    expect(last.argv).toEqual(["bun", "test", "tests/b.bun.test.ts"]);
    expect(resolvePathInSegment(parse, last, "tests/b.bun.test.ts")).toEqual({
      kind: "inside",
      path: "packages/lore/tests/b.bun.test.ts",
      absolute: "/repo/packages/lore/tests/b.bun.test.ts",
    });
  });

  it("(cd packages/lore && bun test x.bun.test.ts) && bun test y.test.ts scopes the cd to the subshell", () => {
    const parse = parsed("(cd packages/lore && bun test x.bun.test.ts) && bun test y.test.ts");
    const inner = parse.segments[1]!;
    const outer = parse.segments[2]!;
    expect(resolvePathInSegment(parse, inner, "x.bun.test.ts")).toMatchObject({ kind: "inside", path: "packages/lore/x.bun.test.ts" });
    expect(resolvePathInSegment(parse, outer, "y.test.ts")).toMatchObject({ kind: "inside", path: "y.test.ts" });
    expect(inner.raw).toBe("bun test x.bun.test.ts");
  });

  it("cd /outside && bun test z → the absolute cwd outside the root is refused", () => {
    const parse = parsed("cd /outside && bun test z");
    expect(parse.segments[1]!.cwd).toEqual({ kind: "outside", absolute: "/outside" });
    expect(resolvePathInSegment(parse, parse.segments[1]!, "z")).toEqual({ kind: "outside", absolute: "/outside/z" });
  });

  it("cd $W && git worktree remove . with $W unset is not-measured NAMING $W; with $W in the env it resolves", () => {
    const unset = parsed("cd $W && git worktree remove .");
    expect(unset.segments[1]!.cwd).toEqual({ kind: "not-measured", cause: "unset-variable", detail: "$W" });
    expect(resolvePathInSegment(unset, unset.segments[1]!, ".")).toMatchObject({ kind: "not-measured", detail: "$W" });

    const given = parsed("cd $W && git worktree remove .", { W: "/repo/wts/one" });
    expect(given.segments[1]!.cwd).toEqual({ kind: "inside", relative: "wts/one", absolute: "/repo/wts/one" });
    expect(resolvePathInSegment(given, given.segments[1]!, ".")).toMatchObject({ kind: "inside", path: "wts/one" });
  });
});

describe("AC-DCL-4 shell-cwd — whole-command not-measured and caller errors", () => {
  it.each([
    ["unbalanced single quote", "cd 'a && bun test f", "unbalanced-quotes"],
    ["unbalanced double quote", 'cd "a && bun test f', "unbalanced-quotes"],
    ["unbalanced backtick", "cd `a && bun test f", "unbalanced-quotes"],
    ["unterminated $(", "cd $(a && bun test f", "unbalanced-parentheses"],
    ["unmatched )", "bun test f) && x", "unbalanced-parentheses"],
    ["unclosed (", "(cd a && bun test f", "unbalanced-parentheses"],
    ["( after a command word", "echo (a)", "unsupported-grouping"],
  ])("%s → not-measured %s", (_name, command, cause) => {
    const result = parseShellCommand(command, { root: ROOT, env: {} });
    expect(result.kind).toBe("not-measured");
    if (result.kind === "not-measured") expect(result.cause).toBe(cause);
  });

  it("rejects a relative root with a typed error instead of defaulting", () => {
    expect(() => parseShellCommand("cd a", { root: "repo", env: {} })).toThrow(InvalidShellRootError);
  });

  it("a trailing slash and . / .. in the root are normalised", () => {
    const result = parseShellCommand("cd a", { root: "/repo/x/../", env: {} });
    expect(result.kind === "parsed" && result.root).toBe("/repo");
  });

  it("the abstract root works as a stand-in and a / root classifies everything as inside", () => {
    const abstract = parseShellCommand("cd a && x", { root: ABSTRACT_ROOT, env: {} });
    expect(abstract.kind === "parsed" && show(abstract.segments[1]!.cwd)).toBe("inside:a");
    const slash = parseShellCommand("cd /etc && x", { root: "/", env: {} });
    expect(slash.kind === "parsed" && show(slash.segments[1]!.cwd)).toBe("inside:etc");
  });
});

describe("AC-DCL-4 shell-cwd — argv and unresolved expansions", () => {
  it("removes quotes, keeps single-quoted text literal, expands $VAR in double quotes", () => {
    const parse = parsed(`echo '$W' "$W" $W "a b" 'c d'`, { W: "x" });
    expect(parse.segments[0]!.argv).toEqual(["echo", "$W", "x", "x", "a b", "c d"]);
    expect(parse.segments[0]!.unresolved).toEqual([]);
  });

  it("lists an unresolvable expansion in a NON-cd word without disturbing the cwd", () => {
    const parse = parsed("echo $NOPE && bun test f");
    expect(parse.segments[0]!.unresolved).toEqual([{ kind: "not-measured", cause: "unset-variable", detail: "$NOPE" }]);
    expect(parse.segments[0]!.argv).toEqual(["echo", "$NOPE"]);
    expect(show(parse.segments[1]!.cwd)).toBe("inside:");
  });

  it("an unquoted value containing whitespace is not guessed at (it would be word-split)", () => {
    const parse = parsed("cd $W && x", { W: "a b" });
    expect(show(parse.segments[1]!.cwd)).toBe("not-measured:unsupported-expansion");
  });

  it("special parameters and ${VAR:-x} are named unsupported, not guessed", () => {
    expect(show(parsed("cd ${W:-x} && y").segments[1]!.cwd)).toBe("not-measured:unsupported-expansion");
    expect(show(parsed("cd $? && y").segments[1]!.cwd)).toBe("not-measured:unsupported-expansion");
  });

  it("leading NAME=value assignments are not argv", () => {
    const parse = parsed("CI=1 bun test f");
    expect(parse.segments[0]!.argv).toEqual(["bun", "test", "f"]);
  });

  it("a quoted && or ; does not split", () => {
    const parse = parsed(`bun test -t "a && b; c" f && x`);
    expect(parse.segments).toHaveLength(2);
    expect(parse.segments[0]!.argv).toEqual(["bun", "test", "-t", "a && b; c", "f"]);
  });

  it("records the uncomposed literal target of the last cd (legacy answer kept by commandRunsFileUnfiltered)", () => {
    const parse = parsed("cd a && cd b && bun test f");
    expect(parse.segments[2]!.lastCdTarget).toBe("b");
    expect(parse.segments[0]!.lastCdTarget).toBeNull();
  });

  it("CWD_BUILTINS lists every directory-changing builtin consumers must classify through", () => {
    expect([...CWD_BUILTINS]).toEqual(["cd", "pushd", "popd"]);
  });
});
