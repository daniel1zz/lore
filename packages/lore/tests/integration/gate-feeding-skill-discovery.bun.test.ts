/**
 * @spec_ref IoC vertical-slice tech-spec §4.1/§11, P1 slice-2 (superseded for this gate by
 * spec-every-document-is-stored-as-structured-fields-validated-by, "One source") — `lore gate spec-create`'s
 * "active feeding" rule is the approved corpus TEMPLATE of the spec's kind; a `knowledge/skill` doc scoped
 * `applies_to: "spec"` (`CorpusService.findFeedingSkill`) no longer feeds this gate.
 *
 * bun test (not vitest): drives the real `gate.ts` command module in-process against a
 * real `SQLiteStore` (`createApp()`), the same in-process idiom
 * `spec-loop-e2e.bun.test.ts` establishes (chdir into a throwaway temp corpus, import
 * the command module directly, call its `run()`, capture stdout/exitCode) — chosen so
 * assertions can inspect the exact skill-doc slug/content that surfaces in the feeding
 * pack, which a subprocess-spawn harness cannot do without re-parsing stdout twice.
 *
 * ⛔ Never touches the repo's own `.lore/` corpus (project CLAUDE.md hard rule) — every
 * test operates inside its own `mkdtempSync` directory.
 *
 * Coverage dimensions:
 *   HAPPY      — one approved knowledge/skill doc with applies_to="spec" is discovered;
 *                its slug + content surface in the feeding pack.
 *   NEGATIVE   — a second approved skill doc with a DIFFERENT applies_to ("task") never
 *                surfaces in the spec-create feeding pack.
 *   BOUNDARY   — two approved skill docs both applies_to="spec" → the most-recently
 *                updated one wins (findFeedingSkill's "latest" tie-break).
 *   ERROR      — no approved knowledge/skill doc exists at all → placeholder fallback
 *                (backward-compat with the pre-discovery hardcoded-title behaviour).
 *   STATE      — a DRAFT (not yet approved) skill doc with a matching applies_to is
 *                invisible to discovery, same as if it didn't exist.
 *   REGRESSION — discovery never mutates the corpus (doc count unchanged across calls).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { createApp, type App } from "../../src/app.js";
import type { CreateDocInput } from "@lore/core";
import { liveInvocation, liveAmbient, liveWriteContext, runHandlerForExit } from "../live-invocation.js";

/** The exit code the most recent command call ended with (commands return it; none sets `process.exitCode`). */
let lastExitCode = 0;
import type { Invocation } from "@lore/core";

import { ensureRequirementsDocId } from "../helpers/parented-create.js";
// ─── Command type + importer (mirrors spec-loop-e2e.bun.test.ts) ────────────

type RunnableCommand = { run: (ctx: { args: Record<string, unknown>; inv?: Invocation }) => Promise<void> };

async function importGateSpecCreate(): Promise<RunnableCommand> {
  const mod = await import("../../src/adapters/cli/commands/gate.js");
  const group = (mod as { default?: { subCommands?: Record<string, unknown> } }).default;
  const cmd = group?.subCommands?.["spec-create"] as { run?: RunnableCommand["run"] } | undefined;
  if (!cmd?.run) throw new Error("gate spec-create command not exported");
  return cmd as RunnableCommand;
}

function captureOutput() {
  const stdout: string[] = [];
  const origConsoleLog = process.stdout.write;
  process.stdout.write = (((chunk: unknown) => {
    const args: unknown[] = [String(chunk).replace(/\n$/, "")];
    stdout.push(args.join(" "));
  
    return true;
  }) as typeof process.stdout.write);
  return {
    stdout,
    restore: () => {
      process.stdout.write = origConsoleLog;
    },
  };
}

// ─── Project setup ──────────────────────────────────────────────────────────

let tmpDir: string;
let dbPath: string;
let originalCwd: string;

beforeEach(() => {
  tmpDir = resolve(mkdtempSync(join(tmpdir(), "lore-gate-skill-discovery-test-")));
  const loreDir = join(tmpDir, ".lore");
  mkdirSync(loreDir, { recursive: true });
  dbPath = join(loreDir, "lore.db");

  const app = createApp(dbPath, undefined, liveAmbient(), liveWriteContext());
  app.close();

  originalCwd = process.cwd();
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

// ─── Fixture helpers ─────────────────────────────────────────────────────────

// reason: BR-2 — a spec takes no parent, so a payload that names one (any id or slug, even one that resolves to nothing)
// is a gate denial: the one predicate violation a schema-valid payload can carry now that the heading count is retired.
const NO_PARENT_PAYLOAD_WITH_PARENT: Record<string, unknown> = {
  type: "spec",
  title: "A spec that names a parent",
  parent_id: "no-such-parent",
};

async function withApp<T>(fn: (app: App) => Promise<T>): Promise<T> {
  const app = createApp(dbPath, undefined, liveAmbient(), liveWriteContext());
  try {
    return await fn(app);
  } finally {
    app.close();
  }
}

/** Creates an approved `knowledge/skill` doc with the given `applies_to` scope. */
async function createApprovedSkillDoc(opts: {
  title: string;
  appliesTo: string;
  content: string;
}): Promise<{ id: string; slug: string }> {
  return withApp(async (app) => {
    const createResult = await app.corpusService.create({
      parent_id: await ensureRequirementsDocId(app.corpusService), type: "knowledge",
      title: opts.title,
      content: opts.content,
      extra: { sub_type: "skill", skill: { applies_to: opts.appliesTo } },
    } as CreateDocInput);
    if (!createResult.ok) throw new Error(`skill doc create failed: ${JSON.stringify(createResult.error)}`);

    // draft -> approved is a valid direct (fast-track) transition (SPEC-002 §3).
    const approveResult = await app.corpusService.set(createResult.value.id, { status: "approved" });
    if (!approveResult.ok) throw new Error(`skill doc approve failed: ${JSON.stringify(approveResult.error)}`);

    return { id: createResult.value.id, slug: approveResult.value.slug };
  });
}

/** Creates a DRAFT (never approved) `knowledge/skill` doc — invisible to discovery. */
async function createDraftSkillDoc(opts: {
  title: string;
  appliesTo: string;
  content: string;
}): Promise<{ id: string; slug: string }> {
  return withApp(async (app) => {
    const createResult = await app.corpusService.create({
      parent_id: await ensureRequirementsDocId(app.corpusService), type: "knowledge",
      title: opts.title,
      content: opts.content,
      extra: { sub_type: "skill", skill: { applies_to: opts.appliesTo } },
    } as CreateDocInput);
    if (!createResult.ok) throw new Error(`skill doc create failed: ${JSON.stringify(createResult.error)}`);
    return { id: createResult.value.id, slug: createResult.value.slug };
  });
}

async function runGateSpecCreate(payload: Record<string, unknown>) {
  const cmd = await importGateSpecCreate();
  const output = captureOutput();
  try {
    lastExitCode = await runHandlerForExit(() => cmd.run({ args: { "input-json": JSON.stringify(payload) }, inv: liveInvocation() }));
  } finally {
    output.restore();
  }
  return { exitCode: lastExitCode, stdout: output.stdout.join("\n") };
}

async function countDocs(): Promise<number> {
  return withApp(async (app) => {
    const result = await app.corpusService.list({ type: "knowledge" });
    if (!result.ok) throw new Error(`list failed: ${JSON.stringify(result.error)}`);
    return result.value.docs.length;
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

// reason: the spec-rules document and the rule file shipped with the binary are retired: a `lore gate spec-create` denial
// quotes the APPROVED TEMPLATE of the spec's kind (spec-every-document-is-stored-as-structured-fields-validated-by, "One
// source"). A `knowledge/skill` doc scoped `applies_to: "spec"` is still a discoverable feeding source for OTHER checkpoints
// (`lore feed <checkpoint>`), but it no longer feeds this gate. These cases pin that: every skill-doc shape is ignored.
describe("lore gate spec-create — the rule is the approved template, never a skill doc", () => {
  async function installSpecFeatureTemplate(): Promise<string> {
    return withApp(async (app) => {
      const body = {
        doc_type: "spec",
        kind: "feature",
        version: 1,
        fields: { type: "object", required: ["summary"], properties: { summary: { type: "string", minLength: 1 } } },
        dimensions: [{ id: "edge-cases", question: "Which edge cases does it handle?" }],
        checks: [],
        render: [{ heading: "Summary", fields: ["summary"] }],
      };
      const created = await app.corpusService.create({ type: "template", title: "Gate fixture spec feature template", extra: { template: body } } as CreateDocInput);
      if (!created.ok) throw new Error(`template create failed: ${JSON.stringify(created.error)}`);
      const approved = await app.corpusService.set(created.value.id, { status: "approved" });
      if (!approved.ok) throw new Error(`template approve failed: ${JSON.stringify(approved.error)}`);
      return `${created.value.slug}@1`;
    });
  }

  // HAPPY — the template is the source.
  it("quotes the approved spec/feature template on the source line", async () => {
    const ref = await installSpecFeatureTemplate();

    const result = await runGateSpecCreate(NO_PARENT_PAYLOAD_WITH_PARENT);

    expect(result.exitCode).toBe(4);
    expect(result.stdout).toContain(`[source: template ${ref}, trust: team-authored]`);
    expect(result.stdout).toContain("What a spec feature must satisfy");
  });

  // NEGATIVE — an approved skill doc scoped applies_to=spec does NOT feed the gate any more.
  it("ignores an approved skill doc scoped applies_to=spec: its slug and content never surface", async () => {
    const ref = await installSpecFeatureTemplate();
    const skill = await createApprovedSkillDoc({
      title: "Custom write-spec rules",
      appliesTo: "spec",
      content: "## Rule\n\nDiscoverable-by-applies-to marker content.",
    });

    const result = await runGateSpecCreate(NO_PARENT_PAYLOAD_WITH_PARENT);

    expect(result.exitCode).toBe(4);
    expect(result.stdout).toContain(`[source: template ${ref}, trust: team-authored]`);
    expect(result.stdout).not.toContain(skill.slug);
    expect(result.stdout).not.toContain("Discoverable-by-applies-to marker content.");
  });

  // ERROR — nothing readable: the pack NAMES the missing template (never an invented or shipped rule).
  it("names the missing template, never a shipped asset or a skill doc, when no template is approved", async () => {
    await createApprovedSkillDoc({
      title: "Custom write-spec rules",
      appliesTo: "spec",
      content: "## Rule\n\nMust not stand in for the template.",
    });
    // reason: the skill-doc fixture above seeds the shipped templates (a bare corpus gets them from ensureRequirementsDocId),
    // so "no template approved" needs them removed explicitly (as removeSeededTemplates in tests/helpers/structured-corpus.ts
    // does for a rig, which this suite does not build).
    await withApp(async (app) => {
      const templates = await app.corpusService.list({ type: "template", limit: 500 } as never);
      if (!templates.ok) throw new Error(`list templates failed: ${JSON.stringify(templates.error)}`);
      for (const template of templates.value.docs) {
        const removed = await app.corpusService.delete(template.id, true);
        if (!removed.ok) throw new Error(`remove seeded template ${template.slug} failed: ${JSON.stringify(removed.error)}`);
      }
    });

    const result = await runGateSpecCreate(NO_PARENT_PAYLOAD_WITH_PARENT);

    expect(result.exitCode).toBe(4);
    expect(result.stdout).toContain("[source: template lookup, trust: team-authored]");
    expect(result.stdout).toContain("No rule could be read from an approved template");
    expect(result.stdout).not.toContain("shipped asset");
    expect(result.stdout).not.toContain("Must not stand in for the template.");
  });

  // STATE — a draft skill doc changes nothing either.
  it("a DRAFT skill doc changes nothing", async () => {
    const ref = await installSpecFeatureTemplate();
    await createDraftSkillDoc({
      title: "Not yet approved rules",
      appliesTo: "spec",
      content: "## Rule\n\nDraft marker content — must never surface.",
    });

    const result = await runGateSpecCreate(NO_PARENT_PAYLOAD_WITH_PARENT);

    expect(result.exitCode).toBe(4);
    expect(result.stdout).toContain(`[source: template ${ref}`);
    expect(result.stdout).not.toContain("Draft marker content");
  });

  // REGRESSION — discovery is read-only; it never creates/mutates corpus documents.
  it("does not create or mutate any corpus documents while discovering", async () => {
    await createApprovedSkillDoc({
      title: "Read-only check rules",
      appliesTo: "spec",
      content: "## Rule\n\nRead-only marker content.",
    });
    const before = await countDocs();

    await runGateSpecCreate(NO_PARENT_PAYLOAD_WITH_PARENT);
    await runGateSpecCreate(NO_PARENT_PAYLOAD_WITH_PARENT);

    const after = await countDocs();
    expect(after).toBe(before);
  });
});
