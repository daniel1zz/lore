/**
 * Per-call write scope for MCP tools (spec-run-identity-slice-1 D1/D3/D11; BR-1034, BR-1035, BR-1036).
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
 *   - The run is verified ONCE per call by the wrapped App (`verifyInvocationIdentity`): an unregistered run is
 *     downgraded to unattested with one warning on the injected sink, never refused. The verified identity is what
 *     `CallContext.identity` exposes, so claim/release decide on the same run the rows are stamped with.
 *   - An App with no `forWriteContext` (hand-built stub) cannot attest: a call that names a `harness_run` is
 *     refused loudly; a call with none runs on the base App (unattested, as before).
 *   - {@link McpCallScope.app} is a live view: every property read resolves against the App of the call that is
 *     currently running (AsyncLocalStorage), else the base App. Handlers keep using `app.xxxService` unchanged.
 *   - Reads outside `run` (non-attested tools) never open a second store connection.
 *
 * Side-effect class: IO (opens and closes one store connection per attested call) + injected warn sink.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { err, ok, type InvocationIdentity, type LoreError, type NameSource, type Result } from "@lore/core";
import { readOsUsername } from "../../os-username.js";
import { RunIdentityArgumentError, resolveInvocationIdentity, type ActorSource } from "@lore/core/node";
import type { App } from "../../app.js";

/** What the running call exposes to its handler. */
export interface CallContext {
  /** The App for THIS call: the base App, or a sibling whose store is wrapped for the call's identity. */
  readonly app: App;
  /** The call's identity with its run verified against the registry (unregistered -> `harnessRun` null). */
  readonly identity: InvocationIdentity;
}

/** The per-call attestation argument every attested tool accepts. The name is never an argument (BR-1055). */
export interface CallAttestation {
  readonly harness_run?: string | undefined;
}

function stderrWarn(line: string): void {
  // MCP stdout is the protocol channel; a warning must go to stderr. MCP surface.
  process.stderr.write(`${line}\n`);
}

function errorResult(error: LoreError): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(error) }], isError: true };
}

/**
 * Build the invocation identity of one call. `harness_run` is the run the agent integration vouched for. The
 * name falls to the server's own chain (session, OS user) exactly as `resolveInvocationIdentity` resolves it — so
 * the name source stays honest (`session`/`os`), and the working-copy tier is skipped (the server's cwd says
 * nothing about the caller).
 */
export function buildCallIdentity(input: CallAttestation, env: Readonly<Record<string, string | undefined>>): Result<InvocationIdentity, LoreError> {
  const argv = input.harness_run !== undefined ? ["--harness-run", input.harness_run] : [];
  try {
    const { identity } = resolveInvocationIdentity(argv, env, readOsUsername);
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
 */
export function requireCallIdentity(scope: McpCallScope): InvocationIdentity {
  const context = scope.current();
  if (context === undefined) {
    throw new Error("requireCallIdentity: no attested call is running (the tool's schema must declare harness_run)");
  }
  return context.identity;
}

/**
 * Map a name source onto the actor-source tier the claim identity guard reads. `mcp` and `flag` are explicit
 * caller-given names; `worktree` is a derived non-colliding name (explicit-equivalent); only the OS user name is
 * the colliding "os-fallback" tier.
 */
export function actorSourceOfName(source: NameSource): ActorSource {
  switch (source) {
    case "mcp":
    case "flag":
    case "worktree":
      return "explicit";
    case "env":
      return "env";
    case "session":
      return "session";
    case "os":
      return "os-fallback";
  }
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
    /** The server's environment (`Invocation.env` of the MCP entry): the session tier of every call's name. */
    private readonly env: Readonly<Record<string, string | undefined>>,
    private readonly warn: (line: string) => void = stderrWarn,
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
    const built = buildCallIdentity(input, this.env);
    if (!built.ok) return errorResult(built.error);
    const identity = built.value;

    let app = this.base;
    let scoped: App | undefined;
    if (this.base.forWriteContext !== undefined) {
      const opened = this.base.forWriteContext({ identity, warn: this.warn });
      if (!opened.ok) return errorResult(opened.error);
      scoped = opened.value;
      scoped.callerSurface = this.base.callerSurface;
      app = scoped;
    } else if (identity.harnessRun !== null) {
      return errorResult({
        code: "STORE_ERROR",
        message: "This server cannot attest writes: its App has no per-call write context (harness_run was supplied)",
      });
    }

    try {
      let verified = identity;
      const check = await app.verifiedInvocationIdentity?.();
      if (check !== undefined) {
        if (!check.ok) return errorResult(check.error);
        if (check.value !== undefined) verified = check.value;
      }
      const context: CallContext = { app, identity: verified };
      return await this.store.run(context, () => body(context));
    } finally {
      scoped?.close();
    }
  }
}
