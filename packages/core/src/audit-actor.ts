/**
 * Audit-actor codec — formats a JudgeIdentity into the single `created_by` /
 * `actor` string stored on review_judgments and calibration_records, and
 * parses it back. Lets AI-authored rows share the same plain-text actor
 * column every other audit trail in this codebase already uses (no schema
 * change, no new column), while still round-tripping the full judge identity
 * for AI-authored rows. Pure, browser-safe module: no IO.
 *
 * Public surface:
 *   - formatJudgeActor(judge) — JudgeIdentity → "ai:{provider}:{model}:{prompt_version}"
 *   - parseAuditActor(actor) — the inverse; degrades to {kind:"human"} on anything
 *     that isn't a well-formed "ai:...:...:..." string
 *
 * Invariants:
 *   - parseAuditActor never throws. A string that starts with "ai:" but doesn't
 *     carry all three colon-delimited segments (provider, model, prompt_version)
 *     degrades to {kind: "human", name: <the raw original string>} — never a
 *     partially-populated JudgeIdentity with empty fields.
 *   - The split is capped at exactly 4 segments ("ai", provider, model, rest).
 *     prompt_version may itself contain colons (e.g. "v1:2026-07-06") — anything
 *     after the third colon belongs to prompt_version verbatim, unsplit.
 *   - formatJudgeActor(judge) |> parseAuditActor round-trips to
 *     {kind: "ai", judge} for every JudgeIdentity whose fields don't start with
 *     an empty string (judgeIdentitySchema's .min(1) already guarantees that).
 *
 * Side-effect class: pure
 *
 * Source: SPEC-034 §2, §3
 */

import type { JudgeIdentity } from "./review-judgment.js";

// ─── Format ─────────────────────────────────────────────────────────────────

/**
 * Format a JudgeIdentity into the actor string persisted as `created_by` on
 * an AI-authored `review_judgments` row.
 *
 * @param judge - The judge identity to encode
 * @returns `"ai:{provider}:{model}:{prompt_version}"`
 *
 * @example
 * formatJudgeActor({ provider: "claude-cli", model: "claude-sonnet-5", prompt_version: "v1" });
 * // → "ai:claude-cli:claude-sonnet-5:v1"
 */
export function formatJudgeActor(judge: JudgeIdentity): string {
  return `ai:${judge.provider}:${judge.model}:${judge.prompt_version}`;
}

// ─── Parse ──────────────────────────────────────────────────────────────────

/** Discriminated result of {@link parseAuditActor}. */
export type ParsedAuditActor = { kind: "ai"; judge: JudgeIdentity } | { kind: "human"; name: string };

/**
 * Parse an actor string back into either an AI judge identity or a plain
 * human name. Never throws — any string that isn't well-formed
 * "ai:{provider}:{model}:{prompt_version}" (including one that merely starts
 * with the "ai:" prefix but is missing a segment) degrades to
 * `{kind: "human", name: actor}` with the raw original string preserved.
 *
 * @param actor - Raw actor string, e.g. from DocRecord.created_by or an audit entry
 * @returns `{kind: "ai", judge}` on a well-formed AI actor string, otherwise
 *   `{kind: "human", name: actor}`
 *
 * @example
 * parseAuditActor("ai:claude-cli:claude-sonnet-5:v1");
 * // → { kind: "ai", judge: { provider: "claude-cli", model: "claude-sonnet-5", prompt_version: "v1" } }
 * parseAuditActor("alice"); // → { kind: "human", name: "alice" }
 * parseAuditActor("ai:incomplete"); // → { kind: "human", name: "ai:incomplete" } (malformed, degrades)
 */
export function parseAuditActor(actor: string): ParsedAuditActor {
  const AI_PREFIX = "ai:";
  if (!actor.startsWith(AI_PREFIX)) {
    return { kind: "human", name: actor };
  }

  // reason: split into exactly 4 segments max (ai, provider, model, rest=prompt_version) —
  // prompt_version may itself contain colons, so we only ever consume the first two
  // colons after the "ai:" prefix and leave everything else as the remainder. See
  // SPEC-034 §2.
  const afterPrefix = actor.slice(AI_PREFIX.length);

  const providerEnd = afterPrefix.indexOf(":");
  if (providerEnd === -1) {
    return { kind: "human", name: actor };
  }
  const provider = afterPrefix.slice(0, providerEnd);

  const afterProvider = afterPrefix.slice(providerEnd + 1);
  const modelEnd = afterProvider.indexOf(":");
  if (modelEnd === -1) {
    return { kind: "human", name: actor };
  }
  const model = afterProvider.slice(0, modelEnd);
  const promptVersion = afterProvider.slice(modelEnd + 1);

  if (provider === "" || model === "" || promptVersion === "") {
    return { kind: "human", name: actor };
  }

  return { kind: "ai", judge: { provider, model, prompt_version: promptVersion } };
}
