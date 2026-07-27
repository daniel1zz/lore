/**
 * Narrative-compression prompt builder for `lore context init --ai`
 * (spec-context-verb-family-two-zone-claude-md-anatomy-lore, §Design
 * Decisions D2). Asks the provider for a SHORT hand-written-discipline (Z2)
 * narrative — standing rules/prohibitions/thresholds, NOT a projection of
 * repo facts (those are lore-managed Z1 sections, rendered deterministically
 * by `flows/context-flow.ts`, never by AI). Consumed ONLY by the CLI adapter
 * path (`adapters/cli/commands/context.ts`) — the flow itself never calls
 * any AI provider (D2: "flow calls ai/registry" was the REJECTED design;
 * `runContextInit` only ever receives an already-resolved `narrative?:
 * string`).
 *
 * Public surface:
 *   - CONTEXT_NARRATIVE_PROMPT_VERSION — the active prompt version tag
 *   - ContextNarrativePromptInput — the facts shape this template renders
 *     from (deliberately duck-typed against `service/context-facts.ts`'s
 *     `ContextFacts` rather than importing it — see Invariants)
 *   - buildContextNarrativePrompt(input) — the prompt builder
 *
 * Invariants:
 *   - Does NOT import `service/context-facts.ts` — `ai/` sits BELOW
 *     `service/` in the dependency direction (`core <- service <- flows <-
 *     adapters`; `service/*.ts` already imports FROM `ai/*.ts` template
 *     builders via `AIProviderService`), so importing a `service/` type
 *     here would open a reverse edge. `ContextNarrativePromptInput` is
 *     instead a narrow structural duplicate of the two `ContextFacts`
 *     fields this template actually renders — `service/context-facts.ts`'s
 *     `ContextFacts` satisfies it by construction (TypeScript structural
 *     typing), so a caller passes a real `ContextFacts` value directly with
 *     no adapter/mapping step needed.
 *   - Pure string assembly — no IO, no wall-clock reads.
 *
 * Side-effect class: pure
 *
 * Source: spec-context-verb-family-two-zone-claude-md-anatomy-lore
 *   §Design Decisions D2, D3.
 */

/** Prompt schema version — bump on any prompt-text revision, never mutate this string's meaning in place. */
export const CONTEXT_NARRATIVE_PROMPT_VERSION = "v1";

/**
 * The subset of `service/context-facts.ts`'s `ContextFacts` this template
 * renders from — see module header for why this is a structural duplicate,
 * not an import.
 */
export interface ContextNarrativePromptInput {
  moduleIndex: ReadonlyArray<{ path: string; hasMemoryFile: boolean }>;
  commands: Readonly<Record<string, string>>;
}

/** Renders the discovered module list as a compact bullet block, or a placeholder line when empty. */
function renderModuleListBlock(moduleIndex: ContextNarrativePromptInput["moduleIndex"]): string {
  if (moduleIndex.length === 0) {
    return "(no nested module directories were discovered)";
  }
  return moduleIndex.map((m) => `- ${m.path}${m.hasMemoryFile ? " (already has its own memory file)" : ""}`).join("\n");
}

/** Renders the discovered command table as a compact bullet block, or a placeholder line when empty. */
function renderCommandsBlock(commands: ContextNarrativePromptInput["commands"]): string {
  const entries = Object.entries(commands);
  if (entries.length === 0) {
    return "(no package.json scripts were discovered)";
  }
  return entries.map(([name, command]) => `- ${name}: \`${command}\``).join("\n");
}

/**
 * Builds the `v1` narrative-compression prompt: asks the provider for a
 * short, standing-discipline paragraph block suitable for a project's
 * hand-written (Z2) CLAUDE.md zone — given only the deterministic facts
 * already discovered for the SIBLING lore-managed (Z1) zone, so the
 * narrative can reference real module/command names without re-deriving
 * them itself.
 *
 * @param input - The module-index + commands facts (see
 *   {@link ContextNarrativePromptInput}).
 * @returns The full prompt text to pass as `GenerateInput.prompt`.
 * @example
 * buildContextNarrativePrompt({ moduleIndex: [], commands: {} });
 * // => "# Role\nYou are..." (a complete, ready-to-send prompt string)
 */
export function buildContextNarrativePrompt(input: ContextNarrativePromptInput): string {
  return (
    `# Role\n` +
    `You are helping a software team seed the hand-written discipline section of a new ` +
    `project's CLAUDE.md file — the part an AI coding agent reads every session for ` +
    `standing rules, prohibitions, and thresholds. You are NOT writing an index of the ` +
    `repo's structure or commands (those sections are generated separately and will sit ` +
    `alongside what you write).\n\n` +
    `# Discovered Modules\n` +
    `${renderModuleListBlock(input.moduleIndex)}\n\n` +
    `# Discovered Commands (package.json scripts)\n` +
    `${renderCommandsBlock(input.commands)}\n\n` +
    `# Output Instruction\n` +
    `Write a SHORT (under 200 words) Markdown block of standing project discipline: things ` +
    `an AI agent must always/never do in this repo, given only the modules/commands above. ` +
    `Prefer concrete, testable rules over vague adjectives. Output ONLY the Markdown block — ` +
    `no preamble, no meta-commentary about this being a placeholder.\n`
  );
}
