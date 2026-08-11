---
id: KN-368
type: knowledge
role: knowledge
title: "A session row is only as real as the api_keys row it joins to — F5a packaged-mode auth failure"
status: approved
priority: medium
created: 2026-07-28
updated: 2026-07-28
tags: [auth, sessions, f5a, root-cause]
parent: SPEC-105
links:
  - {id: SPEC-105, type: informs}
---
# A session row is only as real as the api_keys row it joins to — packaged-mode dashboard auth failure

## Symptom

The F5a packaged dashboard served its UI shell correctly (`GET /` → 200 HTML) and the nonce bootstrap appeared to succeed (302 + `Set-Cookie: lore_sid`), yet EVERY subsequent `/api/*` request returned 401 `VALIDATION_ERROR field=Cookie "Session not found or expired"`. The feature looked shipped and was non-functional.

## Root cause

`static-serving.ts` mints the redeemed-nonce session against `BOOTSTRAP_SESSION_OWNER = "dashboard-local"`. `SessionStore.resolve()` INNER JOINs `sessions` → `api_keys WHERE revoked_at IS NULL`. Packaged mode deliberately skipped `ensureLocalApiKey` (its header comment asserted this as a DD-2 invariant), so no `api_keys` row named `dashboard-local` ever existed. The join matched nothing, `resolve()` returned null, and every authenticated read 401'd.

`sessionStore.create()` does NOT validate that its owner key exists — it happily writes a session row pointing at a non-existent owner. The failure surfaces only at resolve time, one request later, as an auth error rather than a creation error.

## Fix (adjudicated)

Packaged startup calls `ensureLocalApiKey` for its side effect (ensuring the row exists) and discards the raw key. This does not weaken DD-2: that invariant is **the key is never SERVED over HTTP / never embedded in the built artifact** — not that it never exists. The key already existed in `--dev` mode; packaged mode simply stopped serving it.

⛔ Rejected fix: loosening `SessionStore.resolve()`'s JOIN. That would weaken revocation semantics for every auth path in the product to paper over one caller's missing precondition.

## Transferable lessons

1. **A creation API that doesn't validate its foreign-key precondition converts a setup bug into a delayed auth bug.** If `sessionStore.create` had rejected an unknown owner, this would have failed loudly at launch instead of silently at first read.
2. **"Page loads" is not "app works."** The T3 smoke test curled `GET /` and got 200 HTML — proving the static shell serves, not that any data is reachable. An end-to-end reachability oracle (redeem session → authenticated `/api` read) belongs in the exit gate of the phase that ships the auth path, not deferred to a later e2e phase. Phases 2 and 3 both reported all-green while the shipped surface could not authenticate.
3. **A comment asserting an invariant must be updated when the invariant is deliberately changed** — the stale "packaged mode never calls ensureLocalApiKey" comment would have misled the next reader into re-breaking it.
