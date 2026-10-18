/** STUB (red phase): never reports a change. */
export class UserStateWrittenDuringRunError extends Error {}
export type UserStateRoots = { readonly home: string; readonly settingsDir: string };
export type UserStateSnapshot = ReadonlyMap<string, string>;
export function resolveUserStateRoots(home: string, _env: Record<string, string | undefined>): UserStateRoots {
  return { home, settingsDir: "" };
}
export function snapshotUserState(_roots: UserStateRoots): UserStateSnapshot {
  return new Map();
}
export function diffUserState(_a: UserStateSnapshot, _b: UserStateSnapshot): string[] {
  return [];
}
export function assertUserStateUnchanged(_before: UserStateSnapshot, _roots: UserStateRoots): void {}
