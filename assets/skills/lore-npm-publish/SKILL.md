---
name: lore-npm-publish
description: "npm package publishing — MUST USE when publishing packages to npm/registry, bumping versions, generating changelogs, creating releases, or setting up a new npm package for first publish. Triggers: 'publish this package', 'bump version', 'release a new version', 'npm publish', 'first publish', 'publish to npm', 'create release', 'version bump', 'generate changelog', 'prerelease', 'publish alpha/beta/rc', 'dry run publish', 'check before publish', '发包', '发布npm', '版本升级'. Also use when user asks about publish configuration, .npmignore, package.json fields for publishing, or registry setup. Covers npm, pnpm, and yarn."
---

# npm Publish

Orchestrate the complete npm package publishing lifecycle: pre-flight checks → version bump → changelog → git tag → publish → push.

Read `references/workflow.md` for the detailed step-by-step workflow before executing.

## Modes

Detect the appropriate mode from user intent. If ambiguous, ask.

| Mode | When | Reference |
|------|------|-----------|
| `release` | Standard publish (major/minor/patch) | `references/workflow.md` |
| `prerelease` | Alpha/beta/rc versions | `references/prerelease.md` |
| `first-publish` | New package, never published | `references/first-publish.md` |
| `dry-run` | Simulate without side effects | `references/workflow.md` (dry-run section) |

## Core Principles

1. **Safety first** — every destructive action (publish, push, tag) requires explicit confirmation. Dry-run by default if uncertain.
2. **Detect, don't assume** — detect package manager (npm/pnpm/yarn) from lockfile, detect conventional commits from git log, detect registry from .npmrc / publishConfig.
3. **Fail loud** — if any pre-flight check fails, stop and report. Never skip failing tests or dirty working tree.
4. **Idempotent** — if a step partially completed (e.g., version bumped but publish failed), detect the state and resume from where it left off.

## Package Manager Detection

```
pnpm-lock.yaml → pnpm
yarn.lock → yarn
package-lock.json → npm
none → check packageManager field in package.json → fallback to npm
```

## Pre-flight Checklist (applies to ALL modes)

Run these checks in order. Stop at first failure.

1. **Git state**: working tree clean, on expected branch (main/master or release branch)
2. **Auth**: `npm whoami --registry <target>` succeeds
3. **package.json**: required fields present (name, version, main/module/exports, files or .npmignore)
4. **Build**: `npm run build` (or equivalent) succeeds if build script exists
5. **Tests**: `npm test` succeeds if test script exists
6. **Lint**: `npm run lint` succeeds if lint script exists
7. **Pack audit**: `npm pack --dry-run` — review included files, check for secrets/unwanted files
8. **Version conflict**: target version not already published (`npm view <pkg>@<version>`)

## Version Bump Strategy

### Conventional Commits (default)

Parse commits since last git tag to determine bump:
- `feat!:` or `BREAKING CHANGE:` → **major**
- `feat:` → **minor**
- `fix:`, `perf:`, `refactor:` → **patch**
- No conventional commits found → ask user for explicit version

### Manual Override

User can always specify: `patch`, `minor`, `major`, or exact version `1.2.3`.

## Changelog Generation

Generate from conventional commits using this structure:

```markdown
## [version] (YYYY-MM-DD)

### Breaking Changes
- description (commit-hash)

### Features
- description (commit-hash)

### Bug Fixes
- description (commit-hash)
```

Prepend to existing CHANGELOG.md. Create if not exists.

## Publish Execution Sequence

```
1. Pre-flight checks (all must pass)
2. Determine version (conventional commits or manual)
3. Update CHANGELOG.md
4. Bump version in package.json (and lockfile)
5. Git commit: "chore(release): vX.Y.Z"
6. Git tag: vX.Y.Z
7. Publish to registry
8. Git push (commits + tags)
```

Each step confirms before proceeding to the next destructive action. Steps 5-8 are the "point of no return" zone — confirm with user before entering.

## Post-publish Verification

After publish:
- `npm view <pkg>@<version>` confirms package is live
- Report the published version, registry URL, and git tag

## Error Recovery

| Failure Point | Recovery |
|---|---|
| Publish failed after version bump | Version already bumped in package.json + committed. Fix the issue, then `npm publish` manually — do NOT re-bump. |
| Push failed after publish | Package is live. Run `git push && git push --tags` manually. |
| Tag exists but publish didn't happen | Delete tag (`git tag -d vX.Y.Z`), fix issue, re-run. |

## 2FA / OTP

If the registry requires OTP, prompt the user to enter the code. Pass via `--otp <code>`. Never store OTP codes.
