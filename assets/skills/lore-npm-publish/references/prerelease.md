# Prerelease Workflow

Prerelease versions follow a different flow than stable releases. They use dist-tags to avoid affecting the `latest` tag.

## Prerelease Types

| Type | Pattern | Use Case |
|------|---------|----------|
| `alpha` | `1.2.0-alpha.0` | Internal testing, API may change |
| `beta` | `1.2.0-beta.0` | External testing, API mostly stable |
| `rc` | `1.2.0-rc.0` | Release candidate, final validation |

## Version Calculation

If current version is stable (e.g., `1.1.0`):
1. Determine next stable version from conventional commits (e.g., `1.2.0`)
2. Append prerelease suffix: `1.2.0-alpha.0`

If current version is already prerelease (e.g., `1.2.0-alpha.0`):
1. Same prerelease type → increment: `1.2.0-alpha.1`
2. Different prerelease type → promote: `1.2.0-beta.0`
3. Stable release → strip suffix: `1.2.0`

## Publish with dist-tag

Prerelease versions MUST publish with a dist-tag to avoid becoming the `latest` version:

```bash
# npm
npm publish --tag alpha

# pnpm
pnpm publish --tag alpha --no-git-checks

# yarn
yarn npm publish --tag alpha
```

Common dist-tags:
- `alpha` → `npm install pkg@alpha`
- `beta` → `npm install pkg@beta`
- `next` → `npm install pkg@next` (common for rc versions)

## Changelog

Prerelease changelogs follow the same format but are grouped under a prerelease header:

```markdown
## [1.2.0-alpha.0] (2025-01-15)

### Features (preview)
- new widget API ([abc1234])
```

## Promotion Flow

When promoting from prerelease to stable:
1. Run full pre-flight checks
2. Consolidate all prerelease changelogs into a single stable changelog entry
3. Bump to stable version: `1.2.0`
4. Publish without `--tag` (goes to `latest`)
5. Clean up dist-tags if desired: `npm dist-tag rm <pkg> alpha`

## Git Tagging

Prerelease versions get tags too:
- `v1.2.0-alpha.0`
- `v1.2.0-beta.0`
- `v1.2.0-rc.0`
