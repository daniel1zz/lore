/**
 * Deterministic, PAYLOAD-SERVING `gh` CLI stub — a sibling to
 * `healthy-gh-stub.ts`'s always-`exit 0`-empty-stdout stub, built for a
 * different consumer shape.
 *
 * `healthyGhStubDir()` (this directory) is `#!/bin/sh\nexit 0` with EMPTY
 * stdout BY DESIGN — its only consumer (`runGitHubHealthCheck`) inspects
 * exit codes alone. `GitHubIntakePort` does NOT: `verifyTarget`/
 * `searchDuplicates`/`fileIssue` each `JSON.parse` the stub's stdout
 * (`GithubUserSchema`/`GithubRepoSchema`/`GithubIssueListSchema`/
 * `GithubCreatedIssueSchema`), so pointing them at the empty-stdout stub
 * produces a `VALIDATION_ERROR` that LOOKS like a real defect in the
 * caller's own code — a false red measured while building this file's
 * consumer (spec-a-github-filed-defect-must-be-claimable-one-ingest-seam,
 * Downstream Handoff). `healthyGhStubDir` itself is NEVER widened to serve
 * payloads — its existing `--check` consumers depend on its silence.
 *
 * Public surface:
 *   - `payloadGhStubDir(fixture)` — writes a fresh, one-shot POSIX `/bin/sh`
 *     `gh` script (never memoized/shared across calls, unlike
 *     `healthyGhStubDir` — each test scenario needs its OWN issue number/
 *     repo id/duplicates list) and returns its containing directory.
 *   - `PayloadGhStubFixture` — the four calls
 *     `GitHubIntakePort.verifyTarget`/`.searchDuplicates`/`.fileIssue`
 *     make, and what each caller-configurable field controls.
 *   - `readRecordedLabelWrites(dir)` — AC-GR-3's label-round-trip oracle:
 *     `GhResolutionLabelPort.setLabel` (`resolution-label-port.ts`) issues a
 *     GET-then-POST/DELETE convergence sequence against
 *     `repos/<repo>/issues/<n>/labels[...]`; this stub answers the GET with
 *     an always-empty label list (no test using this fixture needs a
 *     pre-existing `resolution:*` label to converge away) and, on the POST
 *     add call, appends `<endpoint>\t<label>` to `dir`'s
 *     `label-writes.log` instead of merely returning a 200 — a caller that
 *     only asserted the CLI's own exit code would prove the corpus write
 *     landed, never that the label call actually reached this stub with the
 *     right issue number and label string.
 *
 * Dispatch mechanism: the written script is a POSIX `/bin/sh` script (never
 * `#!/usr/bin/env node` — measured: with the spawned child's `PATH` pinned
 * to JUST this stub directory, `env node` cannot resolve `node` at all and
 * fails `exit 127` before the stub logic ever runs; `/bin/sh` needs no PATH
 * lookup for its OWN interpreter, since the kernel execs the shebang's
 * absolute path directly). Each JSON payload is emitted via the shell's
 * `printf '%s\n'` BUILTIN on a single-quoted literal — never `cat
 * <<HEREDOC` (ALSO measured: with `PATH` pinned to just this stub
 * directory, `cat` itself cannot be resolved either, since it is an
 * external binary, not a shell builtin — the exact same class of failure
 * `env node` hit, one layer deeper) and never the `echo` builtin (some
 * `/bin/sh` implementations, e.g. `dash`, interpret backslash escapes in
 * `echo`'s argument by default — a JSON string containing `\"` would be
 * silently mangled; `printf`'s `%s` conversion never reinterprets its
 * argument). {@link shellSingleQuote} escapes any embedded `'` so a
 * caller-supplied duplicate-issue title containing one cannot break out of
 * the literal. Dispatch order matters: the issue-list endpoint and the bare
 * repo-metadata endpoint share the `repos/<repo>` prefix, so the LIST check
 * (`case "$second" in *"/issues?"*`) runs BEFORE the generic `repos/*`
 * fallback; the POST check (a `for` loop over `"$@"` matching a `-X`
 * immediately followed by `POST`, since the flag's position in argv is not
 * fixed) runs before either, since a create-issue POST also targets
 * `repos/<repo>/issues`.
 *
 * Side-effect class: IO (writes one throwaway directory + one executable
 * file per call — caller owns cleanup, mirroring `healthy-gh-stub.ts`'s
 * "the caller MUST register cleanup itself" contract).
 *
 * Source: spec-a-github-filed-defect-must-be-claimable-one-ingest-seam,
 *   Downstream Handoff ("A NEW payload-serving gh stub is required").
 */

import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Filename (inside the stub dir `payloadGhStubDir` returns) that
 * `GhResolutionLabelPort.setLabel`'s POST-add call is recorded to — one
 * tab-separated `<endpoint>\t<label>` line per add. AC-GR-3's load-bearing
 * assertion (the label round-trip actually reached "GitHub") reads this
 * file back via {@link readRecordedLabelWrites}; nothing else in this
 * module consumes it.
 */
const LABEL_WRITES_FILENAME = "label-writes.log";

/** One recorded `resolution:<state>` label POST, decoded from {@link LABEL_WRITES_FILENAME}. */
export interface RecordedLabelWrite {
  /** The `owner/repo` segment of the `gh api repos/<repo>/issues/<n>/labels` endpoint the stub matched. */
  readonly repo: string;
  /** The issue number segment of that same endpoint. */
  readonly issueNumber: number;
  /** The exact `labels[]=<value>` payload value the stub's POST call carried. */
  readonly label: string;
}

/**
 * One duplicate-search / listing hit `searchDuplicates`/`listIssues` can be
 * made to see, shaped exactly as `gh api repos/<repo>/issues?...` returns
 * it (`number`/`title`/`state`/`body`/`labels` are read — `labels` by
 * `commands/issues.ts`'s `--verify` against a GitHub-configured
 * `feedback.upstream`, spec-a-github-filed-defect-must-be-claimable-one-
 * ingest-seam). `labels` is plain label NAME strings here for ergonomics —
 * {@link payloadGhStubDir} objectifies each into `gh`'s real `{name: ...}`
 * shape when serialising, and defaults to `[]` when omitted (GitHub's real
 * payload always carries the key, never omits it, even with zero labels).
 */
export interface PayloadGhStubIssue {
  readonly number: number;
  readonly title: string;
  readonly state: "open" | "closed";
  readonly body?: string;
  readonly labels?: readonly string[];
}

/**
 * Every value a `PayloadGhStubFixture` caller can pin. Field-to-call map:
 *   - `login` → `gh api user`'s `.login` (`verifyTarget`'s auth check).
 *   - `repoId` → `gh api repos/<repo>`'s `.id` (`verifyTarget`, D1's
 *     rename-proof identity key — this is what `fileGithubIssue` threads
 *     into `githubIssueTaskSlug`).
 *   - `existingIssues` → `gh api repos/<repo>/issues?state=all&...`'s array
 *     body (`searchDuplicates`/`listIssues`). Defaults to `[]` — no
 *     duplicates, the common case for a fresh filing.
 *   - `createdNumber` / `createdUrl` → the `-X POST` issue-create call's
 *     `{number, html_url}` response (`fileIssue`) — the number
 *     `toIssueTaskInput`'s slug is derived from (D1).
 */
export interface PayloadGhStubFixture {
  readonly login?: string;
  readonly repoId: number;
  readonly existingIssues?: readonly PayloadGhStubIssue[];
  readonly createdNumber: number;
  readonly createdUrl: string;
}

/**
 * Escapes a string for embedding inside a single-quoted POSIX shell
 * literal: closes the quote, emits an escaped literal `'`, reopens the
 * quote (the standard `'\''` idiom) for every embedded `'`. Used because
 * this stub's generated script must emit JSON via the shell's `echo`
 * BUILTIN (see this module's header for why `cat <<HEREDOC` is unusable
 * here) — the JSON payload's own double quotes need no escaping in a
 * single-quoted literal, only a literal apostrophe would.
 *
 * @example
 *   shellSingleQuote(`{"a":"b"}`)   // => "'{\"a\":\"b\"}'" (no apostrophe, untouched)
 *   shellSingleQuote(`it's here`)   // => "'it'\\''s here'"
 */
function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Writes a fresh payload-serving `gh` stub for ONE test scenario and
 * returns its containing directory (pass as the spawned child's `PATH`,
 * mirroring `healthyGhStubDir()`'s calling convention).
 *
 * @param fixture - see {@link PayloadGhStubFixture}
 * @returns absolute path to a directory containing an executable `gh`
 * @throws Never from this function's own logic — `mkdtempSync`/
 *   `writeFileSync`/`chmodSync` failures are real environment faults that
 *   should propagate loudly (mirrors `healthyGhStubDir`'s contract).
 */
export function payloadGhStubDir(fixture: PayloadGhStubFixture): string {
  const dir = mkdtempSync(join(tmpdir(), "lore-payload-gh-stub-"));
  const ghPath = join(dir, "gh");
  const labelWritesLogPath = join(dir, LABEL_WRITES_FILENAME);

  const login = fixture.login ?? "payload-stub-user";
  const existingIssues = fixture.existingIssues ?? [];

  const loginJson = JSON.stringify({ login });
  const createdJson = JSON.stringify({ number: fixture.createdNumber, html_url: fixture.createdUrl });
  // reason: `labels` is objectified from plain name strings into `gh`'s real
  // `{name: ...}` shape here, and DEFAULTED to `[]` when the fixture omits
  // it — `GithubIssueListEntrySchema` (github-intake-port.ts) requires the
  // key on every entry (GitHub's real payload always carries it), so every
  // fixture using this stub must serve it regardless of whether the CALLER
  // supplied one.
  const issuesJson = JSON.stringify(
    existingIssues.map((issue) => ({ ...issue, labels: (issue.labels ?? []).map((name) => ({ name })) })),
  );
  const repoJson = JSON.stringify({ id: fixture.repoId, name: "stub-repo" });
  // reason: `GhResolutionLabelPort.setLabel`'s GET step needs SOME array —
  // an empty one means every fixture using this stub converges with zero
  // stale `resolution:*` siblings to delete, which is the only scenario
  // AC-GR-3 (a fresh issue's first resolve) needs.
  const labelsJson = "[]";

  const script = `#!/bin/sh
first="$1"
second="$2"

is_post=0
prev=""
for arg in "$@"; do
  if [ "$prev" = "-X" ] && [ "$arg" = "POST" ]; then
    is_post=1
  fi
  prev="$arg"
done

if [ "$first" != "api" ]; then
  echo "payload-gh-stub: unhandled non-'api' gh invocation: $*" >&2
  exit 1
fi

if [ "$second" = "user" ]; then
  printf '%s\n' ${shellSingleQuote(loginJson)}
  exit 0
fi

# reason: dispatched BEFORE the generic is_post fallback below — a bare
# is_post check cannot distinguish this label-add POST from the plain
# issue-create POST (\`repos/<repo>/issues\`, no trailing /labels), which is
# exactly why this stub previously could not serve GhResolutionLabelPort at
# all (a labels GET fell through to the repos/* object fallback, an array
# schema mismatch).
case "$second" in
  *"/labels")
    if [ "$is_post" = "1" ]; then
      label_value=""
      for arg in "$@"; do
        case "$arg" in
          labels\\[\\]=*)
            label_value="\${arg#labels\\[\\]=}"
            ;;
        esac
      done
      printf '%s\t%s\n' "$second" "$label_value" >> ${shellSingleQuote(labelWritesLogPath)}
      printf '%s\n' ${shellSingleQuote(createdJson)}
      exit 0
    fi
    printf '%s\n' ${shellSingleQuote(labelsJson)}
    exit 0
    ;;
  *"/labels/"*)
    # reason: the stale-sibling DELETE call — this stub's labels GET always
    # answers "[]" (no pre-existing resolution:* label), so no fixture using
    # it ever reaches this branch today; handled anyway so a future fixture
    # that seeds a stale label converges instead of hitting the
    # "unrecognized endpoint" refusal below.
    exit 0
    ;;
esac

if [ "$is_post" = "1" ]; then
  printf '%s\n' ${shellSingleQuote(createdJson)}
  exit 0
fi

case "$second" in
  *"/issues?"*)
    printf '%s\n' ${shellSingleQuote(issuesJson)}
    exit 0
    ;;
  repos/*)
    printf '%s\n' ${shellSingleQuote(repoJson)}
    exit 0
    ;;
esac

echo "payload-gh-stub: unrecognized gh api endpoint: $second" >&2
exit 1
`;

  writeFileSync(ghPath, script);
  chmodSync(ghPath, 0o755);
  return dir;
}

/** Removes a directory returned by {@link payloadGhStubDir}. Call from the test's own `afterAll`/`afterEach` — this module holds no lifecycle hooks of its own (mirrors `healthy-gh-stub.ts`). */
export function cleanupPayloadGhStubDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup — mirrors every other scratch-dir cleanup in this suite family */
  }
}

/**
 * Reads back every label POST this stub recorded in `dir` (see
 * {@link payloadGhStubDir}'s header) — AC-GR-3's load-bearing assertion
 * that a `lore issue resolve` call reached "GitHub", not merely that the
 * corpus write and the CLI's own exit code succeeded.
 *
 * @param dir - a directory previously returned by {@link payloadGhStubDir}
 * @returns one entry per recorded POST, in call order; `[]` when the stub
 *   was never called with a label-add POST (no `label-writes.log` file at
 *   all) — never a thrown error, matching this module's other read paths.
 *   A line whose endpoint does not match `repos/<owner>/<repo>/issues/<n>/labels`
 *   is skipped rather than throwing — that shape is only ever written by
 *   this same file's own script, so a mismatch here would mean the script
 *   and this reader have drifted, not that the CALLER passed a bad `dir`.
 */
export function readRecordedLabelWrites(dir: string): RecordedLabelWrite[] {
  const logPath = join(dir, LABEL_WRITES_FILENAME);
  if (!existsSync(logPath)) return [];

  const endpointPattern = /^repos\/(.+)\/issues\/(\d+)\/labels$/;
  const writes: RecordedLabelWrite[] = [];
  for (const line of readFileSync(logPath, "utf8").split("\n")) {
    if (line.trim().length === 0) continue;
    const [endpoint, label] = line.split("\t");
    const match = endpoint === undefined ? null : endpointPattern.exec(endpoint);
    if (match === null) continue;
    writes.push({ repo: match[1] as string, issueNumber: Number(match[2]), label: label ?? "" });
  }
  return writes;
}
