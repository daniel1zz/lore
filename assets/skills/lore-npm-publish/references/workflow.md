# Release Workflow — Step by Step

## Step 1: Gather Context

```bash
# Detect package manager
PM=$([ -f pnpm-lock.yaml ] && echo pnpm || ([ -f yarn.lock ] && echo yarn || echo npm))

# Read package info
cat package.json | jq '{name, version, publishConfig, files, main, module, exports, scripts: (.scripts | keys)}'

# Check git state
git status --porcelain
git branch --show-current
git log --oneline $(git describe --tags --abbrev=0 2>/dev/null || echo "HEAD~20")..HEAD
```

Capture: package name, current version, package manager, current branch, commits since last tag.

## Step 2: Pre-flight Checks

Run each check. Report results as a checklist. Stop at first failure.

```bash
# 1. Clean working tree
[ -z "$(git status --porcelain)" ] || echo "FAIL: dirty working tree"

# 2. Auth check
npm whoami --registry $(node -e "console.log(require('./package.json').publishConfig?.registry || 'https://registry.npmjs.org/')")

# 3. package.json validation
node -e "
const pkg = require('./package.json');
const required = ['name', 'version'];
const recommended = ['description', 'license', 'repository', 'keywords'];
const entryPoints = ['main', 'module', 'exports'];
const missing = required.filter(f => !pkg[f]);
const missingRec = recommended.filter(f => !pkg[f]);
const hasEntry = entryPoints.some(f => pkg[f]);
if (missing.length) console.log('FAIL: missing required:', missing.join(', '));
if (!hasEntry) console.log('WARN: no entry point (main/module/exports)');
if (!pkg.files && !require('fs').existsSync('.npmignore')) console.log('WARN: no files field or .npmignore — entire directory will be published');
if (missingRec.length) console.log('WARN: missing recommended fields:', missingRec.join(', '));
"

# 4. Build
npm run build --if-present 2>&1

# 5. Tests
npm test 2>&1

# 6. Lint
npm run lint --if-present 2>&1

# 7. Pack audit
$PM pack --dry-run 2>&1
```

### Pack Audit — What to Check

Review the `npm pack --dry-run` output for:
- **Secrets**: .env, .env.*, credentials.*, *secret*, *.pem, *.key
- **Dev artifacts**: node_modules/, .git/, coverage/, .nyc_output/, *.test.*, __tests__/
- **Unnecessary files**: .DS_Store, *.log, .vscode/, .idea/, dist/*.map (unless intentional)
- **Missing files**: README.md, LICENSE, dist/ or lib/ (built output)

If suspicious files are included, warn the user and suggest adding them to `files` in package.json or `.npmignore`.

## Step 3: Determine Version

### From Conventional Commits

```bash
# Get commits since last tag
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null)
if [ -n "$LAST_TAG" ]; then
  COMMITS=$(git log --format="%s" "$LAST_TAG"..HEAD)
else
  COMMITS=$(git log --format="%s")
fi
```

Parse each commit:
- `BREAKING CHANGE:` in body or `!` after type → **major**
- `feat` type → **minor**  
- `fix`, `perf`, `refactor`, `docs`, `style`, `chore`, `test`, `build`, `ci` → **patch**

Take the highest bump level found. If no conventional commits, ask user.

Calculate next version:
```
current: 1.2.3
commits indicate: minor
next: 1.3.0
```

Present to user:
```
Current version: 1.2.3
Commits since v1.2.3: 12
  - 3 feat (minor)
  - 7 fix (patch)
  - 2 chore (patch)
Recommended bump: minor → 1.3.0

Proceed with 1.3.0? (or specify a different version)
```

## Step 4: Generate Changelog

Parse conventional commits and group by type:

```markdown
## [1.3.0] (2025-01-15)

### Features
- add user profile page ([abc1234](commit-url))
- support dark mode toggle ([def5678](commit-url))

### Bug Fixes
- fix login redirect loop ([111aaaa](commit-url))
- correct date formatting in reports ([222bbbb](commit-url))
```

If CHANGELOG.md exists, prepend the new section after the title line.
If not, create with header `# Changelog` followed by the new section.

## Step 5: Bump, Commit, Tag, Publish, Push

This is the critical section. Confirm with user before proceeding.

```bash
PM=<detected package manager>
PKG_NAME=<package name>
VERSION=<target version>

# Bump version (updates package.json and lockfile)
$PM version $VERSION --no-git-tag-version

# Stage changes
git add package.json CHANGELOG.md
# Also stage lockfile if it changed
git add pnpm-lock.yaml package-lock.json yarn.lock 2>/dev/null

# Commit
git commit -m "chore(release): v$VERSION"

# Tag
git tag -a "v$VERSION" -m "v$VERSION"

# Publish
$PM publish --access public  # for scoped packages; omit --access for unscoped

# Push
git push && git push --tags
```

For **pnpm**: use `pnpm publish --no-git-checks` if git state is already verified.
For **yarn**: use `yarn npm publish` (Yarn Berry) or `yarn publish` (Yarn Classic).

## Step 6: Post-publish Verification

```bash
# Confirm published
npm view $PKG_NAME@$VERSION version

# Show registry URL
echo "https://www.npmjs.com/package/$PKG_NAME/v/$VERSION"
```

Report to user:
```
✓ Published <pkg>@<version>
✓ Tagged v<version>
✓ Pushed to <remote>/<branch>
Registry: https://www.npmjs.com/package/<pkg>/v/<version>
```

---

## Dry-run Mode

Execute the full workflow but replace destructive steps with simulations:

| Step | Normal | Dry-run |
|------|--------|---------|
| Pre-flight checks | Run all | Run all |
| Version calculation | Calculate | Calculate + display |
| Changelog | Write to file | Display in terminal only |
| Version bump | `npm version` | Display what would change |
| Commit + tag | `git commit` + `git tag` | Display commit message + tag name |
| Publish | `npm publish` | `npm publish --dry-run` |
| Push | `git push` | Skip |

At the end of dry-run, summarize everything that would happen.
