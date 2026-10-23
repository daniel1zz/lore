---
id: SPEC-208
type: spec
role: spec
title: "One baseline map call maps many sites of a leaf as one version"
status: approved
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
---
# Spec: One baseline map call maps many sites of a leaf as one version

## Overview/Goal

`lore baseline map` takes one `--site` per call, and every accepted call writes a full version snapshot of the leaf (whose site map holds 100-250 entries). The 2026-10-18/19 coverage restoration needed about 10,000 calls: they wrote 8,881 baseline version rows, 306 MB of an 847 MB versions table, and grew the corpus to 1.1 GB; the next integrate floor (which snapshots the corpus) then failed with "database or disk is full". Coverage maintenance after every merge is now routine (spec-baseline-coverage-cannot-silently-regress-one-program), so its cost must scale with the leaves touched, not the sites mapped.

End state: one `lore baseline map <leaf>` call can set and remove any number of site mappings and commands for that leaf, validated all-or-nothing, and writes exactly one version and one audit row that names every site set and removed. A mapping round costs one version per touched leaf. Task: task-baseline-map-takes-many-site-mappings-in-one-call-so-a.

## Scope

In:
- `lore baseline map <leaf> --sites-file <path>`: a JSON array of `{ "site": "<key>", "rules": ["BR-n", ...] }` or `{ "site": "<key>", "nonBusiness": "<reason>" }` rows, combinable with the existing `--remove-site` and `--command` / `--remove-command` flags in the same call. The existing single `--site` form stays and is the one-row case of the same write.
- Every row is validated exactly as a single `--site` mapping is today (rules of this leaf; non-blank reason; owned-by references checked per BR-654); any invalid row refuses the whole call with exit 4, naming every invalid row, and nothing is written.
- An accepted call writes one version and one audit row whose details list every site set, every site removed and every command added and dropped; a site-only call keeps an approved leaf approved (BR-658), a command change demotes it.
- A file that cannot be read or is not such an array refuses with exit 4 and writes nothing; a file with duplicate site keys refuses (exit 4) naming them.

Out:
- How a version stores the site map (full snapshot or delta) is unchanged here.

## Acceptance Criteria

Declared with `lore ac add` as AC-BMB-1..3, citing BR-658 and BR-654.

- AC-BMB-1: one map call with a 50-row sites file on an approved leaf adds exactly 1 version and 1 audit row listing all 50 sites, and the leaf stays approved; the same 50 rows sent as 50 single-site calls add 50 versions (the falsifying contrast).
- AC-BMB-2: a sites file whose 50th row names a rule of another leaf refuses with exit 4 naming that row; the leaf's version and site map are unchanged (no partial write of rows 1-49).
- AC-BMB-3: a sites file that is not valid JSON, is not an array, or repeats a site key refuses with exit 4 naming the problem, and writes nothing.


## Acceptance Criteria (structured)

- [⚑] [script] AC-BMB-1: One baseline map call with a 50-row sites file on an approved leaf adds exactly 1 version and 1 audit row listing all 50 sites and the leaf stays approved; the same 50 rows sent as 50 single-site calls add 50 versions
  script: test — bunx --bun vitest run packages/lore/tests/unit/service/site-map-batch-one-version.test.ts && echo 'AC-BMB-1 PASS: a 50-row map is one version'
- [⚑] [script] AC-BMB-2: A sites file whose 50th row names a rule of another leaf makes baseline map exit exactly 4 naming that row; the leaf version and site map are unchanged, rows 1-49 are not written
  script: test — bunx --bun vitest run packages/lore/tests/unit/service/site-map-batch-all-or-nothing.test.ts && echo 'AC-BMB-2 PASS: one bad row writes nothing'
- [⚑] [script] AC-BMB-3: A sites file that is not valid JSON, is not an array, or repeats a site key makes baseline map exit exactly 4 naming the problem and writes nothing
  script: test — bunx --bun vitest run packages/lore/tests/unit/service/site-map-batch-file-shape.test.ts && echo 'AC-BMB-3 PASS: malformed sites files are refused'

## Code anchors

- packages/lore/src/service/rule-service.ts
