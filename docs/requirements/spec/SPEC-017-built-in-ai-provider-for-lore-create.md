---
id: SPEC-017
type: spec
role: spec
title: "Built-in AI provider for lore create"
status: deprecated
priority: medium
created: 2026-06-28
updated: 2026-10-10
tags: []
---
# SPEC-017: Built-in AI provider for `lore create`

## 1. Purpose

`lore create <type>` today opens `$EDITOR` for body content. For AI-first teams (3-5 people + multiple AI agents) the editor step is friction: most docs start from a one-line title and the human-or-agent then types or pastes a body that an AI would have produced better anyway. SPEC-017 inverts the default — **AI generation is the primary path**, the editor remains as `--no-ai` escape — and introduces a small provider registry so future providers (codex CLI, remote APIs) can slot in without touching `create.ts`.

The first concrete provider is `claude -p` (Claude Code CLI in non-interactive print mode), because (a) it is already installed in every authoring environment that uses Claude Code, (b) it inherits the user's existing login / quota / model selection without lore needing any API key plumbing, and (c) it produces well-formatted Markdown out of the box.

End result: `lore create prd --title "Notification Center"` runs `claude -p` against an internal PRD prompt template, captures the full stdout, and writes the result straight into a `draft` document — no editor, no preview, no extra flag. `--no-ai` falls back to today's editor flow byte-for-byte. `.lore/config.yaml` can override the prompt templates, swap provider, or tune timeouts.

## 2. Goals & Non-Goals

### 2.1 Goals

- New `AIProvider` interface in `@lore/core` (type only) — `generate(input): Promise<Result<GenerateOutput, LoreError>>`.
- New `packages/lore/src/ai/` directory containing the runtime: `claude-cli-provider.ts`, `in-memory-provider.ts` (test double), `registry.ts`, `templates.ts`.
- New `AIProviderService` in `packages/lore/src/service/` that owns provider dispatch, template rendering, and telemetry emission. Stateless. Returns `Promise<Result<T, LoreError>>` like every other service.
- `lore create <type> --title "..."` becomes AI-default: when neither `--content` nor `--no-ai` is set, route through `AIProviderService.generate` and feed the result into `corpusService.create`. Doc lands in `draft` status (existing rule).
- `--no-ai` flag triggers today's `openEditor()` path unchanged — every existing test for editor behaviour keeps passing.
- Built-in per-doc-type prompt templates (`prd | spec | adr | plan | knowledge | task`) with minimal mustache-subset interpolation (`{{title}}`, optional `{{#parent_title}}…{{/parent_title}}` block). Overridable via `.lore/config.yaml → ai.templates.<type>`.
- Provider registry built at `createApp` time: built-in `claude-cli` always present; `.lore/config.yaml → ai.providers.<name>` overrides per-provider config; `ai.provider` picks the active one.
- New `AI_PROVIDER_ERROR` code added to the `LoreError` union; CLI exit code `6`.
- New `ai.generation` JSONL telemetry event (provider / doc_type / template_source / duration_ms / output_chars / exit_code / optional error). Reuses `JsonlTelemetry`. Honours existing opt-in switch + new `ai.telemetry: false` per-feature kill switch.
- Fail loud on every AI failure path (binary missing, exit non-zero, empty stdout, timeout). Never silently insert an empty document, never silently fall back to the editor.
- Six-dimension test coverage on schemas, template engine, registry, service, CLI integration, and an end-to-end smoke with a stub binary on `$PATH`.

### 2.2 Non-Goals (explicit)

- ❌ **Remote API providers** (OpenAI / Anthropic API / Vertex / Bedrock direct HTTP). The registry shape is forward-compatible, but v1 ships only the CLI-spawning `claude-cli` provider. No `fetch()` to provider endpoints, no API-key plumbing.
- ❌ **Streaming infra** — no progressive stdout passthrough, no SSE, no token-by-token render. Sync capture only; spinner on stderr; silent in `--json` mode.
- ❌ **Prompt engineering for non-`create` commands.** No `lore search --ai`, no `lore set <id> --ai`, no `lore link --ai`. `create` is the only entry point that grows an AI mode in this SPEC.
- ❌ **Dashboard write-UI AI integration.** The dashboard SPA stays read-only; any future "create via AI" button is a separate SPEC.
- ❌ **Multi-provider fan-out, voting, fallback chains.** Exactly one active provider per invocation. If it fails, the command fails.
- ❌ **Pre-flight `claude --version` probe.** First `Bun.spawn` failure is the probe; saves one fork on the happy path.
- ❌ **Preview / confirm / `--yes` gate.** Generated content goes straight into a `draft` document; the existing `draft → in-review → approved` lifecycle remains the only review surface.
- ❌ **Per-doc-type provider override** (today `ai.provider` is global). The registry config shape leaves room but v1 does not implement per-type routing.
- ❌ **Cost / token-budget accounting.** Telemetry records `duration_ms` and `output_chars`; token / cost tracking belongs to whichever provider exposes it (`claude -p` does not, today).
- ❌ **MCP `lore_create_ai` tool.** MCP adapter is unchanged in this SPEC; AI is CLI-only for v1.

## 3. Architecture

### 3.1 Module layout

```
packages/core/src/
├── ai.ts                              ← NEW: AiConfigSchema, GenerateInput/Output types, AIProvider interface (type-only)
├── errors.ts                          ← MODIFIED: add { code: "AI_PROVIDER_ERROR", ... } variant
├── telemetry.ts                       ← MODIFIED: add aiGenerationEventSchema + emit support
├── config.ts                          ← MODIFIED: LoreConfigSchema gains optional ai: AiConfigSchema
└── index.ts                           ← MODIFIED: re-export ai.ts public surface

packages/lore/src/ai/
├── claude-cli-provider.ts             ← NEW: ClaudeCliProvider implements AIProvider (Bun.spawn)
├── in-memory-provider.ts              ← NEW: InMemoryAIProvider (test double, ships in src/ for test reuse)
├── registry.ts                        ← NEW: buildProviderRegistry(config, telemetry) → Result<{providers, active}, LoreError>
├── templates.ts                       ← NEW: BUILT_IN_TEMPLATES + renderTemplate(tpl, vars)
└── CLAUDE.md                          ← NEW: module-level context

packages/lore/src/service/
├── ai-provider-service.ts             ← NEW: AIProviderService class
└── CLAUDE.md                          ← MODIFIED: bump "six stateless services" → "seven", document AI service

packages/lore/src/adapters/cli/
├── commands/create.ts                 ← MODIFIED: AI-default decision tree, spinner, --no-ai escape
└── utils.ts                           ← MODIFIED: exitCode mapping for AI_PROVIDER_ERROR (6), formatError case

packages/lore/src/app.ts               ← MODIFIED: build registry, construct AIProviderService, expose on App

.lore/config.yaml                      ← user-edited; new `ai:` node entirely optional
```

### 3.2 Provider contract (in `@lore/core/ai.ts`)

```ts
export const GenerateInputSchema = z.object({
  prompt: z.string().min(1),
  doc_type: DocTypeSchema,
  title: z.string().min(1),
  parent_title: z.string().optional(),
}).strict();
export type GenerateInput = z.infer<typeof GenerateInputSchema>;

export interface GenerateOutput {
  content: string;
  duration_ms: number;
  exit_code: number;
  provider_name: string;
}

export interface AIProvider {
  readonly name: string;
  generate(input: GenerateInput): Promise<Result<GenerateOutput, LoreError>>;
}
```

`AIProvider` is type-only — `@lore/core` stays IO-free per SPEC-014 §3.2. Concrete implementations live in `packages/lore/src/ai/`.

### 3.3 `AiConfigSchema`

```ts
export const AiProviderConfigSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  timeout_ms: z.number().int().positive().default(60_000),
}).strict();
export type AiProviderConfig = z.infer<typeof AiProviderConfigSchema>;

export const AiConfigSchema = z.object({
  provider: z.string().min(1).default("claude-cli"),
  providers: z.record(z.string(), AiProviderConfigSchema).default({}),
  templates: z.record(DocTypeSchema, z.string().min(1)).default({}),
  telemetry: z.boolean().default(true),
}).strict();
export type AiConfig = z.infer<typeof AiConfigSchema>;
```

Defaults make `ai: {}` (or missing `ai:` entirely) parse to a fully-populated config pointing at `claude-cli`. `.strict()` rejects typos (`provder:`) at load time — fail loud.

Injected into `LoreConfigSchema` as `ai: AiConfigSchema.optional()`. `loader.ts` (`loadLoreApp`) does `config.ai ?? AiConfigSchema.parse({})` before passing into `createApp`.

### 3.4 `LoreError` extension (`@lore/core/errors.ts`)

```ts
export type LoreError =
  | ...existing 13 variants...
  | {
      code: "AI_PROVIDER_ERROR";
      message: string;
      provider?: string;
      exit_code?: number;
      stderr?: string;
    };
```

CLI exit-code mapping (`packages/lore/src/adapters/cli/utils.ts`):

```ts
case "AI_PROVIDER_ERROR": return 6;
```

`formatError` case prints:

```
Error: AI provider "<provider>" failed.
  exit code: <n>
  stderr: <first 1024 chars of stderr>
  Retry with --no-ai to use the editor instead.
```

### 3.5 Registry construction (`packages/lore/src/ai/registry.ts`)

```ts
const BUILT_IN: Record<string, AiProviderConfig> = {
  // --setting-sources project: skip user-global Claude Code settings (hooks /
  // ~/.claude/CLAUDE.md / stop-review chain) that would otherwise inject session
  // output into stdout, while keeping keychain auth and project-local CLAUDE.md
  // intact. Found via dogfood smoke (commit history). Users can override via
  // ai.providers.claude-cli.args if they need a different invocation shape.
  "claude-cli": { command: "claude", args: ["-p", "--setting-sources", "project"], timeout_ms: 60_000 },
};

export function buildProviderRegistry(
  config: AiConfig,
): Result<{ providers: ReadonlyMap<string, AIProvider>; active: string }, LoreError> {
  // Merge: built-in defaults first, then user overrides replace whole records.
  const merged: Record<string, AiProviderConfig> = { ...BUILT_IN, ...config.providers };

  const providers = new Map<string, AIProvider>();
  for (const [name, cfg] of Object.entries(merged)) {
    providers.set(name, new ClaudeCliProvider(name, cfg));   // v1: all known providers spawn a CLI.
  }

  if (!providers.has(config.provider)) {
    return err({
      code: "STORE_ERROR",
      message: `Unknown ai.provider '${config.provider}'. Known: ${[...providers.keys()].join(", ")}`,
    });
  }

  return ok({ providers, active: config.provider });
}
```

Note v1 design choice: `ClaudeCliProvider` is generic over (command, args, timeout) — it works for any CLI that consumes prompt on stdin and writes Markdown to stdout. To register a fundamentally different transport (e.g. an HTTP provider), a future SPEC will introduce a discriminator on `AiProviderConfig` (`kind: "cli" | "http"`); we deliberately do **not** introduce that field here because there is no second consumer to validate it against.

### 3.6 `AIProviderService` (`packages/lore/src/service/ai-provider-service.ts`)

```ts
export class AIProviderService {
  constructor(
    private readonly providers: ReadonlyMap<string, AIProvider>,
    private readonly active: string,
    private readonly templates: Record<DocType, string>,
    private readonly telemetry: Telemetry,
    private readonly aiTelemetryEnabled: boolean,
  ) {}

  get activeProviderName(): string { return this.active; }

  async generate(args: {
    doc_type: DocType;
    title: string;
    parent_title?: string;
  }): Promise<Result<GenerateOutput, LoreError>> {
    const userOverride = args.doc_type in this.templates;
    const tpl = this.templates[args.doc_type] ?? BUILT_IN_TEMPLATES[args.doc_type];
    const prompt = renderTemplate(tpl, { title: args.title, parent_title: args.parent_title });

    const provider = this.providers.get(this.active)!;  // existence checked by registry construction
    const t0 = performance.now();
    const result = await provider.generate({
      prompt,
      doc_type: args.doc_type,
      title: args.title,
      ...(args.parent_title !== undefined ? { parent_title: args.parent_title } : {}),
    });
    const duration_ms = Math.round(performance.now() - t0);

    if (this.aiTelemetryEnabled) {
      this.telemetry.emit({
        event: "ai.generation",
        ts: new Date().toISOString(),
        provider: this.active,
        doc_type: args.doc_type,
        template_source: userOverride ? "user-override" : "built-in",
        duration_ms,
        output_chars: result.ok ? result.value.content.length : 0,
        exit_code: result.ok ? 0 : (result.error.code === "AI_PROVIDER_ERROR" ? (result.error.exit_code ?? -1) : -1),
        ...(result.ok ? {} : { error: result.error.message }),
      });
    }

    return result;
  }
}
```

Stateless: every dependency is constructor-injected; no global state, no I/O outside `provider.generate(...)` and `telemetry.emit(...)`.

### 3.7 `ClaudeCliProvider` (`packages/lore/src/ai/claude-cli-provider.ts`)

```ts
export class ClaudeCliProvider implements AIProvider {
  constructor(public readonly name: string, private readonly cfg: AiProviderConfig) {}

  async generate(input: GenerateInput): Promise<Result<GenerateOutput, LoreError>> {
    const t0 = performance.now();
    let proc: ReturnType<typeof Bun.spawn>;
    try {
      proc = Bun.spawn([this.cfg.command, ...this.cfg.args], {
        stdin: "pipe", stdout: "pipe", stderr: "pipe",
      });
    } catch (e) {
      return err({
        code: "AI_PROVIDER_ERROR",
        provider: this.name,
        message: `command not found: ${this.cfg.command}`,
      });
    }

    // Timeout watchdog
    const killer = setTimeout(() => proc.kill("SIGTERM"), this.cfg.timeout_ms);

    proc.stdin.write(input.prompt);
    proc.stdin.end();

    const [stdout, stderr, exit_code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    clearTimeout(killer);

    const duration_ms = Math.round(performance.now() - t0);

    if (exit_code !== 0) {
      return err({
        code: "AI_PROVIDER_ERROR",
        provider: this.name,
        exit_code,
        stderr: stderr.slice(0, 1024),
        message: `provider "${this.name}" exited ${exit_code}`,
      });
    }

    if (stdout.trim() === "") {
      return err({
        code: "AI_PROVIDER_ERROR",
        provider: this.name,
        exit_code,
        message: `provider "${this.name}" produced empty output`,
      });
    }

    return ok({ content: stdout, duration_ms, exit_code, provider_name: this.name });
  }
}
```

### 3.8 `InMemoryAIProvider` (`packages/lore/src/ai/in-memory-provider.ts`)

Ships in `src/` (not `tests/`) so any test in any package can import it. Configurable per-instance to return a fixed string, an error, or throw.

```ts
export type InMemoryAIProviderMode =
  | { kind: "ok"; content: string; duration_ms?: number }
  | { kind: "err"; error: Extract<LoreError, { code: "AI_PROVIDER_ERROR" }> };

export class InMemoryAIProvider implements AIProvider {
  public calls: GenerateInput[] = [];
  constructor(public readonly name = "in-memory", private mode: InMemoryAIProviderMode = { kind: "ok", content: "# Stub doc\n" }) {}
  setMode(mode: InMemoryAIProviderMode) { this.mode = mode; }
  async generate(input: GenerateInput) {
    this.calls.push(input);
    if (this.mode.kind === "err") return err(this.mode.error);
    return ok({
      content: this.mode.content,
      duration_ms: this.mode.duration_ms ?? 0,
      exit_code: 0,
      provider_name: this.name,
    });
  }
}
```

### 3.9 Template engine (`packages/lore/src/ai/templates.ts`)

```ts
export const BUILT_IN_TEMPLATES: Record<DocType, string> = {
  prd:       "Generate a Product Requirements Document titled \"{{title}}\". Sections: Problem, Users, Goals, Scope, Success Metrics. Output GitHub-flavoured Markdown.",
  spec:      "Generate a Specification titled \"{{title}}\"{{#parent_title}} under parent \"{{parent_title}}\"{{/parent_title}}. Sections: Purpose, Goals & Non-Goals, Architecture, Acceptance Criteria. Output GitHub-flavoured Markdown.",
  adr:       "Generate an Architecture Decision Record titled \"{{title}}\". Sections: Context, Decision, Consequences, Status. Output GitHub-flavoured Markdown.",
  plan:      "Generate an implementation Plan titled \"{{title}}\". Sections: Goal, Phases (numbered), Risks, Definition of Done. Output GitHub-flavoured Markdown.",
  knowledge: "Write a knowledge note titled \"{{title}}\". Concise, no preamble. Output GitHub-flavoured Markdown.",
  task:      "Write a task description titled \"{{title}}\"{{#parent_title}} for plan \"{{parent_title}}\"{{/parent_title}}. Sections: Acceptance Criteria, File Anchors, Test Plan. Output GitHub-flavoured Markdown.",
};

export function renderTemplate(tpl: string, vars: { title: string; parent_title?: string }): string {
  // Step 1: conditional blocks {{#key}}...{{/key}} — keep body iff vars[key] truthy
  let out = tpl.replace(
    /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
    (_, key: string, body: string) => (vars as Record<string, unknown>)[key] ? body : "",
  );
  // Step 2: simple var substitution {{key}}
  out = out.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const v = (vars as Record<string, unknown>)[key];
    return v === undefined || v === null ? "" : String(v);
  });
  return out;
}
```

No external dependency; ~30 LOC; safe against ReDoS (both regexes are linear, non-backtracking on the input shapes accepted).

### 3.10 Telemetry event schema (`@lore/core/telemetry.ts`)

```ts
export const aiGenerationEventSchema = z.object({
  event: z.literal("ai.generation"),
  ts: z.string().datetime(),
  provider: z.string(),
  doc_type: DocTypeSchema,
  template_source: z.enum(["built-in", "user-override"]),
  duration_ms: z.number().nonnegative(),
  output_chars: z.number().int().nonnegative(),
  exit_code: z.number().int(),
  error: z.string().optional(),
}).strict();
export type AiGenerationEvent = z.infer<typeof aiGenerationEventSchema>;
```

Reuses the existing `JsonlTelemetry` writer. No new sink. Same `.lore/telemetry/YYYY-MM-DD.jsonl` file, schema discriminated by `event`.

### 3.11 CLI surface change (`packages/lore/src/adapters/cli/commands/create.ts`)

New flag:

```ts
"no-ai": {
  type: "boolean",
  description: "Skip AI generation; open $EDITOR instead (default behaviour pre-SPEC-017).",
},
```

Decision tree in `run({ args })`, replacing the current `if (resolvedContent === undefined) { editor }` block:

```ts
let resolvedContent: string | undefined = args.content;
if (resolvedContent === undefined) {
  if (args["no-ai"]) {
    const editorResult = await openEditor({ defaults });
    if (!editorResult.ok) { stderr + exit; }
    resolvedContent = editorResult.value;
  } else {
    // AI path
    const parent = resolvedParent ? (await app.corpusService.get(resolvedParent)) : undefined;
    const parent_title = parent?.ok ? parent.value.title : undefined;

    const showSpinner = process.stderr.isTTY && !args.json;
    if (showSpinner) process.stderr.write(`⏳ Generating via ${app.aiProviderService.activeProviderName}...\n`);

    const aiResult = await app.aiProviderService.generate({
      doc_type: docType, title: args.title, ...(parent_title ? { parent_title } : {}),
    });
    if (!aiResult.ok) {
      process.stderr.write(formatError(aiResult.error) + "\n");
      process.exit(exitCode(aiResult.error));
    }
    resolvedContent = aiResult.value.content;
    if (showSpinner) process.stderr.write(`✓ Generated ${aiResult.value.content.length} chars in ${(aiResult.value.duration_ms/1000).toFixed(1)}s\n`);
  }
}
```

`AIProviderService` exposes `get activeProviderName(): string` for the spinner string.

### 3.12 `App` composition (`packages/lore/src/app.ts`)

```ts
// after corpusService is built:
const aiConfig = config?.ai ?? AiConfigSchema.parse({});
const registry = buildProviderRegistry(aiConfig);
if (!registry.ok) return registry;          // STORE_ERROR — fail loud, surfaces as exit 1
const aiProviderService = new AIProviderService(
  registry.value.providers,
  registry.value.active,
  aiConfig.templates,
  telemetry,
  aiConfig.telemetry,
);
```

Returned `App` gains `aiProviderService: AIProviderService` field. `App.close()` unchanged — AI service holds no resources.

## 4. Implementation Plan

Two-phase split aligned with the CLAUDE.md "implementer ≠ tester" discipline.

### Phase 1 — Source + minimal smoke (one implementer subagent, worktree)

1. `@lore/core/ai.ts` new file: schemas + types + `AIProvider` interface.
2. `@lore/core/errors.ts`: add `AI_PROVIDER_ERROR` variant.
3. `@lore/core/telemetry.ts`: add `aiGenerationEventSchema`.
4. `@lore/core/config.ts`: extend `LoreConfigSchema` with optional `ai`.
5. `@lore/core/index.ts`: re-export new public surface.
6. `packages/lore/src/ai/`: 4 new files + CLAUDE.md per §3.1.
7. `packages/lore/src/service/ai-provider-service.ts`: new class.
8. `packages/lore/src/service/CLAUDE.md`: bump count + add service row.
9. `packages/lore/src/app.ts`: wire registry + service.
10. `packages/lore/src/adapters/cli/utils.ts`: `AI_PROVIDER_ERROR` → exit 6, `formatError` case.
11. `packages/lore/src/adapters/cli/commands/create.ts`: AI-default decision tree + `--no-ai` flag.
12. Smoke: `bun run typecheck` clean; existing `bun run test:vitest && bun run test:bun` still green (no test regression from injecting new service).

### Phase 2 — Tests (one tester subagent, worktree, branched off Phase-1-merged main)

13. Vitest files per §5.4 below.
14. Bun test file with stub `claude` binary on `$PATH`.
15. `bun run test:vitest && bun run test:bun` add ≥ 36 new tests, all green.

### Phase 3 — Review (one docman-reviewer, read-only)

16. Multi-dimension audit on combined diff. Address findings if any.

## 5. Acceptance Criteria

### 5.1 Behaviour

**AC-AI-1** `lore create prd --title "X"` with `claude` binary on `$PATH` and clean exit creates a `draft` PRD whose body equals the binary's stdout. stderr contains a single `⏳ Generating` line and a single `✓ Generated N chars` line.

**AC-AI-2** `lore create prd --title "X" --no-ai` is byte-identical in behaviour to today's `lore create prd --title "X"` editor flow. Every existing editor test continues to pass without behavioural regression (tests may add `--no-ai` to opt out of the new default AI path).

**AC-AI-3** `lore create prd --title "X" --content "..."` skips both AI and editor (regression — current SPEC-003 §3.1 behaviour preserved).

**AC-AI-4** `lore create spec --title "X" --parent <slug>` AI path resolves the parent's title and interpolates it into any template with a `{{#parent_title}}…{{/parent_title}}` block.

### 5.2 Failure

**AC-AI-5** Binary missing → exit code 6, stderr contains `command not found: claude` and `Retry with --no-ai`, `lore list --type prd` count unchanged.

**AC-AI-6** Binary present but exits non-zero → exit 6, stderr echoes first 1024 chars of provider stderr, telemetry writes one `ai.generation` event with non-zero `exit_code` and an `error` field.

**AC-AI-7** Binary present, exits 0, stdout whitespace-only → exit 6, no document created, telemetry records `output_chars: 0` and `error: "...empty output..."`.

**AC-AI-8** Spawn exceeds `timeout_ms` → process killed, exit 6, error mentions `timeout`.

### 5.3 Config

**AC-AI-9** Missing `ai:` node in `.lore/config.yaml` is identical to writing `ai: { provider: claude-cli }` (defaults applied).

**AC-AI-10** `ai.templates.prd: "Custom {{title}}"` overrides the built-in template; telemetry tags the event `template_source: "user-override"`.

**AC-AI-11** `ai.provider: "unknown"` causes `createApp` to return `STORE_ERROR` listing known providers; `lore <any-cmd>` exits 1 with that message — no command runs.

**AC-AI-12** Unknown key under `ai:` (e.g. `ai: { provder: claude-cli }`) → Zod `.strict()` rejection at config load; CLI exits 1.

### 5.4 Boundary / SSOT

**AC-AI-13** `AIProvider` interface is exported from `@lore/core` only. `packages/lore/src/ai/claude-cli-provider.ts` imports it from `@lore/core`, not from a relative path. `@lore/core` contains zero references to `Bun.*`.

**AC-AI-14** `AIProviderService` is constructed exclusively by `app.ts`; no other module instantiates it. Every consumer goes through `app.aiProviderService`.

**AC-AI-15** All AI-path error responses use `LoreError` with `code: "AI_PROVIDER_ERROR"` (or `STORE_ERROR` for config-time failures). No `throw` escapes the service layer.

### 5.5 Oracle

**AC-AI-16** `bun run typecheck` clean (5-stage).

**AC-AI-17** `bun run test:vitest` ≥ 1061 tests green (1028 existing + ≥ 33 new).

**AC-AI-18** `bun run test:bun` ≥ 454 tests green (451 existing + ≥ 3 new).

**AC-AI-19** `bun run build` produces a runnable `dist/lore`; `dist/lore --help` lists `create` and shows the `--no-ai` flag in its help text.

### 5.6 Telemetry

**AC-AI-20** A successful AI generation emits exactly one `ai.generation` event satisfying `aiGenerationEventSchema`, with `exit_code: 0` and `output_chars > 0`.

**AC-AI-21** `ai.telemetry: false` in config silences `ai.generation` events but does not affect other event types (e.g. `doc.created`).

## 6. Out-of-scope rejections

This SPEC explicitly refuses scope creep:

- "Add `--prompt` flag to override the rendered template" — possible future, not v1. v1 forces templates as the SSOT for prompt shape.
- "Add `--preview` / `--yes` gate" — Q3 settled `direct insert, no preview`; draft status is the soft gate.
- "Stream stdout to terminal" — Q4 settled sync; spinner is the UX surface.
- "Per-doc-type provider override" — config shape leaves room (`ai.per_type.<type>.provider`) but v1 only honours global `ai.provider`.
- "Auto-fallback to editor on AI failure" — Q6 settled fail loud; CLAUDE.md "禁止无声 fallback".
- "Cost / token accounting" — Telemetry stays on duration/chars; cost belongs to the provider's own observability.
- "MCP tool `lore_create_ai`" — MCP adapter unchanged.
- "AI in `lore set` / `lore link` / dashboard write-UI" — separate SPECs if/when needed.

## 7. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| `claude -p` output isn't valid Markdown (rare, but possible if user has custom system prompt) | We don't validate — the doc lands as raw content. User can `lore set <id> --content "..."` or `lore restore` from v1 if they don't like it. |
| First-time `Bun.spawn` cost on cold systems makes AC-AI-5 slow | Acceptable — failure path latency isn't a correctness concern; only happy-path UX needs to feel responsive. |
| Stub binary in bun test pollutes `$PATH` for parallel tests | Use `process.env.PATH` patch scoped to the spawned-child `env`, not the parent process. Each test cleans up its temp dir. |
| Future HTTP provider needs a different config shape | Already called out in §3.5 — future SPEC adds `kind: "cli" | "http"` discriminator. Today's config simply omits it. |
| Telemetry blow-up if user has thousands of AI generations per day | JsonlTelemetry already rolls daily files; new event reuses same writer. No new rotation logic needed. |
| User has `claude` binary but it points to wrong version / pre-print-mode build | First failure surfaces real stderr verbatim; user diagnoses and updates. We do not version-check. |
| `parent_title` lookup adds a corpus read on every AI-create | One extra `O(1)` indexed read by id; negligible vs `claude -p` 3-30s latency. Skip lookup when no `--parent` flag. |

## 8. Open Questions (deliberately none)

All design questions from the brainstorming pass (trigger surface / prompt source / safety gate / streaming / telemetry / failure mode / config shape) are resolved into the §3 architecture. Any future ambiguity becomes its own SPEC.

## Code anchors

- packages/lore/src/ai/claude-cli-provider.ts
