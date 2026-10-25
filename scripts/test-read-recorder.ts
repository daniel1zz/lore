/**
 * Per-test enforcement of declared inputs (task-skill-implement-tg-13, AC-TG-7): a vitest setup file.
 *
 * Purpose: after every test (and once for module-load and hook time) compare the repository paths the
 * test read and the programs it spawned, as recorded by scripts/test-read-log.ts, with the `@reads` /
 * `@spawns` declarations in the test file's leading comment block; fail the test, naming the test and
 * the path, when one is not declared.
 * Public surface: none (import side effect). Registered LAST in `setupFiles` of vitest.shared.ts so
 * the reads of earlier setup files are discarded rather than blamed on the test.
 * Report mode: with `LORE_TEST_READS_REPORT=<file>` set, nothing fails; each undeclared group is
 * appended to that file as one JSON line `{ testFile, label, undeclared }` (how declarations for the
 * existing suite were generated).
 * Side-effect class: registers vitest hooks; patches `Bun.file`/`Bun.spawn*` when running under Bun.
 */
import { createRequire } from "node:module";
import { afterAll, afterEach, beforeAll, beforeEach, expect } from "vitest";
import {
  clearEvents,
  recordRepoPath,
  recordSpawn,
  setCurrentLabel,
  takeUndeclaredInputs,
  toRepoRelative,
  UndeclaredTestInputError,
} from "./test-read-log";
import { rewriteLoreStart } from "./test-known-party-spawn";

const realFs = createRequire(import.meta.url)("node:fs") as { appendFileSync(path: string, data: string): void };
// reason: an EMPTY value means "not set" so a fixture run can switch an inherited report mode off.
const reportFile = process.env["LORE_TEST_READS_REPORT"] || undefined;

interface BunSpawnOptions {
  readonly cmd?: readonly string[];
  readonly cwd?: string;
}
interface BunGlobal {
  file: (path: unknown, ...rest: unknown[]) => unknown;
  spawn: (cmd: unknown, ...rest: unknown[]) => unknown;
  spawnSync: (cmd: unknown, ...rest: unknown[]) => unknown;
}

/**
 * `Bun.spawn*` arguments as a known party starts `lore` (scripts/test-known-party-spawn.ts): `(argv, options?)` or `({ cmd, ...options })`.
 * Anything that is not a `lore` start is returned unchanged.
 */
function withKnownParty(first: unknown, rest: unknown[]): [unknown, ...unknown[]] {
  if (Array.isArray(first)) {
    const options = (rest[0] ?? {}) as { cwd?: unknown; env?: unknown };
    const rewritten = rewriteLoreStart((first as unknown[]).map(String), options);
    if (rewritten === undefined) return [first, ...rest];
    const nextOptions = rewritten.env === undefined ? rest[0] : { ...options, env: rewritten.env };
    return [rewritten.argv, ...(nextOptions === undefined && rest.length <= 1 ? [] : [nextOptions]), ...rest.slice(1)];
  }
  const options = first as { cmd?: readonly string[]; cwd?: unknown; env?: unknown } | undefined;
  if (options?.cmd === undefined) return [first, ...rest];
  const rewritten = rewriteLoreStart(options.cmd.map(String), options);
  if (rewritten === undefined) return [first, ...rest];
  return [{ ...options, cmd: rewritten.argv, ...(rewritten.env === undefined ? {} : { env: rewritten.env }) }, ...rest];
}

function spawnArgv(first: unknown, second: unknown): { argv: readonly string[]; cwd: unknown } {
  const options = (Array.isArray(first) ? second : first) as BunSpawnOptions | undefined;
  const argv = Array.isArray(first) ? (first as readonly string[]) : (options?.cmd ?? []);
  return { argv, cwd: options?.cwd };
}

/** Under the Bun runtime tests may use Bun's own file and spawn APIs, which bypass node:fs and node:child_process. */
function patchBunApis(): void {
  const bun = (globalThis as { Bun?: BunGlobal }).Bun;
  if (bun === undefined) return;
  const originalFile = bun.file.bind(bun);
  bun.file = (path, ...rest) => {
    recordRepoPath(path);
    return originalFile(path, ...rest);
  };
  for (const name of ["spawn", "spawnSync"] as const) {
    const original = bun[name].bind(bun);
    bun[name] = (cmd, ...rest) => {
      const { argv, cwd } = spawnArgv(cmd, rest[0]);
      if (argv.length > 0) recordSpawn(argv[0], argv.slice(1), cwd);
      return original(...withKnownParty(cmd, rest));
    };
  }
}

function currentTestFile(): string {
  const path = expect.getState().testPath;
  if (path === undefined) throw new Error("test-read-recorder: vitest did not provide expect.getState().testPath");
  return path;
}

/** Fail (or report) every undeclared access recorded since the last check. */
function checkDeclaredInputs(): void {
  const testFile = currentTestFile();
  const groups = takeUndeclaredInputs(testFile);
  if (groups.length === 0) return;
  const repoPath = toRepoRelative(testFile) ?? testFile;
  if (reportFile !== undefined) {
    for (const group of groups) {
      realFs.appendFileSync(reportFile, `${JSON.stringify({ testFile: repoPath, label: group.label, undeclared: group.undeclared })}\n`);
    }
    return;
  }
  const first = groups[0]!;
  throw new UndeclaredTestInputError(repoPath, first.label, first.undeclared);
}

clearEvents();
setCurrentLabel("<module load>");
patchBunApis();

beforeAll(() => {
  checkDeclaredInputs();
  setCurrentLabel("<hook>");
});
beforeEach(() => {
  setCurrentLabel(expect.getState().currentTestName ?? "<unnamed test>");
});
afterEach(() => {
  try {
    checkDeclaredInputs();
  } finally {
    setCurrentLabel("<hook>");
  }
});
afterAll(() => {
  checkDeclaredInputs();
});
