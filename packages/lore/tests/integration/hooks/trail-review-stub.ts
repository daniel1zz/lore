/**
 * trail-review-stub.ts — test helper for the stop-turn-review suites that exercise the
 * `lore session trail-review` spawn (AC-ST-9, AC-ST-10).
 *
 * Installs a PATH stub named `lore`: it appends its argv to `calls.log`, optionally rewrites a helper
 * record while it "runs" (a SubagentStop landing during the review), then prints a canned reply and
 * exits with a canned status. Everything lives in a throwaway directory; nothing touches the real
 * `lore` binary, this repo's `.lore/` or `~/.claude`. Side-effect class: IO (tmp dirs, subprocesses).
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, runHook, type HookRun } from "./hook-harness";
import { STOP_HOOK, type TurnFixture } from "./turn-review-harness";

export interface StubReply {
  /** stdout the stub prints (default: an empty, successful trail-review). */
  readonly stdout?: string;
  /** exit status of the stub (default 0). */
  readonly exit?: number;
  /** a helper record the stub rewrites before replying: a SubagentStop that lands mid-review. */
  readonly bumpHelper?: { readonly file: string; readonly endCount: number };
  /** milliseconds the stub sleeps before replying. */
  readonly sleepMs?: number;
}

export interface LoreStub {
  readonly binDir: string;
  readonly callsFile: string;
  reply(next: StubReply): void;
  /** Every recorded invocation, as argv arrays. */
  calls(): string[][];
  /** Invocations of `session trail-review` only. */
  reviewCalls(): string[][];
}

const STUB_SOURCE = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const dir = __dirname;
fs.appendFileSync(path.join(dir, 'calls.log'), JSON.stringify(process.argv.slice(2)) + '\\n');
let reply = {};
try { reply = JSON.parse(fs.readFileSync(path.join(dir, 'reply.json'), 'utf8')); } catch {}
if (reply.bumpHelper) {
  const record = JSON.parse(fs.readFileSync(reply.bumpHelper.file, 'utf8'));
  record.end_count = reply.bumpHelper.endCount;
  fs.writeFileSync(reply.bumpHelper.file, JSON.stringify(record));
}
const finish = () => {
  if (reply.stdout !== undefined) process.stdout.write(reply.stdout);
  process.exit(reply.exit ?? 0);
};
if (reply.sleepMs) setTimeout(finish, reply.sleepMs); else finish();
`;

export const EMPTY_REVIEW = JSON.stringify({ ok: true, data: { helpers: [], findings: [] } });

/** Creates the stub directory (put `binDir` first on PATH when spawning the hook). */
export function makeLoreStub(): LoreStub {
  const binDir = makeTmpDir("lore-stub-");
  const callsFile = join(binDir, "calls.log");
  writeFileSync(join(binDir, "lore"), STUB_SOURCE);
  chmodSync(join(binDir, "lore"), 0o755);
  const stub: LoreStub = {
    binDir,
    callsFile,
    reply(next) {
      writeFileSync(join(binDir, "reply.json"), JSON.stringify({ stdout: EMPTY_REVIEW, ...next }));
    },
    calls() {
      if (!existsSync(callsFile)) return [];
      return readFileSync(callsFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as string[]);
    },
    reviewCalls() {
      return stub.calls().filter((argv) => argv.includes("trail-review"));
    },
  };
  stub.reply({});
  return stub;
}

/** Runs the Stop hook with the stub first on PATH. */
export function stopTurnWithStub(f: TurnFixture, stub: LoreStub, extra: Record<string, unknown> = {}): HookRun {
  const r = spawnSync("node", [join(__dirname, "../../../../../assets/hooks", STOP_HOOK)], {
    input: JSON.stringify({ session_id: f.sid, cwd: f.repo, hook_event_name: "Stop", stop_hook_active: false, ...extra }),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_STATE_BASE_OVERRIDE: f.base, PATH: `${stub.binDir}:${process.env.PATH ?? ""}` },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

export function helpersDir(f: TurnFixture): string {
  const dir = join(f.base, "sessions", f.sid, "helpers");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Writes `helpers/<agent>.json` as SubagentStop leaves it (end_count `endCount`). */
export function writeHelperEnd(f: TurnFixture, agent: string, endCount: number): string {
  const file = join(helpersDir(f), `${agent}.json`);
  writeFileSync(
    file,
    JSON.stringify({
      run: `cc:${f.sid}:${agent}`,
      started_at: "2026-01-01T00:00:00.000Z",
      ended_at: "2026-01-01T00:01:00.000Z",
      end_count: endCount,
      changes: { measured: false, reason: "not isolated" },
    }),
  );
  return file;
}

/** `judged_end_count` of a helper, or null when its judged file does not exist. */
export function readJudged(f: TurnFixture, agent: string): number | null {
  const file = join(helpersDir(f), `${agent}.judged.json`);
  if (!existsSync(file)) return null;
  return (JSON.parse(readFileSync(file, "utf8")) as { judged_end_count: number }).judged_end_count;
}

/** `judged_at_ms` of a helper's judged file, or null when the file or the field is absent (AU-T25). */
export function readJudgedAt(f: TurnFixture, agent: string): number | null {
  const file = join(helpersDir(f), `${agent}.judged.json`);
  if (!existsSync(file)) return null;
  const at = (JSON.parse(readFileSync(file, "utf8")) as { judged_at_ms?: number }).judged_at_ms;
  return at ?? null;
}

export { runHook };
