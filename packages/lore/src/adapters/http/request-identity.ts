/**
 * The write party of one HTTP request (spec-every-write-is-made-by-a-known-party-an-attested-agent-run end state 3-4;
 * BR-1055, BR-1352): a bearer key's name or a dashboard login, each with a run of its own.
 *
 * Purpose: `lore serve` is ONE long-lived process answering many callers, so who made a write is a per-request fact.
 * It is NEVER the serve process's own environment, user name or session: a bearer request is made by the key's name
 * under an `api-key` run, a cookie request by the logged-in person under a `dashboard` run. The run is registered on
 * first use and reused by every later write of the same key or person (first registration wins).
 *
 * Public surface: {@link partyOfActor}, {@link openRequestParty}, {@link dispatchUnderRequestParty}.
 *
 * Invariants:
 *   - A cookie login is named by the session's `owner` (the person the session was minted for), falling back to the
 *     session's key name only when no owner is recorded; a bearer key is named by the key's name.
 *   - Reads (GET/HEAD/OPTIONS) never register a run and run under no request identity.
 *   - A write whose party cannot be registered is refused (the registration error), never made unattributed.
 *
 * Side-effect class: IO (one `insertRun` per write request, first-wins) + request-scoped async context.
 */

import type { InvocationIdentity, LoreError, Result } from "@lore/core";
import { err, ok } from "@lore/core";
import type { App } from "../../app.js";
import { runWithRequestIdentity } from "../../store/write-context-store.js";
import type { ActorContext } from "./auth.js";

/** The party kind and display name of an authenticated request. */
export interface RequestParty {
  readonly harness: "api-key" | "dashboard";
  readonly name: string;
}

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Who an authenticated request is: the dashboard login (cookie) or the bearer key.
 *
 * @example
 *   partyOfActor({ name: "dashboard-local", owner: "dana", session_id: "ab", callerSurface: "http_cookie" })
 *   // => { harness: "dashboard", name: "dana" }
 */
export function partyOfActor(actor: ActorContext): RequestParty {
  if (actor.callerSurface === "http_cookie") {
    const owner = actor.owner;
    return { harness: "dashboard", name: owner !== undefined && owner.trim() !== "" ? owner : actor.name };
  }
  return { harness: "api-key", name: actor.name };
}

/**
 * Register (or reuse) the run of the request's party and return the identity its writes are made under.
 *
 * @returns ok(identity with source `api-key` or `dashboard`); the registration error when the party has no run;
 *   VALIDATION_ERROR when the App has no run registry (callers dispatch a stub App without an identity instead)
 */
export async function openRequestParty(app: App, actor: ActorContext): Promise<Result<InvocationIdentity, LoreError>> {
  if (app.runService === undefined) {
    return err({ code: "VALIDATION_ERROR", field: "identity", message: "This server cannot attribute writes: its App has no run registry" });
  }
  const party = partyOfActor(actor);
  const registered = await app.runService.registerParty({ harness: party.harness, name: party.name });
  if (!registered.ok) return registered;
  return ok({ harnessRun: registered.value.id, claimed: party.name, claimedSource: party.harness });
}

/**
 * Run `dispatch` (one request's route handling) with the request's party as the author of every store write inside.
 *
 * @param method - the request's HTTP method; a read dispatches as is
 * @returns the dispatch result, or the registration error when a write's party has no run
 */
export async function dispatchUnderRequestParty<T>(
  app: App,
  actor: ActorContext,
  method: string,
  dispatch: () => Promise<T>,
): Promise<Result<T, LoreError>> {
  if (READ_METHODS.has(method.toUpperCase())) return ok(await dispatch());
  // reason: an App with no run registry is a hand-built stub: it has no write-context store either, so there is no
  // identity for a request to override (every composed App from `createApp` carries `runService`).
  if (app.runService === undefined) return ok(await dispatch());
  const identity = await openRequestParty(app, actor);
  if (!identity.ok) return identity;
  return ok(await runWithRequestIdentity(identity.value, dispatch));
}
