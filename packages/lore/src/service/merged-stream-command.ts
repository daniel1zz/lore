/**
 * Single-stream command shaping — the ONE mechanism by which an oracle command's
 * stderr is routed into its stdout, shared by `lore evidence --capture`
 * (`adapters/evidence-capture.ts`) and `lore verify` (`service/verify-executor.ts`).
 *
 * Public surface: {@link mergeStderrIntoStdout}, {@link mergeStderrIntoShellArgv}.
 * Invariants: the caller's command text is passed through UNCHANGED and runs in the
 * same shell, so its exit status is the shell's exit status.
 * Side-effect class: pure (string -> string).
 *
 * Lives in `service/` (not `adapters/`) because both consumers must import it and
 * service code must never import an adapter.
 *
 * Defect (task-gh-1343388703-181, lore issue #181): both spawn paths used to keep
 * stdout then stderr (concatenated) and a `CAPTURE_TAIL_CHARS`-sized tail, so a runner printing its
 * summary on stdout and noise on stderr lost the summary from the tail. One pipe
 * keeps the order a terminal shows.
 *
 * @module
 */

/**
 * Prefixes shell text with `exec 2>&1` so the shell routes stderr into the SAME pipe
 * as stdout for the whole command.
 *
 * Why this and not a wrapper such as `( cmd ) 2>&1`: `exec` redirects the shell's own
 * descriptors and then runs the caller's text unchanged in that same shell, so the
 * exit status IS the command's own — there is no subshell or pipe stage whose status
 * could replace it. The newline keeps the caller's text on its own line, so a trailing
 * `# comment` or a heredoc in it cannot swallow anything we add.
 *
 * @param command - the oracle command exactly as the caller wrote it
 * @returns the shell text to spawn
 * @example
 * mergeStderrIntoStdout("bun test"); // => "exec 2>&1\nbun test"
 */
export function mergeStderrIntoStdout(command: string): string {
  return `exec 2>&1\n${command}`;
}

/**
 * Applies {@link mergeStderrIntoStdout} to a `["sh", "-c", script]` argv (the only
 * shape `buildVerifySpawnSpec` produces).
 *
 * @param argv - the argv about to be spawned
 * @returns `{ argv, merged: true }` with the script rewritten when `argv` is a
 *   `sh -c <script>` triple; otherwise `{ argv, merged: false }` UNCHANGED — a bare
 *   binary has no shell to redirect through, and wrapping it would turn a launch
 *   failure (ENOENT) into a shell exit 127, so the caller must keep stderr separate.
 */
export function mergeStderrIntoShellArgv(argv: readonly string[]): {
  readonly argv: readonly string[];
  readonly merged: boolean;
} {
  if (argv.length === 3 && argv[0] === "sh" && argv[1] === "-c") {
    return { argv: ["sh", "-c", mergeStderrIntoStdout(argv[2] as string)], merged: true };
  }
  return { argv, merged: false };
}
