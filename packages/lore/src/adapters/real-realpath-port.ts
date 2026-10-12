/**
 * Real filesystem realpath port (spec-session-start-injection-carries-only-the-session-s-own
 * D12) — leaf IO resolving a directory path through symlinks, so a claim recorded as
 * `/tmp/x` matches a seat whose `git rev-parse --show-toplevel` prints `/private/tmp/x`.
 *
 * Public surface:
 *   - RealpathPort — the injectable port type (`SessionService`'s constructor DI, so the
 *     InMemoryStore suite never touches the real filesystem).
 *   - realpathNative — the real implementation (`fs.realpathSync.native`).
 *
 * Invariants:
 *   - THROWS the underlying `fs` error unchanged (`code: "ENOENT"` for a path that no
 *     longer exists). Classifying ENOENT as "fall back to path.resolve" is the CALLER's
 *     documented decision (`SessionService.seatClaims`); every other code is surfaced.
 *
 * Side-effect class: IO (filesystem stat).
 */

import { realpathSync } from "node:fs";

/** Injectable port: resolves `path` through symlinks; throws the `fs` error (`ENOENT` when absent). */
export type RealpathPort = (path: string) => string;

/** The real port — `fs.realpathSync.native` (the OS realpath, so macOS `/tmp` → `/private/tmp`). */
export const realpathNative: RealpathPort = (path) => realpathSync.native(path);
