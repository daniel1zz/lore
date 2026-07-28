/**
 * lore set <id> — update specific fields on a document.
 *
 * Editor flow (SPEC-003 §3.1, AC-SET-1):
 *   When no flags are provided, fetches the current doc, opens defaults.editor / $EDITOR / vi
 *   pre-populated with the current content. If the user saves unchanged content, prints
 *   "no changes" and exits 0 without bumping the version number.
 *
 * Non-editor flow (AC-SET-2):
 *   When any of --title, --status, --content, --content-file, --priority, --tags is provided,
 *   applies those fields directly via corpusService.set() (no editor is opened).
 *
 * --content-file <path>:
 *   Reads the file at <path> and uses its full contents as the new content.
 *   Workaround for Bug A: citty/mri treats `---` as an option terminator when it appears
 *   as the value of a `--content VALUE` pair. --content-file avoids this by reading from disk.
 *   Mutually exclusive with --content (exit 2 if both passed).
 *   File not found or unreadable → exit 4 (VALIDATION_ERROR).
 *
 * AI mutation flags (SPEC-019):
 *   --regenerate:
 *     Re-renders the doc's type template via AIProvider, replaces content.
 *     Requires AI to be on (resolved via resolveAiDefault with --ai/--no-ai).
 *     On approved doc → demotes to draft automatically via CorpusService.set.
 *   --refine "<prompt>":
 *     Sends current content + user instruction to AIProvider, replaces content.
 *     Mutually exclusive with --regenerate and --refine-stdin.
 *   --refine-stdin:
 *     Same as --refine but reads the prompt from stdin (pipe: `echo "..." | lore set <id> --refine-stdin`).
 *
 *   --ai / --no-ai: override the surface-level AI default (SPEC-024).
 *     Passing --no-ai with --regenerate/--refine/--refine-stdin → exit 2 (contradiction).
 *     Any two of {--regenerate, --refine, --refine-stdin} passed together → exit 2 (mutex).
 *     AI mutation flags + --content / --content-file → exit 2 (mutex).
 *
 * Approved→draft demotion (SPEC-019 AC-SET-AI-4, SPEC-022 AC-DASH-WRITE-5,
 * spec-plan-closure-must-be-loud-terminality-divergence-silent DD-3):
 *   ANY content/title change on an approved doc — via the AI mutation branch OR the
 *   standard --title/--content/--content-file patch path — passes through
 *   CorpusService.set, which auto-demotes approved→draft as an internal side effect.
 *   The service does not (yet) carry this fact on its result, so BOTH branches here
 *   fetch the doc's prior status before the write and print APPROVED_DEMOTION_ADVISORY
 *   (the SAME exported constant — never a duplicated string literal) when the write
 *   lands the doc in draft from approved. Previously only the AI branch printed this;
 *   the standard path's silence let a correct CLOSE-phase edit (appending a closure
 *   record to an approved plan) silently de-promote it with no signal to the operator.
 *
 * --kind <feature|tech|design> (SPEC-032 §3.1):
 *   Sets extra.spec_kind on a spec document. Valid only for type 'spec' — set operates on
 *   an existing id/slug (not a --type flag like create.ts), so the type-scope check fetches
 *   the doc first. Because CorpusService.set replaces `extra` wholesale (docPatch.extra =
 *   parsedPatch.data.extra, not a merge), this command merges { ...existing.extra, spec_kind }
 *   before patching so unrelated extra keys survive. docPatchSchema.extra is an untyped
 *   z.record — there is no schema hook analogous to createDocInputSchema's superRefine on the
 *   patch path — so an invalid value is validated here, in the CLI, against SPEC_KINDS before
 *   ever reaching the service, and reported as exit 4 (VALIDATION_ERROR-equivalent).
 *
 * --slug <new-slug> (SPEC-068 D5):
 *   The repair path for a degenerate slug (e.g. a CJK-titled doc created before SPEC-068's
 *   pinyin transliteration landed). Validated + uniqueness-checked entirely inside
 *   CorpusService.set (slugSchema + "taken by another doc" VALIDATION_ERROR, exit 4);
 *   restating the doc's own current slug is a no-op. Does NOT reset an approved doc to
 *   draft (slug is an address, not content — only title/content edits do that). The old
 *   slug stops resolving immediately; this command prints a reminder that any FREE-TEXT
 *   reference to the old slug inside OTHER docs' bodies is NOT rewritten (link-table edges
 *   key on the doc's immutable ULID and are unaffected either way).
 *
 * ⛔ Known TypeScript limitation (do NOT "clean up" — see
 * spec-plan-closure-must-be-loud-terminality-divergence-silent DD-3 close-out note): adding
 * ANY second top-level export to this file (regardless of name, type, or position) makes
 * `bun run typecheck` report spurious TS2352 errors in two UNRELATED pre-existing test files
 * (cli-editor-integration.bun.test.ts, cli-set-kind.bun.test.ts) that cast a dynamic
 * `import("./set.js")` via `(mod as { default?: { run?: ... } }).default`. Confirmed via
 * direct bisection: a bare `export const FOO = 1;` with zero other changes reproduces the
 * SAME 6 errors; removing the export removes them. Root cause is TypeScript's structural
 * comparability check for `as` type assertions treating a default-only module namespace
 * specially — this is a latent fragility in those two OTHER files' unsafe cast pattern, not
 * a defect in this file. Fixing it requires hardening those two files' casts (e.g. through
 * `unknown` first, as TS's own diagnostic suggests) — out of this task's write scope
 * (task-skill-implement-surface-approved-to-draft-demotion-on's anchors are this file plus
 * one new test file only). Tracked as a reported blocker, not silently worked around.
 */

import { readFileSync } from "node:fs";
import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, resolveActor } from "../utils.js";
import { openEditor } from "../editor.js";
import type { DocStatus, Priority, SpecKind } from "@lore/core";
import { SPEC_KINDS } from "@lore/core";

/**
 * Advisory text printed when `CorpusService.set`'s internal approved→draft
 * auto-demotion fires (a content/title edit on an `approved` doc always
 * demotes it to `draft` — see corpus-service.ts::isApprovedAutoResetToDraft).
 *
 * SINGLE exported constant so the AI-mutation branch (--regenerate/--refine/
 * --refine-stdin) and the standard patch branch (--title/--content/
 * --content-file) can never drift on the wording: both print THIS constant,
 * never a duplicated string literal.
 *
 * Source: spec-plan-closure-must-be-loud-terminality-divergence-silent DD-3
 * (the live incident: appending a closure record to an approved plan via the
 * standard patch path silently demoted it, and the standard path printed
 * nothing — only the AI-mutation branch did).
 */
export const APPROVED_DEMOTION_ADVISORY =
  "  (approved doc demoted to draft because content changed)";

export default defineCommand({
  meta: {
    name: "set",
    description: "Update specific fields on a document",
  },
  args: {
    id: {
      type: "positional",
      description: "Document ID or slug",
      required: true,
    },
    title: {
      type: "string",
      description: "New title",
    },
    status: {
      type: "string",
      description: "New status: draft | in-review | approved | active | archived | deprecated",
    },
    content: {
      type: "string",
      description: "New content (markdown)",
    },
    "content-file": {
      type: "string",
      description:
        "Path to file whose full contents become the new content. Mutually exclusive with --content.",
    },
    priority: {
      type: "string",
      description: "New priority: critical | high | medium | low",
    },
    tags: {
      type: "string",
      description: "Comma-separated tags (replaces existing)",
    },
    kind: {
      type: "string",
      description: `[spec only] Spec kind: ${SPEC_KINDS.join(" | ")}. Source: SPEC-032`,
    },
    slug: {
      type: "string",
      description:
        "New slug (repair path for a degenerate slug, e.g. a pre-SPEC-068 CJK title). " +
        "Must be unique; restating the current slug is a no-op. Does not reset an " +
        "approved doc to draft. Source: SPEC-068 D5",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
    by: {
      type: "string",
      description:
        "Actor identity to attribute this update to (SPEC-079 G2). Defaults to " +
        "$LORE_ACTOR env var, then session tier, then OS username.",
    },
    regenerate: {
      type: "boolean",
      description:
        "Re-render the doc's type template via AI and replace content. Requires AI (pass --ai on agent surfaces).",
    },
    refine: {
      type: "string",
      description:
        'Refine current content with AI using this prompt. Mutually exclusive with --regenerate and --refine-stdin.',
    },
    "refine-stdin": {
      type: "boolean",
      description:
        "Refine current content with AI using a prompt read from stdin. Mutually exclusive with --regenerate and --refine.",
    },
    ai: {
      type: "boolean",
      // reason: SPEC-024 tri-state AI flag — same pattern as create.ts.
      // mri collapses --ai (true) and no-flag (default) into the same value; process.argv
      // scan below is the reliable way to distinguish explicit --ai from absent flag.
      // AC-AI-19 (--no-ai shows in help): mri negation still works for discoverability.
      description:
        "Explicitly enable AI for --regenerate/--refine (overrides surface default). Pass --no-ai to disable.",
    },
  },
  async run({ args }) {
    // ─── Step 1: flag parsing and mutex checks ─────────────────────────────────
    // reason: process.argv scan is needed for tri-state --ai detection (same as create.ts).
    // mri/citty cannot distinguish "flag absent" from "flag=false (default)" for booleans.
    const _rawArgv = process.argv;
    const _hasExplicitAi = _rawArgv.includes("--ai");
    const _hasExplicitNoAi = _rawArgv.includes("--no-ai");

    const hasRegenerate = args.regenerate === true;
    const hasRefine = args.refine !== undefined;
    const hasRefineStdin = args["refine-stdin"] === true;
    const hasAiMutation = hasRegenerate || hasRefine || hasRefineStdin;

    // Mutex: --ai + --no-ai
    if (_hasExplicitAi && _hasExplicitNoAi) {
      process.stderr.write("Error: --ai and --no-ai are mutually exclusive. Pass only one.\n");
      process.exit(2);
    }

    // Mutex: --no-ai + any AI mutation flag (contradiction: "regenerate but don't use AI")
    if (_hasExplicitNoAi && hasAiMutation) {
      process.stderr.write(
        "Error: --no-ai cannot be combined with --regenerate, --refine, or --refine-stdin.\n",
      );
      process.exit(2);
    }

    // Mutex: more than one AI mutation mode
    const aiModeCount = [hasRegenerate, hasRefine, hasRefineStdin].filter(Boolean).length;
    if (aiModeCount > 1) {
      process.stderr.write(
        "Error: --regenerate, --refine, and --refine-stdin are mutually exclusive. Pass only one.\n",
      );
      process.exit(2);
    }

    // Mutex: AI mutation flags cannot be combined with manual content flags
    if (hasAiMutation && (args.content !== undefined || args["content-file"] !== undefined)) {
      process.stderr.write(
        "Error: --regenerate/--refine/--refine-stdin cannot be combined with --content or --content-file.\n",
      );
      process.exit(2);
    }

    // Mutex: existing --content + --content-file guard (exit 2 per Bug A spec).
    if (args.content !== undefined && args["content-file"] !== undefined) {
      process.stderr.write(
        "Error: --content and --content-file are mutually exclusive. Pass only one.\n",
      );
      process.exit(2);
    }

    // Validate --refine inline prompt is non-empty
    if (hasRefine && args.refine!.trim() === "") {
      process.stderr.write("Error: --refine requires a non-empty prompt string.\n");
      process.exit(2);
    }

    // Read stdin for --refine-stdin (synchronous, before loading app)
    // reason: readFileSync(0) reads stdin fd synchronously — works for piped input.
    // If stdin is a TTY (interactive), it blocks until the user presses Ctrl+D (EOF).
    // This is consistent with typical UNIX CLI tools that accept stdin prompts.
    let stdinPrompt: string | undefined;
    if (hasRefineStdin) {
      let raw: string;
      try {
        raw = readFileSync(0, "utf8");
      } catch (e) {
        process.stderr.write(
          `Error: failed to read stdin: ${e instanceof Error ? e.message : String(e)}\n`,
        );
        process.exit(2);
      }
      stdinPrompt = raw.trim();
      if (!stdinPrompt) {
        process.stderr.write("Error: --refine-stdin requires non-empty stdin input.\n");
        process.exit(2);
      }
    }

    const resolvedActor = resolveActor(args.by);
    const { app, defaults } = loadLoreApp();
    try {
      // ─── Step 2: AI mutation path (SPEC-019) ──────────────────────────────────
      if (hasAiMutation) {
        // Resolve AI default — honour explicit --ai / --no-ai; fall back to surface default.
        // reason: process.argv scan gives us the tri-state; mri's args.ai is not reliable.
        const explicitAi: boolean | undefined = _hasExplicitAi ? true : undefined;
        const { ai: useAi, source: aiSource } = app.resolveAiDefault(explicitAi);

        if (!useAi) {
          // reason: on agent surfaces AI defaults to off. The user must pass --ai explicitly
          // when running --regenerate/--refine in agent/CI contexts (SPEC-024 §9.3, SPEC-019 §9.6).
          process.stderr.write(
            "Error: AI is required for --regenerate/--refine/--refine-stdin but is disabled " +
              "for this surface. Pass --ai to enable.\n",
          );
          process.exitCode = 2;
          return;
        }

        // Fetch the document to be mutated
        const resolveResult = await app.corpusService.resolve(args.id);
        if (!resolveResult.ok) {
          process.stderr.write(formatError(resolveResult.error) + "\n");
          process.exitCode = exitCode(resolveResult.error);
          return;
        }
        const getResult = await app.corpusService.get(resolveResult.value);
        if (!getResult.ok) {
          process.stderr.write(formatError(getResult.error) + "\n");
          process.exitCode = exitCode(getResult.error);
          return;
        }
        const doc = getResult.value.doc;

        const showSpinner = process.stderr.isTTY && !args.json;
        const aiService = app.aiProviderService;
        let newContent: string;
        let durationMs: number;

        if (hasRegenerate) {
          // Optionally fetch parent title for template interpolation (same pattern as create.ts)
          let parent_title: string | undefined;
          if (doc.parent_id) {
            const parentResult = await app.corpusService.get(doc.parent_id);
            // reason: parent title lookup failure is non-fatal — template omits
            // {{#parent_title}}…{{/parent_title}} block gracefully when not provided.
            if (parentResult.ok) {
              parent_title = parentResult.value.doc.title;
            }
          }

          if (showSpinner) {
            process.stderr.write(`⏳ Regenerating via ${aiService.activeProviderName}...\n`);
          }

          const aiResult = await aiService.regenerateContent(doc, {
            parent_title,
            caller_surface: app.callerSurface,
            ai_default_source: aiSource,
          });

          if (!aiResult.ok) {
            process.stderr.write(formatError(aiResult.error) + "\n");
            process.exitCode = exitCode(aiResult.error);
            return;
          }

          newContent = aiResult.value.content;
          durationMs = aiResult.value.duration_ms;
        } else {
          // --refine or --refine-stdin
          const userPrompt = hasRefine ? args.refine! : stdinPrompt!;

          // Warn about content truncation (SPEC-019 §9.4)
          const maxChars = aiService.refineMaxInputChars;
          if (doc.content.length > maxChars) {
            process.stderr.write(
              `Warning: document content (${doc.content.length} chars) exceeds the ` +
                `refine limit (${maxChars} chars) and will be truncated.\n`,
            );
          }

          if (showSpinner) {
            process.stderr.write(`⏳ Refining via ${aiService.activeProviderName}...\n`);
          }

          const aiResult = await aiService.refineContent(doc, userPrompt, {
            caller_surface: app.callerSurface,
            ai_default_source: aiSource,
          });

          if (!aiResult.ok) {
            process.stderr.write(formatError(aiResult.error) + "\n");
            process.exitCode = exitCode(aiResult.error);
            return;
          }

          newContent = aiResult.value.content;
          durationMs = aiResult.value.duration_ms;
        }

        if (showSpinner) {
          process.stderr.write(
            `✓ AI generated ${newContent.length} chars in ${(durationMs / 1000).toFixed(1)}s\n`,
          );
        }

        // Write AI-generated content via corpusService.set.
        // approved→draft demotion is handled automatically inside the service layer
        // (SPEC-019 AC-SET-AI-4 / SPEC-022 AC-DASH-WRITE-5 shared bypass).
        const prevStatus = doc.status;
        const setResult = await app.corpusService.set(
          args.id,
          { content: newContent },
          { by: resolvedActor },
        );

        if (!setResult.ok) {
          process.stderr.write(formatError(setResult.error) + "\n");
          process.exitCode = exitCode(setResult.error);
          return;
        }

        const updatedDoc = setResult.value;
        if (args.json) {
          console.log(JSON.stringify({ ok: true, data: updatedDoc }, null, 2));
        } else {
          console.log(`Updated ${updatedDoc.slug} → v${updatedDoc.version}`);
          if (prevStatus === "approved" && updatedDoc.status === "draft") {
            console.log(APPROVED_DEMOTION_ADVISORY);
          }
        }
        return;
      }

      // ─── Step 3: standard patch path (unchanged from pre-SPEC-019) ────────────
      const patch: Record<string, unknown> = {};
      if (args.title !== undefined) patch["title"] = args.title;
      if (args.status !== undefined) patch["status"] = args.status as DocStatus;
      if (args.content !== undefined) patch["content"] = args.content;
      // reason: --content-file reads from disk and assigns as content, bypassing the mri
      // argv-terminator bug that drops content starting with `---` (Bug A fix, SPEC-003 §3.1).
      if (args["content-file"] !== undefined) {
        let fileContent: string;
        try {
          fileContent = readFileSync(args["content-file"], "utf8");
        } catch (e) {
          process.stderr.write(
            `Error: cannot read --content-file '${args["content-file"]}': ${e instanceof Error ? e.message : String(e)}\n`,
          );
          process.exitCode = 4;
          return;
        }
        patch["content"] = fileContent;
      }
      if (args.priority !== undefined) patch["priority"] = args.priority as Priority;
      if (args.tags !== undefined) {
        patch["tags"] = args.tags.split(",").map((t: string) => t.trim()).filter(Boolean);
      }
      if (args.slug !== undefined) patch["slug"] = args.slug;

      // --kind (SPEC-032 §3.1): type-scoped to 'spec', and extra is patched wholesale by
      // CorpusService.set (not merged) — fetch the existing doc so we can (a) reject
      // non-spec targets and (b) merge spec_kind into the existing extra rather than
      // clobbering unrelated extra keys.
      if (args.kind !== undefined) {
        const resolveForKind = await app.corpusService.resolve(args.id);
        if (!resolveForKind.ok) {
          process.stderr.write(formatError(resolveForKind.error) + "\n");
          process.exitCode = exitCode(resolveForKind.error);
          return;
        }
        const getForKind = await app.corpusService.get(resolveForKind.value);
        if (!getForKind.ok) {
          process.stderr.write(formatError(getForKind.error) + "\n");
          process.exitCode = exitCode(getForKind.error);
          return;
        }
        const targetDoc = getForKind.value.doc;

        if (targetDoc.type !== "spec") {
          process.stderr.write(
            `Error: --kind is only valid for type 'spec' (got '${targetDoc.type}').\n`,
          );
          process.exit(2);
        }

        if (!SPEC_KINDS.includes(args.kind as SpecKind)) {
          process.stderr.write(
            `Error: Invalid --kind '${args.kind}'.\n` +
              `  Valid values: ${SPEC_KINDS.join(" | ")}\n`,
          );
          process.exitCode = 4;
          return;
        }

        patch["extra"] = { ...targetDoc.extra, spec_kind: args.kind };
      }

      // Prior status, captured BEFORE the write, so the demotion advisory below can
      // detect CorpusService's silent approved→draft auto-reset after the fact (DD-3,
      // spec-plan-closure-must-be-loud-terminality-divergence-silent). corpus-service.ts
      // is out of this command's write scope, so the CLI derives the fact itself from a
      // doc it already fetches on every code path that can touch content/title.
      let priorStatusForDemotionAdvisory: DocStatus | undefined;

      if (Object.keys(patch).length === 0) {
        // No flags provided — open editor pre-populated with current content (AC-SET-1)
        const resolvedId = await app.corpusService.resolve(args.id);
        if (!resolvedId.ok) {
          process.stderr.write(formatError(resolvedId.error) + "\n");
          process.exitCode = exitCode(resolvedId.error);
          return;
        }
        const getResult = await app.corpusService.get(resolvedId.value);
        if (!getResult.ok) {
          process.stderr.write(formatError(getResult.error) + "\n");
          process.exitCode = exitCode(getResult.error);
          return;
        }
        const currentDoc = getResult.value.doc;
        priorStatusForDemotionAdvisory = currentDoc.status;

        const editorResult = await openEditor({
          initialContent: currentDoc.content,
          defaults,
        });
        if (!editorResult.ok) {
          process.stderr.write(formatError(editorResult.error) + "\n");
          process.exitCode = exitCode(editorResult.error);
          return;
        }

        const newContent = editorResult.value;

        // If the content is unchanged, skip the service call entirely (AC-SET-1)
        if (newContent === currentDoc.content) {
          process.stdout.write("no changes\n");
          return;
        }

        patch["content"] = newContent;
      }

      // Only a content/title change can trigger the approved→draft auto-demotion (see
      // corpus-service.ts::isApprovedAutoResetToDraft) — a --priority/--tags-only patch
      // never does, so skip the extra fetch for that common case (AC: no demotion, no
      // advisory, no round trip). The editor branch above already fetched prior status;
      // this only runs for the --title/--content/--content-file flag path.
      if (
        priorStatusForDemotionAdvisory === undefined &&
        (patch["content"] !== undefined || patch["title"] !== undefined)
      ) {
        const resolveForDemotion = await app.corpusService.resolve(args.id);
        if (!resolveForDemotion.ok) {
          process.stderr.write(formatError(resolveForDemotion.error) + "\n");
          process.exitCode = exitCode(resolveForDemotion.error);
          return;
        }
        const getForDemotion = await app.corpusService.get(resolveForDemotion.value);
        if (!getForDemotion.ok) {
          process.stderr.write(formatError(getForDemotion.error) + "\n");
          process.exitCode = exitCode(getForDemotion.error);
          return;
        }
        priorStatusForDemotionAdvisory = getForDemotion.value.doc.status;
      }

      const result = await app.corpusService.set(args.id, patch, { by: resolvedActor });

      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exitCode = exitCode(result.error);
        return;
      }

      const doc = result.value;
      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: doc }, null, 2));
      } else {
        console.log(`Updated ${doc.slug} → v${doc.version}`);
        if (priorStatusForDemotionAdvisory === "approved" && doc.status === "draft") {
          console.log(APPROVED_DEMOTION_ADVISORY);
        }
        // reason: SPEC-068 D5 — when --slug renamed the doc, the old slug stops
        // resolving immediately, but any FREE-TEXT reference to it inside other
        // docs' bodies (e.g. "see spec-foo") is NOT rewritten; link-table edges
        // key on the doc's immutable ULID and are unaffected either way.
        if (args.slug !== undefined) {
          console.log(
            `  (note: free-text references to the old slug in other docs' bodies are not rewritten)`,
          );
        }
      }
    } finally {
      app.close();
    }
  },
});
