/**
 * The resolved facts of ONE program invocation (spec-ambient-state-is-read-once-at-the-entry-owned-only-prune
 * D4, rule AS-26): where it runs, with what environment and arguments, which paths it owns, who it is.
 *
 * Purpose: the single value the program entry builds once and every layer below RECEIVES, so no layer
 * reads `process.env` / `process.cwd()` / the home directory itself.
 * Public surface: {@link Invocation}, {@link InvocationWriter}, {@link InvocationPaths}, {@link InvocationReader}.
 * Invariants:
 *   - Pure types, no Node import (browser-safe barrel, AS-4). The resolver is `resolveInvocation` in
 *     `@lore/core/node` (`invocation-node.ts`), the ONE core file allowed to read ambient state.
 *   - Immutable: every field is `readonly`. A value that changes during a run (the verified run identity)
 *     is NOT stored here; whoever verifies it returns it (`ensureVerifiedIdentity` in the lore store layer).
 *   - `paths.claudeDir` follows BR-813 (`--claude-dir` > `$CLAUDE_CONFIG_DIR` > `<home>/.claude`);
 *     `paths.userConfigDir` follows BR-1012/BR-1065 (`$LORE_CONFIG_HOME` > `$XDG_CONFIG_HOME/lore` > `~/.config/lore`).
 * Side-effect class: pure (type declarations only).
 */

import type { InvocationIdentity } from "./run-identity.js";

/** The part of a writable stream a command needs: write one string. `process.stdout` satisfies it. */
export interface InvocationWriter {
  write(text: string): unknown;
  /** `true` when the writer is an interactive terminal (a command may then show a progress spinner); absent otherwise. */
  readonly isTTY?: boolean | undefined;
}

/**
 * The input of one invocation as a structural async stream of chunks (`process.stdin` satisfies it). Node-free on
 * purpose: this file is part of the browser-safe barrel.
 */
export interface InvocationReader {
  [Symbol.asyncIterator](): AsyncIterator<string | Uint8Array>;
}

/** Directories of one invocation, all absolute. */
export interface InvocationPaths {
  /** The user's home directory. */
  readonly home: string;
  /** The Claude config directory the setup/context verbs install into (BR-813). */
  readonly claudeDir: string;
  /** The per-user lore config directory (BR-1012/BR-1065). */
  readonly userConfigDir: string;
  /** Nearest ancestor of `cwd` holding a lore corpus, or `null` outside any project. */
  readonly projectRoot: string | null;
  /** The OS temp directory. */
  readonly tmpDir: string;
}

/** Everything one program invocation read from its process, resolved once at the entry. */
export type Invocation = Readonly<{
  cwd: string;
  env: Readonly<Record<string, string | undefined>>;
  /** Arguments after the program name. */
  argv: readonly string[];
  paths: InvocationPaths;
  host: string;
  execPath: string;
  /** True inside the `bun build --compile` binary (`Bun.main` under `/$bunfs/`). */
  isCompiled: boolean;
  /** Who this invocation is (the known party's run and name, or why there is none); unverified until the store verifies its run. */
  identity: InvocationIdentity;
  /**
   * True when the identity's run must also be verified against this process's ancestry (set by the real program
   * entry; absent for in-process runs, whose test process is not a harness child). The store layer reads it.
   */
  verifyAncestry?: boolean;
  /** The run's streams: the two writers, the input, and whether the input is an interactive terminal (resolved once at the entry). */
  io: Readonly<{ stdout: InvocationWriter; stderr: InvocationWriter; stdin: InvocationReader; stdinIsTTY: boolean }>;
}>;
