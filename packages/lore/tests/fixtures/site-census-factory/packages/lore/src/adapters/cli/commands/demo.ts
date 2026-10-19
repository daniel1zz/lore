// Fixture: a subcommand built by a local factory function, like `regenerableVerb` in autonomy.ts.
type Res = { ok: boolean; code?: string };
const err = (e: { code: string }): Res => ({ ok: false, code: e.code });
const defineCommand = <T>(c: T): T => c;

function verb(name: "add" | "rm") {
  return defineCommand({
    meta: { name },
    async run(): Promise<Res> {
      if (name === "rm") return err({ code: "FACTORY_REFUSAL" });
      return { ok: true };
    },
  });
}

const group = defineCommand({ meta: { name: "group" }, subCommands: { add: verb("add"), rm: verb("rm") } });

export default defineCommand({ meta: { name: "demo" }, subCommands: { group } });
