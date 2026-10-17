/**
 * Recorded fs module (alias target for `fs` / `node:fs`).
 * Purpose: the vite alias target that lets scripts/test-read-log.ts see every path a test passes to
 * this module (task-skill-implement-tg-13, AC-TG-7). Public surface: every named export of the real
 * module (Node and Bun union, checked by scripts/tests/test-read-aliases.test.ts) plus `default`.
 * Side-effect class: records into the per-worker event log, then delegates unchanged.
 * Do not hand-edit the export list: regenerate it from `Object.keys(require("node:fs"))` on Node and Bun.
 */
import { createRequire } from "node:module";
import { wrapFsModule } from "./test-read-log";

// reason: `createRequire` reaches the REAL module; importing "node:fs" here would resolve to this file.
const real = createRequire(import.meta.url)("node:fs") as typeof import("node:fs");
// reason: typed loosely on purpose - the export list is the union of Node and Bun names, which no single @types/node version declares.
const recorded = wrapFsModule(real) as unknown as Record<string, unknown>;

export default recorded;
export const Dir = recorded.Dir;
export const Dirent = recorded.Dirent;
export const F_OK = recorded.F_OK;
export const FileReadStream = recorded.FileReadStream;
export const FileWriteStream = recorded.FileWriteStream;
export const R_OK = recorded.R_OK;
export const ReadStream = recorded.ReadStream;
export const Stats = recorded.Stats;
export const Utf8Stream = recorded.Utf8Stream;
export const W_OK = recorded.W_OK;
export const WriteStream = recorded.WriteStream;
export const X_OK = recorded.X_OK;
export const access = recorded.access;
export const accessSync = recorded.accessSync;
export const appendFile = recorded.appendFile;
export const appendFileSync = recorded.appendFileSync;
export const chmod = recorded.chmod;
export const chmodSync = recorded.chmodSync;
export const chown = recorded.chown;
export const chownSync = recorded.chownSync;
export const close = recorded.close;
export const closeSync = recorded.closeSync;
export const constants = recorded.constants;
export const copyFile = recorded.copyFile;
export const copyFileSync = recorded.copyFileSync;
export const cp = recorded.cp;
export const cpSync = recorded.cpSync;
export const createReadStream = recorded.createReadStream;
export const createWriteStream = recorded.createWriteStream;
export const exists = recorded.exists;
export const existsSync = recorded.existsSync;
export const fchmod = recorded.fchmod;
export const fchmodSync = recorded.fchmodSync;
export const fchown = recorded.fchown;
export const fchownSync = recorded.fchownSync;
export const fdatasync = recorded.fdatasync;
export const fdatasyncSync = recorded.fdatasyncSync;
export const fstat = recorded.fstat;
export const fstatSync = recorded.fstatSync;
export const fsync = recorded.fsync;
export const fsyncSync = recorded.fsyncSync;
export const ftruncate = recorded.ftruncate;
export const ftruncateSync = recorded.ftruncateSync;
export const futimes = recorded.futimes;
export const futimesSync = recorded.futimesSync;
export const glob = recorded.glob;
export const globSync = recorded.globSync;
export const lchmod = recorded.lchmod;
export const lchmodSync = recorded.lchmodSync;
export const lchown = recorded.lchown;
export const lchownSync = recorded.lchownSync;
export const link = recorded.link;
export const linkSync = recorded.linkSync;
export const lstat = recorded.lstat;
export const lstatSync = recorded.lstatSync;
export const lutimes = recorded.lutimes;
export const lutimesSync = recorded.lutimesSync;
export const mkdir = recorded.mkdir;
export const mkdirSync = recorded.mkdirSync;
export const mkdtemp = recorded.mkdtemp;
export const mkdtempDisposableSync = recorded.mkdtempDisposableSync;
export const mkdtempSync = recorded.mkdtempSync;
export const open = recorded.open;
export const openAsBlob = recorded.openAsBlob;
export const openSync = recorded.openSync;
export const opendir = recorded.opendir;
export const opendirSync = recorded.opendirSync;
export const promises = recorded.promises;
export const read = recorded.read;
export const readFile = recorded.readFile;
export const readFileSync = recorded.readFileSync;
export const readSync = recorded.readSync;
export const readdir = recorded.readdir;
export const readdirSync = recorded.readdirSync;
export const readlink = recorded.readlink;
export const readlinkSync = recorded.readlinkSync;
export const readv = recorded.readv;
export const readvSync = recorded.readvSync;
export const realpath = recorded.realpath;
export const realpathSync = recorded.realpathSync;
export const rename = recorded.rename;
export const renameSync = recorded.renameSync;
export const rm = recorded.rm;
export const rmSync = recorded.rmSync;
export const rmdir = recorded.rmdir;
export const rmdirSync = recorded.rmdirSync;
export const stat = recorded.stat;
export const statSync = recorded.statSync;
export const statfs = recorded.statfs;
export const statfsSync = recorded.statfsSync;
export const symlink = recorded.symlink;
export const symlinkSync = recorded.symlinkSync;
export const truncate = recorded.truncate;
export const truncateSync = recorded.truncateSync;
export const unlink = recorded.unlink;
export const unlinkSync = recorded.unlinkSync;
export const unwatchFile = recorded.unwatchFile;
export const utimes = recorded.utimes;
export const utimesSync = recorded.utimesSync;
export const watch = recorded.watch;
export const watchFile = recorded.watchFile;
export const write = recorded.write;
export const writeFile = recorded.writeFile;
export const writeFileSync = recorded.writeFileSync;
export const writeSync = recorded.writeSync;
export const writev = recorded.writev;
export const writevSync = recorded.writevSync;
