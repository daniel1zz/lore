/**
 * Offline, RECORDING `gh` CLI stub for report-issue channel tests that need
 * more than `payload-gh-stub.ts` offers: a per-invocation-unique issue number
 * (so many filings into one corpus never collide on `task-gh-<repo>-<n>`), a
 * count of the issue-create POSTs the CLI really sent, a listing a test can
 * rewrite between spawns, and a switchable listing failure.
 *
 * Why not `payloadGhStubDir`: it answers every create-POST with ONE fixed
 * number, so a second filing into the same corpus fails with DUPLICATE_SLUG,
 * and it records nothing but label writes. Both are right for its own
 * consumers and wrong here; it is left untouched.
 *
 * Public surface:
 *   - `recordingGhStubDir(opts)` — writes a fresh POSIX `/bin/sh` `gh` script
 *     and returns its directory (pass it as the spawned child's whole `PATH`).
 *   - `setStubIssues(dir, issues)` — replaces the listing the stub serves.
 *   - `setNextCreatedNumber(dir, n)` / `clearNextCreatedNumber(dir)` — pin or
 *     unpin the number the NEXT create-POST answers (default: the script's
 *     own PID, unique per invocation).
 *   - `setListingFailure(dir, message | null)` — make the issue-list endpoint
 *     exit 1 with `message` on stderr, or restore it.
 *   - `readPostBodies(dir)` — one entry per create-POST the stub received.
 *   - `cleanupRecordingGhStubDir(dir)` — best-effort removal.
 *
 * Dispatch notes (same constraints `payload-gh-stub.ts` documents): the child's
 * PATH holds ONLY this directory, so the script may use shell builtins only —
 * no `cat`, no `env node`. State lives in sibling files read with `read`
 * loops; JSON is emitted with `printf '%s\n'`.
 *
 * Side-effect class: IO (one throwaway directory, one executable file).
 * Never touches the network and never touches this repo's own `.lore/`.
 */

import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ISSUES_FILE = "issues.json";
const NEXT_NUMBER_FILE = "next-number";
const LIST_FAILURE_FILE = "list-failure";
const POSTS_FILE = "posts.log";
/** Separates one recorded create-POST body from the next inside {@link POSTS_FILE}. */
const POST_SEPARATOR = "␞--post-end--␞";

/** One listing entry, shaped like `gh api repos/<repo>/issues` (labels given as plain names). */
export interface RecordingStubIssue {
  readonly number: number;
  readonly title: string;
  readonly state: "open" | "closed";
  readonly body?: string;
  readonly labels?: readonly string[];
}

export interface RecordingGhStubOptions {
  /** `gh api repos/<repo>`'s `.id` — the rename-proof key the CLI threads into `task-gh-<repoId>-<number>`. */
  readonly repoId: number;
  readonly login?: string;
  /** The listing served until a test replaces it; defaults to `[]`. */
  readonly issues?: readonly RecordingStubIssue[];
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Serialises a listing the way `gh` would (labels objectified). */
function issuesToJson(issues: readonly RecordingStubIssue[]): string {
  return JSON.stringify(issues.map((issue) => ({ ...issue, labels: (issue.labels ?? []).map((name) => ({ name })) })));
}

/** Writes a fresh recording stub; the caller owns cleanup via {@link cleanupRecordingGhStubDir}. */
export function recordingGhStubDir(options: RecordingGhStubOptions): string {
  const dir = mkdtempSync(join(tmpdir(), "lore-recording-gh-stub-"));
  writeFileSync(join(dir, ISSUES_FILE), issuesToJson(options.issues ?? []));

  const loginJson = JSON.stringify({ login: options.login ?? "recording-stub-user" });
  const repoJson = JSON.stringify({ id: options.repoId, name: "stub-repo" });

  const script = `#!/bin/sh
dir="\${0%/*}"
first="$1"
second="$2"

if [ "$first" != "api" ]; then
  echo "recording-gh-stub: unhandled non-'api' gh invocation: $*" >&2
  exit 1
fi

if [ "$second" = "user" ]; then
  printf '%s\\n' ${shellSingleQuote(loginJson)}
  exit 0
fi

is_post=0
prev=""
body=""
for arg in "$@"; do
  if [ "$prev" = "-X" ] && [ "$arg" = "POST" ]; then
    is_post=1
  fi
  case "$arg" in
    body=*) body="\${arg#body=}" ;;
  esac
  prev="$arg"
done

case "$second" in
  *"/labels")
    if [ "$is_post" = "1" ]; then
      printf '%s\\n' '{"number":0,"html_url":"https://example.test/labels"}'
      exit 0
    fi
    printf '%s\\n' '[]'
    exit 0
    ;;
  *"/labels/"*)
    exit 0
    ;;
esac

if [ "$is_post" = "1" ]; then
  number="$$"
  if [ -f "$dir/${NEXT_NUMBER_FILE}" ]; then
    read -r number < "$dir/${NEXT_NUMBER_FILE}"
  fi
  printf '%s\\n%s\\n' "$body" ${shellSingleQuote(POST_SEPARATOR)} >> "$dir/${POSTS_FILE}"
  printf '{"number":%s,"html_url":"https://example.test/%s/issues/%s"}\\n' "$number" "stub-repo" "$number"
  exit 0
fi

case "$second" in
  *"/issues?"*)
    if [ -f "$dir/${LIST_FAILURE_FILE}" ]; then
      read -r failure < "$dir/${LIST_FAILURE_FILE}"
      echo "$failure" >&2
      exit 1
    fi
    while IFS= read -r line || [ -n "$line" ]; do
      printf '%s\\n' "$line"
    done < "$dir/${ISSUES_FILE}"
    exit 0
    ;;
  repos/*/issues/[0-9]*)
    # one issue read back (retry recognition reads a prior filing's state, #397): a filed issue is open
    printf '%s\\n' '{"state":"open"}'
    exit 0
    ;;
  repos/*)
    printf '%s\\n' ${shellSingleQuote(repoJson)}
    exit 0
    ;;
esac

echo "recording-gh-stub: unrecognized gh api endpoint: $second" >&2
exit 1
`;
  const ghPath = join(dir, "gh");
  writeFileSync(ghPath, script);
  chmodSync(ghPath, 0o755);
  return dir;
}

/** Replaces the listing the stub serves from the next spawn on. */
export function setStubIssues(dir: string, issues: readonly RecordingStubIssue[]): void {
  writeFileSync(join(dir, ISSUES_FILE), issuesToJson(issues));
}

/** Pins the number the NEXT create-POST answers (stays pinned until cleared). */
export function setNextCreatedNumber(dir: string, number: number): void {
  writeFileSync(join(dir, NEXT_NUMBER_FILE), `${number}\n`);
}

/** Returns create-POST numbering to one-number-per-invocation (the stub's PID). */
export function clearNextCreatedNumber(dir: string): void {
  rmSync(join(dir, NEXT_NUMBER_FILE), { force: true });
}

/** Makes the issue-list endpoint fail with `message` on stderr (exit 1); `null` restores it. */
export function setListingFailure(dir: string, message: string | null): void {
  const path = join(dir, LIST_FAILURE_FILE);
  if (message === null) {
    rmSync(path, { force: true });
    return;
  }
  writeFileSync(path, `${message.replace(/\n/g, " ")}\n`);
}

/** The body of every create-POST the stub received, in arrival order. */
export function readPostBodies(dir: string): string[] {
  const path = join(dir, POSTS_FILE);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(`${POST_SEPARATOR}\n`)
    .filter((chunk) => chunk.length > 0);
}

/** Removes a directory returned by {@link recordingGhStubDir}. */
export function cleanupRecordingGhStubDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // reason: best-effort scratch cleanup, mirrors cleanupPayloadGhStubDir.
  }
}
