/**
 * The human session's token file (spec-every-write-is-made-by-a-known-party-an-attested-agent-run end state 5;
 * BR-1350): where `lore session start --human` binds a person to a checkout, and how a write finds that binding.
 *
 * Purpose: a person's session is a registered run (harness `human`) plus ONE file in the user's lore state directory,
 * keyed by the checkout's absolute path. The file holds a random session token; the runs registry holds only the
 * token's SHA-256 (as the run's `session_ref`), so the registry alone cannot be replayed as a login.
 *
 * Public surface: {@link humanSessionFilePath}, {@link readHumanSessionFile}, {@link writeHumanSessionFile},
 * {@link deleteHumanSessionFile}, {@link bindingOfHumanSessionFile}, {@link hashSessionToken},
 * {@link newSessionToken}, {@link HumanSessionFile}, {@link HumanSessionFileError}.
 *
 * Invariants:
 *   - The file lives OUTSIDE the repository (`<lore state dir>/human-sessions/<sha256(checkout)>.json`, mode 0600) and
 *     is never committed. The state directory is `resolveMachineAuthBaseDir(env, home)`
 *     (`$LORE_STATE_HOME` > `$XDG_STATE_HOME/lore` > `~/.local/state/lore`).
 *   - Nothing here reads the host name or the computer's user name; the name is the one the person typed.
 *   - A file that exists but is unreadable, malformed or keyed to another checkout is an error
 *     ({@link HumanSessionFileError}), never "no session": a damaged binding must be seen, not skipped.
 *
 * Side-effect class: IO (reads, writes and deletes one file under the state directory).
 */

import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { deriveHumanRunId } from "@lore/core";
import type { HumanSessionBinding } from "@lore/core/node";
import { resolveMachineAuthBaseDir } from "../http/machine-auth.js";

type EnvBag = Readonly<Record<string, string | undefined>>;

const humanSessionFileSchema = z.object({
  version: z.literal(1),
  /** Absolute path of the checkout this session is bound to. */
  checkout: z.string().min(1),
  name: z.string().min(1),
  /** The random session token (64 hex); only its SHA-256 is stored in the runs registry. */
  token: z.string().regex(/^[0-9a-f]{64}$/),
  started_at: z.string().min(1),
});

/** The parsed token file. */
export type HumanSessionFile = z.infer<typeof humanSessionFileSchema>;

/** The token file of a checkout exists but cannot be used. */
export class HumanSessionFileError extends Error {
  readonly path: string;
  constructor(path: string, reason: string) {
    super(`human session file ${path}: ${reason}`);
    this.name = "HumanSessionFileError";
    this.path = path;
  }
}

/** SHA-256 hex of a session token: what the runs registry stores instead of the token. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A fresh random session token (32 random bytes, hex). */
export function newSessionToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Path of the token file for the checkout at `checkout`.
 *
 * @param checkout - absolute path of the checkout (the project root holding `.lore/lore.db`)
 */
export function humanSessionFilePath(env: EnvBag, home: string, checkout: string): string {
  const key = createHash("sha256").update(checkout).digest("hex");
  return join(resolveMachineAuthBaseDir(env, home), "human-sessions", `${key}.json`);
}

/**
 * Read the open human session of a checkout.
 *
 * @returns the parsed file, or `null` when the checkout has no open session
 * @throws {HumanSessionFileError} when the file exists but is not valid JSON of the expected shape, or names another checkout
 */
export function readHumanSessionFile(env: EnvBag, home: string, checkout: string): HumanSessionFile | null {
  const path = humanSessionFilePath(env, home, checkout);
  if (!existsSync(path)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    throw new HumanSessionFileError(path, `not readable JSON (${cause instanceof Error ? cause.message : String(cause)}); remove it or run \`lore session end\``);
  }
  const parsed = humanSessionFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new HumanSessionFileError(path, `unexpected shape: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
  }
  if (parsed.data.checkout !== checkout) {
    throw new HumanSessionFileError(path, `is bound to ${parsed.data.checkout}, not ${checkout}`);
  }
  return parsed.data;
}

/** The binding an invocation writes under: the person's name and the run derived from the token's hash. */
export function bindingOfHumanSessionFile(file: HumanSessionFile): HumanSessionBinding {
  return { name: file.name, run: deriveHumanRunId(hashSessionToken(file.token)) };
}

/**
 * Write the token file of a checkout (mode 0600, directory created).
 *
 * @throws {HumanSessionFileError} when a session file already exists for this checkout (never overwritten here)
 */
export function writeHumanSessionFile(env: EnvBag, home: string, file: HumanSessionFile): string {
  const path = humanSessionFilePath(env, home, file.checkout);
  if (existsSync(path)) throw new HumanSessionFileError(path, "already exists");
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  // reason: `mode` is masked by the process umask on creation; the token must not be group/world readable.
  chmodSync(path, 0o600);
  return path;
}

/** Delete the token file of a checkout; `false` when there was none. */
export function deleteHumanSessionFile(env: EnvBag, home: string, checkout: string): boolean {
  const path = humanSessionFilePath(env, home, checkout);
  if (!existsSync(path)) return false;
  rmSync(path);
  return true;
}
