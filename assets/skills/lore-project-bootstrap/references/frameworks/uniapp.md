# UniApp Conventions

## Platform Type
Cross-platform (WeChat/Alipay Mini Programs + H5 + App)

## Architecture
- Vue 3 Composition API + `<script setup>` + TypeScript
- Pinia for state management with `pinia-plugin-unistorage` for persistence
- Conditional compilation `#ifdef` / `#ifndef` for platform-specific code
- CLI-based project (not HBuilderX-dependent)

## File Organization
```
src/
  pages/                     # Page components (registered in pages.json)
    index/index.vue
    user/profile.vue
  components/                # Reusable components (easycom auto-import)
  composables/               # Vue composables (useAuth, useRequest, etc.)
  stores/                    # Pinia stores
  api/                       # API layer (uni.request wrapper)
  utils/                     # Pure utility functions
  static/                    # Static assets
  uni_modules/               # Third-party uni plugins
pages.json                   # Page routes + tabBar + window config
manifest.json                # App config per platform
```

## Cross-Platform Patterns
- `uni.` API over platform-specific APIs (`wx.`, `my.`)
- Conditional compilation only when uni API doesn't cover the gap
- rpx for responsive units (750rpx = screen width)
- Test on all target platforms — behavior diverges silently

## Page Lifecycle
- `onLoad(options)` for page params (NOT Vue `onMounted`)
- `onShow` / `onHide` for visibility
- `onPullDownRefresh` / `onReachBottom` for scroll interactions
- `onShareAppMessage` for WeChat sharing

## Navigation
- `uni.navigateTo` for push, `uni.navigateBack` for pop
- `uni.switchTab` for tabBar pages (cannot pass params)
- `EventChannel` for passing data back from child page
- Deep link params via `onLoad(options)`

## Performance
- SubPackages (`subPackages` in pages.json) to split bundle
- Lazy-load images, virtual scroll for long lists
- Avoid deep reactive nesting — flatten Pinia state
- `v-if` over `v-show` for conditional heavy components

## Testing
- Vitest for unit tests (composables, stores, utils)
- miniprogram-ci for automated builds
- Manual testing on real devices required for platform-specific features

## Required Permissions
```json
{
  "allow": [
    "Bash(npm run dev:*)",
    "Bash(npm run build:*)",
    "Bash(npx uni)",
    "Bash(npx tsc --noEmit)",
    "Bash(npx vitest)"
  ]
}
```

## CLAUDE.md Section Template

```markdown
## UniApp (Vue 3 + TypeScript)
- Vue 3 Composition API + <script setup>, Pinia for state
- Conditional compilation (#ifdef) only when uni.* API doesn't cover
- rpx units, pages.json for routes, manifest.json for platform config
- onLoad(options) for page params, EventChannel for return data
- SubPackages for bundle splitting, virtual scroll for long lists
- Vitest for unit tests, manual testing on real devices for platform-specific
```
