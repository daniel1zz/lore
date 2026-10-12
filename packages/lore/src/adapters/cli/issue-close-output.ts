/**
 * `emitIssueCloseItems` — the ONE CLI renderer for the post-archive GitHub issue step's lines
 * (spec-archiving-the-work-that-resolves-a-defect-report-closes D3/D4, Public Interface "On archive").
 *
 * Every archive-reaching verb (`lore set`, `lore done`, `lore archive --apply`) routes through it, so a
 * close outcome is worded and streamed identically everywhere: success and informational lines on
 * stdout, failures and warnings on stderr. In `--json` mode stdout belongs to the JSON document (which
 * already carries the items), so only the stderr-stream lines are echoed — a failure is never hidden
 * behind a machine-readable mode.
 *
 * Side-effect class: IO (writes to process stdout / stderr).
 */

import type { IssueCloseItem } from "../../service/issue-close-on-archive.js";

/**
 * @param items - the lines a service returned (`undefined` when no archive step ran)
 * @param opts - `json`: true when stdout is reserved for a JSON document
 */
export function emitIssueCloseItems(items: readonly IssueCloseItem[] | undefined, opts: { json: boolean }): void {
  if (items === undefined) return;
  for (const item of items) {
    if (item.stream === "stderr") {
      process.stderr.write(`${item.message}\n`);
    } else if (!opts.json) {
      console.log(item.message); // CLI surface
    }
  }
}
