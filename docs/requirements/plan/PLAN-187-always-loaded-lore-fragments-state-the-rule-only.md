---
id: PLAN-187
type: plan
role: plan
title: "Always-loaded lore fragments state the rule only"
status: archived
priority: medium
created: 2026-10-15
updated: 2026-10-16
tags: []
parent: SPEC-185
phases:
  - {name: "W1"}
  - {name: "close"}
---
## Goal

Land `spec-always-loaded-lore-fragments-state-the-rule-only-reasoning`.

## Phases

| Phase | Task | ACs | Why it exists |
|---|---|---|---|
| W1 | task-reword-the-ten-always-loaded-fragments-to-the-rule-only | AC-RW-1..5 | the planned reword |
| W1 | task-restore-the-instruction-parts-the-rule-only-reword-dropped | AC-RW-1..5 | assessment -1 (AC-RW-5 65): six instructions dropped |
| W1 | task-restore-the-remaining-clauses-the-assessment-named-and | AC-RW-1,3,4,5 | assessment -2 (50): more clauses dropped, the first restore cut three to fit the byte ceiling |
| W1 | task-traceability-pass-over-the-ten-fragments-classify-every | AC-RW-1..4 | assessment -3 (62) and the revised lore-context-optimizer workflow: a clause-by-clause traceability table, restore every instruction |
| W1 | task-drop-the-explanation-the-traceability-pass-over-restored | AC-RW-1..5 | assessment -4 (outcome 68): the traceability pass also restored explanation; drop the clauses an independent grader listed |
| W1 | task-close-out-keep-the-three-borderline-clauses-and-fix-the | AC-RW-1..4 | assessment -6: two graders disagreed on three drops; user rule: when in doubt, keep |
| close | main agent | — | write the traceability table to the corpus (a claim lease cannot), grade AC-RW-5 with an independent grader run captured by `lore evidence --capture`, `lore verify`, `lore assess` |

One fragment set shares one manifest and one rendered rules directory, so the tasks ran in sequence, never in parallel. Criterion corrections are listed in the spec's Revisions section.

## AC-RW-5 grading method

- Editor: every fragment change was made by `lore-implementer` runs, whose shipped definition pins `model: sonnet` (`assets/agents/lore-implementer.md`).
- Grader: `claude -p --model opus` (a different model from the editor), executed by `lore evidence --capture` so the grader's own output and exit code are the evidence, not a transcription. The grader has no tools; its whole input is built by `grade_prompt.py` below.
- Blind: the grader sees each DROPPED item's id, file and original clause only, never the editor's `drop_reason`.
- Red control: `gp_red.py` below takes the same blind input, plants one DROPPED item that is a real instruction (`Run \`lore done\` BEFORE \`git branch -d\``) and removes it from the current worktree-dispatch text; the grader must answer `AC-RW-5 FAIL: wd-ctrl`. Recorded as `expected-fail`; the captured tail ends with the verdict lines.
- A manual AC-RW-5 pass on task-reword-the-ten-always-loaded-fragments-to-the-rule-only (v26) was refuted by assessment -1 and cannot be retracted (#224); it is not support.

Known limit, not fixed in this plan: AC-RW-3 checks that every KEPT/MERGED phrase is present, not that the phrase covers the whole clause; ac-1h stayed KEPT on a shortened phrase while its parenthetical was dropped, caught only by assessment -6.

### grade_prompt.py

```python
#!/usr/bin/env python3
"""Build the AC-RW-5 grader prompt: the rubric, every DROPPED item of the traceability
table, and the before (b049f0ab) and current text of the ten fragments. Prints to stdout;
pipe into `claude -p --model <grader-model>`. Run from the repo root."""
import json, re, subprocess

TABLE = "knowledge-traceability-table-always-loaded-lore-fragments"
BASE = "b049f0ab"

def sh(args):
    return subprocess.run(args, capture_output=True, text=True, check=True).stdout

doc = json.loads(sh(["lore", "get", TABLE, "--json"]))["data"]
doc = doc.get("doc", doc)
table = json.loads(re.search(r"```json\n(.*?)\n```", doc["content"], re.S).group(1))
# Blind grading: the grader sees only id, file and the original clause, never the
# editor's drop_reason, so the editor's classification cannot prime the verdict.
dropped = [{"id": i["id"], "file": i["file"], "before": i["before"]}
           for i in table if i["status"] == "DROPPED"]
files = sorted({i["file"] for i in table})
if not dropped or len(files) != 10:
    raise SystemExit(f"bad table: {len(dropped)} dropped, {len(files)} files")

out = [
    "You are an independent grader. You did not write this change. Grade acceptance criterion AC-RW-5.",
    "For EACH item below: first one or two sentences of reasoning, then a verdict on its own line as `<id>: INSTRUCTION` or `<id>: EXPLANATION`.",
    "INSTRUCTION = the dropped text tells the reader what to do or never do, when or where a rule applies (a condition or qualifier), a threshold, an ordering, an exit code, a command or a flag, AND that content is not present elsewhere in the CURRENT text.",
    "EXPLANATION = only history, an incident, a dated measurement, a mechanism walkthrough or consequence (why something happens), a second reason beyond one scope-setting reason, a duplicate of text that IS present in the current text (find it and quote it), or common knowledge.",
    f"After all {len(dropped)} items, print exactly one final line: `AC-RW-5 PASS` if every item is EXPLANATION, otherwise `AC-RW-5 FAIL: <ids>`.",
    "",
    "## DROPPED items",
    json.dumps(dropped, indent=1, ensure_ascii=False),
]
for f in files:
    out += ["", f"## {f} at {BASE} (before)", sh(["git", "show", f"{BASE}:{f}"]),
            f"## {f} now (current)", open(f, encoding="utf-8").read()]
print("\n".join(out))
```

### gp_red.py

```python
#!/usr/bin/env python3
"""Red control for the AC-RW-5 grader: take the real (blind) grader input on stdin, plant one
DROPPED item that is a real instruction, and remove that instruction from the current text of
its file, so a grader with discriminating power must answer AC-RW-5 FAIL: wd-ctrl."""
import json, re, sys

t = sys.stdin.read()
needle = "Run `lore done` BEFORE `git branch -d`"
cur_hdr = "## assets/context/worktree-dispatch.md now (current)"
i = t.index(cur_hdr)
head, cur = t[:i], t[i:]
if needle not in cur:
    raise SystemExit("needle missing from current worktree-dispatch text")
cur = cur.replace(needle + ".", "", 1).replace(needle, "", 1)
if needle in cur:
    raise SystemExit("needle still present after removal")
m = re.search(r"## DROPPED items\n(\[.*?\n\])", head, re.S)
items = json.loads(m.group(1))
n = len(items)
items.append({"id": "wd-ctrl", "file": "assets/context/worktree-dispatch.md", "before": needle + "."})
head = head[:m.start(1)] + json.dumps(items, indent=1, ensure_ascii=False) + head[m.end(1):]
head = head.replace(f"After all {n} items", f"After all {n + 1} items", 1)
sys.stdout.write(head + cur)
```
