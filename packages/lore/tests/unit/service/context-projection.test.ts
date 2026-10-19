/**
 * RED-phase TDD suite for AC-CTX-1 — `parseManagedSections` /
 * `renderManagedSections` / `spliceManagedSections` at
 * `packages/lore/src/service/context-projection.ts`
 * (task-skill-test-red-projection-splice-suite-binding-the-exact).
 *
 * The module under test does NOT exist yet in this worktree (confirmed
 * empirically before writing this file: `ls
 * packages/lore/src/service/context-projection.ts` -> "No such file or
 * directory"). Authoring it is a DIFFERENT task's anchor — this suite must
 * not create it. This file is AC-CTX-1's script target verbatim:
 *   `bunx vitest run packages/lore/tests/unit/service/context-projection.test.ts`
 *
 * Typecheck strategy (same dodge as the `claude-md-check.test.ts` precedent):
 * a STATIC `import { parseManagedSections } from
 * "../../../src/service/context-projection.js"` would fail module resolution
 * at `tsc --noEmit` time (the file doesn't exist). `loadContextProjection()`
 * below builds the module specifier from a `string[]` via `.join("/")`
 * instead of a string literal — TypeScript's `import()` type-checker only
 * attempts resolution for a LITERAL specifier, so a non-literal
 * `string`-typed specifier resolves to `Promise<any>` with zero resolution
 * attempt, keeping `bun run typecheck` green pre-GREEN while `vitest run`
 * still fails loudly today with a real "Cannot find module" error. Called
 * fresh inside each `it()` (never hoisted to a shared `beforeAll`) so a
 * missing module fails every scenario individually, not as one collapsed
 * suite-level error.
 *
 * ── Executable contract this suite pins (spec text + this suite's own
 * authoring decisions, since a RED suite IS the executable spec for its
 * paired implementation task) ──
 *
 * Marker literals (from the task's Context Digest, spec's `memory-markers.ts`
 * constants not yet landed under these exact string values):
 *   ZONE_START = "# ─── lore governance (managed) ───"
 *   ZONE_END   = "# ─── end lore governance ───"
 * Fingerprint comment format: `<!-- lore:managed section=<id> hash=<8hex> -->`
 * Hash = first 8 hex chars of sha256 over the section BODY, computed over
 * UTF-8 bytes, EXCLUDING the fingerprint line itself (spec Downstream
 * Handoff note, verbatim).
 *
 * Canonical "body" shape: the string passed into `next: ManagedSection[]`
 * (and returned as `ParsedManagedSection.body`) never carries a trailing
 * newline; when serialized, a body is followed by exactly one "\n" before
 * the next fingerprint line or the end marker. This keeps hashing and
 * round-tripping unambiguous.
 *
 * Both `parseManagedSections` and `spliceManagedSections` are modeled as
 * PURE, SYNCHRONOUS `Result<T, LoreError>` returns (not `Promise`-wrapped —
 * CLAUDE.md's "every service method returns Promise<Result<...>>" convention
 * applies to store-touching services; this module is spec'd "ALL PURE", and
 * the Public Interface block shows non-Promise return types). Failure mode
 * is `VALIDATION_ERROR` per the task's own "missing end-marker -> fail-loud
 * VALIDATION_ERROR Result (never partial splice)" phrasing.
 *
 * Five-state semantics this suite pins (the split between "created" and
 * "appended" is this suite's own authoring decision — the spec names both
 * states but does not pin their exact trigger condition):
 *   - "created": the section id is new WITHIN an already-parseable zone
 *     (including the degenerate case of splicing into a fully EMPTY existing
 *     file, where the zone itself is being created for the first time — there
 *     is no prior Z2 content to preserve, so this is "creation", not
 *     "appending after content").
 *   - "appended": the existing file has NO zone markers at all AND is
 *     non-empty (real Z2 prose already exists) — the whole new zone is
 *     appended after that prose, and every section written into it is
 *     "appended" rather than "created".
 *   - "updated": the section id exists in the zone, its stored fingerprint
 *     hash matches sha256_8(stored body) (not hand-edited), and the
 *     requested body differs from the stored body -> body + hash rewritten.
 *   - "unchanged": same as "updated" but the requested body is byte-identical
 *     to the stored body -> the ENTIRE file is byte-identical output.
 *   - "diverged_skip": the section id exists but its stored fingerprint hash
 *     does NOT match sha256_8(stored body) (a human/AI hand-edited the body
 *     without recomputing the fingerprint) -> the section is left
 *     byte-for-byte untouched regardless of what `next` requests.
 * Sections outside the managed zone (Z2 bytes: everything before the start
 * marker and after the end marker, or the WHOLE original file when a new
 * zone gets appended) MUST be preserved byte-for-byte on every path.
 *
 * Coverage dimensions: HAPPY (created / updated / unchanged / appended) /
 * STATE (diverged_skip) / BOUNDARY (splice idempotency, CRLF tolerance,
 * UTF-8 multibyte hashing) / NEGATIVE-ERROR (missing end-marker, malformed
 * fingerprint line, both fail loud with VALIDATION_ERROR) / REGRESSION
 * (z2Spans exactly recover Z2 prose bytes, nothing more/less).
 *
 * @spec_ref spec-context-verb-family-two-zone-claude-md-anatomy-lore
 * @ac_ref AC-CTX-1
 */

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import type { Result, LoreError } from "@lore/core";

// ─── Local shape mirrors (module under test doesn't exist yet — see header) ─

interface Span {
  start: number;
  end: number;
}

interface ParsedManagedSection {
  id: string;
  /** Body exactly as stored, excluding the fingerprint line and any trailing "\n". */
  body: string;
  /** Fingerprint hash exactly as stored — NOT necessarily valid for `body` (divergence check is the splice layer's job). */
  hash: string;
}

interface ManagedSection {
  id: string;
  body: string;
}

type SpliceSectionState = "created" | "updated" | "unchanged" | "diverged_skip" | "appended";

interface SpliceResult {
  content: string;
  perSection: Array<{ id: string; state: SpliceSectionState }>;
}

type ParseManagedSectionsFn = (
  content: string,
) => Result<{ sections: ParsedManagedSection[]; z2Spans: Span[] }, LoreError>;

type RenderManagedSectionsFn = (facts: unknown) => ManagedSection[];

type SpliceManagedSectionsFn = (
  existing: string,
  next: ManagedSection[],
) => Result<SpliceResult, LoreError>;

/**
 * Loads the three-function Public Interface via a NON-LITERAL dynamic import
 * specifier — see header comment for why this keeps `tsc --noEmit` green
 * pre-GREEN while still failing loudly (real "Cannot find module") under
 * `vitest run` today. Called fresh inside each `it()`.
 */
async function loadContextProjection(): Promise<{
  parseManagedSections: ParseManagedSectionsFn;
  renderManagedSections: RenderManagedSectionsFn;
  spliceManagedSections: SpliceManagedSectionsFn;
}> {
  const modulePathParts = ["..", "..", "..", "src", "service", "context-projection.js"];
  const modulePath = modulePathParts.join("/");
  const mod = (await import(modulePath)) as {
    parseManagedSections: ParseManagedSectionsFn;
    renderManagedSections: RenderManagedSectionsFn;
    spliceManagedSections: SpliceManagedSectionsFn;
  };
  return mod;
}

// ─── Marker + fingerprint literals ──────────────────────────────────────────

const ZONE_START = "# ─── lore governance (managed) ───";
const ZONE_END = "# ─── end lore governance ───";

function fingerprintLine(id: string, hash: string): string {
  return `<!-- lore:managed section=${id} hash=${hash} -->`;
}

/** sha256 over UTF-8 bytes of `body`, first 8 hex chars — the canonical fingerprint hash. */
function sha256_8(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex").slice(0, 8);
}

/** Unwraps a `Result`, failing the test loudly (with the error payload) if it's `ok:false`. */
function expectOk<T>(result: Result<T, LoreError>): T {
  if (!result.ok) {
    throw new Error(`expected ok:true but got ok:false — error: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

// ─── Fixture builders ───────────────────────────────────────────────────────

interface SectionFixture {
  id: string;
  body: string;
  /** Override the fingerprint hash written into the fixture — used to simulate a
   * hand-edited (diverged) section whose stored hash no longer matches its stored body. */
  hashOverride?: string;
}

/** Builds a single managed zone (LF line endings), no leading/trailing newline. */
function buildZoneBody(sections: SectionFixture[]): string {
  const lines: string[] = [ZONE_START];
  for (const s of sections) {
    const hash = s.hashOverride ?? sha256_8(s.body);
    lines.push(fingerprintLine(s.id, hash));
    lines.push(s.body);
  }
  lines.push(ZONE_END);
  return lines.join("\n");
}

/** Builds a single managed zone using CRLF line endings throughout. */
function buildZoneBodyCrlf(sections: SectionFixture[]): string {
  const lines: string[] = [ZONE_START];
  for (const s of sections) {
    const hash = s.hashOverride ?? sha256_8(s.body);
    lines.push(fingerprintLine(s.id, hash));
    lines.push(s.body);
  }
  lines.push(ZONE_END);
  return lines.join("\r\n");
}

/** The message of a VALIDATION_ERROR; fails the test for any other error code. */
function messageOf(error: LoreError): string {
  if (error.code !== "VALIDATION_ERROR") throw new Error(`expected VALIDATION_ERROR, got ${error.code}`);
  return error.message;
}

const PROSE_BEFORE ="# Demo Project\n\nHand-written discipline goes here.\n\n";
const PROSE_AFTER = "\n⛔ Never remove this line manually.\n";

// ─── Scenarios ──────────────────────────────────────────────────────────────

describe("context-projection splice suite (RED — packages/lore/src/service/context-projection.ts does not exist yet)", () => {
  it("HAPPY: created — splicing into a completely empty file creates the managed zone from scratch", async () => {
    const { spliceManagedSections } = await loadContextProjection();
    const sections: ManagedSection[] = [
      { id: "module-index", body: "- packages/core\n- packages/lore" },
      { id: "command-table", body: "bun run build" },
    ];

    const result = spliceManagedSections("", sections);
    const { content, perSection } = expectOk(result);

    expect(perSection).toEqual([
      { id: "module-index", state: "created" },
      { id: "command-table", state: "created" },
    ]);
    expect(content).toContain(ZONE_START);
    expect(content).toContain(ZONE_END);
    for (const s of sections) {
      expect(content).toContain(fingerprintLine(s.id, sha256_8(s.body)));
      expect(content).toContain(s.body);
    }
  });

  it("HAPPY: updated — existing section's facts changed -> body+hash rewritten, Z2 prose preserved", async () => {
    const { spliceManagedSections } = await loadContextProjection();
    const oldBody = "Module count: 3 (as of last refresh)";
    const newBody = "Module count: 5 (as of last refresh)";
    const existing =
      PROSE_BEFORE + buildZoneBody([{ id: "module-index", body: oldBody }]) + "\n" + PROSE_AFTER;

    const result = spliceManagedSections(existing, [{ id: "module-index", body: newBody }]);
    const { content, perSection } = expectOk(result);

    expect(perSection).toEqual([{ id: "module-index", state: "updated" }]);
    expect(content).toContain(newBody);
    expect(content).not.toContain(oldBody);
    expect(content).toContain(fingerprintLine("module-index", sha256_8(newBody)));
    expect(content).toContain(PROSE_BEFORE);
    expect(content).toContain(PROSE_AFTER);
  });

  it("HAPPY: unchanged — identical requested body -> byte-identical whole-file output, state unchanged", async () => {
    const { spliceManagedSections } = await loadContextProjection();
    const stableBody = "Stable, unchanging discipline line.";
    const existing =
      PROSE_BEFORE + buildZoneBody([{ id: "command-table", body: stableBody }]) + "\n" + PROSE_AFTER;

    const result = spliceManagedSections(existing, [{ id: "command-table", body: stableBody }]);
    const { content, perSection } = expectOk(result);

    expect(perSection).toEqual([{ id: "command-table", state: "unchanged" }]);
    expect(content).toBe(existing);
  });

  it("HAPPY: appended — non-empty markerless file gets the zone appended at the end, prose preserved verbatim", async () => {
    const { spliceManagedSections } = await loadContextProjection();
    const humanProse = "# My Project\n\nThis file predates the context verb family.\n";
    const sections: ManagedSection[] = [{ id: "module-index", body: "- packages/core" }];

    const result = spliceManagedSections(humanProse, sections);
    const { content, perSection } = expectOk(result);

    expect(perSection).toEqual([{ id: "module-index", state: "appended" }]);
    expect(content).toContain(humanProse);
    expect(content.indexOf(humanProse)).toBe(0); // prose stays at the very start, untouched
    expect(content).toContain(ZONE_START);
    expect(content.indexOf(ZONE_START)).toBeGreaterThan(content.indexOf(humanProse));
  });

  it("STATE: diverged_skip — hand-edited section (stored hash mismatch) is left byte-for-byte untouched", async () => {
    const { spliceManagedSections } = await loadContextProjection();
    const originalBody = "Original projected body — do not hand edit.";
    const handEditedBody = "SOMEONE HAND-EDITED THIS SECTION AFTERWARD";
    // Simulates: the zone was created with `originalBody` + a correct hash,
    // then a human edited the body in place WITHOUT recomputing the
    // fingerprint — the stored hash still reflects `originalBody`, but the
    // stored body bytes are now `handEditedBody` (spec D5 divergence: hash
    // of stored body != stored hash).
    const staleHash = sha256_8(originalBody);
    const existing =
      PROSE_BEFORE +
      buildZoneBody([{ id: "governance-pointer", body: handEditedBody, hashOverride: staleHash }]) +
      "\n" +
      PROSE_AFTER;

    const requestedBody = "Attempted fresh projection facts — must NOT land";
    const result = spliceManagedSections(existing, [
      { id: "governance-pointer", body: requestedBody },
    ]);
    const { content, perSection } = expectOk(result);

    expect(perSection).toEqual([{ id: "governance-pointer", state: "diverged_skip" }]);
    expect(content).toContain(handEditedBody);
    expect(content).toContain(fingerprintLine("governance-pointer", staleHash));
    expect(content).not.toContain(requestedBody);
    expect(content).toContain(PROSE_BEFORE);
    expect(content).toContain(PROSE_AFTER);
  });

  it("BOUNDARY: splice idempotency — re-applying identical sections twice yields a byte-identical second output", async () => {
    const { spliceManagedSections } = await loadContextProjection();
    const sections: ManagedSection[] = [
      { id: "module-index", body: "- packages/core\n- packages/lore" },
      { id: "command-table", body: "bun run test" },
    ];

    const first = expectOk(spliceManagedSections("", sections));
    expect(first.perSection.every((p) => p.state === "created")).toBe(true);

    const second = expectOk(spliceManagedSections(first.content, sections));
    expect(second.content).toBe(first.content);
    expect(second.perSection).toEqual([
      { id: "module-index", state: "unchanged" },
      { id: "command-table", state: "unchanged" },
    ]);
  });

  it("BOUNDARY: CRLF-formatted existing content is tolerated; Z2 CRLF bytes preserved exactly", async () => {
    const { spliceManagedSections } = await loadContextProjection();
    const proseBeforeCrlf = "# Demo\r\n\r\nCRLF-authored discipline line.\r\n\r\n";
    const proseAfterCrlf = "Trailing CRLF discipline line.\r\n";
    // "gamma" is a NEW section id (not present in the existing CRLF zone,
    // which only carries "alpha") — isolates CRLF structural tolerance from
    // hash-divergence semantics, which are exercised by other scenarios.
    const existing =
      proseBeforeCrlf +
      buildZoneBodyCrlf([{ id: "alpha", body: "Alpha body" }]) +
      "\r\n" +
      proseAfterCrlf;

    const result = spliceManagedSections(existing, [{ id: "gamma", body: "Gamma body" }]);
    const { content, perSection } = expectOk(result);

    expect(perSection).toEqual([{ id: "gamma", state: "created" }]);
    expect(content).toContain(proseBeforeCrlf);
    expect(content).toContain(proseAfterCrlf);
  });

  it("BOUNDARY: UTF-8 multibyte body (CJK) hashes correctly — unchanged when identical, updated with correct new hash otherwise", async () => {
    const { spliceManagedSections } = await loadContextProjection();
    const cjkBody = "测试文档内容一二三四五";
    const existing = buildZoneBody([{ id: "cjk-section", body: cjkBody }]) + "\n";

    const unchangedResult = expectOk(
      spliceManagedSections(existing, [{ id: "cjk-section", body: cjkBody }]),
    );
    expect(unchangedResult.perSection).toEqual([{ id: "cjk-section", state: "unchanged" }]);
    expect(unchangedResult.content).toBe(existing);

    const newCjkBody = "测试文档内容一二三四五六七八九十";
    // Self-check: pin that this scenario genuinely exercises multibyte
    // content (false-oracle killer, per claude-md-check.test.ts precedent) —
    // UTF-16 code-unit length must differ from UTF-8 byte length.
    expect(Buffer.byteLength(newCjkBody, "utf8")).toBeGreaterThan(newCjkBody.length);

    const updatedResult = expectOk(
      spliceManagedSections(existing, [{ id: "cjk-section", body: newCjkBody }]),
    );
    expect(updatedResult.perSection).toEqual([{ id: "cjk-section", state: "updated" }]);
    expect(updatedResult.content).toContain(newCjkBody);
    expect(updatedResult.content).toContain(fingerprintLine("cjk-section", sha256_8(newCjkBody)));
  });

  it("NEGATIVE/ERROR: missing end-marker -> parseManagedSections AND spliceManagedSections fail loud with VALIDATION_ERROR (never partial)", async () => {
    const { parseManagedSections, spliceManagedSections } = await loadContextProjection();
    const unterminated =
      [ZONE_START, fingerprintLine("alpha", sha256_8("Alpha body")), "Alpha body"].join("\n") + "\n";
    // Deliberately NO ZONE_END line anywhere in this fixture.
    expect(unterminated).not.toContain(ZONE_END);

    const parseResult = parseManagedSections(unterminated);
    expect(parseResult.ok).toBe(false);
    if (!parseResult.ok) {
      expect(parseResult.error.code).toBe("VALIDATION_ERROR");
    }

    const spliceResult = spliceManagedSections(unterminated, [{ id: "alpha", body: "New body" }]);
    expect(spliceResult.ok).toBe(false);
    if (!spliceResult.ok) {
      expect(spliceResult.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("ERROR: a marker zone with ZERO fingerprint comments (older-lore shape) is refused with the named repair, never replaced (BR-881)", async () => {
    const { spliceManagedSections } = await loadContextProjection();
    const legacyBody = "# CLAUDE.md\n\nLore-governed workflow stub.\n\n## Module Index\n";
    const existing = `${PROSE_BEFORE}${ZONE_START}\n${legacyBody}${ZONE_END}\n${PROSE_AFTER}`;

    const result = spliceManagedSections(existing, [{ id: "governance", body: legacyBody }]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(messageOf(result.error)).toContain("carries no fingerprint");
    expect(messageOf(result.error)).toContain("Repair: delete the zone");
    expect(messageOf(result.error)).toContain(ZONE_START);
    expect(messageOf(result.error)).toContain(ZONE_END);
  });

  it("STATE: the stated repair works — with the zone deleted, a fresh fingerprinted zone is appended and Z2 prose is kept", async () => {
    const { spliceManagedSections } = await loadContextProjection();
    const repaired = `${PROSE_BEFORE}${PROSE_AFTER}`;
    const body = "Freshly rendered body.";
    const { content, perSection } = expectOk(spliceManagedSections(repaired, [{ id: "governance", body }]));
    expect(perSection).toEqual([{ id: "governance", state: "appended" }]);
    expect(content).toContain(PROSE_BEFORE);
    expect(content).toContain(fingerprintLine("governance", sha256_8(body)));
  });

  it("NEGATIVE/ERROR: an ATTEMPTED-but-malformed fingerprint inside an otherwise fingerprint-less zone is NOT adopted — VALIDATION_ERROR stays (structural damage, not legacy)", async () => {
    const { spliceManagedSections } = await loadContextProjection();
    // Only ONE interior line even attempts the fingerprint prefix, and it's
    // corrupt (non-hex hash) — this must NOT be treated as legacy adoption
    // even though most of the zone looks like plain legacy prose.
    const existing = [
      ZONE_START,
      "<!-- lore:managed section=alpha hash=NOTHEX -->",
      "Alpha body",
      ZONE_END,
    ].join("\n") + "\n";

    const result = spliceManagedSections(existing, [{ id: "alpha", body: "New body" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("NEGATIVE/ERROR: malformed fingerprint line (non-8-hex hash) -> parseManagedSections fails loud with VALIDATION_ERROR", async () => {
    const { parseManagedSections } = await loadContextProjection();
    const malformed =
      [ZONE_START, "<!-- lore:managed section=alpha hash=NOTHEX -->", "Alpha body", ZONE_END].join(
        "\n",
      ) + "\n";

    const result = parseManagedSections(malformed);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("REGRESSION: parseManagedSections' z2Spans exactly recover the Z2 prose bytes (nothing more, nothing less)", async () => {
    const { parseManagedSections } = await loadContextProjection();
    const sectionBody = "Command table content.";
    const existing =
      PROSE_BEFORE + buildZoneBody([{ id: "command-table", body: sectionBody }]) + "\n" + PROSE_AFTER;

    const result = parseManagedSections(existing);
    const { sections, z2Spans } = expectOk(result);

    expect(sections).toHaveLength(1);
    expect(sections[0]?.id).toBe("command-table");
    expect(sections[0]?.body).toBe(sectionBody);
    expect(sections[0]?.hash).toBe(sha256_8(sectionBody));

    const z2Text = z2Spans.map((span) => existing.slice(span.start, span.end)).join("");
    expect(z2Text).toBe(PROSE_BEFORE + PROSE_AFTER);
  });

  it("binds the full Public Interface: renderManagedSections is exported as a function (ContextFacts shape owned by the sibling context-facts.ts task, out of this suite's scope)", async () => {
    const { renderManagedSections } = await loadContextProjection();
    expect(typeof renderManagedSections).toBe("function");
  });
});
