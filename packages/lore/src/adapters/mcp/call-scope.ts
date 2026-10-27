/**
 * Per-call write scope for MCP tools (spec-run-identity-slice-1 D1/D3; spec-every-write-is-made-by-a-known-party-an-attested-agent-run;
 * BR-1034, BR-1036, BR-1351).
 *
 * Purpose: an MCP server is ONE long-lived process serving many callers, so the identity of a write can never be
 * the server's environment. Each attested tool call builds its own {@link InvocationIdentity} from the call's
 * `harness_run` argument alone, runs against an App whose store is wrapped for
 * exactly that identity (`App.forWriteContext`), and closes that App when the call ends. One call = one identity,
 * so every operation of a `lore_batch` call carries the same run and the same name.
 *
 * Public surface: {@link McpCallScope} (`run`, `app`, `current`), {@link CallContext}.
 *
 * Invariants:
 *   - A call without `harness_run` has no known party: its writes are refused before anything is written (exit-4
 *     class `VALIDATION_ERROR` naming `lore session start --human <name>` and `lore setup`); its reads proceed. The
 *     wrapped store verifies the run at the call's first write: an unregistered run is refused there, never downgraded.
 *   - An App with no `forWriteContext` (hand-built stub) cannot attest: a call that names a `harness_run` is
 *     refused loudly.
 *   - {@link McpCallScope.app} is a live view: every property read resolves against the App of the call that is
 *     currently running (AsyncLocalStorage), else the base App. Handlers keep using `app.xxxService` unchanged.
 *   - Reads outside `run` (non-attested tools) never open a second store connection.
 *
 * Side-effect class: IO (opens and closes one store connection per attested call).
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { HARNESS_RUN_ENV, err, ok, type Invocation, type InvocationIdentity, type LoreError, type NameSource, type ResolvedInvocationIdentity, type Result } from "@lore/core";
import { RunIdentityArgumentError, UnknownPartyError, resolveInvocationIdentity } from "@lore/core/node";
import type { App } from "../../app.js";
import { createRealProcessTablePort } from "../process-table-port.js";

/** What the running call exposes to its handler. */
export interface CallContext {
  /** The App for THIS call: the base App, or a sibling whose store is wrapped for the call's identity. */
  readonly app: App;
  /**
   * The call's identity: its attested run and name, or the refusal reason when the call carried no `harness_run`.
   * Only a tool that needs an actor (or a store write) fails on the latter; reads proceed.
   */
  readonly identity: InvocationIdentity;
}

/** The per-call attestation argument every attested tool accepts. The name is never an argument (BR-1055). */
export interface CallAttestation {
  readonly harness_run?: string | undefined;
}

function errorResult(error: LoreError): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(error) }], isError: true };
}

/** The refusal of a call whose run could not be verified; carries the BR-1351 cause text. */
function refuseCall(error: LoreError): CallToolResult {
  return errorResult(error);
}

/**
 * Build the invocation identity of one call. `harness_run` is the run the agent integration vouched for and the
 * ONLY source: a call without it has no known party (BR-1351) — the server's own environment, user and working copy
 * say nothing about the caller, and a human session is never consulted (an MCP server is no person's terminal).
 */
export function buildCallIdentity(input: CallAttestation, server: Pick<Invocation, "env">): Result<InvocationIdentity, LoreError> {
  // reason: the call's structured `harness_run` is the per-call run value; it is handed to the resolver the way the CLI
  // hands `LORE_HARNESS_RUN`, over the server's own env WITHOUT its inherited value (the server's run is not the call's).
  const { [HARNESS_RUN_ENV]: _serverRun, ...serverEnv } = server.env;
  const callEnv = input.harness_run !== undefined ? { ...serverEnv, [HARNESS_RUN_ENV]: input.harness_run } : serverEnv;
  try {
    // reason: a missing `harness_run` keeps the generic refusal naming `lore setup` (BR-1351): the tool path has no
    // Bash hook whose removal could be blamed, so the hook probe answers "not installed".
    const { identity } = resolveInvocationIdentity([], callEnv, () => null, () => false);
    return ok(identity);
  } catch (e) {
    if (e instanceof RunIdentityArgumentError) {
      return err({ code: "VALIDATION_ERROR", field: "harness_run", message: e.message });
    }
    throw e;
  }
}

/**
 * The identity of the attested call that is running. Only attested tools (those whose schema declares
 * `harness_run`) run in a scope, so a handler that decides on identity (claim/release/report_issue) always has one.
 * @throws Error when called outside an attested call — a wiring defect, never a caller error.
 * @throws {UnknownPartyError} when the call carried no `harness_run` (`McpCallScope.run` returns it as an error result)
 */
export function requireCallIdentity(scope: McpCallScope): ResolvedInvocationIdentity {
  const context = scope.current();
  if (context === undefined) {
    throw new Error("requireCallIdentity: no attested call is running (the tool's schema must declare harness_run)");
  }
  // reason: these callers (claim/release/report_issue) record an actor, so THEY are where a call with no known party fails.
  if (context.identity.claimed === null) throw new UnknownPartyError(context.identity.unresolvedReason);
  return context.identity;
}

/** Service keys of App that tool handlers read through the live view. */
type ServiceKey = {
  [K in keyof App]-?: NonNullable<App[K]> extends object ? K : never;
}[keyof App];

export class McpCallScope {
  private readonly store = new AsyncLocalStorage<CallContext>();
  private readonly view: App;

  constructor(
    readonly base: App,
    /**
     * The server's invocation: its environment words the refusal of a call with no `harness_run`; its identity is used
     * ONLY for a hand-built App double that has no per-call write context (see {@link McpCallScope.run}).
     */
    private readonly server: Pick<Invocation, "env" | "identity">,
  ) {
    const resolve = (): App => this.store.getStore()?.app ?? this.base;
    this.view = new Proxy(base, {
      get(_target, prop) {
        const current = resolve();
        const value: unknown = Reflect.get(current, prop, current);
        return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(current) : value;
      },
      set(_target, prop, value) {
        return Reflect.set(base, prop, value, base);
      },
    });
  }

  /** The App as the running call sees it (live view; resolves per property read). */
  get app(): App {
    return this.view;
  }

  /** The context of the call currently running, or `undefined` outside {@link run}. */
  current(): CallContext | undefined {
    return this.store.getStore();
  }

  /**
   * A service of the current call's App, as a stable object a handler can hold: every member access resolves to
   * the CURRENT call's service. Lets a handler registered once keep a bare `corpusService` reference.
   */
  service<K extends ServiceKey>(key: K): NonNullable<App[K]> {
    const live = this.view;
    return new Proxy({} as NonNullable<App[K]>, {
      get(_target, prop) {
        const service = live[key] as object;
        const value: unknown = Reflect.get(service, prop, service);
        return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(service) : value;
      },
    });
  }

  /**
   * Run `body` as ONE attested call: build the identity, open the call-scoped App, verify the run once, run, close.
   * @returns the body's result, or an error result when the identity/App could not be established.
   */
  async run(input: CallAttestation, body: (context: CallContext) => Promise<CallToolResult>): Promise<CallToolResult> {
    const built = buildCallIdentity(input, this.server);
    if (!built.ok) return errorResult(built.error);
    // reason: an App with no `forWriteContext` is a hand-built test double (every App `createApp` returns has one): it
    // has no per-call store to stamp, so a call without `harness_run` is made as the server's OWN invocation identity.
    // A real server (production, any `createApp` App) never takes this branch: there a call without `harness_run` has no
    // known party and its writes are refused (BR-1351).
    const identity = this.base.forWriteContext === undefined && input.harness_run === undefined ? this.server.identity : built.value;

    let app = this.base;
    let scoped: App | undefined;
    if (this.base.forWriteContext !== undefined) {
      // reason: the tool server verifies the call's run by process ancestry exactly like the CLI entry (D19, AC-RV-6):
      // the server process (or one of its ancestors) must be the run's registered harness process.
      const ancestry = identity.harnessRun !== null ? { table: createRealProcessTablePort({ env: this.server.env, cwd: process.cwd() }), selfPid: process.pid } : undefined;
      const opened = this.base.forWriteContext({ identity, ...(ancestry === undefined ? {} : { ancestry }) });
      if (!opened.ok) return errorResult(opened.error);
      scoped = opened.value;
      scoped.callerSurface = this.base.callerSurface;
      app = scoped;
      const verified = await scoped.verifiedInvocationIdentity?.();
      if (verified !== undefined && !verified.ok) {
        scoped.close();
        return refuseCall(verified.error);
      }
    } else if (input.harness_run !== undefined) {
      return errorResult({
        code: "STORE_ERROR",
        message: "This server cannot attest writes: its App has no per-call write context (harness_run was supplied)",
      });
    }

    try {
      // reason: the call's run is verified by the wrapped store at its first WRITE (an unregistered run is refused
      // there, BR-1351), not eagerly here: a read made with an unknown run is never refused for identity.
      const context: CallContext = { app, identity };
      try {
        return await this.store.run(context, () => body(context));
      } catch (error) {
        // reason: a call with no known party reaches here only from a tool that needed an actor (`by`, a service write,
        // claim); it ends as that call's error result, naming how to become one. Anything else is a defect and rethrows.
        if (error instanceof UnknownPartyError) return errorResult(error.loreError);
        throw error;
      }
    } finally {
      scoped?.close();
    }
  }
}
