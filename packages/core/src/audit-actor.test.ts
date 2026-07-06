/**
 * Tests for @lore/core audit-actor — formatJudgeActor / parseAuditActor codec.
 * Pure functions, no IO.
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      format → parse round-trips to the original JudgeIdentity
 *   NEGATIVE:   a plain human name parses to {kind: "human"}
 *   BOUNDARY:   prompt_version itself containing colons is preserved verbatim
 *               (split caps at exactly 4 segments)
 *   ERROR:      n/a — parseAuditActor never throws, no Result channel
 *   STATE:      n/a — no state machine in this module
 *   REGRESSION: malformed "ai:" prefixed strings (missing segments, empty
 *               segments) degrade to human-kind with the RAW original string
 *               preserved — never a partially-populated JudgeIdentity
 *
 * @spec_ref SPEC-034 §2, §3
 */

import { describe, expect, it } from "vitest";
import { formatJudgeActor, parseAuditActor } from "./audit-actor.js";
import type { JudgeIdentity } from "./review-judgment.js";

describe("formatJudgeActor", () => {
  it("HAPPY: formats a judge identity into the ai: actor string", () => {
    const judge: JudgeIdentity = {
      provider: "claude-cli",
      model: "claude-sonnet-5",
      prompt_version: "v1",
    };
    expect(formatJudgeActor(judge)).toBe("ai:claude-cli:claude-sonnet-5:v1");
  });
});

describe("parseAuditActor", () => {
  it("HAPPY: round-trips a well-formed judge identity through format → parse", () => {
    const judge: JudgeIdentity = {
      provider: "claude-cli",
      model: "claude-sonnet-5",
      prompt_version: "v1",
    };
    const actor = formatJudgeActor(judge);
    const parsed = parseAuditActor(actor);
    expect(parsed).toEqual({ kind: "ai", judge });
  });

  it("NEGATIVE: a plain human name parses to {kind: 'human'}", () => {
    expect(parseAuditActor("alice")).toEqual({ kind: "human", name: "alice" });
  });

  it("NEGATIVE: an empty string parses to {kind: 'human', name: ''}", () => {
    expect(parseAuditActor("")).toEqual({ kind: "human", name: "" });
  });

  it("NEGATIVE: a string that merely contains 'ai:' mid-string (not as a prefix) is human", () => {
    expect(parseAuditActor("human-said-ai:foo:bar:baz")).toEqual({
      kind: "human",
      name: "human-said-ai:foo:bar:baz",
    });
  });

  it("BOUNDARY: prompt_version containing colons is preserved verbatim (split caps at 4 segments)", () => {
    const actor = "ai:claude-cli:claude-sonnet-5:v1:2026-07-06T00:00:00.000Z";
    const parsed = parseAuditActor(actor);
    expect(parsed).toEqual({
      kind: "ai",
      judge: {
        provider: "claude-cli",
        model: "claude-sonnet-5",
        prompt_version: "v1:2026-07-06T00:00:00.000Z",
      },
    });
  });

  it("REGRESSION: 'ai:' prefix with only one segment degrades to human with the raw string", () => {
    expect(parseAuditActor("ai:incomplete")).toEqual({
      kind: "human",
      name: "ai:incomplete",
    });
  });

  it("REGRESSION: 'ai:' prefix with only two segments degrades to human with the raw string", () => {
    expect(parseAuditActor("ai:provider-only:")).toEqual({
      kind: "human",
      name: "ai:provider-only:",
    });
  });

  it("REGRESSION: empty provider segment (ai::model:v1) degrades to human with the raw string", () => {
    expect(parseAuditActor("ai::model:v1")).toEqual({
      kind: "human",
      name: "ai::model:v1",
    });
  });

  it("REGRESSION: empty model segment (ai:provider::v1) degrades to human with the raw string", () => {
    expect(parseAuditActor("ai:provider::v1")).toEqual({
      kind: "human",
      name: "ai:provider::v1",
    });
  });

  it("REGRESSION: empty prompt_version segment (ai:provider:model:) degrades to human with the raw string", () => {
    expect(parseAuditActor("ai:provider:model:")).toEqual({
      kind: "human",
      name: "ai:provider:model:",
    });
  });

  it("REGRESSION: bare 'ai:' prefix alone degrades to human with the raw string", () => {
    expect(parseAuditActor("ai:")).toEqual({ kind: "human", name: "ai:" });
  });
});
