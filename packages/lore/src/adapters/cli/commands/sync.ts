/**
 * lore sync — manage remote Turso sync configuration.
 * Subcommands: setup, status, push, pull
 * Source: SPEC-009 §5, D-004 (auth_token_env stores NAME only, never plaintext token)
 */

import { defineLoreCommand } from "../cli-exit.js";
import { exitCli } from "../cli-exit.js";
import { join, dirname } from "path";
import { existsSync } from "fs";
import { resolveSyncCredentials } from "@lore/core";
import type { LoreConfig } from "@lore/core";
import type { Result, LoreError } from "@lore/core";
import { err, ok } from "@lore/core";
// reason: loadConfig/saveConfig read/write .lore/config.yaml via Node fs — only
// reachable via the @lore/core/node subpath (browser-safety split,
// packages/core/src/CLAUDE.md).
import { loadConfig, saveConfig } from "@lore/core/node";
import { invocationOf } from "../command-invocation.js";
import { formatErrorFor } from "../utils.js";
import { syncPush, type PushReport } from "../../http/sync-push.js";
import {
  TursoStore,
  buildTursoClientConfig,
  loadLibsqlClientModule,
  probeTmpdirUsability,
} from "../../../store/turso-store.js";
import { printLine } from "../output.js";

// ─── Push / Pull implementations ─────────────────────────────────────────────

/**
 * Logical replication push: read all local rows and INSERT OR IGNORE into remote.
 * Returns a PushReport with per-table row counts on success.
 */
export async function performPush(
  localPath: string,
  remoteUrl: string,
  authToken: string,
  env: Readonly<Record<string, string | undefined>>,
): Promise<Result<PushReport, LoreError>> {
  // reason: spec-eager-libsql-load-makes-every-command-depend-on-a-healthy
  // AC-LL-4 — callers (`syncPushCmd.run()`) already resolve credentials
  // before calling this function; the TMPDIR probe runs SECOND, here, right
  // before the native load `createClient` triggers (THIRD) — never a raw
  // dlopen trace.
  const tmpdirError = probeTmpdirUsability(env);
  if (tmpdirError !== null) return err(tmpdirError);

  const { createClient } = await loadLibsqlClientModule();
  const remoteClient = createClient({ url: remoteUrl, authToken });
  try {
    return await syncPush(localPath, remoteClient);
  } finally {
    remoteClient.close();
  }
}

/**
 * Embedded-replica pull: sync remote frames to local embedded replica.
 * Uses TursoStore.sync() which calls @libsql/client client.sync().
 * Returns { frameNo, framesSynced } on success.
 */
export async function performPull(
  localPath: string,
  remoteUrl: string,
  authToken: string,
  env: Readonly<Record<string, string | undefined>>,
): Promise<Result<{ frameNo: number; framesSynced: number } | void, LoreError>> {
  // reason: same ordering as performPush above — credential validation
  // already ran in the caller, TMPDIR probe here, native load only after.
  const tmpdirError = probeTmpdirUsability(env);
  if (tmpdirError !== null) return err(tmpdirError);

  const tursoConfig = { localPath, remoteUrl, authToken };
  // reason: THIS function (already async) pre-resolves the native module via
  // the literal-specifier dynamic-import loader — the ONLY mechanism proven
  // safe from a compiled binary (see `turso-store.ts`'s loader headers) —
  // and injects the built client into `TursoStore`'s constructor, which
  // therefore never needs to resolve `@libsql/client` itself on this
  // (real, compiled-binary-reachable) call path.
  const { createClient } = await loadLibsqlClientModule();
  const client = createClient(buildTursoClientConfig(tursoConfig));
  const store = new TursoStore(tursoConfig, client);
  try {
    return await store.sync();
  } finally {
    store.close();
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Discover the lore project directory by walking up from cwd.
 * Returns the directory containing .lore/, or null if not found.
 */
function findLoreDir(cwd: string): string | null {
  let dir = cwd;
  while (true) {
    const candidate = join(dir, ".lore", "lore.db");
    if (existsSync(candidate)) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// ─── sync setup ───────────────────────────────────────────────────────────────

const syncSetup = defineLoreCommand({
  meta: {
    name: "setup",
    description: "Configure remote Turso sync connection",
  },
  args: {
    url: {
      type: "string",
      description: "libsql:// remote URL (required)",
    },
    "token-env": {
      type: "string",
      description: "Name of env var holding the Turso auth token (default: LORE_SYNC_TOKEN)",
    },
    interval: {
      type: "string",
      description: "Sync interval in seconds (default: 60)",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  async run(context) {
    const { args } = context;
    const inv = invocationOf(context);
    // Validate --url is present
    if (!args.url) {
      const msg = "Missing required option --url (libsql://...)";
      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: false, error: msg }));
      } else {
        inv.io.stderr.write(`Error: ${msg}\n`);
      }
      exitCli(1);
    }

    // Validate --url must start with libsql://
    if (!args.url.startsWith("libsql://")) {
      const msg = `Invalid URL — must start with libsql:// (got: ${args.url})`;
      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: false, error: msg }));
      } else {
        inv.io.stderr.write(`Error: ${msg}\n`);
      }
      exitCli(1);
    }

    const loreDir = findLoreDir(inv.cwd);
    if (loreDir === null) {
      const msg = "No Lore project found. Run `lore init` first.";
      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: false, error: msg }));
      } else {
        inv.io.stderr.write(`Error: ${msg}\n`);
      }
      exitCli(1);
    }

    // Load existing config (may not have sync section)
    const configResult = loadConfig(loreDir);
    if (!configResult.ok) {
      const msg = `Failed to load config: ${configResult.error.code}`;
      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: false, error: msg }));
      } else {
        inv.io.stderr.write(`Error: ${msg}\n`);
      }
      exitCli(1);
    }

    const tokenEnv = (args["token-env"] as string | undefined) ?? "LORE_SYNC_TOKEN";
    const intervalSeconds = args.interval !== undefined ? parseInt(String(args.interval), 10) : 60;
    const safeInterval = Number.isFinite(intervalSeconds) && intervalSeconds > 0 ? intervalSeconds : 60;

    // Build updated config with sync section (D-004: write env var NAME, never token value)
    const updatedConfig: LoreConfig = {
      ...configResult.value,
      sync: {
        enabled: true,
        remote_url: args.url,
        auth_token_env: tokenEnv,
        interval: safeInterval,
      },
    };

    const saveResult = saveConfig(loreDir, updatedConfig);
    if (!saveResult.ok) {
      const msg = `Failed to save config: ${formatErrorFor(inv, saveResult.error)}`;
      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: false, error: msg }));
      } else {
        inv.io.stderr.write(`Error: ${msg}\n`);
      }
      exitCli(1);
    }

    if (args.json) {
      printLine(inv.io.stdout, 
        JSON.stringify({
          ok: true,
          data: {
            remote_url: args.url,
            auth_token_env: tokenEnv,
            interval: safeInterval,
            enabled: true,
          },
        }),
      );
    } else {
      printLine(inv.io.stdout, `Sync configured.`);
      printLine(inv.io.stdout, `  Remote URL:    ${args.url}`);
      printLine(inv.io.stdout, `  Token env var: ${tokenEnv}`);
      printLine(inv.io.stdout, `  Interval:      ${safeInterval}s`);
      printLine(inv.io.stdout, `  Config:        ${join(loreDir, ".lore", "config.yaml")}`);
    }

    exitCli(0);
  },
});

// ─── sync status ──────────────────────────────────────────────────────────────

const syncStatus = defineLoreCommand({
  meta: {
    name: "status",
    description: "Show current sync configuration and state",
  },
  args: {
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  async run(context) {
    const inv = invocationOf(context);
    const { args } = context;
    const loreDir = findLoreDir(inv.cwd);
    if (loreDir === null) {
      const msg = "No Lore project found. Run `lore init` first.";
      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: false, error: msg }));
      } else {
        inv.io.stderr.write(`Error: ${msg}\n`);
      }
      exitCli(1);
    }

    const configResult = loadConfig(loreDir);
    if (!configResult.ok) {
      const msg = `Failed to load config: ${configResult.error.code}`;
      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: false, error: msg }));
      } else {
        inv.io.stderr.write(`Error: ${msg}\n`);
      }
      exitCli(1);
    }

    const config = configResult.value;
    const syncSection = config.sync;

    // No sync section or sync disabled
    if (syncSection === undefined) {
      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { configured: false, status: "not configured" } }));
      } else {
        printLine(inv.io.stdout, "Sync is not configured (local-only mode).");
        printLine(inv.io.stdout, "Run `lore sync setup --url libsql://...` to configure remote sync.");
      }
      exitCli(0);
    }

    if (!syncSection.enabled) {
      if (args.json) {
        printLine(inv.io.stdout, 
          JSON.stringify({
            ok: true,
            data: {
              configured: true,
              enabled: false,
              status: "disabled",
              remote_url: syncSection.remote_url,
              auth_token_env: syncSection.auth_token_env,
              interval: syncSection.interval,
            },
          }),
        );
      } else {
        printLine(inv.io.stdout, "Sync is disabled.");
        printLine(inv.io.stdout, `  Remote URL:    ${syncSection.remote_url ?? "(none)"}`);
        printLine(inv.io.stdout, `  Token env var: ${syncSection.auth_token_env}`);
        printLine(inv.io.stdout, `  Interval:      ${syncSection.interval}s`);
      }
      exitCli(0);
    }

    // Sync is enabled
    if (args.json) {
      printLine(inv.io.stdout, 
        JSON.stringify({
          ok: true,
          data: {
            configured: true,
            enabled: true,
            status: "enabled",
            remote_url: syncSection.remote_url,
            auth_token_env: syncSection.auth_token_env,
            interval: syncSection.interval,
          },
        }),
      );
    } else {
      printLine(inv.io.stdout, "Sync is enabled.");
      printLine(inv.io.stdout, `  Remote URL:    ${syncSection.remote_url ?? "(none)"}`);
      printLine(inv.io.stdout, `  Token env var: ${syncSection.auth_token_env}`);
      printLine(inv.io.stdout, `  Interval:      ${syncSection.interval}s`);
    }

    exitCli(0);
  },
});

// ─── sync push ────────────────────────────────────────────────────────────────

const syncPushCmd = defineLoreCommand({
  meta: {
    name: "push",
    description: "Upload local DB to remote Turso (logical replication)",
  },
  args: {
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  async run(context) {
    const inv = invocationOf(context);
    const { args } = context;
    const loreDir = findLoreDir(inv.cwd);
    if (loreDir === null) {
      const msg = "No Lore project found. Run `lore init` first.";
      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: false, error: msg }));
      } else {
        inv.io.stderr.write(`Error: ${msg}\n`);
      }
      exitCli(1);
    }

    const configResult = loadConfig(loreDir);
    if (!configResult.ok) {
      const msg = `Failed to load config: ${configResult.error.code}`;
      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: false, error: msg }));
      } else {
        inv.io.stderr.write(`Error: ${msg}\n`);
      }
      exitCli(1);
    }

    const credResult = resolveSyncCredentials(configResult.value, invocationOf(context).env);
    if (!credResult.ok) {
      const msg =
        credResult.error.code === "VALIDATION_ERROR" && credResult.error.field === "sync"
          ? "Sync is not configured. Run `lore sync setup --url libsql://...` first."
          : `Sync credentials unavailable: ${formatErrorFor(inv, credResult.error)}`;
      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: false, error: msg }));
      } else {
        inv.io.stderr.write(`Error: ${msg}\n`);
      }
      exitCli(1);
    }

    const localDbPath = join(loreDir, ".lore", "lore.db");
    const pushResult = await performPush(localDbPath, credResult.value.url, credResult.value.token, inv.env);

    if (!pushResult.ok) {
      const msg = formatErrorFor(inv, pushResult.error);
      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: false, error: msg }));
      } else {
        inv.io.stderr.write(`Error: ${msg}\n`);
      }
      exitCli(1);
    }

    const report = pushResult.value;

    if (args.json) {
      printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { pushed: true, report } }));
    } else {
      printLine(inv.io.stdout, "Push complete.");
      for (const t of report.tables) {
        printLine(inv.io.stdout, `  ${t.table}: ${t.local_rows} local → ${t.remote_rows} remote`);
      }
      printLine(inv.io.stdout, `  Total: ${report.total_rows} rows`);
    }

    exitCli(0);
  },
});

// ─── sync pull ────────────────────────────────────────────────────────────────

const syncPullCmd = defineLoreCommand({
  meta: {
    name: "pull",
    description: "Sync remote Turso changes to local DB (embedded replica)",
  },
  args: {
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  async run(context) {
    const inv = invocationOf(context);
    const { args } = context;
    const loreDir = findLoreDir(inv.cwd);
    if (loreDir === null) {
      const msg = "No Lore project found. Run `lore init` first.";
      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: false, error: msg }));
      } else {
        inv.io.stderr.write(`Error: ${msg}\n`);
      }
      exitCli(1);
    }

    const configResult = loadConfig(loreDir);
    if (!configResult.ok) {
      const msg = `Failed to load config: ${configResult.error.code}`;
      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: false, error: msg }));
      } else {
        inv.io.stderr.write(`Error: ${msg}\n`);
      }
      exitCli(1);
    }

    const credResult = resolveSyncCredentials(configResult.value, invocationOf(context).env);
    if (!credResult.ok) {
      const msg =
        credResult.error.code === "VALIDATION_ERROR" && credResult.error.field === "sync"
          ? "Sync is not configured. Run `lore sync setup --url libsql://...` first."
          : `Sync credentials unavailable: ${formatErrorFor(inv, credResult.error)}`;
      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: false, error: msg }));
      } else {
        inv.io.stderr.write(`Error: ${msg}\n`);
      }
      exitCli(1);
    }

    const localDbPath = join(loreDir, ".lore", "lore.db");
    const pullResult = await performPull(localDbPath, credResult.value.url, credResult.value.token, inv.env);

    if (!pullResult.ok) {
      const msg = formatErrorFor(inv, pullResult.error);
      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: false, error: msg }));
      } else {
        inv.io.stderr.write(`Error: ${msg}\n`);
      }
      exitCli(1);
    }

    const syncInfo = pullResult.value;

    if (args.json) {
      printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { pulled: true, sync: syncInfo ?? null } }));
    } else {
      printLine(inv.io.stdout, "Pull complete.");
      if (syncInfo) {
        printLine(inv.io.stdout, `  Frame: ${syncInfo.frameNo}, synced: ${syncInfo.framesSynced}`);
      }
    }

    exitCli(0);
  },
});

// ─── sync command group ───────────────────────────────────────────────────────

export default defineLoreCommand({
  meta: {
    name: "sync",
    description: "Manage remote Turso sync configuration",
  },
  subCommands: {
    setup: syncSetup,
    status: syncStatus,
    push: syncPushCmd,
    pull: syncPullCmd,
  },
});
