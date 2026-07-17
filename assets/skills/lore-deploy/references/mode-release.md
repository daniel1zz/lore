# Deploy Mode: Release

> Release management — versioning, changelogs, tags, publishing, and rollback.

## Workflow

1. **Readiness check** — all tests pass, docs updated, no blocking issues
2. **Load runbooks** — `lore search "release deployment" --type knowledge --json`
3. **Risk assessment** — apply SKILL.md Phase 1 (Analyze) to determine release risk level
4. **Bump version** — semver (major/minor/patch), pre-release: alpha → beta → rc
5. **Generate changelog** — from conventional commits since last tag
6. **Tag + publish** — git tag, GitHub/GitLab release, artifact registry
7. **Link docs** — connect release to PRDs, tech-specs via `lore link <release-doc> <prd-or-spec> --type=relates-to`
8. **Verify** — artifacts accessible, version endpoint returns correct version
9. **Announce** — notify stakeholders (automated via CI or manual)

## Versioning Strategy

### Semantic Versioning (semver)

| Bump | When | Example |
|------|------|---------|
| **MAJOR** (X.0.0) | Breaking API changes, incompatible migrations | 1.0.0 → 2.0.0 |
| **MINOR** (0.X.0) | New features, backward-compatible additions | 1.0.0 → 1.1.0 |
| **PATCH** (0.0.X) | Bug fixes, security patches, documentation | 1.0.0 → 1.0.1 |
| **Pre-release** | Testing phase: alpha → beta → rc | 2.0.0-alpha.1 → 2.0.0-beta.1 → 2.0.0-rc.1 → 2.0.0 |

**Decision rule**: If you must explain "how to migrate" in release notes → MAJOR. If you can say "now supports X" → MINOR. If users don't need to know → PATCH.

### Conventional Commits → Changelog

| Commit prefix | Changelog section | Bump |
|--------------|-------------------|------|
| `feat:` | Features | MINOR |
| `fix:` | Bug Fixes | PATCH |
| `feat!:` or `BREAKING CHANGE:` | Breaking Changes | MAJOR |
| `perf:` | Performance | PATCH |
| `docs:` | Documentation | (no bump) |
| `chore:` | Maintenance | (no bump) |

## Release Checklist (Quality Gates)

| Gate | Check | Block |
|------|-------|-------|
| Tests | All CI checks pass on release branch | HARD |
| Security | No known critical/high CVEs in dependencies | HARD |
| Changelog | Generated and reviewed, breaking changes documented | HARD |
| Version | Bumped correctly per semver rules | HARD |
| Documentation | API docs updated, migration guide (if breaking) | HARD for MAJOR, SOFT otherwise |
| Rollback plan | Documented per SKILL.md Phase 5 | HARD |
| Stakeholder approval | Product/eng sign-off for MAJOR releases | HARD for MAJOR |

## Rollback Procedures for Releases

### Published Package (npm, PyPI, etc.)

| Scenario | Action |
|----------|--------|
| Bug found within minutes | `npm unpublish` (within 72h) or `npm deprecate` + publish fix |
| Bug found after adoption | Publish patched version (X.Y.Z+1), deprecate broken version |
| Breaking change was unintentional | Revert commit, publish patch to restore old behavior, then MAJOR for actual breaking change |

### GitHub/GitLab Release

```bash
# Delete tag and re-tag if release was premature
git tag -d v{version}
git push origin :refs/tags/v{version}

# Or create a new patch release with the fix
git checkout -b hotfix/v{version}
# ... fix ...
git tag v{version-patch}
```

### Container Image Release

```bash
# Re-tag previous known-good image
docker tag {registry}/{image}:{previous-version} {registry}/{image}:{current-version}
docker push {registry}/{image}:{current-version}

# Or publish hotfix image
docker build -t {registry}/{image}:{hotfix-version} .
docker push {registry}/{image}:{hotfix-version}
```

### Deployment Rollback

If release was deployed, follow SKILL.md Phase 5 rollback procedures based on the deployment strategy used.

## Artifact Publishing

| Registry | Tool | Command |
|----------|------|---------|
| npm | npm/pnpm | `npm publish --access public` |
| PyPI | twine | `twine upload dist/*` |
| Docker Hub / GHCR | docker | `docker push {registry}/{image}:{tag}` |
| GitHub Release | gh CLI | `gh release create v{version} --generate-notes` |
| Maven Central | gradle/maven | `./gradlew publish` |

## Exit Criteria

- [ ] Version bumped correctly (semver)
- [ ] Changelog generated from commits and reviewed
- [ ] Git tag pushed
- [ ] GitHub/GitLab release created with changelog body
- [ ] Artifacts published to registry
- [ ] Version endpoint returns correct version (if applicable)
- [ ] Release notes linked in lore (PRD, tech-spec) via `lore link`
- [ ] Rollback plan documented (per SKILL.md Phase 5)
- [ ] Breaking changes documented with migration guide (if MAJOR)

## Tools

- `serena`: replace_content (version numbers), execute_shell_command (git tag, npm version)
- `github`: release creation, tag management
- `lore`: `lore search --type knowledge` for runbooks + related docs, `lore link` to connect release to specs
