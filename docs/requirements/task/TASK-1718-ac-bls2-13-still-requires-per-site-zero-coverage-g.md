---
id: TASK-1718
type: task
role: plan
title: "AC-BLS2-13 still requires per-site zero coverage gaps, which the coverage ADR retired"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Follow-up of plan-baseline-coverage-refuse-only-undeclared-commands-strip P2. AC-BLS2-13 of spec-baseline-slice-2-completeness-census-per-branch-citation (ai mode, currently failing 6/2) bundles four arming conditions for the citation gate; its item (1) 'every branch's leaves report 0 coverage gaps' (and its rubric 'per-branch coverage exit 0 for all 12 branches') measures the per-site completeness that adr-a-structural-gate-refuses-only-what-an-excuse-cannot retired (BR-660 retired; coverage now exits 0 with unmapped sites). Items (2)-(4) (citation coverage, blind probe, fidelity sample) are untouched by that decision. The spec is a locked approved record: the item cannot be edited in place, and superseding the whole criterion would drop items (2)-(4).

Decide with the owner: supersede AC-BLS2-13 by a new criterion carrying items (2)-(4) only (new spec or the slice-2 successor), or record that the gate is already armed and the criterion is historical. AC: AC-BLS2-13 no longer requires per-site 0 gaps, and items (2)-(4) remain required by a live criterion or are recorded as satisfied.
