# Drivers — non-web targets

The seven phases, persona-blind rule, rubric, coverage matrix, UIUX audit, and verdict logic are platform-independent. Only the EXECUTE driver and the mechanical layer change. Pick by target:

| Target | Semantic driver (EXECUTE) | Mechanical layer (PERSIST) |
|--------|---------------------------|----------------------------|
| Web (default) | `agent-browser` | Playwright |
| Android / iOS app | `maestro` MCP (tap_on / input_text / take_screenshot) or `mobile-mcp` | Maestro flow files (`run_flow_files`) — YAML flows are the compiled artifact |
| WeChat miniprogram | `weapp-dev` MCP (`mp_ensureConnection` first, then `element_tap` / `element_input` / `mp_screenshot`) | miniprogram-automator scripts |
| Tauri desktop | `tauri-mcp-server` (`webview_interact` / `webview_screenshot` / `webview_dom_snapshot`) | Playwright against the webview where wiring exists; otherwise keep journeys agent-only |

Adaptation notes:

- **Evidence standard is unchanged** — numbered step log + per-step screenshots + in-character outcome, whatever the screenshot tool is called.
- **Persona-blind is unchanged** — on mobile, "do not guess deep links" becomes "do not launch hidden activities / scheme URLs the persona wouldn't have".
- **Session persistence** for abandon-and-return: use the platform's real backgrounding (`stop_app` / relaunch) rather than just navigating away.
- **Outcome oracles**: `api` oracles work identically everywhere; `artifact` oracles may need platform file access (e.g. `mobile_save_screenshot`, app sandbox pulls).
- If the target platform has no mechanical layer available, PERSIST still commits the Journey Ledger — the ledger, not the compiled suite, is the primary durable asset.
