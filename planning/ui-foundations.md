# UI foundations

Implementation notes for U.0 and U.1 from [work list #17](https://github.com/Nano-Collective/nanocoder-desktop/issues/17).

- Status: Draft
- Last updated: 2026-10-31

Visual decisions remain in [`DESIGN.md`](../DESIGN.md). The user approved revision 4 as designer on 31 October 2026 (`DEC-40`), including its token and local-logo update. The foundations style the technical-gate renderer, now composed inside the [U.2 app shell](app-shell.md).

## Token pipeline

Run `pnpm tokens:generate` after an approved token change. `scripts/generate-design-tokens.mjs` parses the YAML front matter with `yaml`, validates light colour partners and references, and writes `source/renderer/styles/tokens.css` through the repository's Biome formatter. The CSS is committed. AVA compares the generated output byte for byte, so `pnpm test:all` fails on drift.

Colours, typography, radii, spacing and component references become plain CSS custom properties. Component references point at base colour variables, so changing the theme also changes shared parts. There is no CSS framework.

## Themes and QA

Dark is the default, independent of the system preference. The single theme switch is `data-theme` on the document root:

```js
document.documentElement.dataset.theme = 'light';
document.documentElement.dataset.theme = 'dark';
```

No main-process test hook or IPC is needed. The switch is transient, and reload returns to dark. Persistent theme settings belong to the later settings UI.

For fake-fixture-only visual QA, use the hidden Electron wrapper in `e2e/qa/electron.ts`, temporary profiles and both themes at 1240, 1020 and 840px. Capture under `.qa/`, never real content. Port 9333 is not needed. Routine checks never take native focus or show a Dock icon.

Theme changes are instant, so text and selected backgrounds change together. Reduced motion also stops spinner, cursor and approval pulse. The official coloured logo is bundled under `source/renderer/assets/`, unchanged, and loaded through the same local resource policy as fonts.

## Shared parts

`source/renderer/ui.tsx` provides native buttons, status badges, cards and dividers. Controls keep native names, roles and disabled states. State glyphs sit beside words and are hidden from assistive technology only to avoid duplicate announcements. Global `:focus-visible` styles apply to keyboard controls.

The turn badge uses received turn updates and prompt results. The app-shell ACP badge now consumes phase 1.3 supervisor state, never the historical connect result, to avoid claiming that an exited child is ready. See [app-shell status](app-shell.md#acp-status).

The button has an optional key-hint slot using full-opacity muted ink. The old 55% style is retired. A deliberately faded test fixture still proves that rendered low-contrast text is detected even when marked `aria-hidden`.

Contrast tests compute WCAG ratios for used token pairs and actual visible text in both themes. `DEC-40` retires the twelve original design exceptions: all approved M1 pairings now pass AA without a waiver. Future surfaces must extend the inventory and pass the same gate.

## Font and notices

Fira Code 400 comes from the lockfile-pinned `@fontsource/fira-code` package. Vite copies its local font assets into `out/renderer/assets/`, and the existing `app://renderer` protocol serves them with the renderer. Renderer `assetsInlineLimit: 0` prevents small font subsets becoming `data:` URLs that the CSP would refuse. The existing `font-src 'self'` CSP is unchanged; unit and built-app tests prove remote fonts are refused. Prose permits ligatures, while code, diffs and terminals disable them.

[`THIRD-PARTY-NOTICES.txt`](../THIRD-PARTY-NOTICES.txt) contains the upstream copyright and full SIL OFL 1.1 text. Packaging includes the notice and all built renderer assets (`REL-06`). This is the first bundled-font notice, not a claim that the later complete dependency-notices work in phase 4.3 is finished.

## Proposed Markdown renderer

Proposed, not yet approved (`DEC-39`): use `react-markdown` in U.4 with raw HTML disabled and no remote resources. Do not enable `rehype-raw`, `dangerouslySetInnerHTML`, remote images, or automatic navigation from agent-supplied URLs. Link actions must follow the main-owned external-link policy. U.0/U.1 added no Markdown dependency or rendering code. The later phase 1.6 prototype now isolates version 10.1.0 in swappable `AgentMarkdown`, adds `remark-gfm` 4.0.1 as its only plugin for GFM tables, strikethrough, disabled task checkboxes and autolinks, and renders every link as inert text. See [streaming conversation](streaming-conversation.md) for its refusal tests, licence notices and boundaries. `DEC-39` remains proposed.

## Scope of accessibility checks

This branch supports the foundations of `A11Y-01` to `A11Y-03` and preserves the technical gate. It does not claim complete permission-focus management, throttled stream announcements, or platform screen-reader acceptance. Those remain with U.4/U.6 and milestone hardening.
