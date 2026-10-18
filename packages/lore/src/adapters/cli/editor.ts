/**
 * Editor helper — opens the user's preferred $EDITOR on a temp Markdown file and reads back content.
 *
 * Public surface:
 *   - openEditor(opts) — spawns editor synchronously via spawnSync, returns ok(content) or err(VALIDATION_ERROR)
 *
 * Invariants:
 *   - Temp directory is ALWAYS removed in a finally block — success and all error paths (AC-ED-7)
 *   - Editor resolution order: opts.defaults?.editor → $EDITOR env → "vi" (Unix) / "notepad" (Windows)
 *   - Empty content after edit → err(VALIDATION_ERROR, "content is empty — aborting") (AC-ED-6)
 *   - Editor binary not found (ENOENT) → err(VALIDATION_ERROR) with actionable message (AC-ED-4)
 *   - Non-zero editor exit → err(VALIDATION_ERROR, "editor exited with code N — aborting") (AC-ED-5)
 *   - Temp file has .md extension so editors treat it as Markdown (AC-ED-8)
 *   - No shell interpolation — spawnSync receives [bin, ...args, file] array (injection-safe)
 *
 * Side-effect class: IO (spawns child process, creates/reads/removes temp file on disk)
 *
 * Source: SPEC-003 §3.1, §6.2
 */

import { spawnSync } from "child_process";
import { exitCli } from "./cli-exit.js";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { ok, err } from "@lore/core";
import type { Result, LoreError } from "@lore/core";
import type { LoreDefaults } from "@lore/core";

// ─── Options ──────────────────────────────────────────────────────────────────

/**
 * Options accepted by openEditor.
 *
 * @example
 *   // No initial content — blank temp file (AC-ED-1)
 *   openEditor({ env: inv.env, tmpDir: inv.paths.tmpDir })
 *
 *   // Pre-populate with existing doc body for in-place editing (AC-ED-2)
 *   openEditor({ initialContent: doc.content, defaults, env: inv.env, tmpDir: inv.paths.tmpDir })
 */
export interface OpenEditorOptions {
  /**
   * Initial text to write into the temp file before spawning the editor.
   * When absent or undefined, the temp file starts empty (AC-ED-1).
   */
  initialContent?: string;
  /**
   * Merged defaults from loadLoreApp(); provides defaults.editor (highest-priority override).
   * When absent, falls back to $EDITOR env var, then vi/notepad (AC-ED-3).
   */
  defaults?: LoreDefaults;
  /** The Invocation's environment (`inv.env`): the `$EDITOR` source. No ambient default (AS-26). */
  env: NodeJS.ProcessEnv;
  /** The Invocation's temp directory (`inv.paths.tmpDir`): where the per-invocation edit dir is created. */
  tmpDir: string;
}

// ─── Editor resolution ────────────────────────────────────────────────────────

/**
 * Resolve the editor binary (and any leading flags) to use for the session.
 *
 * Resolution chain per SPEC-003 §6.2:
 *   1. defaults.editor   — merged global+project config (highest priority)
 *   2. $EDITOR env var   — conventional shell override
 *   3. "vi" / "notepad"  — platform default (vi on POSIX, notepad on win32)
 *
 * @param defaults - Merged LoreDefaults from loadLoreApp()
 * @param env - the Invocation's environment (`inv.env`) — `$EDITOR` source
 * @returns editor command string (may include flags, e.g. "code --wait")
 */
function resolveEditorCommand(env: NodeJS.ProcessEnv, defaults?: LoreDefaults): string {
  if (defaults?.editor) return defaults.editor;
  const fromEnv = env["EDITOR"];
  if (fromEnv) return fromEnv;
  // reason: notepad is the only GUI editor available by default on win32.
  // vi is POSIX-standard on macOS/Linux/BSD. (SPEC-003 §6.2)
  return process.platform === "win32" ? "notepad" : "vi";
}

// ─── Core helper ──────────────────────────────────────────────────────────────

/**
 * Open the user's preferred editor on a temp Markdown file, then return the saved content.
 *
 * Workflow:
 *   1. Resolve editor command (see resolveEditorCommand).
 *   2. Create a unique temp directory via mkdtempSync (handles uniqueness — AC-ED-8).
 *   3. Write initialContent (or empty string) to <tempdir>/content.md.
 *   4. spawnSync(editorBin, [...editorArgs, tempFile], { stdio: 'inherit' }) so the editor
 *      takes over the terminal.
 *   5. On ENOENT → err(VALIDATION_ERROR) with actionable message.
 *   6. On non-zero exit → err(VALIDATION_ERROR).
 *   7. Read back the file; if empty → err(VALIDATION_ERROR).
 *   8. Return ok(content).
 *   finally: rmSync(tempDir, { recursive: true, force: true }) in ALL paths (AC-ED-7).
 *
 * @param opts - Optional initial content and merged LoreDefaults for editor resolution
 * @returns ok(content) on success; err(VALIDATION_ERROR) on editor not found, non-zero exit,
 *   or empty file after edit
 *
 * @throws never — all errors are returned as err(VALIDATION_ERROR)
 *
 * @example
 *   // In a CLI command handler:
 *   const editorResult = await openEditor({ defaults, env: inv.env, tmpDir: inv.paths.tmpDir });
 *   if (!editorResult.ok) {
 *     process.stderr.write(formatError(editorResult.error) + "\n");
 *     exitCli(exitCode(editorResult.error));
 *   }
 *   const content = editorResult.value;
 */
export async function openEditor(
  opts: OpenEditorOptions,
): Promise<Result<string, LoreError>> {
  // Non-interactive (piped / CI / spawned subprocess) — skip editor, keep caller's initialContent.
  // Matches git/npm/bun behaviour: editor steps only fire in a TTY. Lets `lore create --title X` work
  // headless without --content (content stays empty, same as pre-editor behaviour).
  if (!process.stdin.isTTY) return ok(opts.initialContent ?? "");
  const editorCommand = resolveEditorCommand(opts.env, opts.defaults);

  // reason: split on whitespace to support commands like "code --wait" or "subl -w".
  // Do NOT use shell: true — that would allow injection if defaults.editor is untrusted.
  const [editorBin, ...editorArgs] = editorCommand.split(/\s+/);

  // Guard: split produced an empty first token (edge case: command is only whitespace)
  if (!editorBin) {
    return err({
      code: "VALIDATION_ERROR",
      field: "editor",
      message: `editor '${editorCommand}' not found; set $EDITOR or defaults.editor in your Lore config`,
    } satisfies LoreError);
  }

  // Create a per-invocation temp dir — mkdtempSync appends random suffix (AC-ED-8)
  const tempDir = mkdtempSync(join(opts.tmpDir, "lore-editor-"));
  const tempFile = join(tempDir, "content.md");

  try {
    // Write initial content so editor opens with existing text or a blank canvas (AC-ED-1/2)
    writeFileSync(tempFile, opts.initialContent ?? "", "utf8");

    // spawnSync blocks until the editor process exits.
    // stdio: 'inherit' gives the editor full terminal control (critical for vi/nano/emacs).
    const spawnResult = spawnSync(editorBin, [...editorArgs, tempFile], {
      stdio: "inherit",
    });

    // ENOENT → editor binary not found on PATH (AC-ED-4)
    if (spawnResult.error) {
      const nodeError = spawnResult.error as NodeJS.ErrnoException;
      if (nodeError.code === "ENOENT") {
        return err({
          code: "VALIDATION_ERROR",
          field: "editor",
          message: `editor '${editorBin}' not found; set $EDITOR or defaults.editor in your Lore config`,
        } satisfies LoreError);
      }
      // Other spawn errors (e.g. EACCES, EMFILE)
      return err({
        code: "VALIDATION_ERROR",
        field: "editor",
        message: `editor '${editorBin}' failed to start: ${nodeError.message ?? String(spawnResult.error)}`,
      } satisfies LoreError);
    }

    // Non-zero exit code → user aborted or editor crashed (AC-ED-5)
    const exitStatus = spawnResult.status ?? 0;
    if (exitStatus !== 0) {
      return err({
        code: "VALIDATION_ERROR",
        field: "editor",
        message: `editor exited with code ${exitStatus} — aborting`,
      } satisfies LoreError);
    }

    // Read back the saved content
    const content = readFileSync(tempFile, "utf8");

    // Empty content is treated as a cancel signal (AC-ED-6)
    if (content.trim() === "") {
      return err({
        code: "VALIDATION_ERROR",
        field: "content",
        message: "content is empty — aborting",
      } satisfies LoreError);
    }

    return ok(content);
  } finally {
    // Always remove the temp dir, even when we are returning an error (AC-ED-7).
    // best-effort: do not let cleanup failure mask the real return value.
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // intentionally swallowed — cleanup failure must not override caller's result
    }
  }
}
