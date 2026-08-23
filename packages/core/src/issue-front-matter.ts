/**
 * `frontMatterCodec` — serialises the closed six-field issue-report metadata
 * set into a delimited block at the head of a GitHub issue body, parses it
 * back, and redacts the two identity leaks measured in the reporting wiring
 * (spec-the-defect-channel-reaches-no-machine-but-its-own-github, Risk R1):
 * an absolute `$HOME`-rooted corpus path (`report-issue-wiring.ts:225`
 * builds `` `${basename(root)} (${root})` ``, the raw root) and the actor
 * os-fallback tier (`actor-resolution-node.ts:114`, `os.userInfo().username`).
 * Both would land in a PUBLIC GitHub issue, and GitHub caches edits, so the
 * disclosure is irreversible — redaction happens HERE, before any text
 * reaches a `gh` invocation, never downstream.
 *
 * Public surface:
 *   - `IssueFrontMatterFields` / `issueFrontMatterFieldsSchema` — the closed
 *     six-field set, two classes: reporter-supplied (`severity`, `category`,
 *     `tags`) and provenance/transport (`reporter_corpus`,
 *     `reporter_root_prd`, `idempotency_key`).
 *   - `assembleIssueBody(fields, description, actor?)` — renders the
 *     front-matter block plus free-form body text plus an optional
 *     attribution line.
 *   - `parseIssueBody(body)` — the inverse: `ParsedIssueBody`, an EXPLICIT
 *     `{present: false}` when no front-matter block exists, never a
 *     silently-empty record.
 *   - `RawReporterIdentity` / `ReporterActorSource` / `RedactedReporterIdentity`
 *     / `redactReporterIdentity(raw)` — the redaction step itself.
 *   - `MalformedIssueFrontMatterError` — thrown when a front-matter block IS
 *     present (both delimiters found) but its content is not valid JSON
 *     matching the six-field schema; kept distinct from "absent" so a
 *     corrupted block never reads the same as "no front matter here".
 *
 * Invariants:
 *   - PURE. `redactReporterIdentity` takes every identity fact
 *     (`corpusRoot`, `home`, `rootPrdId`, `actor`, `actorSource`) as
 *     PARAMETERS — it never calls `os.homedir()` / `os.userInfo()` /
 *     `process.env.HOME` itself. That is also why this module imports no
 *     Node builtin at module scope: `@lore/core`'s default barrel is
 *     consumed by `@lore/dashboard`, and Vite's browser dev-mode stub throws
 *     on a named-export access at module-LOAD time for `fs`/`path`/`os`.
 *   - The front-matter block's payload is a SINGLE-LINE `JSON.stringify` of
 *     the six-field object, not hand-rolled YAML-style `key: value` lines.
 *     `JSON.stringify` escapes every embedded newline and control character
 *     as a two-character sequence inside the string, so the serialised
 *     block can never contain a raw `\n` — which is what makes the closing
 *     `"\n---"` delimiter unambiguous even when a field's value itself
 *     contains a literal newline or a `---` lookalike (round-trip scenario
 *     4). A delimiter search that tolerated multi-line YAML (this package's
 *     own `frontmatter.ts::splitFrontmatter`) would be exactly the wrong
 *     tool here for that reason — reused deliberately nowhere in this file.
 *   - The os-fallback actor tier is DROPPED entirely (the redacted identity
 *     carries no `actor` key at all), never replaced with a redacted
 *     placeholder — there is no safe partial form of a bare OS username.
 *     Every other tier (`explicit`, `env`, `session`) is retained verbatim.
 *   - `reporter_corpus` never carries the raw `home` prefix: when `corpusRoot`
 *     is rooted under the seeded `home`, that prefix is replaced with `~`;
 *     otherwise (no known-sensitive prefix to strip) it falls back to the
 *     final path segment only — never the untouched absolute path.
 *   - `parseIssueBody` and `assembleIssueBody` know nothing about WHERE the
 *     six field values came from — `redactReporterIdentity` is the sole
 *     redaction step, always called BEFORE building an `IssueFrontMatterFields`
 *     record.
 *
 * Side-effect class: pure.
 *
 * Source: spec-the-defect-channel-reaches-no-machine-but-its-own-github
 *   Scope entry `frontMatterCodec`; Risk R1; AC-GI-6.
 */

import { z } from "zod";
import { ISSUE_SEVERITIES } from "./issue-report.js";

// ─── Closed six-field set ───────────────────────────────────────────────────

/**
 * The closed six-field front-matter set (spec Scope → `frontMatterCodec`).
 * Two classes: reporter-supplied (`severity`, `category`, `tags`) and
 * provenance/transport (`reporter_corpus`, `reporter_root_prd`,
 * `idempotency_key`). `.strict()` — an extra key is a schema violation, not
 * silently dropped or silently accepted, because the set closing is itself
 * part of the contract (AC-GI-11's corpus-equality check is defined over
 * exactly these six).
 *
 * `category` carries NO length bound here deliberately: `ISSUE_CATEGORY_MAX_LENGTH`
 * (`issue-report.ts`) is a CLI input-validation concern for the `--category`
 * flag, not a codec concern — this module stores and parses back whatever
 * value it is given, unabridged.
 */
export const issueFrontMatterFieldsSchema = z
  .object({
    severity: z.enum(ISSUE_SEVERITIES),
    category: z.string(),
    tags: z.array(z.string()),
    reporter_corpus: z.string(),
    reporter_root_prd: z.string(),
    idempotency_key: z.string(),
  })
  .strict();

/** One record of the closed six-field front-matter set. See {@link issueFrontMatterFieldsSchema}. */
export type IssueFrontMatterFields = z.infer<typeof issueFrontMatterFieldsSchema>;

/**
 * The result of {@link parseIssueBody} — an EXPLICIT discriminant, never a
 * record with empty/undefined field values standing in for "absent". A
 * caller that only checked truthiness of individual fields could not tell
 * "no front matter" from "front matter present but empty", which is exactly
 * the silent-failure shape this type rules out by construction.
 */
export type ParsedIssueBody = { present: true; fields: IssueFrontMatterFields } | { present: false };

// ─── Front-matter delimiter ─────────────────────────────────────────────────

/** The block delimiter, on its own line at both open and close. */
const FRONT_MATTER_DELIMITER = "---";

/** Opening marker: the delimiter followed immediately by a newline. */
const OPEN_MARKER = `${FRONT_MATTER_DELIMITER}\n`;

/** Closing marker: a newline followed immediately by the delimiter. */
const CLOSE_MARKER = `\n${FRONT_MATTER_DELIMITER}`;

/**
 * Thrown by {@link parseIssueBody} when a front-matter block IS present
 * (both delimiters were found) but the text between them is not valid JSON,
 * or is valid JSON that fails {@link issueFrontMatterFieldsSchema}. Kept
 * distinct from `{present: false}` — a corrupted block (e.g. a GitHub-side
 * hand-edit that broke the JSON) is a different fact than "no front matter
 * was ever written here", and collapsing the two would silently hide the
 * corruption from a caller reconciling against the corpus-side copy.
 */
export class MalformedIssueFrontMatterError extends Error {
  /** The raw text found between the two `---` delimiters, unparsed. */
  readonly rawFrontMatter: string;
  /** The underlying `JSON.parse` `SyntaxError` or Zod `ZodError`. */
  readonly parseError: unknown;

  constructor(rawFrontMatter: string, parseError: unknown) {
    super(
      `Malformed issue front matter: content between the "${FRONT_MATTER_DELIMITER}" delimiters is not valid JSON matching the six-field schema (${String(parseError)})`,
    );
    this.name = "MalformedIssueFrontMatterError";
    this.rawFrontMatter = rawFrontMatter;
    this.parseError = parseError;
  }
}

/**
 * Render the front-matter block plus body text (plus an optional
 * attribution line) into one issue-body string. The six fields are the
 * caller's responsibility to have ALREADY redacted via
 * {@link redactReporterIdentity} — this function performs no redaction of
 * its own, it only serialises.
 *
 * @param fields - the closed six-field set, already redacted if it carries
 *   any reporter-identity value.
 * @param description - free-form body text (title/expected/actual/repro —
 *   consumer-authority content per the spec's Per-Field Authority table).
 *   Passed through byte-for-byte; this function performs no scanning or
 *   redaction of it.
 * @param actor - the reporter's actor string, or `undefined` when the
 *   os-fallback tier already dropped it (see {@link redactReporterIdentity}).
 *   `undefined` renders NO attribution line at all — never a placeholder.
 * @returns the full issue body: `---\n<json>\n---\n\n<description>` plus,
 *   when `actor` is defined, a trailing `\n\nReported by: <actor>` line.
 * @example
 *   assembleIssueBody(
 *     { severity: "high", category: "x", tags: [], reporter_corpus: "c",
 *       reporter_root_prd: "prd-c", idempotency_key: "01..." },
 *     "Steps to reproduce...",
 *   )
 *   // => '---\n{"severity":"high",...}\n---\n\nSteps to reproduce...'
 */
export function assembleIssueBody(
  fields: IssueFrontMatterFields,
  description: string,
  actor?: string,
): string {
  const serialisedFields = JSON.stringify(fields);
  const attribution = actor === undefined ? "" : `\n\nReported by: ${actor}`;
  return `${FRONT_MATTER_DELIMITER}\n${serialisedFields}\n${FRONT_MATTER_DELIMITER}\n\n${description}${attribution}`;
}

/**
 * Parse an issue body back into its front-matter fields, or an explicit
 * absent result when no front-matter block exists at all.
 *
 * @param body - the full issue body text, e.g. as read back from GitHub.
 * @returns `{present: false}` when `body` does not open with a `---` line
 *   or has no matching closing `---` line; `{present: true, fields}`
 *   otherwise.
 * @throws {MalformedIssueFrontMatterError} when both delimiters are found
 *   but the enclosed text fails to parse as JSON, or fails
 *   {@link issueFrontMatterFieldsSchema}.
 * @example
 *   parseIssueBody("Just plain text, no front matter.") // => { present: false }
 *   parseIssueBody("") // => { present: false }
 */
export function parseIssueBody(body: string): ParsedIssueBody {
  if (!body.startsWith(OPEN_MARKER)) {
    return { present: false };
  }

  const afterOpen = body.slice(OPEN_MARKER.length);
  const closeIdx = afterOpen.indexOf(CLOSE_MARKER);
  if (closeIdx === -1) {
    return { present: false };
  }

  // reason: the front-matter payload is always a single-line JSON.stringify
  // output (see module header) — it contains no raw newline byte, so the
  // FIRST "\n---" found in `afterOpen` is guaranteed to be the block's own
  // closing delimiter, never a "---" lookalike inside the body text that
  // follows it.
  const rawFrontMatter = afterOpen.slice(0, closeIdx);

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawFrontMatter);
  } catch (error) {
    throw new MalformedIssueFrontMatterError(rawFrontMatter, error);
  }

  const result = issueFrontMatterFieldsSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new MalformedIssueFrontMatterError(rawFrontMatter, result.error);
  }

  return { present: true, fields: result.data };
}

// ─── Identity redaction ─────────────────────────────────────────────────────

/**
 * Which precedence tier produced {@link RawReporterIdentity.actor} — the
 * same four-tier vocabulary `actor-resolution-node.ts::ActorSource` resolves
 * at runtime, redeclared independently here (rather than imported) so this
 * module stays decoupled from that Node-touching file: `@lore/core`'s
 * default barrel must not grow even a type-only dependency edge toward a
 * module gated behind `@lore/core/node`.
 */
export type ReporterActorSource = "explicit" | "env" | "session" | "os-fallback";

/**
 * Identity facts as resolved by the CALLER, before any redaction. Every
 * field here is a plain value passed in — this module never reads
 * `process.env`, `os.homedir()`, or `os.userInfo()` itself (spec Review
 * Revisions round 2 item 8: an ambient read would make the paired test
 * suite pass or fail depending on which machine it runs on).
 */
export interface RawReporterIdentity {
  /** Absolute path to the reporting corpus's root directory. */
  readonly corpusRoot: string;
  /** The seeded/ambient home directory `corpusRoot` may be rooted under. */
  readonly home: string;
  /** The reporting corpus's root-PRD id — safe to publish as-is. */
  readonly rootPrdId: string;
  /** The resolved actor string for the tier named by `actorSource`. */
  readonly actor: string;
  /** Which precedence tier produced `actor`. */
  readonly actorSource: ReporterActorSource;
}

/**
 * The redacted identity — safe to fold into an {@link IssueFrontMatterFields}
 * record and publish. See {@link redactReporterIdentity}.
 */
export interface RedactedReporterIdentity {
  /** `corpusRoot` with the `home` prefix replaced by `~`, or the final path segment when `home` is not a prefix. */
  readonly reporter_corpus: string;
  /** `rootPrdId`, unredacted — already safe to publish as-is. */
  readonly reporter_root_prd: string;
  /** `actor`, unless `actorSource` was `"os-fallback"`, in which case this is `undefined` — DROPPED, not redacted-in-place. */
  readonly actor: string | undefined;
}

/**
 * Redact the two identity leaks measured in the reporting wiring (module
 * header, Risk R1): strip the raw home-directory prefix from the corpus
 * path, and drop the os-fallback actor tier entirely.
 *
 * @param raw - identity facts resolved by the caller.
 * @returns the redacted identity — `reporter_corpus` never contains `raw.home`
 *   or the full `raw.corpusRoot`; `actor` is `undefined` iff
 *   `raw.actorSource === "os-fallback"`.
 * @example
 *   redactReporterIdentity({
 *     corpusRoot: "/Users/alice/my-corpus", home: "/Users/alice",
 *     rootPrdId: "prd-x", actor: "alice", actorSource: "explicit",
 *   })
 *   // => { reporter_corpus: "~/my-corpus", reporter_root_prd: "prd-x", actor: "alice" }
 * @example
 *   redactReporterIdentity({
 *     corpusRoot: "/Users/alice/my-corpus", home: "/Users/alice",
 *     rootPrdId: "prd-x", actor: "alice", actorSource: "os-fallback",
 *   })
 *   // => { reporter_corpus: "~/my-corpus", reporter_root_prd: "prd-x", actor: undefined }
 */
export function redactReporterIdentity(raw: RawReporterIdentity): RedactedReporterIdentity {
  return {
    reporter_corpus: redactHomePrefix(raw.corpusRoot, raw.home),
    reporter_root_prd: raw.rootPrdId,
    actor: raw.actorSource === "os-fallback" ? undefined : raw.actor,
  };
}

/**
 * Replace a leading `home` directory prefix in `path` with `~`. When `home`
 * is not a prefix of `path` (no known-sensitive segment this function can
 * identify), falls back to `path`'s final segment only — NEVER the
 * untouched absolute path, since whatever directory sits above it might
 * still be sensitive in a way this function cannot detect from `home` alone.
 */
function redactHomePrefix(path: string, home: string): string {
  if (home !== "" && (path === home || path.startsWith(`${home}/`))) {
    return `~${path.slice(home.length)}`;
  }
  const lastSlashIdx = path.lastIndexOf("/");
  return lastSlashIdx === -1 ? path : path.slice(lastSlashIdx + 1);
}
