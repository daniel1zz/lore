---
id: KN-637
type: knowledge
role: knowledge
title: "Review-branch frozen probe set: 10 questions for the review branch migration"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: PLAN-177
---
Frozen review probe set (10 questions), areas: review + specification/execution. Each answer verified by code reading and/or CLI run against a throwaway corpus. Do not edit after creation.

## Questions

1. I wrote an architecture decision record and a product requirements doc. Nobody has reviewed either one yet. Can I approve each of them straight away?
2. The approve command refused my unreviewed decision record. Can I get it to "approved" anyway with the general "edit document" command by setting its status? If that works, does the history show it as an approval?
3. I ran the review command on a decision record that is not attached to any parent document. What does the review do to the document's status, what exit code does the command return, and can I approve the document afterwards?
4. My decision record got a "reject" review verdict. I fixed the text and now want to approve it without running a new review. Is plain approve accepted? Which of the two "override" options works here, and is the override recorded anywhere?
5. A reviewer rejects a draft with a reason. What happens to the document's status and version number, where is the reason stored, and does that rejection stop someone approving the same document a moment later?
6. A document was approved by mistake. Can I take the approval back by rejecting it, by setting its status back to draft or "in review", or by approving it again? What exit code do I get?
7. An approved document is saved again with exactly the same text, no change at all. Does it stay approved? What does the tool tell me? And what about a change that only touches its tags?
8. I moved a draft into the "in review" status. Will it appear in the pending-review queue, and will the batch "review everything pending" run pick it up? If a reviewer then rejects it, what status does it end up in, and what does the tool print?
9. A spec is approved. Then I (a) add a new acceptance criterion, (b) reword an existing acceptance criterion, (c) change the spec's kind from "feature" to "tech". After each change, is the spec still approved?
10. A plan sits under a spec that is still a draft. Can the plan be approved with the approve command? Can it be approved by setting its status with the general edit command?

## Answers and evidence

Setup for every CLI run: `D=$(mktemp -d) && cd "$D" && lore init` (corpus 1: `/var/folders/_l/h_l4wm9d1kg2zh9qkdzs2yrc0000gn/T/tmp.0gEupt0oGz`; corpus 2 for Q8: `/var/folders/_l/h_l4wm9d1kg2zh9qkdzs2yrc0000gn/T/tmp.YsBKieHimd`). Binary `/Users/apple/.local/bin/lore` v0.1.0, environment `CLAUDECODE=1`. Most runs set `LORE_ACTOR=probe:alice`. No AI judge call was made in any run: every review verdict below came from the deterministic (non-AI) checks.

### 1 (area: review)

**Answer**: The decision record (ADR) is **refused**: exit **4**, `Gate "review-judgment" blocked: NO_JUDGMENT`. The message says it needs "an independent, non-rejecting, non-escalating review judgment for its CURRENT version" and suggests `lore review <slug>`. The PRD is **accepted**: exit 0, `Approved prd-probe-root → status: approved (v2)`. A review judgment is required only for the doc types in `workflow.review.judgment_required_types`, which defaults to `["spec","adr"]`. For any other type, only an "escalate" verdict can block approval. Approving bumps the version by 1.

**Code**: packages/core/src/config.ts:679 (default `["spec","adr"]`); packages/lore/src/service/review-service.ts:420-499 (`enforceJudgmentRequiredGate`: types outside the list are blocked only by escalate, lines 490-498); review-service.ts:269-272 (runs for every type before the spec/plan branches); review-service.ts:777-785 (version + 1 on approve); packages/lore/src/service/checkpoint-registry.ts:2267 (rule text); packages/lore/src/adapters/cli/utils.ts:98-107 (VALIDATION_ERROR → exit 4).

**CLI**:
```
$ lore approve prd-probe-root            -> exit=0  Approved prd-probe-root → status: approved (v2)
$ lore approve adr-use-sqlite            -> exit=4
Error: Validation failed on field 'gate:review-judgment:judgment-required': Gate "review-judgment" blocked: NO_JUDGMENT
Required for review-judgment: adr-use-sqlite needs an independent, non-rejecting, non-escalating review judgment for its CURRENT version before it may be approved. Recovery: run `lore review adr-use-sqlite`.
```

### 2 (area: review) (PROSE-vs-CODE discriminator)

**Answer**: **Yes, it works.** `lore set <adr> --status approved` exits **0** and the unreviewed ADR becomes `approved` (v2). The review-judgment gate does not run on this path. The version history records the change as a plain **`update`**, not `approve`. So in `lore log`, an approval made this way looks the same as an ordinary edit. By contrast, `lore approve` writes a version with action `approve` and the reviewer as author.

**Conflicting prose**:
- packages/lore/src/service/checkpoint-registry.ts:2267: the rule text says the doc "needs an independent, non-rejecting, non-escalating review judgment for its CURRENT version **before it may be approved**", with no exception for other write paths.
- packages/lore/src/service/corpus-service.ts:2447-2452: the comment admits `set` is "a SECOND write path (besides `ReviewService.approve`) that can push a spec straight to 'approved'" and adds the spec-promote (has-criteria) check as defense-in-depth. It does not add the review-judgment check, so the second path is only partly guarded.

**Code**: packages/lore/src/service/corpus-service.ts:2092-2138 (`set`: status change only checked against the transition table, `draft → approved` is legal); corpus-service.ts:2459-2486 (the only approval-time gate in `set`, `spec-promote`, for `type === "spec"` only); a grep finds no `review-judgment` / `enforceJudgmentRequiredGate` in corpus-service.ts; review-service.ts:787-800 (`insertVersion` with `action: "approve"` at line 795 exists only in `ReviewService.approve`).

**CLI**:
```
$ lore set adr-use-sqlite --status approved   -> exit=0  Updated adr-use-sqlite → v2   (status "approved")
$ lore log adr-use-sqlite
v2  update  system  ...
v1  create  system  ...
# compare, ADR approved via `lore set --status in-review` then `lore approve --override-no-judgment`:
$ lore log adr-use-bun
v3  approve  agent:task-retraction ...   (reviewer = $LORE_ACTOR in that shell)
v2  update   system ...
```

### 3 (area: review)

**Answer**: The review **does not change status**. The ADR stays `draft` and its version stays `1`. The command records a **judgment** and exits **0**, even though the verdict is `reject`; exit 0 means "a judgment was recorded", not "approved". The ADR has no parent, so the deterministic `parent_contract` check fails. The verdict is therefore recorded without calling the AI: `decision: "reject"`, `confidence: 1`, judge `{provider: "deterministic-checks", model: "n/a"}`. A later `lore approve` is **refused with exit 4**, `JUDGMENT_REJECTED`.

**Code**: packages/lore/src/adapters/cli/commands/review.ts:129-146 (`buildDeterministicRejectJudgment`); review.ts:158-180 (`reviewOneDoc`: any failed check → record the reject with no AI call); review.ts:56-58 header (exit 0 for any recorded judgment); packages/core/src/review-checks.ts:134-156 (`checkParentContract`); packages/core/src/doc-type-rules.ts:13-25 (adr requires a prd/spec parent; only prd is a root type); review-service.ts:438-498 (judgments matched on `doc_version === doc.version`; reject blocks gated types).

**CLI**:
```
$ lore review adr-use-redis --json  -> exit=0
  "decision": "reject", "confidence": 1,
  "finding": "adr has no resolvable parent, but 'adr' is not a root type",
  "judge": {"provider": "deterministic-checks","model": "n/a","prompt_version": "v2"}, "doc_version": 1
$ lore get adr-use-redis --json     -> "status": "draft", "version": 1
$ lore approve adr-use-redis        -> exit=4  Gate "review-judgment" blocked: JUDGMENT_REJECTED
```

### 4 (area: review)

**Answer**: After the content edit the ADR is at version 2. The old reject judgment belongs to version 1, so it no longer counts. Plain approve is **refused, exit 4, `NO_JUDGMENT`**. `--override-no-judgment` is **also refused, exit 4**: it is legal only when the doc has **zero** judgments of any version. Message: `doc "adr-use-redis" already has 1 judgment(s) recorded — name one of them via --override-judgment instead of --override-no-judgment`. **`--override-judgment <judgment-id>` works**: exit 0, `Approved adr-use-redis → status: approved (v3)`. The id is stored on the approve audit entry as `details.override_judgment_id`. The id may point to an older-version judgment. Passing both override flags together is refused (VALIDATION_ERROR, exit 4).

**Code**: review-service.ts:689-696 (both flags → error); review-service.ts:705-726 (`--override-judgment` must name an existing judgment of this doc, any version); review-service.ts:736-758 (`--override-no-judgment` only when zero judgments exist); review-service.ts:805-826 (audit `override_judgment_id` / `override_no_judgment`); review-service.ts:438 (only current-version judgments count for the gate).

**CLI**:
```
$ lore set adr-use-redis --content "We use redis 7."              (v1 -> v2)
$ lore approve adr-use-redis                                      -> exit=4  ... blocked: NO_JUDGMENT
$ lore approve adr-use-redis --override-no-judgment               -> exit=4  ... already has 1 judgment(s) recorded — name one of them via --override-judgment ...
$ lore approve adr-use-redis --override-judgment 01M4F8GEX30TADMX4WHYJ3VGSA -> exit=0  Approved adr-use-redis → status: approved (v3)
$ lore audit adr-use-redis --json   -> "action": "approve", "details": {"reviewer":"probe:alice","from_status":"draft","to_status":"approved","version":3,"override_judgment_id":"01M4F8GEX30TADMX4WHYJ3VGSA"}
```

### 5 (area: review)

**Answer**: The document stays `draft` and its **version does not change**: v1 before, v1 after, because reject never writes a version row. The reason goes **only to the audit trail** (`lore audit <doc>`: action `reject`, `details.reason`, `from_status`, `to_status: "draft"`). `lore log <doc>` shows no reject entry. The `--reason` flag is optional. A rejection **does not block** a later approval: approving the same knowledge doc right afterwards gives exit 0, `→ status: approved (v2)`. (For a spec or ADR, the separate review-judgment rule from Q1 still applies; a human reject is not a review judgment.)

**Code**: review-service.ts:950-1010 (`reject`: status set to `draft` at 977-978, no `insertVersion`, comment at 993-996; audit details with optional reason 984-992); packages/lore/src/adapters/cli/commands/reject.ts:28-31 (reason optional), 89-92 (output); approve has no check for an earlier rejection (review-service.ts:667-777).

**CLI**:
```
$ lore reject knowledge-ref-one --reason "too thin"  -> exit=0  Rejected knowledge-ref-one (status remains: draft)\n  Reason: too thin
$ lore get ... -> "status": "draft", "version": 1
$ lore log knowledge-ref-one   -> only "v1 create"
$ lore audit knowledge-ref-one -> probe:alice  reject  {"reviewer":"probe:alice","from_status":"draft","to_statu...
$ lore approve knowledge-ref-one --by probe:alice -> exit=0  Approved knowledge-ref-one → status: approved (v2)
```

### 6 (area: review)

**Answer**: None of these works. Every attempt is refused with exit **4** (INVALID_TRANSITION):
- `lore reject <approved doc>` → `Cannot transition from 'approved' to 'draft'. Allowed transitions from 'approved': active, archived, deprecated` (reject only accepts `draft` or `in-review`).
- `lore set --status draft` → same message. `lore set --status in-review` → `Cannot transition from 'approved' to 'in-review'`.
- `lore approve` again → `Cannot transition from 'approved' to 'approved'`.

From `approved`, the only allowed targets are `active`, `archived` and `deprecated`. The one way back to `draft` is a side effect: editing the content or title demotes the doc (see Q7).

**Code**: packages/core/src/schemas.ts:824-831 (VALID_TRANSITIONS; `approved → draft` is absent on purpose, see schemas.ts:933-937); review-service.ts:960-971 (reject guard); review-service.ts:676-683 (approve guard); corpus-service.ts:2126-2138 (`set` checks user-requested transitions); utils.ts:104-107 (INVALID_TRANSITION → 4), utils.ts:241-245 (message).

**CLI**:
```
$ lore reject knowledge-ref-one (approved)      -> exit=4  Error: Cannot transition from 'approved' to 'draft'.
$ lore set prd-probe-root --status draft        -> exit=4  Error: Cannot transition from 'approved' to 'draft'.
$ lore set prd-probe-root --status in-review    -> exit=4  Error: Cannot transition from 'approved' to 'in-review'.
$ lore approve knowledge-ref-one (approved)     -> exit=4  Error: Cannot transition from 'approved' to 'approved'.
```

### 7 (area: review) (PROSE-vs-CODE discriminator)

**Answer**: **It does not stay approved.** Passing `--content` with byte-identical text still demotes the doc to `draft`, bumps the version (v5 → v6), and prints `(approved doc demoted to draft because content changed)`, even though nothing changed. The code demotes whenever a content or title value is *supplied*. It never compares it to the stored value. A **tags-only** edit keeps the doc `approved` (the version still goes up by 1).

**Conflicting prose**:
- packages/lore/src/adapters/cli/commands/set.ts:135-136: advisory text `"(approved doc demoted to draft because content changed)"`, printed although the content is unchanged.
- packages/core/src/schemas.ts:893-895: the demotion rule is described as applying when an approved doc's "governing contract content **changes**".

**Code**: packages/lore/src/service/corpus-service.ts:2094-2095 (`contentOrTitleChanged = parsedPatch.data.content !== undefined || parsedPatch.data.title !== undefined`, which tests presence, not difference); corpus-service.ts:2113-2117 (demotion applied); corpus-service.ts:2140 (version + 1 on every set).

**CLI**:
```
$ lore set knowledge-ref-one --tags a,b                (approved v2) -> exit=0  Updated → v3   status "approved"
$ lore set knowledge-ref-one --content "ref changed"   (approved v5, stored content already "ref changed\n")
  -> exit=0  Updated knowledge-ref-one → v6
     (approved doc demoted to draft because content changed)
  -> "status": "draft", "content": "ref changed\n", "version": 6
```

### 8 (area: review) (PROSE-vs-CODE discriminator)

**Answer**: An `in-review` doc **does not appear** in `lore pending`, not even with `--all` ("No pending documents."). `lore review --pending` also skips it ("No pending documents.", exit 0). The pending queue is a query for `status = "draft"` only. `lore approve` does accept it (`in-review → approved`; an ADR was approved from in-review as v3). `lore reject` turns it back into `draft` (exit 0), but **prints `Rejected adr-use-kafka (status remains: draft)`**. The status did change: the audit row records `from_status: "in-review"`. After the reject, the doc reappears in `lore pending`.

**Conflicting prose**:
- packages/lore/src/adapters/cli/commands/reject.ts:91: prints "status **remains**" whatever the previous status was.
- packages/lore/src/service/review-service.ts:946: "Reject a document — status **stays** 'draft'", while line 948 and the code accept `in-review`, which moves to draft.
- packages/lore/src/adapters/cli/commands/approve.ts:21: "Approve a draft document (transition draft → approved)"; in-review docs are approvable too. reject.ts:21: "Reject a draft document", same issue.
- packages/lore/src/adapters/cli/commands/set.ts:155 offers `in-review` as a status, yet nothing in the review queue ever lists it.

**Code**: review-service.ts:521-529 (`pending()` store filter `status: "draft"`); review.ts:502 (`--pending` batch uses the same `pending()`); review-service.ts:960-961 (reject accepts draft|in-review), 977-978 (writes `draft`); schemas.ts:826 (`in-review → approved | draft`).

**CLI** (corpus 2):
```
$ lore set adr-use-kafka --status in-review
$ lore pending --all        -> exit=0  No pending documents.
$ lore review --pending     -> exit=0  No pending documents.
$ lore reject adr-use-kafka --reason "needs context" -> exit=0  Rejected adr-use-kafka (status remains: draft)
$ lore audit adr-use-kafka  -> probe:bob  reject  {"reviewer":"probe:bob","from_status":"in-review","to_sta...
$ lore pending              -> adr-use-kafka ... 1 pending document
```

### 9 (area: specification) (PROSE-vs-CODE discriminator)

**Answer**:
- (a) Adding a new criterion (`lore ac add`): **still approved** (v3 → v4, logged as `update` "Acceptance criteria updated").
- (b) Rewording an existing criterion (`lore ac set`): **demoted to draft** (v5). It prints `Notice: this edit demoted spec "spec-login-flow" from approved to draft ...`.
- (c) Changing the kind (`lore set --kind tech`): **still approved** (v7, `spec_kind` now `tech`).

All three exit 0. Related: a spec with **zero** criteria cannot be approved by either route. Both `lore approve` and `lore set --status approved` give exit 4 `NO_ACCEPTANCE_CRITERIA` ("needs >= 1 for spec_kind \"feature\"").

**Conflicting prose**:
- /Users/apple/Projects/zz/lore/CLAUDE.md:121: "Editing an `approved` doc resets it to `draft` automatically — content/title **AND `extra`**". The spec kind lives in `extra`, but changing it does not demote. (The same line correctly says `ac add` does not demote.)
- packages/core/src/schemas.ts:893-895: "an `approved` doc whose governing contract content changes returns to `draft`, because a changed contract has not been reviewed". Adding a criterion changes the contract but does not demote.

**Code**: packages/lore/src/service/ac-service.ts:402 + 463 (`addCriterion` calls `writeCriteria` with no status) and ac-service.ts:1094 (`newStatus = opts.status ?? spec.status`, so status is unchanged); ac-service.ts:851 (`setCriterion` → `resolveStatusAfterContractEdit(spec.status, true)`); corpus-service.ts:2094-2095 (demotion trigger is content/title only, never `extra`); review-service.ts:274-301 and corpus-service.ts:2459-2486 (spec-promote criterion count on both routes).

**CLI**:
```
$ lore set spec-login-flow --status approved   (0 ACs) -> exit=4  ... blocked: NO_ACCEPTANCE_CRITERIA
$ lore ac add spec-login-flow AC-LOGIN-1 ... --mode human ; lore approve spec-login-flow --override-no-judgment -> approved v3
$ lore ac add spec-login-flow AC-LOGIN-2 ...   -> exit=0  "status":"approved","version":4
$ lore ac set spec-login-flow AC-LOGIN-2 --statement "..." -> exit=0  Notice: this edit demoted spec "spec-login-flow" from approved to draft ... "status":"draft","version":5
$ lore approve spec-login-flow --override-no-judgment -> approved v6
$ lore set spec-login-flow --kind tech         -> exit=0  Updated spec-login-flow → v7   "status": "approved", "spec_kind": "tech"
```

### 10 (area: execution) (PROSE-vs-CODE discriminator)

**Answer**: With `lore approve`: **refused**, exit **4**, `Gate "plan-promote" blocked: UPSTREAM_NOT_APPROVED` (the parent spec `spec-signup-flow` is draft). With `lore set <plan> --status approved`: **accepted**, exit 0, `Updated plan-signup-plan-b → v2`. The plan is `approved` while its spec is still `draft`. `set` runs no plan-promote check at all. It only runs spec-promote for specs and plan-close when a plan is archived.

**Conflicting prose**:
- packages/lore/src/service/corpus-service.ts:2447-2452: this comment names `set` as a second approval path that must be gated ("without this check that path bypasses spec-promote's ... gate entirely"). The plan-promote gate gets no matching protection.
- packages/lore/src/service/review-service.ts:642-656: the approve JSDoc says a plan approval is "write-then-verify", re-checked and rolled back so it is "never left 'approved' against an invalidated prerequisite". The `set` route can reach exactly that state without any check.

**Code**: review-service.ts:308-375 (plan-promote branch of `enforceApprovalGate`, `enforce("plan-promote", ...)` at 369); review-service.ts:836-858 (post-write re-check and rollback, approve only); corpus-service.ts:2459-2486 (spec-only gate in `set`); a grep finds no `enforce("plan-promote"` in corpus-service.ts.

**CLI**:
```
$ lore approve plan-signup-plan               -> exit=4  Gate "plan-promote" blocked: UPSTREAM_NOT_APPROVED  [source: corpus spec-signup-flow]
$ lore set plan-signup-plan-b --status approved -> exit=0  Updated plan-signup-plan-b → v2
$ lore get plan-signup-plan-b -> "status": "approved" ;  lore get spec-signup-flow -> "status": "draft"
```
