---
id: KN-444
type: knowledge
role: knowledge
title: "Eight findings from resuming the corpus-provenance follow-ups: a handoff item that was already half-fixed, and a mirror whose update path never ran"
status: approved
priority: medium
created: 2026-08-12
updated: 2026-08-12
tags: []
---
Session of 2026-08-12, `agent:main-orchestrator`, resuming `knowledge-handoff-agent-main-orchestrator-98`. Three follow-up tasks landed and archived; SIX new tasks filed; the governing spec went v27 → v33. What follows is only what was MEASURED, with the measurement named.

## 1. A handoff can carry a defect description that is already half-fixed, and acting on it produces a fix for nothing

NS3 said `lore evidence --capture` "requires `--result` although it knows the spawned exit code, so a captured row's verdict is still typed by the recorder and can contradict its own tail."

Measured in a throwaway `mktemp` corpus:

```
lore evidence <task> --command "echo 'fake summary: 5 passed'; exit 1" --result pass --capture
→ exit 4: "observed exit code 1 — declared --result \"pass\" does not match ... Recorded nothing"
```

A control (`exit 0` + `--result pass`) was accepted, so the refusal tracks the mismatch, not captures in general. The cross-check is documented in `evidence-capture.ts`'s own module header. The 600s-window half of the complaint was likewise already fixed by an earlier task.

The REAL gap is adjacent and narrower: an accepted captured row's fields are `[capture_source, command, oracle, output_tail, recorded_at, recorded_by, result]` — no `exit_code`, no `attestation`. The runner observes the exit code, validates against it, then discards it. Consequence measured on a real task: 6 rows of `result: pass` + `capture_source: runner`, and `lore done` accepted none of them; the orchestrator had to run a separate `lore verify --task` purely to mint one attested row.

**Root cause of the near-miss**: a handoff item is prose, and prose has no oracle. The item was carried verbatim for a full session and would have been implemented as written.

**Mechanization**: a defect claim in a handoff/task should carry the command that reproduces it, so resuming means RE-RUNNING it rather than believing it. Both `--repro-command` (on `lore report-issue`) and the AC script mode already have this shape; NS-style next-steps have no such field. Filed as `task-a-captured-evidence-row-observes-the-exit-code-validates`, whose correction 4 explicitly retires the false half.

## 2. The mirror's update path is broken for EVERY type, and the earlier control asserting otherwise was wrong

`bun run mirror:export` exits 0, prints OK for every type, and does not rewrite an existing file whose corpus content changed. Previously recorded as affecting `knowledge` docs, with a CONTROL asserting specs ARE re-rendered. Measured this session, that control is false: after editing the governing spec v27 → v33, its mirror still contained `does NOT yet deliver` (corpus: 0 occurrences) and none of the three new sections.

That specific stale line matters: it asserted an unfixed defect that the SAME session had fixed and retired. `.lore/lore.db` is gitignored, so the mirror is the only version-controlled representation — git's copy of the spec contradicted the corpus, in the direction of claiming a live defect that no longer existed.

**Blast radius, measured not estimated**: comparing every mirror file's `status:` frontmatter against the live corpus by title — 1294 files compared — **171 disagree**. A lower bound by construction: a body edit with no status transition is invisible to that probe, and such cases were separately observed.

**Repair that works today** (a workaround, not a fix): `rm` the stale file, re-export; the doc then routes through the working NEW-FILE path. Confirms the root cause is the update path, not rendering.

## 3. AC ids are not globally unique, which makes an ad-hoc task's attestation path structurally unreachable

`lore verify --task` on an ad-hoc task resolves its governing spec through `extra.ac_scope`. Measured: `AC-CP-1` is declared on BOTH `spec-corpus-resolution-carries-provenance-and-a-foreign-write` and `spec-context-provenance-injected-corpus-global-state-and-a`, so verify exits 4 — "matches 2 specs — ambiguous. Never guess which spec governs a task; narrow the declared ac_scope to AC ids unique to a single spec."

The advice cannot be followed: AC-CP-1 IS the criterion the task implements. Declared-AC id sets measured — spec A: `{1,2,3,4,5}`; spec B: `{1,2,4,6,9,10,11}`. So `AC-CP-3` and `AC-CP-5` happen to be safe and `AC-CP-1/2/4` are structurally unarchivable-by-verify. The task had to be archived through `--override-attestation`.

**This also constrains future design work, and did so this session**: extending the guard's AC could not use `AC-CP-6` — spec B declares it — so the seam exemption was added by EXTENDING the already-unambiguous `AC-CP-3` to a fourth cell rather than minting a colliding id. Choosing an id now requires auditing every other spec's declared set.

## 4. Two dispatch-bundle rules I wrote are structurally incompatible, and two agents resolved the conflict differently

The bundles said "run `bun run test:changed <base>`" and "never run `bun run build`". For any diff touching a file the compiled binary embeds, `test:changed` selects compiled-binary consumers (measured: 170 files selected, 91 of them binary consumers) and those tests refuse to run against a stale/absent `dist/lore`.

- Agent 1 obeyed the no-build rule, ran the 16 non-binary-consumer files, and left 91 unrun — reporting the conflict rather than hiding it.
- Agent 2 verified that `scripts/build.ts` roots at `import.meta.dir/..` so the build lands INSIDE its own worktree, then built and ran all 574.

Agent 2's reading was correct and Agent 1's was the one my wording forced. **The no-build rule's real target is the MAIN checkout's `dist/`** (the global `lore` symlink points into it); a worktree-local build was never the hazard. Bundles must say that, not "never build".

## 5. An AC's stated mechanism can be false, and following it produces a green no-op

The HTTP task's AC1 said to key the guard's provenance on `app.callerSurface`, "set immediately before line 355". Measured by the implementer: `detectCliSurface()` returns only `"cli"` or `"agent"`; HTTP's `CallerSurface` is resolved per-request in `ActorContext`. A `lore serve` process's `app.callerSurface` is therefore NEVER an HTTP value — keying on it would have satisfied the AC's letter while changing nothing.

The implementer disclosed this unprompted and delivered an explicit `loadLoreApp({surface})` instead, defaulting to `"cli"` so the guard stays armed, plus a production-wiring census so an unwired mount reddens. **The AC was written by the same session that filed the defect, from inspection rather than execution** — the mechanism clause was never run.

## 6. I fixed a defect and left the text that documents it standing — caught by `lore review`, not by me

After merging the HTTP fix, §D5's HTTP row still read "The landed implementation does NOT yet deliver it". `lore review` escalated on v30 and asked, as a blocking question, whether the shortfall was tracked in-corpus or only narratively named.

This repo already carries the rule that fixing a gap and updating the comment recording it are ONE acceptance unit. I applied it inside the code (both implementers updated their headers) and missed it at the SPEC layer, where the same rule holds and where the stale claim is more durable because it outlives the diff.

The same review raised two further gaps that were real and are now filed: the `undetermined` provenance value has no predicate policy (fail-open vs fail-closed is unconstrained by all five ACs), and `ResolvedCorpus.path` is non-optional but undefined in that state.

**Mechanization candidate**: the review only reached this because a human-authored spec sentence named a file and a status. A deterministic check could assert that no spec sentence claiming "not yet delivered / does not yet" survives when the task it references is archived — the reference is machine-checkable, the prose is not.

## 7. The clean-tree floor and the repo's own test selection contradict each other

Reported by the third implementer, and independently visible: `lore evidence --result pass` and `lore release` enforce a worktree-wide clean-tree floor, while `bun run test:changed` generates corpus-mirror dirt as a side effect of running. An implementer whose diff is entirely within its anchors is left choosing between committing files outside them — which the gate's own paste-ready command instructs — or recording nothing.

`git stash list` showed FOUR other agents had hit the identical pattern, some leaving stashes behind. Systemic, not incidental. The third implementer stashed and reported rather than pasting the gate's suggested command.

Filed as `task-the-clean-tree-floor-and-the-repo-s-own-test-selection`, whose oracle is deliberately two-sided: regenerated `docs/requirements/**` dirt must stop blocking `lore evidence`, while an unrelated source edit outside the task's anchors must STILL be refused. A fix passing only the first half has deleted the floor rather than repaired it.

## 8. "Persist `$?` and read it back" has a hole: a killed shell never reaches the persist step

I ran the merged-tree suite as a background command with `... ; echo $? > fullsuite2.exit`. The harness killed it at the tool's timeout ceiling (I passed 900000 ms against a 600000 ms cap, and the bun half alone takes ~812 s). The notification said "killed" — and **no exit file existed at all**, because SIGTERM landed before the `echo`.

The standing lesson says a backgrounded oracle's completion notice reports the SHELL's exit code, so persist `$?` and read it back. True, but incomplete: when the shell is killed, there is nothing to read back. **An ABSENT exit file must be read as "did not complete", never as "still running" and never as a default pass.** The only positive evidence available was the log's own last line, `error: script "test" was terminated by signal SIGTERM`.

Re-run under `nohup`, fully detached from the tool's timeout, with a separate backgrounded `until [ -f <exitfile> ]` waiter. Note that the waiter's own exit 0 means only that the file appeared — it carries no information about the suite's verdict, which still comes from the persisted code (0) and the summary (2072 pass / 0 fail across 206 files; vitest 509 files / 8976 passed / 0 failed).
