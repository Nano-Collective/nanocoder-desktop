# UI foundations

Implementation notes for U.0 and U.1 from [work list #17](https://github.com/Nano-Collective/nanocoder-desktop/issues/17).

- Status: Draft
- Last updated: 2026-10-29

Visual decisions remain in [`DESIGN.md`](../DESIGN.md), which is not changed by the implementation. The foundations style the technical-gate renderer, now composed inside the [U.2 app shell](app-shell.md).

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

For a fake-fixture-only visual check:

1. Run `pnpm build`, then `pnpm qa:launch`. Note the printed launcher PID.
2. Run `agent-browser connect 9333`. On Factory hosts, pass `--cdp 9333` on every later command too, so it does not select the Factory pane.
3. Run `agent-browser --cdp 9333 set viewport 1240 900` (repeat at 1020 and 840).
4. Use `agent-browser --cdp 9333 eval "document.documentElement.dataset.theme = 'light'"` to switch themes. Wait for both the target background and every descendant colour transition to finish with `agent-browser --cdp 9333 wait --fn "getComputedStyle(document.documentElement).backgroundColor === 'rgb(246, 246, 249)' && document.getAnimations().filter(animation => animation instanceof CSSTransition).every(animation => animation.playState === 'finished')"`. Dark's target background is `rgb(22, 22, 24)`. The background check alone is not enough: child controls can still be transitioning.
5. Press `Tab` from the initial screen to focus `open a project folder`. Press `Enter` to use the stubbed folder picker and trust confirmation, then `Tab` to focus `message`. Enter synthetic text, then `Tab` to focus `send`. Send it to show the approval card, whose `Allow` and `Deny` labels come unchanged from fake Nanocoder.
6. Run `agent-browser --cdp 9333 a11y`. Save screenshots under `.qa/` only, and stop the printed launcher PID with `kill -TERM <pid>`.

There are 200ms colour transitions. Playwright uses `page.emulateMedia({reducedMotion: 'reduce'})` to verify that transitions are instant and spinner, cursor and approval-pulse animations stop. It also checks keyboard focus, both themes, local font loading and the three widths. Tests wait for conditions rather than fixed delays.

## Shared parts

`source/renderer/ui.tsx` provides native buttons, status badges, cards and dividers. Controls keep native names, roles and disabled states. State glyphs sit beside words and are hidden from assistive technology only to avoid duplicate announcements. Global `:focus-visible` styles apply to keyboard controls.

The turn badge uses received turn updates and prompt results. The app-shell ACP badge now consumes phase 1.3 supervisor state, never the historical connect result, to avoid claiming that an exited child is ready. See [app-shell status](app-shell.md#acp-status).

The button has an optional key-hint slot, but no technical-gate control uses it. The prescribed 55% hint opacity creates an unlisted contrast gap in light mode. It needs the designer's decision before use. Hiding text from assistive technology does not exempt it from contrast checks. The rendered-text e2e audit deliberately inserts such a hint and proves it is caught. Do not enable hints without extending the pairing inventory and passing that audit.

Contrast tests compute WCAG ratios from the design tokens for every pairing used here. The only exceptions come from `DESIGN.md`'s known-gaps table, with its measured ratios checked too. E2e also checks actual visible text, including text marked `aria-hidden`, in both themes. Running and failed light badges use their explicit panel-background tokens. The used known gaps are light allow buttons and running badges, light approval titles, and failure banners in both themes. These exceptions still need fixing before public release.

## Font and notices

Fira Code 400 comes from the lockfile-pinned `@fontsource/fira-code` package. Vite copies its local font assets into `out/renderer/assets/`, and the existing `app://renderer` protocol serves them with the renderer. Renderer `assetsInlineLimit: 0` prevents small font subsets becoming `data:` URLs that the CSP would refuse. The existing `font-src 'self'` CSP is unchanged; unit and built-app tests prove remote fonts are refused. Prose permits ligatures, while code, diffs and terminals disable them.

[`THIRD-PARTY-NOTICES.txt`](../THIRD-PARTY-NOTICES.txt) contains the upstream copyright and full SIL OFL 1.1 text. Packaging includes the notice and all built renderer assets (`REL-06`). This is the first bundled-font notice, not a claim that the later complete dependency-notices work in phase 4.3 is finished.

## Proposed Markdown renderer

Proposed, not yet approved (`DEC-39`): use `react-markdown` in U.4 with raw HTML disabled and no remote resources. Do not enable `rehype-raw`, `dangerouslySetInnerHTML`, remote images, or automatic navigation from agent-supplied URLs. Link actions must follow the main-owned external-link policy. U.0/U.1 added no Markdown dependency or rendering code. The later phase 1.6 prototype now isolates version 10.1.0 in swappable `AgentMarkdown`, adds no plugins and renders every link as inert text. See [streaming conversation](streaming-conversation.md) for its refusal tests, licence notices and boundaries. `DEC-39` remains proposed.

## Scope of accessibility checks

This branch supports the foundations of `A11Y-01` to `A11Y-03` and preserves the technical gate. It does not claim complete permission-focus management, throttled stream announcements, or platform screen-reader acceptance. Those remain with U.4/U.6 and milestone hardening.
