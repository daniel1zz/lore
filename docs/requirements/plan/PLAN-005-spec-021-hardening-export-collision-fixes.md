---
id: PLAN-005
type: plan
role: plan
title: "SPEC-021 hardening — export collision fixes"
status: active
priority: medium
created: 2026-07-02
updated: 2026-07-02
tags: [spec-021, hardening, bugfix]
parent: SPEC-021
---
# Plan: export-docs collision hardening

Found by SPEC-026 dogfood: two assessment docs (01KWHB425TDF…, 01KWHB786ZMZ…) both got human_id KN-002 and the SAME file_path (title-truncation stem collision). Slug layer deduped (-2); human-ID allocator and file-path builder did not. Second doc exists only in db; permanent false drift; mapping integrity risk.

## Scope
1. Root-cause human-ID allocation (why KN-002 assigned twice across two export runs).
2. Dedupe file-path stems (existing-path check, -2 suffix like slugs).
3. Repair the corrupted index entry + missing file for 01KWHB786ZMZ (migration or manual reconcile documented).
4. Regression tests.
