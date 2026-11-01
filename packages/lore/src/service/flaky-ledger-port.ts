/**
 * Module: flaky-ledger-port — the `gh`-backed {@link FlakyLedgerPort} of the flaky-tests ledger issue (AC-DCS2-4).
 *
 * Purpose: find the open ledger issue, create it, and comment on it, through the one `gh` seam ({@link GhRunner}); and the port a
 *   project with no tracker configured gets, which refuses every call by naming the missing key.
 * Public surface: {@link createGhFlakyLedgerPort}, {@link createUnconfiguredFlakyLedgerPort}.
 * Invariants:
 *   - every failure is returned as an `err` (the caller records it as `ledger_error` on the row); nothing here throws.
 *   - the issue list is read live and filtered by label AND exact title, so an unrelated issue carrying the label never receives entries.
 *   - the listing is one `gh api` call without `--paginate`: the ledger is a single issue, found among the newest 100 open issues with
 *     its label, never among every issue.
 * Side-effect class: IO (`gh` subprocesses).
 */

import { err, ok, type LoreError, type Result } from "@lore/core";
import { z } from "zod";
import type { FlakyLedgerPort } from "./issue-filing-service.js";
import type { GhRunner } from "./gh-runner.js";

/** One entry of the open-issues listing: only these fields are read. */
const ListedIssueSchema = z.array(z.object({ number: z.number().int(), title: z.string() }).passthrough());

/** The creation response: only the number and url are read. */
const CreatedIssueSchema = z.object({ number: z.number().int(), html_url: z.string() }).passthrough();

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined; // reason: an unreadable body is reported as a VALIDATION_ERROR by the schema parse that follows, never swallowed
  }
}

function malformed(what: string, stdout: string): LoreError {
  return { code: "VALIDATION_ERROR", field: `gh_${what}_response`, message: `gh returned a ${what} payload the flaky ledger could not parse`, value: stdout };
}

/**
 * The ledger port over GitHub.
 *
 * @param runner - the `gh` seam
 * @param repo - `owner/repo` of `feedback.upstream.repo`
 */
export function createGhFlakyLedgerPort(runner: GhRunner, repo: string): FlakyLedgerPort {
  return {
    findOpen: async (title, label) => {
      const listed = await runner.run(["api", `repos/${repo}/issues?state=open&labels=${encodeURIComponent(label)}&per_page=100`]);
      if (!listed.ok) return listed;
      const parsed = ListedIssueSchema.safeParse(parseJson(listed.value.stdout));
      if (!parsed.success) return err(malformed("issue-list", listed.value.stdout));
      const match = parsed.data.find((issue) => issue.title === title);
      return ok(match === undefined ? undefined : { number: match.number });
    },
    create: async (input) => {
      const created = await runner.run(["api", `repos/${repo}/issues`, "-X", "POST", "-f", `title=${input.title}`, "-f", `body=${input.body}`, "-f", `labels[]=${input.label}`]);
      if (!created.ok) return created;
      const parsed = CreatedIssueSchema.safeParse(parseJson(created.value.stdout));
      if (!parsed.success) return err(malformed("issue-create", created.value.stdout));
      return ok({ number: parsed.data.number, url: parsed.data.html_url });
    },
    comment: async (issueNumber, body) => {
      const posted = await runner.run(["api", `repos/${repo}/issues/${String(issueNumber)}/comments`, "-X", "POST", "-f", `body=${body}`]);
      return posted.ok ? ok(undefined) : posted;
    },
  };
}

/** The port of a project with no GitHub `feedback.upstream.repo`: every call is refused naming the key. */
export function createUnconfiguredFlakyLedgerPort(): FlakyLedgerPort {
  const refusal = (): Result<never, LoreError> =>
    err({ code: "VALIDATION_ERROR", field: "feedback.upstream", message: "no issue tracker is configured (feedback.upstream.repo is not set), so the flaky ledger issue cannot be filed" });
  return {
    findOpen: async () => refusal(),
    create: async () => refusal(),
    comment: async () => refusal(),
  };
}
