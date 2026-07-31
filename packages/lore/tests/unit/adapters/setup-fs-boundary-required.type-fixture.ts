/**
 * AC-SL-7 NEGATIVE CONTROL — a type-level fixture, not a test file.
 * (spec-lore-setup-deletes-repo-source-through-dev-symlinks, D8)
 *
 * WHY THIS FILE EXISTS
 * ────────────────────
 * D8 moves enumeration of removal call sites from a remembered regex to the
 * type checker: `boundary` is a REQUIRED property on every removal port, so a
 * forgotten argument fails `tsc` at every call site — including the ones nobody
 * remembered to list. (The retro filed as that spec's child measured the SAME
 * defect class escaping three times, because grepping the defect's shape
 * searches the CALLEE — already correct — while the omission sits in a caller
 * carrying no distinctive token.)
 *
 * But `bun run typecheck` passing proves nothing on its own: a signature left
 * OPTIONAL also typechecks. So the oracle needs a control that discriminates.
 *
 * HOW IT DISCRIMINATES
 * ────────────────────
 * Every call below OMITS `boundary` and is annotated `@ts-expect-error`:
 *
 *   - signature REQUIRED (correct)  → the call errors → the directive is USED
 *                                     → `bun run typecheck` exits 0.
 *   - signature reverted to OPTIONAL → the call compiles → the directive is
 *                                     UNUSED → TS2578 "Unused '@ts-expect-error'
 *                                     directive" → `bun run typecheck` FAILS.
 *
 * Measured in both directions before this file was committed: required → exit 0;
 * `opts?: { boundary?: string }` → TS2578, exit 2. A control never observed
 * failing is not a control.
 *
 * The `withBoundary` positive controls are equally load-bearing: without them a
 * signature mangled into rejecting EVERYTHING would also satisfy every
 * `@ts-expect-error` above and pass vacuously. They pin that the required form
 * is the form that compiles.
 *
 * ⛔ NOT A `*.test.ts` FILE, deliberately: it asserts a COMPILE-TIME property,
 * so its oracle is `tsc` (`typecheck:lore-tests` includes `tests/**‍/*`), not a
 * runner. Naming it `*.test.ts` would make vitest collect a file with zero
 * cases. Its continued existence is pinned by a case in
 * `real-setup-fs-symlink.test.ts` ("negative control fixture"), which is in turn
 * pinned by that suite's membership floor (AC-SL-8) — so deleting this file, or
 * deleting the case that guards it, both go red.
 *
 * Nothing here executes. `void` on each expression keeps the intent explicit.
 */

import { RealSetupFsWriter, removeProjectPath } from "../../../src/adapters/real-setup-fs.js";
import type { SetupFsWriter } from "../../../src/service/setup-service.js";
import type { ProjectFsPort } from "../../../src/flows/setup-project-flow.js";
import type { ProjectFsRemovePort } from "../../../src/flows/setup-project-uninstall.js";

/** Stand-in absolute paths — never touched, this file is never executed. */
const TARGET = "/tmp/lore-type-fixture/claude/skills/x/SKILL.md";
const BOUNDARY = "/tmp/lore-type-fixture/claude";

// ─── Surface 1: RealSetupFsWriter.remove (the concrete machine-install writer) ─

async function writerRemoveOmitted(writer: RealSetupFsWriter): Promise<void> {
  // @ts-expect-error — D8: `opts.boundary` is required; omitting it must not compile.
  await writer.remove(TARGET);
}

async function writerRemoveWithBoundary(writer: RealSetupFsWriter): Promise<void> {
  await writer.remove(TARGET, { boundary: BOUNDARY });
}

// ─── Surface 2: removeProjectPath (the SYNC twin, lore setup --project --uninstall) ─

function removeProjectPathOmitted(): void {
  // @ts-expect-error — D8: `opts.boundary` is required; omitting it must not compile.
  removeProjectPath(TARGET);
}

function removeProjectPathWithBoundary(): void {
  removeProjectPath(TARGET, { boundary: BOUNDARY });
}

// ─── Surface 3: SetupFsWriter port (what SetupService's six call sites see) ────

async function setupFsWriterPortOmitted(writer: SetupFsWriter): Promise<void> {
  // @ts-expect-error — D8: `opts.boundary` is required; omitting it must not compile.
  await writer.remove(TARGET);
}

async function setupFsWriterPortWithBoundary(writer: SetupFsWriter): Promise<void> {
  await writer.remove(TARGET, { boundary: BOUNDARY });
}

// ─── Surface 4: ProjectFsPort.remove (optional METHOD, required boundary) ─────
// The method is optional (additive capability, SPEC-060 D1/D2) while its
// `boundary` is not — so this surface pins BOTH: the presence check still
// narrows, and the narrowed call still demands the boundary.

function projectFsPortOmitted(fs: ProjectFsPort): void {
  if (fs.remove === undefined) return;
  // @ts-expect-error — D8: `opts.boundary` is required; omitting it must not compile.
  fs.remove(TARGET);
}

function projectFsPortWithBoundary(fs: ProjectFsPort): void {
  if (fs.remove === undefined) return;
  fs.remove(TARGET, { boundary: BOUNDARY });
}

// ─── Surface 5: ProjectFsRemovePort (uninstallProject's three call sites) ─────

function projectFsRemovePortOmitted(fs: ProjectFsRemovePort): void {
  // @ts-expect-error — D8: `opts.boundary` is required; omitting it must not compile.
  fs.remove(TARGET);
}

function projectFsRemovePortWithBoundary(fs: ProjectFsRemovePort): void {
  fs.remove(TARGET, { boundary: BOUNDARY });
}

// ─── Surface 6: a test double may not opt OUT of the constraint ───────────────
// TypeScript lets an implementation declare FEWER parameters than the interface
// it satisfies (measured: `remove(path: string)` is a legal `ProjectFsRemovePort`).
// That is exactly how a fake stays loose enough to make this AC vacuous — a
// wrapper double forwarding `base.remove(p)` then drops the boundary with no
// compile error anywhere. So every double in this repo declares the parameter,
// and this fixture pins the SHAPE they must declare: once declared, dropping the
// boundary on a forward is a compile error again.
const looselyTypedDoubleIsStillAssignable: ProjectFsRemovePort = {
  exists: (): boolean => false,
  readFile: (): string | null => null,
  writeFile: (): void => {},
  mkdir: (): void => {},
  // No `@ts-expect-error` here on purpose: this ASSIGNMENT is legal TypeScript
  // and pretending otherwise would be a false claim about the language. The
  // point of the entry is the comment above — the type system cannot force a
  // double to declare the parameter, so the repo's doubles do it by convention
  // and this fixture records why that convention is not optional.
  remove: (path: string): void => {
    void path;
  },
};

const strictlyTypedDouble: ProjectFsRemovePort = {
  exists: (): boolean => false,
  readFile: (): string | null => null,
  writeFile: (): void => {},
  mkdir: (): void => {},
  remove: (path: string, opts: { boundary: string }): void => {
    void `${path}${opts.boundary}`;
  },
};

// Keep every symbol referenced so `isolatedModules`/unused-export tooling has
// nothing to prune, without executing any of it.
export const AC_SL_7_FIXTURE_SURFACES = [
  writerRemoveOmitted,
  writerRemoveWithBoundary,
  removeProjectPathOmitted,
  removeProjectPathWithBoundary,
  setupFsWriterPortOmitted,
  setupFsWriterPortWithBoundary,
  projectFsPortOmitted,
  projectFsPortWithBoundary,
  projectFsRemovePortOmitted,
  projectFsRemovePortWithBoundary,
  looselyTypedDoubleIsStillAssignable,
  strictlyTypedDouble,
] as const;
