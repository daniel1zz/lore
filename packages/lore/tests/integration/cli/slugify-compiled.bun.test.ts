// @reads assets/project/lore-config-template.yaml
/**
 * AC-068-10 — compiled-binary regression oracle for SPEC-068's CJK-aware
 * slugify (SPEC-068 hotfix, 2026-07-23): the original pinyin-pro lazy-load
 * (`createRequire(import.meta.url)("pinyin-pro")`) resolves fine when run
 * from SOURCE (`bun run dev`) but throws `Cannot find package 'pinyin-pro'
 * from '/$bunfs/root/index.js'` when run from the COMPILED `dist/lore`
 * binary outside the repo — the compiled binary's virtual `$bunfs/root`
 * filesystem has no `node_modules` to `require()` from. NONE of the
 * pre-hotfix SPEC-068 acceptance criteria (AC-068-1..9, all vitest, all
 * source-mode) exercised the compiled artifact — this is the first and only
 * oracle that does.
 *
 * Spawns the COMPILED `dist/lore` binary (`Bun.spawnSync`) against a
 * THROWAWAY corpus created via `mkdtemp(os.tmpdir())` — genuinely OUTSIDE
 * this repo's own working tree, so there is no `node_modules` directory
 * anywhere on the corpus's own path the binary could accidentally fall back
 * to. Never touches the repo's own `.lore/` corpus (project CLAUDE.md hard
 * rule). Requires `bun run build` to have run first — `assertFreshBinary`
 * (same helper `cli-claim-anchors.bun.test.ts`/`cli-handoff.bun.test.ts` use)
 * fails loud before any test runs if `dist/lore` is missing or older than
 * the newest `.ts` source under `packages/{lore,core}/src`. This test file
 * itself, spawning `dist/lore`, falls under the SPEC-061 build-freshness
 * attestation precheck when run via `lore verify`.
 *
 * Coverage:
 *   HAPPY:      an all-CJK ADR title ("测试", "test" in Chinese — well-known,
 *               unambiguous pinyin "ce shi") creates successfully (exit 0)
 *               and its slug is pinyin-derived, matching slugSchema and
 *               starting with the type prefix + the FIRST pinyin token
 *               ("adr-ce")
 *   REGRESSION: a Korean-title create (Hangul is outside pinyin-pro's
 *               coverage, D2's guard) still yields the deterministic
 *               `{type}-{8hex}` hash slug in the COMPILED binary too — same
 *               oracle vitest already covers in source mode
 *               (`slugify-cjk.test.ts` AC-068-5), re-run here end-to-end
 *
 * @spec_ref SPEC-068 §Acceptance Criteria AC-068-10
 *
 * TG-25 (adr-tg-1 option b): the commands run IN-PROCESS through tests/helpers/run-lore-in-process.ts, not through
 * dist/lore. Wherever the prose above says the compiled binary is spawned or its freshness asserted, that is the
 * history of this file; the assertions and the throwaway-corpus rule are unchanged.
 */

import { describe, expect, it, beforeAll, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runLoreInProcess } from "../../helpers/run-lore-in-process";

import { ensureRequirementsDocSlugAsync } from "../../helpers/parented-create.js";
// tests/integration/cli/ -> tests/integration/ -> tests/ -> packages/lore/ -> packages/ -> repo root (5 levels up).
const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Spawns the compiled `dist/lore` binary with `cwd` as its working directory.
 * `CLAUDECODE: "1"` resolves the CLI's "agent" caller surface (SPEC-024) —
 * this suite exercises `--content`-explicit creates, which bypass AI
 * generation entirely regardless of surface, but the env var also keeps any
 * gate-feeding AI calls (none triggered by an `adr` create) from attempting
 * a nested Claude invocation.
 */
async function runLore(args: string[], cwd: string): Promise<RunResult> {
  const proc = await runLoreInProcess(args, {
    cwd,
    home: cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true", CLAUDECODE: "1" },
  });
  return {
    stdout: proc.stdout,
    stderr: proc.stderr,
    exitCode: proc.exitCode,
  };
}

interface JsonDocEnvelope {
  ok: boolean;
  data: { slug: string; type: string; title: string };
}

async function initCorpus(tmpDir: string): Promise<void> {
  const result = await runLore(["init"], tmpDir);
  if (result.exitCode !== 0) {
    throw new Error(`lore init failed: ${result.stderr}`);
  }
}

let tmpDir: string;

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

describe("AC-068-10: compiled dist/lore survives a CJK-title create (SPEC-068 hotfix)", () => {
  it("HAPPY: all-CJK ADR title yields a pinyin slug, not exit 1 / a bare 'adr' collapse", async () => {
    // Genuinely outside the repo's own working tree — os.tmpdir() (e.g.
    // /tmp or /var/folders on macOS) has no ancestor node_modules the
    // compiled binary's pre-hotfix createRequire() could have fallen back
    // to; this is what makes the pre-hotfix defect reproduce deterministically.
    tmpDir = mkdtempSync(join(tmpdir(), "lore-slugify-compiled-"));
    await initCorpus(tmpDir);

    const result = await runLore(
      [
        "create",
        "adr", "--parent", await ensureRequirementsDocSlugAsync((a) => runLore(a, tmpDir,)),
        "--decision-status",
        "accepted",
        "--title",
        "测试",
        "--content",
        "x",
        "--json",
      ],
      tmpDir,
    );

    // Pre-hotfix behavior: exit 1, stderr "Cannot find package 'pinyin-pro'
    // from '/$bunfs/root/index.js'". Assert the full success path, not just
    // exit 0, so a regression that silently produces a wrong-but-nonzero-exit
    // slug (e.g. falling back to the bare "adr" collapse) is also caught.
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout) as JsonDocEnvelope;
    expect(parsed.ok).toBe(true);

    const { slug } = parsed.data;
    // Well-formed slug shape (slugSchema: lowercase, hyphen-kebab, 3-64 chars).
    expect(slug).toMatch(/^adr-[a-z0-9]+(-[a-z0-9]+)*$/);
    // Never the bare-type collapse this whole spec exists to fix.
    expect(slug).not.toBe("adr");
    // Pinyin-derived: starts with the type prefix + the first pinyin token
    // of 测 ("ce" — pinyin-pro's documented tone-less romanization).
    expect(slug.startsWith("adr-ce")).toBe(true);
    expect(slug).toBe("adr-ce-shi");
  });

  it("REGRESSION: Korean-title create still yields the deterministic {type}-{8hex} hash slug (D2 guard, compiled binary)", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-slugify-compiled-korean-"));
    await initCorpus(tmpDir);

    const result = await runLore(
      [
        "create",
        "adr", "--parent", await ensureRequirementsDocSlugAsync((a) => runLore(a, tmpDir,)),
        "--decision-status",
        "accepted",
        "--title",
        "한국어 제목",
        "--content",
        "x",
        "--json",
      ],
      tmpDir,
    );

    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout) as JsonDocEnvelope;
    expect(parsed.ok).toBe(true);

    const { slug } = parsed.data;
    // D2's deterministic hash guard: {type}-{fnv1a32 8-hex}, never the bare
    // "adr" collapse, and never a pinyin attempt on Hangul (pinyin-pro has
    // no Korean coverage — this exercises the "no useful transliteration"
    // branch through the compiled binary, not just source-mode vitest).
    expect(slug).toMatch(/^adr-[0-9a-f]{8}$/);
    expect(slug).not.toBe("adr");
    // Same title, same deterministic hash the source-mode oracle
    // (slugify-cjk.test.ts AC-068-5) already pins — cross-checks that the
    // compiled binary's hash guard computes byte-identically to source mode.
    expect(slug).toBe("adr-9a3f4081");
  });
});
