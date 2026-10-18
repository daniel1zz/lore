// @spawns scripts/check-ambient-reads.ts
/** @spec_ref AC-IV-6 */
/**
 * @layer script-unit AC-IV-6 (check:ambient-reads refuses a planted read with [AS-26]; also the --ledger-empty mode the plan's final ratchet step uses)
 * Tests for `scripts/check-ambient-reads.ts` (rule AS-26, spec D5).
 *
 * Six-dimension coverage:
 *   HAPPY:      unmodified tree exits 0 with PASS; --ledger-empty exits 0 on `{}`.
 *   NEGATIVE:   planted `os.homedir()` / `process.env` in a non-allowlisted file exits 1 printing
 *               `file:line token [AS-26]`; --ledger-empty exits 1 on a non-empty ledger.
 *   BOUNDARY:   allowlisted file may read; test files are ignored; ledger count equal passes.
 *   ERROR:      missing scan root / unparseable D5 exit 2 (never clean).
 *   STATE:      ratchet — count above AND below ledger both fail.
 *   REGRESSION: comments/strings do not count; destructuring from `process` does.
 */

import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AmbientReadCheckError,
  evaluate,
  extractD5Targets,
  scanSource,
  stripCommentsAndStrings,
} from "../check-ambient-reads.js";

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "check-ambient-reads.ts");
const TOKENS = [
  "process.env", "process.cwd(", "process.chdir(", "process.argv", "Bun.argv", "process.execPath",
  "Bun.main", "Bun.env", "homedir(", "userInfo(", "tmpdir(", "hostname(", "currentHomeDir(",
];

const D5 = [
  "**D4 — other.** `packages/x.ts`",
  "**D5 — Ambient-read check (AS-26).** scans for tokens. Banned tokens: " +
    TOKENS.map((t) => `\`${t}\``).join(", ") +
    ". Not banned by this check: `process.stdout`, `process.platform`. Allowlist (exact paths): " +
    "`packages/lore/src/index.ts`, `packages/lore/src/adapters/cli/run-cli.ts`, `packages/core/src/invocation-node.ts`, " +
    "`packages/lore/src/adapters/mcp/index.ts`, `packages/lore/src/adapters/http/index.ts`. any other ambient read is a finding.",
  "**D6 — later.** `packages/y.ts`",
].join("\n");

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function plant(files: Record<string, string>, ledger: Record<string, number> = {}): { root: string; ledger: string } {
  const root = mkdtempSync(join(tmpdir(), "ambient-"));
  dirs.push(root);
  mkdirSync(join(root, "packages/core/src"), { recursive: true });
  mkdirSync(join(root, "packages/lore/src"), { recursive: true });
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  const ledgerPath = join(root, "ledger.json");
  writeFileSync(ledgerPath, JSON.stringify(ledger));
  return { root, ledger: ledgerPath };
}

function run(args: string[]): { code: number | null; out: string } {
  const r = spawnSync("bun", [SCRIPT, ...args], { encoding: "utf8", timeout: 60_000 });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe("AC-IV-6 check:ambient-reads CLI", () => {
  it("AC-IV-6 exits 0 with PASS on the unmodified tree", () => {
    const r = run([]);
    expect(r.out).toContain("PASS");
    expect(r.code).toBe(0);
  });

  it("AC-IV-6 planted process.env read exits 1 with file:line, token and [AS-26]", () => {
    const p = plant({ "packages/core/src/planted.ts": "export const a = 1;\nexport const e = process.env.HOME;\n" });
    const r = run(["--root", p.root, "--ledger", p.ledger]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("packages/core/src/planted.ts:2 process.env [AS-26]");
  });

  it("AC-IV-6 planted os.homedir() read exits 1 with file:line, token and [AS-26]", () => {
    const p = plant({ "packages/lore/src/svc/h.ts": 'import os from "node:os";\n\nexport const h = os.homedir();\n' });
    const r = run(["--root", p.root, "--ledger", p.ledger]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("packages/lore/src/svc/h.ts:3 homedir( [AS-26]");
  });

  it("AC-IV-6 allowlisted entry file and test files do not fail", () => {
    const p = plant({
      "packages/lore/src/index.ts": "export const e = process.env.X;\n",
      "packages/lore/src/a.test.ts": "export const e = process.env.X;\n",
      "packages/lore/src/b.bun.test.ts": "export const e = process.cwd();\n",
    });
    expect(run(["--root", p.root, "--ledger", p.ledger]).code).toBe(0);
  });

  it("AC-IV-6 ledger ratchet: equal passes, above fails, below fails", () => {
    const files = { "packages/core/src/a.ts": "process.env.A;\nprocess.env.B;\n" };
    expect(run(["--root", plant(files, { "packages/core/src/a.ts": 2 }).root, "--ledger", "x"]).code).toBe(2);
    const equal = plant(files, { "packages/core/src/a.ts": 2 });
    expect(run(["--root", equal.root, "--ledger", equal.ledger]).code).toBe(0);
    const above = plant(files, { "packages/core/src/a.ts": 1 });
    expect(run(["--root", above.root, "--ledger", above.ledger]).code).toBe(1);
    const below = plant(files, { "packages/core/src/a.ts": 3 });
    const r = run(["--root", below.root, "--ledger", below.ledger]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("below ledger 3");
    expect(r.out).toContain("[AS-26]");
  });

  it("AC-IV-6 missing scan root exits 2, never clean", () => {
    const p = plant({});
    rmSync(join(p.root, "packages/lore/src"), { recursive: true });
    expect(run(["--root", p.root, "--ledger", p.ledger]).code).toBe(2);
  });
});

describe("--ledger-empty mode", () => {
  it("exits 1 while the ledger has an entry, naming it", () => {
    const p = plant({}, { "packages/core/src/a.ts": 1 });
    const r = run(["--ledger-empty", "--ledger", p.ledger]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("packages/core/src/a.ts");
    expect(r.out).toContain("[AS-26]");
  });

  it("exits 0 when the ledger is empty", () => {
    const p = plant({});
    expect(run(["--ledger-empty", "--ledger", p.ledger]).code).toBe(0);
  });
});

describe("extractD5Targets", () => {
  it("parses 13 tokens and 5 allowlist paths, stopping at the next decision", () => {
    const t = extractD5Targets(D5);
    expect(t.tokens).toEqual(TOKENS);
    expect(t.allowlist).toHaveLength(5);
    expect(t.allowlist).not.toContain("packages/x.ts");
    expect(t.tokens).not.toContain("process.platform");
  });

  it("throws on a missing D5 and on a narrowed token list", () => {
    expect(() => extractD5Targets("no decisions here")).toThrow(AmbientReadCheckError);
    expect(() => extractD5Targets(D5.replace("`Bun.env`, ", "").replace("`tmpdir(`, ", ""))).toThrow(AmbientReadCheckError);
  });
});

describe("scanSource", () => {
  it("ignores comments and string contents, keeps line numbers", () => {
    const src = ['// process.env here', "/* process.cwd()", " homedir() */", 'const s = "process.env";', "const t = `${process.argv}`;"].join("\n");
    const sites = scanSource("f.ts", src, TOKENS);
    expect(sites.map((s) => [s.line, s.token])).toEqual([[5, "process.argv"]]);
  });

  it("catches destructuring from process and imported homedir calls", () => {
    const src = 'const { env } = process;\nimport { homedir } from "node:os";\nhomedir();\n';
    const sites = scanSource("f.ts", src, TOKENS);
    expect(sites.map((s) => [s.line, s.token])).toEqual([[1, "} = process"], [3, "homedir("]]);
  });

  it("does not match longer identifiers (process.environment, myhomedir()) and counts every occurrence", () => {
    expect(scanSource("f.ts", "process.environment; myhomedir();", TOKENS)).toEqual([]);
    expect(scanSource("f.ts", "process.env.A + process.env.B", TOKENS)).toHaveLength(2);
  });

  it("stripCommentsAndStrings preserves length and newlines", () => {
    const src = 'a /* x\ny */ "q\\"z" `t${b}\nc`';
    const out = stripCommentsAndStrings(src);
    expect(out).toHaveLength(src.length);
    expect(out.split("\n")).toHaveLength(src.split("\n").length);
  });
});

describe("evaluate", () => {
  it("allowlisted file with a ledger entry is itself a failure", () => {
    const m = new Map();
    const o = evaluate(m, ["a.ts"], { "a.ts": 1 });
    expect(o.exitCode).toBe(1);
  });
});
