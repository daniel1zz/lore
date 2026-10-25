/**
 * Double-registration detector for `lore setup --check` (task
 * task-gh-1343388703-157, lore issue #157).
 *
 * Mechanism: `lore setup` installs every `HOOK_REGISTRATIONS` hook at the USER
 * layer (`<claudeDir>/settings.json`). Claude Code runs the user AND the
 * project layer (`<project>/.claude/settings.json`, `.claude/settings.local.json`),
 * so a project that also registers the same lore-managed hook file for the same
 * event fires it twice per event (observed: a Stop hook's block
 * message printed twice).
 *
 * Invariants:
 *   - Identity is (hook FILE BASENAME, event). Command strings differ in
 *     runner prefix (`node `, `bash `) and path (`~/.claude/hooks/x.mjs` vs
 *     `$CLAUDE_PROJECT_DIR/assets/hooks/x.mjs`), so the basename of any
 *     whitespace-separated token of the command is compared, never the string.
 *   - Only files named in `HOOK_REGISTRATIONS` can be findings — a project may
 *     register its own hooks (a project-only hook outside the roster is silent).
 *   - A finding needs the USER layer to register the file for the event too;
 *     user-only registration (the intended state) is silent. Matchers are
 *     ignored: same file + same event at both layers fires twice regardless.
 *   - An ABSENT settings file means "no registrations"; a PRESENT-but-unparsable
 *     or wrongly-shaped one is a loud VALIDATION_ERROR — never read as "no
 *     registration", which would hide exactly the drift this check exists for.
 *   - Read-only. The project layer equal to the user layer (cwd is `$HOME`) is
 *     skipped: a file cannot double-register against itself.
 *
 * Side-effect class: IO (synchronous `node:fs` reads only).
 */

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";

import { z } from "zod";

import { err, HOOK_REGISTRATIONS, ok } from "@lore/core";
import type { LoreError, Result } from "@lore/core";

/** One hook file registered for one event at both layers. */
export interface DoubleRegistration {
  readonly file: string;
  readonly event: string;
  readonly user_settings: string;
  readonly project_settings: string;
}

/** Project-layer settings files Claude Code reads, in report order. */
const PROJECT_SETTINGS_FILENAMES = ["settings.json", "settings.local.json"] as const;

/** `hooks[event][].hooks[].command` — everything else in settings.json is ignored (passthrough). */
const settingsHooksSchema = z
  .object({
    hooks: z
      .record(
        z.string(),
        z.array(z.object({ hooks: z.array(z.object({ command: z.string().optional() }).passthrough()).optional() }).passthrough()),
      )
      .optional(),
  })
  .passthrough();

const MANAGED_HOOK_FILES: ReadonlySet<string> = new Set(HOOK_REGISTRATIONS.map((reg) => reg.file));

/** Basename of every command token that names a lore-managed hook file. */
function managedFilesInCommand(command: string): string[] {
  const out: string[] = [];
  for (const token of command.split(/\s+/)) {
    const name = basename(token.replace(/^["']|["']$/g, ""));
    if (MANAGED_HOOK_FILES.has(name)) out.push(name);
  }
  return out;
}

/** `Result.ok(null)` when the file is absent; loud error when present but unusable. */
function readRegistrations(settingsPath: string): Result<Set<string> | null, LoreError> {
  if (!existsSync(settingsPath)) return ok(null);

  let json: unknown;
  try {
    json = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch (cause) {
    return err({
      code: "VALIDATION_ERROR",
      field: "settings",
      message: `lore setup --check: cannot read hook registrations from "${settingsPath}": ${cause instanceof Error ? cause.message : String(cause)}`,
      value: settingsPath,
      rule: "BR-1182",
    });
  }
  const parsed = settingsHooksSchema.safeParse(json);
  if (!parsed.success) {
    return err({
      code: "VALIDATION_ERROR",
      field: "settings",
      message: `lore setup --check: "${settingsPath}" has an unexpected hooks shape: ${parsed.error.message}`,
      value: settingsPath,
      rule: "BR-1182",
    });
  }

  const keys = new Set<string>();
  for (const [event, groups] of Object.entries(parsed.data.hooks ?? {})) {
    for (const group of groups) {
      for (const hook of group.hooks ?? []) {
        for (const file of managedFilesInCommand(hook.command ?? "")) keys.add(`${event}\u0000${file}`);
      }
    }
  }
  return ok(keys);
}

/**
 * Finds lore-managed hook files registered for one event at both the user layer
 * (`<claudeDir>/settings.json`) and the project layer.
 *
 * @param opts.claudeDir - The setup target (user layer).
 * @param opts.projectDir - The project root whose `.claude/settings*.json` is the project layer.
 * @returns Findings in `HOOK_REGISTRATIONS` order, then project-file order; empty when clean.
 * @throws Never.
 */
export function detectDoubleRegistrations(opts: {
  claudeDir: string;
  projectDir: string;
}): Result<DoubleRegistration[], LoreError> {
  const userSettings = join(opts.claudeDir, "settings.json");
  const userResult = readRegistrations(userSettings);
  if (!userResult.ok) return userResult;
  const userKeys = userResult.value;
  if (userKeys === null) return ok([]);

  const findings: DoubleRegistration[] = [];
  const seen = new Set<string>();
  for (const filename of PROJECT_SETTINGS_FILENAMES) {
    const projectSettings = join(opts.projectDir, ".claude", filename);
    if (!existsSync(projectSettings)) continue;
    if (realpathSync(projectSettings) === realpathSync(userSettings)) continue;
    const projectResult = readRegistrations(projectSettings);
    if (!projectResult.ok) return projectResult;
    const projectKeys = projectResult.value;
    if (projectKeys === null) continue;

    for (const reg of HOOK_REGISTRATIONS) {
      const key = `${reg.event}\u0000${reg.file}`;
      const dedupe = `${projectSettings}\u0000${key}`;
      if (seen.has(dedupe) || !userKeys.has(key) || !projectKeys.has(key)) continue;
      seen.add(dedupe);
      findings.push({ file: reg.file, event: reg.event, user_settings: userSettings, project_settings: projectSettings });
    }
  }
  return ok(findings);
}
