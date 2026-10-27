/**
 * lore agent — manage API keys for AI agents.
 * Subcommands: create, list, revoke
 * Source: SPEC-010 §3.2, §6
 */

import { defineLoreCommand } from "../cli-exit.js";

import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, formatTable } from "../utils.js";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";

/** Exit code for a usage error (a missing `--name`), the same code the other commands' flag contradictions end with. */
const USAGE_EXIT = 2;

/**
 * Both subcommands take the agent name as `--name`. It is declared optional to citty (which would end a missing
 * one with exit 1 and silently drop a positional) so a missing `--name`, including `revoke dup`, is a usage error
 * with exit 2 and a message naming the flag.
 *
 * @returns the name, or `null` after writing the usage error to stderr
 */
function requireNameFlag(name: string | undefined, subcommand: string, stderr: { write(chunk: string): unknown }): string | null {
  if (name !== undefined && name !== "") return name;
  stderr.write(`Error: lore agent ${subcommand} needs --name <name> (the name is a flag, not a positional).\n`);
  return null;
}

const agentCreate = defineLoreCommand({
  meta: {
    name: "create",
    description: "Create a new API key for an agent",
  },
  args: {
    name: {
      type: "string",
      description: "Agent name (unique identifier)",
    },
    owner: {
      type: "string",
      description: "Owner identity (default: admin)",
      default: "admin",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  async run(context): Promise<number> {
    const { args } = context;
    const inv = invocationOf(context);
    const name = requireNameFlag(args.name, "create", inv.io.stderr);
    if (name === null) return USAGE_EXIT;
    const { app } = loadLoreApp({ inv });
    try {
      const result = await app.apiKeyStore.create(name, args.owner ?? "admin");

      if (!result.ok) {
        if (args.json) {
          printLine(inv.io.stdout, JSON.stringify({ ok: false, error: result.error }));
        } else {
          inv.io.stderr.write(`${formatError(result.error)}\n`);
        }
        return exitCode(result.error);
      }

      const { rawKey, record } = result.value;

      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { name: record.name, api_key: rawKey, owner: record.owner } }));
        return 0;
      }

      printLine(inv.io.stdout, "Agent created:");
      printLine(inv.io.stdout, `  Name:    ${record.name}`);
      printLine(inv.io.stdout, `  API Key: ${rawKey}`);
      printLine(inv.io.stdout, `  Owner:   ${record.owner}`);
      printLine(inv.io.stdout, "");
      printLine(inv.io.stdout, "Use it as an HTTP bearer token (Authorization header) against `lore serve`:");
      printLine(inv.io.stdout, `  Authorization: Bearer ${rawKey}`);
      printLine(inv.io.stdout, "");
      printLine(inv.io.stdout, "Store this key securely — it cannot be retrieved again.");
    } finally {
      app.close();
    }
    return 0;
  },
});

const agentList = defineLoreCommand({
  meta: {
    name: "list",
    description: "List all API keys",
  },
  args: {
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  run(context): number {
    const { args } = context;
    const inv = invocationOf(context);
    const { app } = loadLoreApp({ inv });
    try {
      const result = app.apiKeyStore.list();

      if (!result.ok) {
        if (args.json) {
          printLine(inv.io.stdout, JSON.stringify({ ok: false, error: result.error }));
        } else {
          inv.io.stderr.write(`Error: ${"message" in result.error ? result.error.message : result.error.code}\n`);
        }
        return 1;
      }

      const keys = result.value;

      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: true, data: keys }));
        return 0;
      }

      if (keys.length === 0) {
        printLine(inv.io.stdout, "No API keys found. Run `lore agent create --name <name>` to create one.");
        return 0;
      }

      const rows = keys.map((k) => [
        k.name,
        k.owner,
        k.revoked_at !== null ? "revoked" : "active",
        k.created_at.slice(0, 19).replace("T", " "),
      ]);

      printLine(inv.io.stdout, formatTable(["Name", "Owner", "Status", "Created"], rows));
    } finally {
      app.close();
    }
    return 0;
  },
});

const agentRevoke = defineLoreCommand({
  meta: {
    name: "revoke",
    description: "Revoke an agent's API key",
  },
  args: {
    name: {
      type: "string",
      description: "Agent name to revoke",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  run(context): number {
    const { args } = context;
    const inv = invocationOf(context);
    const name = requireNameFlag(args.name, "revoke", inv.io.stderr);
    if (name === null) return USAGE_EXIT;
    const { app } = loadLoreApp({ inv });
    try {
      const result = app.apiKeyStore.revoke(name);

      if (!result.ok) {
        if (args.json) {
          printLine(inv.io.stdout, JSON.stringify({ ok: false, error: result.error }));
        } else {
          inv.io.stderr.write(`${formatError(result.error)}\n`);
        }
        return exitCode(result.error);
      }

      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { name, revoked: true } }));
        return 0;
      }

      printLine(inv.io.stdout, `Agent '${name}' API key revoked.`);
    } finally {
      app.close();
    }
    return 0;
  },
});

export default defineLoreCommand({
  meta: {
    name: "agent",
    description: "Manage API keys for AI agents",
  },
  subCommands: {
    create: agentCreate,
    list: agentList,
    revoke: agentRevoke,
  },
});
