// @spawns dist/lore
/**
 * @spec_ref spec-a-lore-call-s-run-identity-is-injected-per-bash-call-and AC-RV-2 (BR-1055, BR-1424, BR-1218)
 *
 * End to end with the COMPILED `dist/lore`: every shell form of the spec's "Every shell form in #418" table, run through
 * `bash -c` with the per-call prefix the REAL `lore run attest-input` returns, performs a write in a throwaway corpus
 * under the run it was registered as. The run's harness process is THIS test process (registered with its pid and start
 * time), so `lore` verifies the value by process ancestry: lore <- bash <- this process.
 *
 * False green guarded: the agent harness marker (`CLAUDECODE=1`) is set in every call, so the human-session fallback
 * cannot make a write pass; the stored `harness_run` of the written document is compared with the run, not just the exit.
 *
 * Coverage:
 *   HAPPY:      every form in FORMS writes one document whose stored harness_run is the run (exit 0).
 *   NEGATIVE:   the same write with NO prefix (marker set) exits 4 and stores nothing; a fake `sudo` that resets the
 *               environment is refused with the "removed between the Bash call and lore" cause, never `lore setup`.
 *   BOUNDARY:   a negated call (`! lore ...`) exits 1 because lore succeeded, and its write still carries the run.
 *   REGRESSION: the old text rewriter missed exactly for / function / if / script / pipe forms; each is a row here.
 *
 * No mocks: real hook verb, real binary, throwaway git repo + corpus + HOME. The repo's own `.lore/` is never touched.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Database } from "bun:sqlite";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { assertFreshBinary } from "../integration/helpers/assert-fresh-binary";
import { registerRunInDb } from "../helpers/test-run-identity";
import { ensureRequirementsDocSlug } from "../helpers/parented-create";
import { templatedFieldsArgs } from "../helpers/templated-create.js";

/** `--fields-file <path>` text for the knowledge write every form performs (a temp path with no shell-special characters). */
const KNOWLEDGE_FIELDS_TEXT = templatedFieldsArgs("knowledge", { kind: "reference" }).join(" ");

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");
const SESSION = "e2e-shell-forms-session";
const RUN = `cc:${SESSION}`;
/** Exit code of a refused write with no known party (BR-1351). */
const REFUSED_EXIT = 4;

let root = "";
let corpus = "";
let fakeBin = "";

/** Hermetic env of an agent Bash call: marker set, every identity source scrubbed, `lore` first on PATH. */
function agentEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: join(root, "home"),
    XDG_CONFIG_HOME: join(root, "xdg"),
    CLAUDECODE: "1",
    EDITOR: "true",
    PATH: `${fakeBin}${delimiter}${dirname(LORE_BIN)}${delimiter}${process.env["PATH"] ?? ""}`,
  };
  for (const k of ["LORE_ACTOR", "CLAUDE_CODE_SESSION_ID", "CLAUDE_SESSION_ID", "LORE_HARNESS_RUN", "LORE_TEST_IDENTITY"]) delete e[k];
  return { ...e, ...extra };
}

interface Out {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** What the Bash hook does: ask the real verb for the rewritten command of a Bash payload. */
function prefixed(command: string): string {
  const payload = JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", session_id: SESSION, tool_input: { command } });
  const p = spawnSync(LORE_BIN, ["run", "attest-input"], { cwd: corpus, env: agentEnv({ LORE_TEST_IDENTITY: "none" }), input: payload, encoding: "utf8" });
  if (p.status !== 0) throw new Error(`attest-input exited ${p.status}: ${p.stderr}`);
  const out = JSON.parse(p.stdout) as { hookSpecificOutput: { updatedInput: { command: string } } };
  return out.hookSpecificOutput.updatedInput.command;
}

function bash(command: string): Out {
  const p = spawnSync("bash", ["-c", command], { cwd: corpus, env: agentEnv(), encoding: "utf8" });
  return { stdout: p.stdout, stderr: p.stderr, exitCode: p.status ?? -1 };
}

function mustLore(args: string[]): void {
  const p = spawnSync(LORE_BIN, args, { cwd: corpus, env: agentEnv({ LORE_HARNESS_RUN: RUN }), encoding: "utf8" });
  if (p.status !== 0) throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${p.status}): ${p.stderr}${p.stdout}`);
}

/** Stored `harness_run` of every version of the document titled `title` (empty: nothing was written). */
function storedRuns(title: string): Array<string | null> {
  const db = new Database(join(corpus, ".lore", "lore.db"), { readonly: true });
  try {
    return (db.query("SELECT harness_run FROM versions WHERE title = ?").all(title) as Array<{ harness_run: string | null }>).map((r) => r.harness_run);
  } finally {
    db.close();
  }
}

/** The lore write every form performs: one knowledge document titled `title`. */
let parentSlug = "";

const writeOf = (cmd: string, title: string): string => `${cmd} create knowledge --parent ${parentSlug} --sub-type reference --title ${title} ${KNOWLEDGE_FIELDS_TEXT} --no-ai`;

interface Form {
  readonly name: string;
  /** The command text as the agent typed it, for a unique document `title`. */
  readonly command: (title: string) => string;
  /** The exit code of the whole call (a negated call exits 1 when lore succeeded). */
  readonly exitCode?: number;
  readonly skip?: boolean;
}

const hasTimeout = spawnSync("bash", ["-c", "command -v timeout"]).status === 0;

const FORMS: readonly Form[] = [
  { name: "plain command", command: (t) => writeOf("lore", t) },
  { name: "./dist/lore relative path", command: (t) => writeOf("./dist/lore", t) },
  { name: "absolute path", command: (t) => writeOf(LORE_BIN, t) },
  { name: "&& chain", command: (t) => `cd . && true && ${writeOf("lore", t)}` },
  { name: "for loop", command: (t) => `for i in 1; do ${writeOf("lore", t)}; done` },
  { name: "shell function", command: (t) => `f() {\n  ${writeOf("lore", t)}\n}\nf` },
  { name: "if then", command: (t) => `if true; then ${writeOf("lore", t)}; fi` },
  { name: "bash script.sh indirection", command: (t) => `printf '%s\\n' '${writeOf("lore", t)}' > script-${t}.sh\nbash script-${t}.sh` },
  { name: "pipe into lore", command: (t) => `echo x | ${writeOf("lore", t)}` },
  { name: "pipe out of lore", command: (t) => `${writeOf("lore", t)} | cat` },
  { name: "negation", command: (t) => `! ${writeOf("lore", t)}`, exitCode: 1 },
  { name: "braces", command: (t) => `{ ${writeOf("lore", t)}; }` },
  { name: "env A=1", command: (t) => writeOf("env A=1 lore", t) },
  { name: "xargs", command: (t) => `echo ${t} | xargs lore create knowledge --parent ${parentSlug} --sub-type reference ${KNOWLEDGE_FIELDS_TEXT} --no-ai --title` },
  { name: "timeout", command: (t) => writeOf("timeout 5 lore", t), skip: !hasTimeout },
  { name: "exec", command: (t) => writeOf("exec lore", t) },
  { name: "command", command: (t) => writeOf("command lore", t) },
  { name: "sh -c", command: (t) => `sh -c '${writeOf("lore", t)}'` },
  { name: "command substitution", command: (t) => `echo "$(${writeOf("lore", t)} >/dev/null)"` },
  { name: "alias", command: (t) => `shopt -s expand_aliases\nalias L=lore\n${writeOf("L", t)}` },
  { name: "bun run dev", command: (t) => `bun run dev ${t}` },
];

beforeAll(() => {
  assertFreshBinary(LORE_BIN, [join(REPO_ROOT, "packages", "lore", "src"), join(REPO_ROOT, "packages", "core", "src")]);
  root = realpathSync(mkdtempSync(join(tmpdir(), "run-identity-shell-forms-")));
  if (root.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");
  mkdirSync(join(root, "home"), { recursive: true });
  mkdirSync(join(root, "xdg"), { recursive: true });
  fakeBin = join(root, "fake-bin");
  mkdirSync(fakeBin, { recursive: true });
  // A `sudo` that resets the environment like the real one by default (keeping only what a login needs and the harness marker).
  writeFileSync(join(fakeBin, "sudo"), '#!/bin/sh\nexec env -i HOME="$HOME" PATH="$PATH" CLAUDECODE="$CLAUDECODE" "$@"\n');
  chmodSync(join(fakeBin, "sudo"), 0o755);
  corpus = join(root, "corpus");
  mkdirSync(join(corpus, "dist"), { recursive: true });
  symlinkSync(LORE_BIN, join(corpus, "dist", "lore"));
  writeFileSync(join(corpus, "package.json"), JSON.stringify({ name: "fixture", scripts: {} }));
  const git = (a: string[]) => execFileSync("git", a, { cwd: corpus, stdio: ["ignore", "pipe", "pipe"] });
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "e2e@example.invalid"]);
  git(["config", "user.name", "shell forms e2e"]);
  writeFileSync(join(corpus, "README.md"), "fixture\n");
  writeFileSync(join(corpus, ".gitignore"), "dist/\nscript-*.sh\n");
  git(["add", "."]);
  git(["commit", "-q", "-m", "init"]);
  mustLore(["init"]);
  // The run's harness process is THIS process: every bash below descends from it.
  if (!registerRunInDb(join(corpus, ".lore", "lore.db"), RUN)) throw new Error("run registration found no runs table");
  // reason: a knowledge record needs a parent (spec-documents-that-need-a-parent-are-refused-without-one-an-ad D6), so the
  // fixture files a requirements document first; the `dev` script is written after it because its text names that parent.
  parentSlug = ensureRequirementsDocSlug((args) => {
    const p = spawnSync(LORE_BIN, args, { cwd: corpus, env: agentEnv({ LORE_HARNESS_RUN: RUN }), encoding: "utf8" });
    return { stdout: p.stdout, stderr: p.stderr, exitCode: p.status };
  });
  writeFileSync(
    join(corpus, "package.json"),
    JSON.stringify({ name: "fixture", scripts: { dev: `lore create knowledge --parent ${parentSlug} --sub-type reference ${KNOWLEDGE_FIELDS_TEXT} --no-ai --title` } }),
  );
});

afterAll(() => {
  if (root !== "") rmSync(root, { recursive: true, force: true });
});

describe("AC-RV-2: every shell form writes under its verified run (compiled dist/lore)", () => {
  FORMS.forEach((form, index) => {
    const title = `form${index}`;
    it.skipIf(form.skip === true)(`HAPPY: ${form.name}`, () => {
      const call = prefixed(form.command(title));
      expect(call.startsWith(`export LORE_HARNESS_RUN='${RUN}'\n`)).toBe(true);
      const result = bash(call);
      expect({ form: form.name, exit: result.exitCode, stderr: result.stderr }).toEqual({ form: form.name, exit: form.exitCode ?? 0, stderr: result.stderr });
      expect(storedRuns(title)).toEqual([RUN]);
    });
  });

  it("NEGATIVE: the same write with no prefix and the marker set is refused (exit 4) and stores nothing", () => {
    const result = bash(writeOf("lore", "unprefixed"));
    expect(result.exitCode).toBe(REFUSED_EXIT);
    expect(storedRuns("unprefixed")).toEqual([]);
  });

  it("NEGATIVE: sudo resetting the environment is refused with the 'removed' cause, and nothing is written", () => {
    const setup = spawnSync(LORE_BIN, ["setup", "--claude-dir", join(root, "home", ".claude"), "--yes"], {
      cwd: corpus,
      env: agentEnv({ PATH: "" }),
      encoding: "utf8",
    });
    // reason: PATH="" keeps the MCP registration step from reaching a real `claude`; it exits 1 after writing the files.
    expect([0, 1]).toContain(setup.status);
    const result = bash(prefixed(writeOf("sudo lore", "sudo-form")));
    expect(result.exitCode).toBe(REFUSED_EXIT);
    expect(result.stderr).toContain("removed between the Bash call and lore");
    expect(result.stderr).not.toContain("lore setup");
    expect(storedRuns("sudo-form")).toEqual([]);
  });
});
