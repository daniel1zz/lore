# Deploy Mode: CI

> CI/CD pipeline configuration and build automation.

## Workflow

1. **Detect platform** — `.github/workflows/`, `.gitlab-ci.yml`, `Jenkinsfile`, `.circleci/config.yml`
2. **Analyze project** — language, build tool, test framework, package manager
3. **Design pipeline stages** — build → typecheck → lint → test (coverage) → security scan → deploy
4. **Create pipeline** — apply platform-specific patterns from references
5. **Configure** — branch triggers, PR checks, caching, secrets (OIDC/vault, never plain env), concurrency, timeouts
6. **Verify** — pipeline runs green on default branch, PR checks enforced

## Pipeline Stage Quality Gates

| Stage | Gate | Block |
|-------|------|-------|
| Build | Compilation succeeds, no warnings (if strict) | HARD |
| Typecheck | `tsc --noEmit` passes (for TS projects) | HARD |
| Lint | Zero errors (warnings configurable) | HARD |
| Test | All tests pass, coverage >= threshold | HARD |
| Security | No critical/high CVEs (Snyk/Trivy/npm audit) | HARD |
| Deploy | Only from protected branches (main/release/*) | HARD |

## Secret Management

| Method | Security Level | Use When |
|--------|---------------|----------|
| OIDC (workload identity) | Highest | AWS, GCP, Azure — no long-lived credentials |
| Vault / external secret manager | High | Multi-cloud, rotation required |
| Platform secrets (GitHub/GitLab encrypted) | Medium | Single platform, acceptable for most cases |
| Plain environment variables | **NEVER** | Do not use for secrets |

## Caching Strategy

| Package Manager | Cache Key | Cache Path |
|-----------------|-----------|------------|
| npm | `package-lock.json` hash | `~/.npm` |
| pnpm | `pnpm-lock.yaml` hash | `~/.pnpm-store` |
| yarn | `yarn.lock` hash | `~/.yarn/cache` |
| pip | `requirements.txt` / `poetry.lock` hash | `~/.cache/pip` |
| cargo | `Cargo.lock` hash | `~/.cargo/registry`, `target/` |
| Docker | BuildKit layer cache | `type=gha,mode=max` |

## Branch Protection Rules

- Require PR reviews before merge (minimum 1 approval)
- Require status checks to pass (build + test + lint)
- Require up-to-date branch before merge
- No direct pushes to main/production
- Signed commits (recommended for regulated environments)

## Exit Criteria

- [ ] Pipeline runs green on default branch
- [ ] PR checks enforce build + typecheck + lint + test
- [ ] Caching configured (verify with second run timing improvement)
- [ ] Secrets via OIDC/vault (no plain env vars for credentials)
- [ ] Branch protection enabled on main/production
- [ ] Concurrency configured (cancel in-progress for PRs)
- [ ] Timeout configured (prevent hung jobs)
- [ ] Deploy stage restricted to protected branches only

## Tools

- `serena`: create_text_file, replace_content, execute_shell_command
- `context7`: GitHub Actions / GitLab CI / Jenkins docs
- See [github-actions.md](github-actions.md)
