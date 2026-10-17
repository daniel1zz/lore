/**
 * Recorded fs/promises module (alias target for `fs/promises` / `node:fs/promises`).
 * Purpose: the vite alias target that lets scripts/test-read-log.ts see every path a test passes to
 * this module (task-skill-implement-tg-13, AC-TG-7). Public surface: every named export of the real
 * module (Node and Bun union, checked by scripts/tests/test-read-aliases.test.ts) plus `default`.
 * Side-effect class: records into the per-worker event log, then delegates unchanged.
 * Do not hand-edit the export list: regenerate it from `Object.keys(require("node:fs/promises"))` on Node and Bun.
 */
import { createRequire } from "node:module";
import { wrapFsPromisesModule } from "./test-read-log";

// reason: `createRequire` reaches the REAL module; importing "node:fs/promises" here would resolve to this file.
const real = createRequire(import.meta.url)("node:fs/promises") as typeof import("node:fs/promises");
// reason: typed loosely on purpose - the export list is the union of Node and Bun names, which no single @types/node version declares.
const recorded = wrapFsPromisesModule(real) as unknown as Record<string, unknown>;

export default recorded;
export const access = recorded.access;
export const appendFile = recorded.appendFile;
export const chmod = recorded.chmod;
export const chown = recorded.chown;
export const close = recorded.close;
export const constants = recorded.constants;
export const copyFile = recorded.copyFile;
export const cp = recorded.cp;
export const exists = recorded.exists;
export const fchmod = recorded.fchmod;
export const fchown = recorded.fchown;
export const fdatasync = recorded.fdatasync;
export const fstat = recorded.fstat;
export const fsync = recorded.fsync;
export const ftruncate = recorded.ftruncate;
export const futimes = recorded.futimes;
export const glob = recorded.glob;
export const lchmod = recorded.lchmod;
export const lchown = recorded.lchown;
export const link = recorded.link;
export const lstat = recorded.lstat;
export const lutimes = recorded.lutimes;
export const mkdir = recorded.mkdir;
export const mkdtemp = recorded.mkdtemp;
export const mkdtempDisposable = recorded.mkdtempDisposable;
export const open = recorded.open;
export const opendir = recorded.opendir;
export const read = recorded.read;
export const readFile = recorded.readFile;
export const readdir = recorded.readdir;
export const readlink = recorded.readlink;
export const readv = recorded.readv;
export const realpath = recorded.realpath;
export const rename = recorded.rename;
export const rm = recorded.rm;
export const rmdir = recorded.rmdir;
export const stat = recorded.stat;
export const statfs = recorded.statfs;
export const symlink = recorded.symlink;
export const truncate = recorded.truncate;
export const unlink = recorded.unlink;
export const utimes = recorded.utimes;
export const watch = recorded.watch;
export const write = recorded.write;
export const writeFile = recorded.writeFile;
export const writev = recorded.writev;
