/**
 * OutlineMigrationService — one-shot, idempotent, per-section PRD→outline
 * migration (SPEC-080 §Migration Plan Phase 1, Risk Registry "Mid-migration
 * content loss").
 *
 * Relocates one `## `-level-2 section of the root PRD's `content` into a
 * dedicated `spec`/`domain-overview` child doc, verbatim — no summarization,
 * no synthesis. The child doc is created and linked FIRST; only after both
 * writes land does the PRD body shrink (two-phase ordering per the spec's
 * Risk Registry mitigation for "mid-migration content loss": a process
 * killed between phase 1 and phase 2 leaves the PRD's original prose intact,
 * merely duplicated — never orphaned).
 *
 * Mirrors `PhaseMigrationService`'s structural precedent (one-shot, `dryRun`
 * flag, raw `store.insert`/`store.update` bypassing `CorpusService`'s normal
 * gate/validation path — no `outline-section-migrate` checkpoint exists to
 * gate against, same deliberate bounded bypass `PhaseMigrationService`'s own
 * header documents) — but idempotency here is a TWO-BRANCH check, not a
 * single marker field:
 *
 *   1. The section's `## ` heading is still present in the PRD body (not yet
 *      shrunk) → derive "old section text" from the PRD itself and compare it
 *      against the pre-existing child doc's content (or, when no child doc
 *      exists yet, against itself — a fresh verbatim extraction trivially
 *      satisfies every invariant by construction).
 *   2. The heading is GONE (a prior live run already shrank it) → the sole
 *      remaining signal is the child doc's slug marker
 *      (`spec-domain-overview-<section>`); its mere existence is the
 *      idempotency proof, since the PRD side of the invariant comparison no
 *      longer exists to check.
 *
 * `migrateSection` is deliberately narrow-scoped to ONE section per call —
 * the CLI driver (`adapters/cli/commands/migrate.ts`'s `prd-to-outline`
 * action) loops over every requested section, matching the spec's own
 * "Phase 1 — domain sections, one section per step" sequencing. This module
 * does not itself decide WHICH sections are "domain" (§14+) vs "core"
 * (§1–13, Phase 2's separate condensation pass) — that's the caller's
 * decision; `migrateSection` migrates whatever `## `-heading-derived key it's
 * given.
 *
 * Three invariants are computed INDEPENDENTLY (never collapsed into one
 * bundled boolean) — see {@link SectionMigrationVerdict}:
 *   - `char_coverage`: every character used in the old section text also
 *     appears somewhere in the child doc's content (`chars(old §) ⊆
 *     chars(child content)`, SPEC-080 §Migration Plan).
 *   - `section_ref_equality`: the SET of `§NN` tokens in the old section text
 *     equals the set in the child doc's content.
 *   - `r_id_equality`: the SET of `R-NN` tokens equals likewise.
 *
 * A LIVE run (`dryRun: false`) on a section whose invariants fail (a
 * pre-existing, INCOMPLETE child doc) is REFUSED — this service never
 * overwrites or extends an existing child doc's content (that could trample a
 * human edit); it only ever performs a fresh, from-scratch migration when no
 * child doc exists yet.
 *
 * (The former link-only bootstrap projection `renderLinkOnlyOutlineForBootstrap` was never wired
 * into a command and was deleted by slice 3a, BR-985.)
 *
 * Side-effect class: IO (StoreInterface reads/writes; no filesystem, no AI)
 *
 * Source: spec-080-prd-as-outline-contract-structured-outline-domain
 *   §C1, §Migration Plan Phase 1, §Risk Registry, §Acceptance Criteria
 *   AC-080-7.
 */

import { ulid } from "ulidx";
import { err, ok, outlineEntrySchema } from "@lore/core";
import { z } from "zod";
import type { DocRecord, LoreError, Result } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { bareDocWriter, type DocWritePort } from "./corpus-service.js";

// ─── Public Types ───────────────────────────────────────────────────────────

/** Pass/fail + a human-readable explanation for one migration invariant. */
export interface InvariantVerdict {
  passed: boolean;
  detail: string;
}

/**
 * Verdict for one {@link OutlineMigrationService.migrateSection} call.
 *
 *   - `already_migrated`: true when this section is already fully covered by
 *     an existing child doc — either because the PRD's own heading for it is
 *     already gone (a prior live run shrank it), or because a pre-existing
 *     child doc's content already satisfies all three invariants against the
 *     PRD's still-present section text. Zero writes either way.
 *   - `writes_performed`: total store mutations this call made — always 0 for
 *     a dry run and for an already-migrated skip; > 0 only on a successful
 *     first-time live migration.
 *   - `domain_doc_id`: the child doc's id, present whenever one exists
 *     (pre-existing OR newly created this call).
 *   - `failed_invariants`: the subset of `"char_coverage"` /
 *     `"section_ref_equality"` / `"r_id_equality"` that failed, by field
 *     name — empty when `passed` is true.
 */
export interface SectionMigrationVerdict {
  section: string;
  dry_run: boolean;
  passed: boolean;
  already_migrated: boolean;
  writes_performed: number;
  char_coverage: InvariantVerdict;
  section_ref_equality: InvariantVerdict;
  r_id_equality: InvariantVerdict;
  domain_doc_id?: string;
  failed_invariants: string[];
}

/** Options for {@link OutlineMigrationService.migrateSection}. */
export interface MigrateSectionOpts {
  /** When true, computes the full verdict but performs ZERO store writes. */
  dryRun: boolean;
}

/**
 * Error shape returned by {@link OutlineMigrationService.migrateSection} on
 * refusal — a section not found in the PRD body (and never migrated), a
 * live-run invariant violation, or an underlying store failure. Distinct from
 * a bare `LoreError` (mirrors `PhaseMigrationError`'s precedent) because
 * `section`/`failed_invariants` are migration-specific context a generic
 * `LoreError` has no field for.
 */
export interface OutlineMigrationRefusal {
  code: string;
  message: string;
  section: string;
  failed_invariants: string[];
}

// ─── Internal Types ─────────────────────────────────────────────────────────

/** Actor stamped on every doc/version/audit row this service writes. */
const MIGRATION_ACTOR = "system:outline-migration";

/** One `## `-level-2 heading block parsed out of the PRD body. */
interface ParsedSection {
  /** Kebab-case key derived from the heading text (numeric prefix stripped). */
  key: string;
  /** Heading text with any leading "`N. `" numeric prefix stripped. */
  title: string;
  /** Heading line + every paragraph up to (excluding) the next `## ` heading. */
  body: string;
  /** Index into `content.split("\n")` where this block's heading line starts. */
  startLine: number;
  /** Index (exclusive) where this block ends — the next heading's start, or `lines.length`. */
  endLineExclusive: number;
}

const SECTION_REF_PATTERN = /§\d+/g;
const R_ID_PATTERN = /R-\d+/g;

/** The deterministic slug marker every migrated section's child doc carries — the sole idempotency signal once a section's heading has been shrunk out of the PRD body. */
function domainDocSlugFor(section: string): string {
  return `spec-domain-overview-${section}`;
}

/** Lowercase, hyphen-joined key derived from arbitrary heading text (ASCII-only — domain section headings are English prose, unlike doc titles which need `@lore/core/node`'s CJK-aware `slugify`). */
function kebabCase(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Splits a `## ` heading line into its stable key + display title, stripping an optional leading "`N. `" numeric prefix (e.g. "## 14. Feedback Loop" → `{key: "feedback-loop", title: "Feedback Loop"}`). */
function parseHeadingLine(line: string): { key: string; title: string } {
  const raw = line.replace(/^##\s+/, "").trim();
  const withoutNumber = raw.replace(/^\d+\.\s*/, "").trim();
  const title = withoutNumber.length > 0 ? withoutNumber : raw;
  return { key: kebabCase(title), title };
}

/**
 * Parses every `## `-level-2 heading block out of a PRD body. A `### `
 * sub-heading line does NOT match `/^##\s+/` (its third character is `#`, not
 * whitespace) so nested headings never fragment a section's body.
 */
function parsePrdSections(content: string): ParsedSection[] {
  const lines = content.split("\n");
  const headingLineIdxs: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line !== undefined && /^##\s+/.test(line)) headingLineIdxs.push(i);
  }

  const sections: ParsedSection[] = [];
  for (let idx = 0; idx < headingLineIdxs.length; idx++) {
    const start = headingLineIdxs[idx];
    if (start === undefined) continue;
    const endLineExclusive = idx + 1 < headingLineIdxs.length ? (headingLineIdxs[idx + 1] as number) : lines.length;

    const blockLines = lines.slice(start, endLineExclusive);
    while (blockLines.length > 0 && blockLines[blockLines.length - 1]?.trim() === "") blockLines.pop();

    const headingLine = lines[start] as string;
    const { key, title } = parseHeadingLine(headingLine);
    sections.push({ key, title, body: blockLines.join("\n"), startLine: start, endLineExclusive });
  }
  return sections;
}

/** Removes a parsed section's whole line range (heading through its trailing blank separator) from the PRD body — the "shrink" half of the two-phase write. */
function shrinkPrdContent(content: string, section: ParsedSection): string {
  const lines = content.split("\n");
  const remaining = [...lines.slice(0, section.startLine), ...lines.slice(section.endLineExclusive)];
  return remaining.join("\n");
}

/** Distinct-token set extracted via a global regex (e.g. every `§NN` occurrence). */
function extractTokenSet(text: string, pattern: RegExp): Set<string> {
  return new Set(text.match(pattern) ?? []);
}

/** `a` is a subset of `b` — used for both the char-coverage check (character sets) and could generalize to any token set, though only chars use it here. */
function isSubsetOf<T>(a: Set<T>, b: Set<T>): boolean {
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  return a.size === b.size && isSubsetOf(a, b);
}

/** `message` is present on most but not every `LoreError` variant (e.g. `DOC_NOT_FOUND` has none) — falls back to the error code itself rather than omitting a message. */
function describeLoreError(error: LoreError): string {
  return "message" in error ? error.message : error.code;
}

function refusal(code: string, message: string, section: string, failedInvariants: string[]): OutlineMigrationRefusal {
  return { code, message, section, failed_invariants: failedInvariants };
}

function refusalFromLoreError(error: LoreError, section: string): OutlineMigrationRefusal {
  return refusal(error.code, describeLoreError(error), section, []);
}

/**
 * `Result<never, OutlineMigrationRefusal>` constructor — the local analog of
 * `@lore/core`'s `err()`, needed because `err<E extends LoreError>` cannot
 * accept `OutlineMigrationRefusal` (it deliberately does NOT extend
 * `LoreError`, same non-extension precedent `PhaseMigrationError` documents).
 */
function errRefusal(refusalValue: OutlineMigrationRefusal): Result<never, OutlineMigrationRefusal> {
  return { ok: false, error: refusalValue };
}

// ─── Service ────────────────────────────────────────────────────────────────

/**
 * One-shot, idempotent, per-section PRD→outline migration (SPEC-080
 * §Migration Plan Phase 1). See this module's header docstring for the full
 * invariant set — `migrateSection` is the sole public method.
 *
 * @invariant Stateless — holds only a `StoreInterface`, mirroring every other
 *   service in this codebase; no telemetry (a one-shot migration path, same
 *   rationale as `PhaseMigrationService`/`MigrationService`).
 */
export class OutlineMigrationService {
  constructor(
    private readonly store: StoreInterface,
    // reason: AC-DCL-5 — the ONE write route (`CorpusService`); `app.ts` passes the composed one, a bare test gets a
    // bare writer. This service never calls `store.update` / `insertVersion` / `appendAuditEntry` itself.
    writer?: DocWritePort,
  ) {
    this.writer = writer ?? bareDocWriter(store);
  }

  private readonly writer: DocWritePort;

  /**
   * Migrates ONE `## `-heading-derived section of `prdId`'s body into a
   * dedicated `domain-overview` child spec, verbatim.
   *
   * @param prdId - The root PRD's doc id (or slug — resolved via
   *   `store.find`; a slug argument would need `store.findBySlug` instead,
   *   so callers pass the resolved id, mirroring `PhaseMigrationService`'s
   *   own `plan.id`-only convention).
   * @param section - The kebab-case section key (matches
   *   {@link parseHeadingLine}'s derivation from the PRD's own `## ` heading
   *   text, e.g. `"feedback-loop"` for `"## 14. Feedback Loop"`).
   * @param opts - `{dryRun}` — true computes the full verdict with zero
   *   writes; false performs the live two-phase migration when the section is
   *   fresh, or refuses (zero writes) when a pre-existing child doc's content
   *   fails any invariant.
   * @returns `ok(verdict)` on success (including every already-migrated /
   *   dry-run report path) or `err(refusal)` for an unknown section, a failed
   *   live-run invariant check, or an underlying store failure.
   */
  async migrateSection(
    prdId: string,
    section: string,
    opts: MigrateSectionOpts,
  ): Promise<Result<SectionMigrationVerdict, OutlineMigrationRefusal>> {
    const { dryRun } = opts;

    try {
      const prdResult = await this.store.find(prdId);
      if (!prdResult.ok) return errRefusal(refusalFromLoreError(prdResult.error, section));
      const prd = prdResult.value;
      if (prd === null) return errRefusal(
        refusal("DOC_NOT_FOUND", `PRD '${prdId}' not found`, section, []));

      const childSlug = domainDocSlugFor(section);
      const childResult = await this.store.findBySlug(childSlug);
      if (!childResult.ok) return errRefusal(refusalFromLoreError(childResult.error, section));
      const existingChild = childResult.value;

      const parsedSections = parsePrdSections(prd.content);
      const matched = parsedSections.find((s) => s.key === section);

      // Branch 2 of the two-branch idempotency check (see module header): the
      // heading is gone (a prior live run already shrank it) — the child
      // doc's mere existence is the sole remaining migration-complete proof.
      if (matched === undefined) {
        if (existingChild !== null) {
          return ok(this.alreadyMigratedVerdict(section, dryRun, existingChild.id));
        }
        return errRefusal(
        refusal(
            "SECTION_NOT_FOUND",
            `Section '${section}' not found in PRD '${prd.slug}' body and no prior migration exists for it`,
            section,
            [],
          ),
        );
      }

      const oldText = matched.body;
      // A fresh section (no pre-existing child) compares the candidate
      // extraction against ITSELF — a verbatim copy trivially satisfies every
      // invariant by construction, which is exactly the point: nothing has
      // been violated yet, so a dry-run over a fresh section reports a clean
      // pass without pretending a write already happened.
      const candidateContent = existingChild !== null ? existingChild.content : oldText;

      const verdict = this.computeVerdict(section, dryRun, oldText, candidateContent, existingChild?.id);

      if (verdict.already_migrated) return ok(verdict);
      if (dryRun) return ok(verdict);

      if (!verdict.passed) {
        return errRefusal(
        refusal(
            "INVARIANT_VIOLATION",
            `Migration refused for section '${section}': failed invariants ${verdict.failed_invariants.join(", ")}`,
            section,
            verdict.failed_invariants,
          ),
        );
      }

      // Reachable only when passed && !already_migrated, which (per
      // computeVerdict's already_migrated formula) means existingChild is
      // null — a genuinely fresh, first-time live migration.
      const writeResult = await this.performLiveMigration(prd, section, matched, oldText);
      if (!writeResult.ok) return errRefusal(refusalFromLoreError(writeResult.error, section));

      return ok({
        ...verdict,
        already_migrated: false,
        writes_performed: writeResult.value.writesPerformed,
        domain_doc_id: writeResult.value.childId,
      });
    } catch (error) {
      return errRefusal(
        refusal("STORE_ERROR", error instanceof Error ? error.message : String(error), section, []),
      );
    }
  }

  /** Zero-write "already migrated" verdict for the heading-gone branch — nothing left to compare, so every invariant reports a passing, explanatory detail rather than a vacuous true. */
  private alreadyMigratedVerdict(section: string, dryRun: boolean, domainDocId: string): SectionMigrationVerdict {
    const detail = "section heading no longer present in PRD body — already migrated by a prior run";
    return {
      section,
      dry_run: dryRun,
      passed: true,
      already_migrated: true,
      writes_performed: 0,
      char_coverage: { passed: true, detail },
      section_ref_equality: { passed: true, detail },
      r_id_equality: { passed: true, detail },
      domain_doc_id: domainDocId,
      failed_invariants: [],
    };
  }

  /** Computes the three independent invariants (see module header) between `oldText` (the PRD's own section extraction) and `candidateContent` (the child doc's real or simulated-verbatim content). */
  private computeVerdict(
    section: string,
    dryRun: boolean,
    oldText: string,
    candidateContent: string,
    existingChildId: string | undefined,
  ): SectionMigrationVerdict {
    const charCoveragePassed = isSubsetOf(new Set(oldText), new Set(candidateContent));

    const oldRefs = extractTokenSet(oldText, SECTION_REF_PATTERN);
    const childRefs = extractTokenSet(candidateContent, SECTION_REF_PATTERN);
    const refsEqual = setsEqual(oldRefs, childRefs);

    const oldRIds = extractTokenSet(oldText, R_ID_PATTERN);
    const childRIds = extractTokenSet(candidateContent, R_ID_PATTERN);
    const ridsEqual = setsEqual(oldRIds, childRIds);

    const failedInvariants: string[] = [];
    if (!charCoveragePassed) failedInvariants.push("char_coverage");
    if (!refsEqual) failedInvariants.push("section_ref_equality");
    if (!ridsEqual) failedInvariants.push("r_id_equality");
    const passed = failedInvariants.length === 0;

    const verdict: SectionMigrationVerdict = {
      section,
      dry_run: dryRun,
      passed,
      // A pre-existing child doc whose content already satisfies every
      // invariant against the PRD's still-present section text is
      // "already migrated" even though the heading hasn't been shrunk yet
      // (Branch 1 of the two-branch check, see module header) — this call
      // needs no write either way.
      already_migrated: existingChildId !== undefined && passed,
      writes_performed: 0,
      char_coverage: {
        passed: charCoveragePassed,
        detail: charCoveragePassed
          ? "every character in the old section is present in the child doc content"
          : "the child doc content is missing one or more characters present in the old section",
      },
      section_ref_equality: {
        passed: refsEqual,
        detail: refsEqual
          ? "§-reference token sets match"
          : `§-reference token sets differ: old={${[...oldRefs].join(",")}} child={${[...childRefs].join(",")}}`,
      },
      r_id_equality: {
        passed: ridsEqual,
        detail: ridsEqual
          ? "R-id token sets match"
          : `R-id token sets differ: old={${[...oldRIds].join(",")}} child={${[...childRIds].join(",")}}`,
      },
      failed_invariants: failedInvariants,
    };
    if (existingChildId !== undefined) verdict.domain_doc_id = existingChildId;
    return verdict;
  }

  /**
   * Performs the two-phase live write for a fresh section (SPEC-080 §Risk
   * Registry "Mid-migration content loss" mitigation): child doc insert +
   * version + audit, THEN its link to the PRD, THEN — only once both have
   * durably landed — the PRD body shrink + version + audit. A process killed
   * between the two phases leaves the PRD's original prose intact (merely
   * duplicated into the child doc), never orphaned.
   */
  private async performLiveMigration(
    prd: DocRecord,
    section: string,
    matched: ParsedSection,
    oldText: string,
  ): Promise<Result<{ childId: string; writesPerformed: number }, LoreError>> {
    const nowIso = new Date().toISOString();
    const childId = ulid();
    const childSlug = domainDocSlugFor(section);

    const childDoc: DocRecord = {
      id: childId,
      slug: childSlug,
      type: "spec",
      role: "spec",
      title: `${matched.title} (domain overview)`,
      status: "draft",
      priority: "medium",
      content: oldText,
      parent_id: prd.id,
      created_at: nowIso,
      updated_at: nowIso,
      created_by: MIGRATION_ACTOR,
      version: 1,
      deleted_at: null,
      tags: [],
      extra: { spec_kind: "domain-overview" },
    };

    // ── Phase 1: child doc lands (insert + version + audit) THEN the link ──
    // reason: ONE `insertDoc` transaction (doc + version 1 + audit); the version and audit rows name the CALLER
    // (the resolved invocation actor), the doc's own `created_by` keeps the migration marker.
    const inserted = await this.writer.insertDoc({
      doc: childDoc,
      changeSummary: `extracted verbatim from PRD section '${section}' (outline migration)`,
      auditAction: "create",
      auditSessionId: `outline-migration-${childId}`,
      auditDetails: { migrated_from_prd: prd.id, section },
    });
    if (!inserted.ok) return err(inserted.error);

    const linkResult = await this.store.addLink({
      from_id: prd.id,
      to_id: childId,
      link_type: "relates-to",
      created_at: nowIso,
      created_by: MIGRATION_ACTOR,
    });
    if (!linkResult.ok) return err(linkResult.error);

    // ── Phase 2: PRD body shrink — ONLY after phase 1 fully landed ─────────
    const shrunkContent = shrinkPrdContent(prd.content, matched);
    const shrunk = await this.writer.writeDoc({
      doc: prd,
      patch: { content: shrunkContent },
      action: "update",
      changeSummary: `section '${section}' relocated to ${childSlug} (outline migration)`,
      auditAction: "update",
      auditDetails: { section, migrated_to: childId },
      auditSessionId: `outline-migration-${prd.id}`,
      lock: "none",
      now: nowIso,
    });
    if (!shrunk.ok) return err(shrunk.error);

    // writesPerformed counts doc-mutating store calls only (insert + addLink
    // + update) — insertVersion/appendAuditEntry are bookkeeping, not the
    // "did the corpus state change" signal callers care about.
    return ok({ childId, writesPerformed: 3 });
  }
}
