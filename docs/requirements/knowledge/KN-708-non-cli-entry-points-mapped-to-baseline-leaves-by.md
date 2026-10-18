---
id: KN-708
type: knowledge
role: knowledge
title: "Non-CLI entry points mapped to baseline leaves by action (MCP, HTTP, dashboard)"
status: draft
priority: medium
created: 2026-10-18
updated: 2026-10-18
tags: []
links:
  - {id: PLAN-206, type: informs}
---
# Non-CLI entry points mapped to baseline leaves by action (2026-10-18)

Input for plan-baseline-completeness-restoration-every-verb-declared-0 P4 (owner choice: merge by action). Read-only inventory of main at 0cdfbcb5; every divergence note cites file:line as read then. Divergences are open owner decisions, not yet rules.

### MCP (`packages/lore/src/adapters/mcp/tools.ts`)

| entry | CLI verb | leaf | divergence note (file:line) |
|---|---|---|---|
| lore_create | create | DCCR (also SPCR / TASK / PLAN / DCSU by type and `supersedes`) | |
| lore_get | get | DCRD | |
| lore_set | set | DCRV (status patches fall on SUBM / DCAD / PCLS / SPAP) | |
| lore_delete | delete | DCDL | |
| lore_list | list | DCLS | |
| lore_search | search | DCSR | |
| lore_tree | tree | DCTR | |
| lore_link | link | DCLK | |
| lore_log | log | DCHS | |
| lore_diff | diff | DCHS | |
| lore_pending | pending | PEND | |
| lore_approve | approve | APRV | No override escape. The tool's input has only `id_or_slug` and `calibration_note` (tools.ts:569-573, 2001-2002). The CLI lets an approval go through a judgment refusal with `--override-judgment` / `--override-no-judgment` (cli/commands/approve.ts:33-61), so MCP cannot get past those refusals. |
| lore_reopen | reopen | NEW (no leaf declares `reopen`) | |
| lore_schema | none | NEW | |
| lore_context_bundle | get | DCRD | Returns more than `get`: also every active plan (tools.ts:2059), and writes a usage-trace event (tools.ts:2063). |
| lore_batch | none | NEW | |
| lore_status | status | HHLT (`check_drift` mode → HDRF) | |
| lore_claim | claim | CLAM | |
| lore_release | release | CLAM | |
| lore_evidence_add | evidence | EVID | |
| lore_phase_status | phase status | PLAN (PLAN does not declare `phase status`) | |
| lore_ready | ready | PLAN | |
| lore_anchor_set | anchor add / rm | ANCH | On a spec it overwrites the whole `code_anchors` list; the CLI only adds or removes one anchor at a time (tools.ts:2511, 2540). |
| lore_assess | assess | AUAS | |
| lore_audit | audit | HAUQ (verify mode → HAUV) | |
| lore_review | review | JUDG | |
| lore_staleness_probe | review --staleness | HSTL | |
| lore_verify | verify | VRFY | |
| lore_feed | feed | AUFD (also SNRS) | |
| lore_bootstrap | bootstrap | SNBT | |
| lore_handoff | handoff | SNHO | |
| lore_uat_record | uat record | AUUA | |
| lore_requirement_add | requirement add | BRQD | |
| lore_rule_add | rule add | BRAD | |
| lore_rule_set | rule set | BRRV (also BRMV / BRLC) | |
| lore_rule_show | rule show | BFND | |
| lore_rule_find | rule find | BFND | |
| lore_rule_impact | rule impact | BIMP | |
| lore_baseline_add | baseline add | BNOD | |
| lore_baseline_set_label | baseline set-label | BNOD | |
| lore_baseline_depends | baseline depends | BDPN | |
| lore_baseline_glossary_add | baseline glossary add | BGLS | |
| lore_baseline_glossary_rm | baseline glossary rm | BGLS | |
| lore_invalidate | invalidate | DCIV | |
| lore_report_issue | report-issue | IFIL | |

MCP has no tool for `reject` or `unlink`.

### HTTP (`packages/lore/src/adapters/http/`)

| entry | CLI verb | leaf | divergence note (file:line) |
|---|---|---|---|
| GET /health (index.ts:331) | none | SYSV | |
| GET /api/health (index.ts:349) | none | SYSV | |
| POST /api/auth/local-bootstrap (index.ts:363) | dashboard | DSDB | |
| GET /auth/bootstrap (static-serving.ts:406) | dashboard | DSDB | |
| /api/p/:name/* project prefix (index.ts:92) | dashboard | DSDB | |
| GET /api/projects (index.ts:398) | dashboard | DSDB | |
| GET /api/auth/me (routes.ts:182) | none | SYSV | |
| POST /api/auth/logout (routes.ts:192) | none | DSDB | |
| GET /api/status (routes.ts:203) | status | HHLT | |
| GET /api/config (routes.ts:209) | dashboard | SETS | |
| GET /api/config/machine (routes.ts:216) | dashboard | SETS | |
| GET /api/issue-reports (routes.ts:223) | issues | ILST | |
| GET /api/docs (routes.ts:228) | list | DCLS | |
| POST /api/docs (routes.ts:233) | create | DCCR | Cannot generate content with AI; the body must carry the content (routes.ts:378-385). CLI `create --ai` can. |
| GET /api/search (routes.ts:238) | search | DCSR | |
| GET /api/tree (routes.ts:243) | tree | DCTR | |
| GET /api/review/pending (routes.ts:248) | pending | PEND | |
| GET /api/audit/verify (routes.ts:254) | audit | HAUV | |
| GET /api/calibration/stats (routes.ts:259) | calibration | AUCA | |
| POST /api/links (routes.ts:264) | link | DCLK | |
| DELETE /api/links/:from/:to (routes.ts:306) | unlink | DCUL | |
| GET /api/judgments/:id (routes.ts:276) | none | NEW | |
| GET /api/audit/:id (routes.ts:282) | audit | HAUQ | |
| GET /api/ready/:plan (routes.ts:288) | ready | PLAN | |
| GET /api/evidence-panel/:id (routes.ts:294) | none | NEW | |
| GET /api/phase-status/:plan (routes.ts:300) | phase status | PLAN | |
| POST /api/review/:id/approve (routes.ts:312) | approve | APRV | Records no reviewer, has no override escape and does not record a calibration note (routes.ts:653-657). The leaf already asks about the missing reviewer as SYSV Q1. |
| POST /api/review/:id/reject (routes.ts:312) | reject | RJCT | Records no reviewer and takes no reason (routes.ts:660). CLI `reject` records the actor and has `--reason`. |
| GET /api/docs/:id (routes.ts:772) | get | DCRD | |
| PATCH /api/docs/:id (routes.ts:794) | set | DCRV | |
| DELETE /api/docs/:id (routes.ts:817) | delete | DCDL | |
| GET /api/docs/:id/log (routes.ts:675) | log | DCHS | |
| GET /api/docs/:id/diff (routes.ts:679) | diff | DCHS | |
| POST /api/docs/:id/restore (routes.ts:683, 858) | restore | DCRS | |
| POST /api/dashboard/docs (dashboard-routes.ts:146) | create | DCCR | |
| PATCH /api/dashboard/docs/:id (dashboard-routes.ts:174) | set | DCRV | Adds a refusal: a 409 when the content has changed since it was loaded (dashboard-routes.ts:272-280). Sending `X-Force-Overwrite` skips it (concurrency.ts:103). The bearer PATCH route has neither. |
| DELETE /api/dashboard/docs/:id (dashboard-routes.ts:180) | delete | DCDL | |
| POST /api/dashboard/docs/:id/approve (dashboard-routes.ts:186) | approve | APRV | Reviewer is `actor.owner ?? actor.name` (dashboard-routes.ts:319). No override escape (dashboard-routes.ts:323). |
| POST /api/dashboard/docs/:id/reject (dashboard-routes.ts:192) | reject | RJCT | |
| POST /api/dashboard/docs/:id/restore (dashboard-routes.ts:198) | restore | DCRS | Refuses without `?confirm=true` (dashboard-routes.ts:433-439). CLI `restore` and the bearer route need no confirm. |
| POST /api/dashboard/docs/:id/links (dashboard-routes.ts:214) | link | DCLK | |
| DELETE /api/dashboard/docs/:id/links/:to (dashboard-routes.ts:204) | unlink | DCUL | |
| PATCH /api/dashboard/config (dashboard-routes.ts:153) | dashboard | SETS | |
| PATCH /api/dashboard/config/machine (dashboard-routes.ts:161) | dashboard | SETS | |
| POST /api/dashboard/telemetry/route-view (dashboard-routes.ts:168) | none | HUSE (already covered by BR-993) | |

`sync-push.ts` is library code that CLI `sync push` uses; the server does not register it as a route.

### Dashboard (`packages/dashboard/src/`; each `p.$name.*` route is folded into its non-prefixed twin)

| entry | CLI verb | leaf | divergence note (file:line) |
|---|---|---|---|
| Page: __root layout (project switcher, search bar, issues badge) | dashboard / issues | DSDB / ILST | |
| Page: p.$name layout | dashboard | DSDB | |
| Page: index (+p.$name.index): status, pending, active plans, issue reports, PRD | status / pending / list / issues | HHLT / PEND / DCLS / ILST | |
| Page: library (+p.$name) | list | DCLS | |
| Page: search (+p.$name) | search | DCSR | |
| Page: tree (+p.$name) | tree | DCTR | |
| Page: pending / TriageQueue (+p.$name) | pending | PEND | |
| Page: execution / ExecutionPage (+p.$name): ready, phase status, evidence panel | ready / phase status | PLAN (evidence panel → NEW) | |
| Page: docs.$id / DocDetail, HistoryTab, AdjudicationBar (+p.$name): get, log, diff, judgments, audit, evidence | get / log / diff / audit | DCRD / DCHS / HAUQ (judgments and evidence → NEW) | |
| Page: issues (+p.$name) | issues | ILST | |
| Page: issues_.$id / IssueDetail (+p.$name) | issues | ILST | |
| Page: settings (+p.$name) | dashboard | SETS | |
| Write: create doc (library.tsx:181) | create | DCCR | |
| Write: save edit (DocDetail.tsx:417) | set | DCRV | Refuses with a 409 when the content is stale (dashboard-routes.ts:272-280). |
| Write: force save (DocDetail.tsx:445) | set | DCRV | Lets the user skip the stale-content refusal with `forceOverwrite` (concurrency.ts:103). There is no CLI equivalent. |
| Write: status transition (DocDetail.tsx:478) | set | SUBM (also PCLS / DCAD) | |
| Write: approve doc (DocDetail.tsx:464, AdjudicationBar.tsx:125, TriageQueue.tsx:199) | approve | APRV | No override escape (dashboard-routes.ts:323). |
| Write: reject doc (DocDetail.tsx:467, AdjudicationBar.tsx:126, TriageQueue.tsx:200) | reject | RJCT | |
| Write: add link (DocDetail.tsx:507) | link | DCLK | |
| Write: remove link (DocDetail.tsx:521) | unlink | DCUL | |
| Write: delete doc (DocDetail.tsx:535) | delete | DCDL | |
| Write: restore version (HistoryTab.tsx:125) | restore | DCRS | Always sends `confirm=true` (mutations.ts:383), so the click itself is the server's confirm step. |
| Write: approve issue report (IssueDetail.tsx:164) | approve | APRV | |
| Write: reject issue report (IssueDetail.tsx:181) | reject | RJCT | |
| Write: save project settings (settings.tsx:93) | dashboard | SETS | |
| Write: save machine settings (settings.tsx:108) | dashboard | SETS | |
| Write: route-view telemetry (use-route-telemetry.ts:105) | none | HUSE | |

### Proposed new leaves
1. **Read a document's review judgments.** Branch `baseline-review`. Covers GET /api/judgments/:id and the docs page. Decisions: the latest judgment plus the full history, newest first; a document with no judgments returns empty, not "not found" (routes.ts:511-517).
2. **See a document's verification evidence.** Branch `baseline-execution`. Covers GET /api/evidence-panel/:id and the execution and docs pages. Decisions: an unknown id is refused as not found; a plan with phase children but no task children is refused as a validation error (routes.ts:564-585).
3. **Reopen an approved spec.** Branch `baseline-specification-and-acceptance`. Covers lore_reopen. CLI `reopen` exists but no leaf declares it either. Decisions: refused when any task holds evidence for the spec; a non-blank reason is required; the spec goes from approved back to draft.
4. **Read the corpus schema.** Branch `baseline-corpus`. Covers lore_schema. It returns fixed information (document types, link types, required fields) and makes almost no decisions. You may prefer to fold it into DCRD instead of adding a leaf.
5. **Run several document operations in one call.** Branch `baseline-corpus`. Covers lore_batch. Decisions: operations run in order and are not atomic, so earlier ones stay written when a later one fails (tools.ts:2072-2079); each operation reports its own result; a delete inside the batch still needs `confirm`. You may decide this is a transport convenience and not a business verb; if so, record it against the leaves of the operations it runs.

Two CLI verbs in this mapping are not declared on any leaf: `reopen` (no leaf) and `phase status` (PLAN declares only `phase add/rename/rm` and `ready`).

### Full slugs for the codes used above
APRV approve-a-document; RJCT reject-a-document; PEND list-documents-awaiting-review; JUDG judge-a-document; SUBM submit-a-document-for-review; DCCR create-a-document; DCRD read-a-document; DCRV revise-a-document; DCDL delete-a-document; DCLS list-documents; DCSR search-documents; DCTR browse-the-document-tree; DCLK link-two-documents; DCUL unlink-two-documents; DCHS read-a-document-s-history; DCRS restore-an-earlier-version; DCIV invalidate-a-document; DCAD accept-a-decision-record; DCSU supersede-a-document; SETS edit-project-settings; DSDB launch-the-dashboard; SYSV serve-the-corpus-over-http; HHLT report-corpus-health; HDRF detect-code-anchor-drift; HAUQ query-the-audit-trail; HAUV verify-the-audit-trail; HSTL probe-documents-for-staleness; HUSE measure-corpus-usage; AUCA read-calibration-statistics; AUAS assess-a-plan-s-outcome; AUFD pull-the-rules-before-writing; AUUA record-an-acceptance-verdict; CLAM claim-a-task; EVID record-evidence; PLAN plan-the-work; PCLS close-a-plan; TASK create-a-task; VRFY run-verification; ANCH declare-a-code-anchor; SPCR create-a-spec; SPAP approve-a-spec; SNBT start-a-session; SNHO hand-off-a-session; SNRS resume-a-session; ILST list-defect-reports; IFIL file-a-defect-report; BRQD declare-a-product-requirement; BRAD write-a-business-rule; BRRV revise-a-business-rule; BRMV move-a-business-rule; BRLC retire-a-business-rule; BFND find-a-business-rule; BIMP assess-a-rule-s-impact; BNOD add-a-baseline-node; BDPN declare-a-leaf-dependency; BGLS define-a-glossary-term.

SUMMARY: mcp=45 http=45 dashboard=27 new_leaves=5 divergences=13
