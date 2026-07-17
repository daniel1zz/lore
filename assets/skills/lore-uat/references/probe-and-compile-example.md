# Worked Examples — H2 oracle probe & trace→spec compilation

Two mechanical tasks that were unproven in the first run. Concrete examples so a new executor can do them without guessing.

## Example A — H2 outcome-correctness probe (JUDGE)

Journey J-004: persona exports their tasks to CSV. Success criterion:
```yaml
- desc: "Exported CSV contains ALL tasks (active + done) with correct status"
  oracle: artifact
  probe: "parse the downloaded CSV; assert row count == tasks created and every title present"
```

The executor's screenshot showed a "CSV exported!" toast — that is NOT sufficient for H2. The judge runs an actual probe against the artifact:

```bash
# artifact oracle — inspect the file the persona actually downloaded
node -e '
  const fs = require("fs");
  const csv = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").slice(1);
  const titles = csv.map(l => l.split(",")[0].replace(/^"|"$/g,""));
  const expected = ["Email editor the draft","Transcribe notes","Book interviews","File wrap-up","Send invoice"];
  const missing = expected.filter(t => !titles.some(x => x.includes(t.slice(0,10))));
  console.log(missing.length ? "H2 FAIL missing: "+missing.join(", ") : "H2 PASS");
' evidence/J-004/tasks-export.csv
```

For an `api` oracle instead, assert the real record:
```bash
# api oracle — the created order must actually exist with the right data
curl -s "http://localhost:4173/api/orders?user=$ACCT" \
  | jq -e '.[] | select(.total <= 3000 and (.items|length) > 0)' >/dev/null \
  && echo "H2 PASS" || echo "H2 FAIL: no matching order record"
```

If neither a file nor an endpoint exists to probe, H2 is `UNVERIFIED` — write that, do not substitute a screenshot.

## Example B — compiling a trace into a Playwright spec (PERSIST)

Because the executor captured a structured `trace.jsonl`, compilation is mechanical: each action's `target.role`+`name` maps to a `getByRole`, and the success criterion's oracle becomes the assertion. Not a screenshot replay — a translation of typed fields.

**Input** — `evidence/J-001/trace.jsonl` (excerpt):
```json
{"step":2,"action":"click","target":{"role":"button","name":"+"},"result":"input appeared"}
{"step":3,"action":"type","target":{"role":"textbox","name":"Task title"},"value":"Send invoice","result":"text entered"}
{"step":4,"action":"click","target":{"role":"button","name":"Add"},"result":"task appears in list; toast 'Task added'"}
{"step":5,"action":"reload","target":null,"result":"list is EMPTY — task gone"}
```
plus the journey's success criterion (`oracle: ui`, "task persists across reload, visible in list").

**Output** — `regression/J-001-first-task-capture.spec.ts`:
```ts
// Compiled from journeys/J-001-first-task-capture.yaml  (source of truth = the YAML)
import { test, expect } from '@playwright/test';

test('@acceptance-smoke J-001 first task persists across reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '+' }).click();
  await page.getByRole('textbox', { name: 'Task title' }).fill('Send invoice');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText('Send invoice')).toBeVisible();

  // business outcome, asserted on a second surface (after reload), not the toast:
  await page.reload();
  await expect(page.getByText('Send invoice')).toBeVisible(); // this is the line that catches the persistence defect
});
```

Rules the example encodes: user-facing locators only (`getByRole`/`getByText`, never CSS/test-id unless the element has no accessible name — in which case also file an a11y finding); assert the business outcome on a surface *other than* the one that announced success; header comment links back to the YAML (the YAML is source of truth, the spec is compiled output); tag `@acceptance-smoke`.

Until one such compile-and-green-run is demonstrated end-to-end for a target project, treat PERSIST-Playwright as **experimental** and say so in the report — the Journey Ledger, not the compiled suite, is the primary durable asset.
