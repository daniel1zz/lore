// @reads packages/core/src/issue-front-matter.ts
/**
 * RED scenarios for AC-GI-6 (spec-the-defect-channel-reaches-no-machine-but-its-own-github)
 * and the paired implementation task's own AC — the `frontMatterCodec` module
 * (`packages/core/src/issue-front-matter.ts`, NOT YET CREATED) that serialises
 * the closed six-field set into the issue body's front-matter block, parses it
 * back, and redacts the two identity leaks measured today:
 *
 *   - `reporterProject` at `packages/lore/src/adapters/cli/report-issue-wiring.ts:225`,
 *     built as `` `${basename(root)} (${root})` `` — an ABSOLUTE `$HOME` path.
 *   - the actor os-fallback tier at `packages/core/src/actor-resolution-node.ts:114`
 *     (`os.userInfo().username`) — the bare OS username.
 *
 * Both would land in a PUBLIC GitHub issue body, and GitHub caches edits, so
 * the disclosure is irreversible — this is why redaction is asserted here,
 * before any text reaches a `gh` invocation, rather than downstream.
 *
 * ⛔ Seeded, never ambient (spec Review Revisions round 2, item 8): every home
 * path and every "OS username" below is a literal fabricated string passed
 * INTO the function under test as a parameter. Reading the real `$HOME` or
 * the real `os.userInfo().username` would make this suite pass vacuously
 * under a CI account literally named `runner` and false-positive on a
 * developer laptop — the identical test yielding opposite verdicts on two
 * machines. The module under test must therefore take identity facts as
 * parameters; it must never reach for `process.env.HOME` or `os.userInfo()`
 * itself. That is also why every distinctive marker below is unique to this
 * file (`zzfm-…` prefix) — a collision with a real ambient value would make a
 * false pass indistinguishable from a true one.
 *
 * Six-dimension coverage:
 *   HAPPY      — round trip of all six fields (group "round-trip")
 *   BOUNDARY   — markdown control chars + embedded newline + a literal `---`
 *                delimiter lookalike inside a field value (group "round-trip")
 *   NEGATIVE   — the two identity leaks, each paired with a positive control
 *                proving the assertion is not vacuously satisfied by deleting
 *                everything (group "redaction")
 *   ERROR      — parsing a body with no front matter at all must return an
 *                explicit absent result, never a silently-empty record
 *                (group "absent")
 *   STATE      — the os-fallback actor is DROPPED, while an explicit-tier
 *                actor with the same shape is RETAINED — behaviour keyed on
 *                which precedence tier produced the value (group "redaction")
 *   REGRESSION — the exact-equality round trip (group "round-trip") pins the
 *                whole six-field contract so a future codec change that
 *                silently drops/renames/reorders a field turns this file red
 *
 * Runner: vitest (no `bun:sqlite` anywhere in this file or its imports).
 *
 * Import convention: this package's own rule (root CLAUDE.md "Import style
 * (monorepo)") is that packages/lore/** reaches packages/core/** ONLY via the
 * `@lore/core` package alias, never a relative path into another package's
 * `src/` — mirrored by every existing packages/lore/tests/unit/service/*.test.ts
 * file that exercises a pure `@lore/core` function (e.g. issue-report.test.ts's
 * `matchRootPrd`/`buildIssueReportExtra`). Until the paired
 * implementation task lands AND re-exports these names from
 * `packages/core/src/index.ts`, every import below fails at module-load time —
 * that is the expected RED: a missing export, not a malformed test.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  redactReporterIdentity,
  assembleIssueBody,
  parseIssueBody,
} from "@lore/core";
import type {
  IssueFrontMatterFields,
  ParsedIssueBody,
  RawReporterIdentity,
  ReporterActorSource,
} from "@lore/core";

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/lore/tests/unit/service -> packages/core/src
const CORE_SRC = resolve(__dirname, "../../../../core/src");
const CODEC_MODULE_PATH = join(CORE_SRC, "issue-front-matter.ts");

/** A syntactically-plausible-but-fake ULID, distinctive to this test file. */
function fakeIdempotencyKey(suffix: string): string {
  return `01ZZFMTEST${suffix.toUpperCase().padEnd(16, "0")}`.slice(0, 26);
}

/** A minimal, valid six-field record — callers override individual fields per case. */
function baseFields(overrides: Partial<IssueFrontMatterFields> = {}): IssueFrontMatterFields {
  return {
    severity: "high",
    category: "redaction-test-category",
    tags: ["zzfm-tag-a", "zzfm-tag-b"],
    reporter_corpus: "zzfm-base-corpus",
    reporter_root_prd: "prd-zzfm-base-root",
    idempotency_key: fakeIdempotencyKey("base"),
    ...overrides,
  };
}

// ─── redaction ──────────────────────────────────────────────────────────────
// Scenarios 1 and 2 of the task's Scenarios list. Each leak assertion is
// paired with a positive control (per this repo's verification discipline:
// a "leak absent" assertion alone is satisfiable by an implementation that
// deletes all identity information, which would be a worse defect, not a
// fix — the control proves real, safe information survives).
describe("redaction: neither identity leak reaches the assembled body", () => {
  it("scenario 1 — a reporter identity built from an absolute SEEDED home path never appears raw in the assembled body, only its tilde form (or nothing) survives", () => {
    const home = "/Users/zzfm-home-8f21c4-not-a-real-user";
    const corpusRoot = `${home}/zzfm-secret-corpus-9d3f`;
    const rootPrdId = "prd-zzfm-scenario1-root-77ba21";

    const raw: RawReporterIdentity = {
      corpusRoot,
      home,
      rootPrdId,
      actor: "zzfm-scenario1-irrelevant-actor",
      actorSource: "explicit",
    };
    const identity = redactReporterIdentity(raw);

    const fields = baseFields({
      reporter_corpus: identity.reporter_corpus,
      reporter_root_prd: identity.reporter_root_prd,
    });
    const body = assembleIssueBody(fields, "Steps to reproduce: nothing path-related here.", identity.actor);

    // NEGATIVE: neither the full absolute path nor the distinctive home
    // token survives anywhere in the output — not even partially, since a
    // partial leak of the sensitive segment is exactly as disclosive as the
    // whole path.
    expect(body).not.toContain(corpusRoot);
    expect(body).not.toContain(home);
    expect(body).not.toContain("zzfm-home-8f21c4-not-a-real-user");

    // Positive control: the SAFE remainder — the corpus's own name and the
    // root-PRD id — still reaches the body. An implementation that redacts
    // by deleting the whole identity (rather than stripping only the
    // sensitive home prefix) would fail these two lines while still passing
    // the three lines above, so the pair together discriminates "redacted"
    // from "destroyed".
    expect(body).toContain("zzfm-secret-corpus-9d3f");
    expect(body).toContain(rootPrdId);
  });

  it("scenario 2 — a seeded distinctive OS-fallback username appears nowhere in the assembled body, while a same-shaped EXPLICIT-tier actor is retained", () => {
    const osUsername = "zzfm-osuser-4c19e0-not-a-real-user";
    const explicitActor = "zzfm-explicit-actor-712-not-a-real-user";
    const sharedRaw = {
      corpusRoot: "/Users/zzfm-scenario2-home/zzfm-scenario2-corpus",
      home: "/Users/zzfm-scenario2-home",
      rootPrdId: "prd-zzfm-scenario2-root",
    };

    const osFallbackIdentity = redactReporterIdentity({
      ...sharedRaw,
      actor: osUsername,
      actorSource: "os-fallback",
    });
    // STATE: the os-fallback tier's value is DROPPED entirely at the
    // redaction boundary itself — not merely omitted later by some other
    // caller, and not merely redacted-in-place (there is no redacted form
    // of an OS username that is still safe to publish alongside a
    // corpus/PRD identity).
    expect(osFallbackIdentity.actor).toBeUndefined();

    const bodyWithOsFallbackDropped = assembleIssueBody(
      baseFields({
        reporter_corpus: osFallbackIdentity.reporter_corpus,
        reporter_root_prd: osFallbackIdentity.reporter_root_prd,
      }),
      "Body text unrelated to the actor.",
      osFallbackIdentity.actor,
    );
    expect(bodyWithOsFallbackDropped).not.toContain(osUsername);
    expect(bodyWithOsFallbackDropped).not.toContain("zzfm-osuser-4c19e0-not-a-real-user");

    // Positive control: an EXPLICIT-tier actor of the exact same shape is
    // NOT dropped. Without this half, "the username never appears" would
    // also be trivially true of an implementation that drops every actor
    // unconditionally — which contradicts "dropped entirely rather than
    // redacted" being a property of the OS-FALLBACK TIER specifically.
    const explicitIdentity = redactReporterIdentity({
      ...sharedRaw,
      actor: explicitActor,
      actorSource: "explicit",
    });
    expect(explicitIdentity.actor).toBe(explicitActor);

    const bodyWithExplicitActor = assembleIssueBody(
      baseFields({
        reporter_corpus: explicitIdentity.reporter_corpus,
        reporter_root_prd: explicitIdentity.reporter_root_prd,
      }),
      "Body text unrelated to the actor.",
      explicitIdentity.actor,
    );
    expect(bodyWithExplicitActor).toContain(explicitActor);
  });

  it("boundary: every ReporterActorSource other than os-fallback retains the actor; only os-fallback drops it", () => {
    const survivingSources: ReporterActorSource[] = ["explicit", "env", "session"];
    for (const actorSource of survivingSources) {
      const identity = redactReporterIdentity({
        corpusRoot: "/Users/zzfm-tiers-home/zzfm-tiers-corpus",
        home: "/Users/zzfm-tiers-home",
        rootPrdId: "prd-zzfm-tiers-root",
        actor: `zzfm-actor-for-${actorSource}`,
        actorSource,
      });
      expect(identity.actor).toBe(`zzfm-actor-for-${actorSource}`);
    }

    const dropped = redactReporterIdentity({
      corpusRoot: "/Users/zzfm-tiers-home/zzfm-tiers-corpus",
      home: "/Users/zzfm-tiers-home",
      rootPrdId: "prd-zzfm-tiers-root",
      actor: "zzfm-actor-for-os-fallback",
      actorSource: "os-fallback",
    });
    expect(dropped.actor).toBeUndefined();
  });
});

// ─── round-trip ─────────────────────────────────────────────────────────────
// Scenarios 3 and 4 of the task's Scenarios list.
describe("round-trip: the closed six-field set survives assembly and parsing unchanged", () => {
  it("scenario 3 — all six front-matter fields equal their input after a parse of the assembled body", () => {
    const fields: IssueFrontMatterFields = {
      severity: "critical",
      category: "zzfm-round-trip-category",
      tags: ["zzfm-alpha", "zzfm-beta", "zzfm-gamma"],
      reporter_corpus: "zzfm-round-trip-corpus-marker",
      reporter_root_prd: "prd-zzfm-round-trip-root-marker",
      idempotency_key: fakeIdempotencyKey("scenario3"),
    };

    const body = assembleIssueBody(fields, "Some free-form description text.\nAcross multiple lines.");
    const parsed: ParsedIssueBody = parseIssueBody(body);

    expect(parsed.present).toBe(true);
    if (parsed.present) {
      expect(parsed.fields).toEqual(fields);
    }
  });

  it("scenario 4 — a category carrying markdown control characters and a literal newline survives intact and does not break the front-matter delimiters", () => {
    const trickyCategory =
      "weird `category` **bold** with a lone --- delimiter lookalike\nand a second line after a hard newline";
    const fields: IssueFrontMatterFields = baseFields({
      category: trickyCategory,
      idempotency_key: fakeIdempotencyKey("scenario4"),
    });

    const body = assembleIssueBody(fields, "Body text, unaffected by the tricky category above.");
    const parsed: ParsedIssueBody = parseIssueBody(body);

    expect(parsed.present).toBe(true);
    if (parsed.present) {
      // The tricky value survives byte-for-byte — proving the codec escapes
      // or otherwise protects an embedded newline/delimiter-lookalike rather
      // than truncating, escaping-lossily, or letting it terminate the
      // front-matter block early.
      expect(parsed.fields.category).toBe(trickyCategory);
      // Sanity: the delimiters were not broken by the embedded newline — its
      // NEIGHBOURING fields parsed back correctly too, which would not hold
      // if the "---" lookalike had been read as the block's own closing
      // delimiter.
      expect(parsed.fields.severity).toBe(fields.severity);
      expect(parsed.fields.reporter_corpus).toBe(fields.reporter_corpus);
      expect(parsed.fields.idempotency_key).toBe(fields.idempotency_key);
    }
  });
});

// ─── absent ─────────────────────────────────────────────────────────────────
// Scenario 5 of the task's Scenarios list.
describe("absent: a body with no front matter parses to an explicit absent result", () => {
  it("scenario 5 — plain text with no front-matter block at all returns {present: false}, never a silently-empty record", () => {
    const parsed: ParsedIssueBody = parseIssueBody(
      "Just a plain issue body with no front-matter block at all.\n\nMultiple paragraphs, no delimiters.",
    );

    expect(parsed.present).toBe(false);
    // ERROR/negative: this must be an EXPLICIT absent discriminant, not an
    // object that happens to carry empty-string/undefined field values — the
    // two are indistinguishable to a caller that only checks truthiness of
    // individual fields, which is exactly the silent-failure shape this
    // scenario exists to rule out.
    expect("fields" in parsed).toBe(false);
    expect(parsed).toEqual({ present: false });
  });

  it("boundary: an EMPTY string also parses to an explicit absent result (not a crash, not a vacuous present:true)", () => {
    const parsed: ParsedIssueBody = parseIssueBody("");
    expect(parsed.present).toBe(false);
  });
});

// ─── browser-safety (forces the implementation into the required shape) ────
// Not one of the five task scenarios — a standing structural guard, per this
// package's browser-safety invariant (packages/core/src/CLAUDE.md): the
// `@lore/core` default barrel must never top-level-import a Node builtin, on
// pain of blanking the dashboard SPA at module-load time. Mirrors
// packages/lore/tests/unit/core/barrel-isolation.test.ts's static-scan
// method (a vitest runtime import can't observe this — vitest runs under
// Node, where `fs`/`path`/`os` import and execute just fine; the failure
// mode is Vite's BROWSER dev-mode stub, which this repo catches via a static
// source-text scan instead of a browser harness). Before the paired
// implementation lands this also fails — ENOENT on a module that doesn't
// exist yet — which is still "the missing module", the same RED reason as
// every other case above.
describe("browser safety: issue-front-matter.ts imports no Node builtin at module scope", () => {
  it("has no top-level VALUE import of node:fs / node:path / node:os (bare or node: -prefixed specifier)", () => {
    expect(existsSync(CODEC_MODULE_PATH)).toBe(true);
    const content = readFileSync(CODEC_MODULE_PATH, "utf8");
    const nodeBuiltinValueImportPattern =
      /^\s*import\s+(?!type\b)[^;]*from\s+["'](?:node:)?(fs|path|os)["']/m;
    expect(nodeBuiltinValueImportPattern.test(content)).toBe(false);
  });
});
