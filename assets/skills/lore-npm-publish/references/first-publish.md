# First Publish Guide

Publishing a package for the first time has unique requirements. This guide walks through every step.

## Step 1: Validate package.json

Check and fix these fields before first publish:

### Required

| Field | Check |
|-------|-------|
| `name` | Unique on npm. Check: `npm view <name>` should return 404. For scoped: `@scope/name`. |
| `version` | Should be `0.1.0` or `1.0.0`. `0.x.y` signals "not yet stable." |
| `main` / `module` / `exports` | At least one entry point defined. Verify the file exists. |
| `files` | Array of included files/dirs. Or use `.npmignore`. Without either, everything ships. |

### Recommended

| Field | Why |
|-------|-----|
| `description` | Shows in npm search |
| `keywords` | Improves discoverability |
| `license` | Legal clarity (default: ISC or MIT) |
| `repository` | Links to source code |
| `homepage` | Package landing page |
| `engines` | Declare Node.js version support |
| `type` | `"module"` for ESM, omit for CJS |

### Scoped Packages

Scoped packages (`@scope/name`) are private by default. To publish publicly:
- Set `"publishConfig": { "access": "public" }` in package.json, OR
- Use `npm publish --access public` on first publish

## Step 2: Verify Build Output

```bash
# Ensure build artifacts exist
npm run build  # or pnpm/yarn equivalent

# Verify entry points resolve
node -e "require('./dist/index.js')"  # CJS
node -e "import('./dist/index.mjs')"  # ESM
```

## Step 3: Check .npmignore / files

Run `npm pack --dry-run` and review:
- Source maps included? (usually not for production)
- Tests excluded?
- Dev configs excluded? (.eslintrc, tsconfig, jest.config, etc.)
- README.md included? (auto-included by npm)
- LICENSE included? (auto-included by npm)

## Step 4: Registry Auth

```bash
# Check if logged in
npm whoami

# If not, login
npm login
# For scoped registry: npm login --registry=https://npm.pkg.github.com --scope=@your-scope
```

## Step 5: Dry Run

```bash
npm publish --dry-run
# Check: version, files list, tarball size
```

## Step 6: Publish

```bash
# Unscoped package
npm publish

# Scoped package (public)
npm publish --access public
```

## Step 7: Post-publish

```bash
# Verify
npm view <pkg-name> version

# Tag in git
git tag -a v<version> -m "v<version>"
git push --tags
```

## Common First-publish Mistakes

| Mistake | Fix |
|---------|-----|
| Name already taken | Use scoped name `@scope/name` or pick different name |
| Publishing src instead of dist | Add `"files": ["dist"]` to package.json |
| Missing types for TS package | Add `"types": "dist/index.d.ts"` and ensure it's built |
| Forgot `--access public` for scoped pkg | Republish with `--access public` or add publishConfig |
| No README | Create README.md — it shows on the npm package page |
| Huge tarball | Check `npm pack --dry-run` output; add files field to limit |
