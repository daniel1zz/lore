// SPEC reference: task-skill-implement-the-read-surface-reaches-github-and-never
// Covers: `lore issues` (and `lore report-issue --list`) reading live GitHub issues
// through the shared read seam (resolveGithubIssueListing + joinListing), never
// writing to the corpus, and never silently dropping pre-GitHub local-only reports.
import { describe, test } from "bun:test";

describe("AC-GR-1: real dist/lore issues exits 0 and prints exactly 3 rows against a 3-issue gh stub", () => {
  // implemented below in a later commit
});

describe("AC-GR-2: an un-ingested row and a computed-open row render as different tokens", () => {
  // implemented below in a later commit
});

describe("AC-GR-10: the GitHub listing shows only the 3 GitHub issues and names the --local boundary", () => {
  // implemented below in a later commit
});

describe("AC-GR-12: a real lore issues run left the task count and every version log unchanged", () => {
  // implemented below in a later commit
});
