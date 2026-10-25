---
version: alpha
name: Nanocoder Desktop
description: Dense, monospace, terminal-native workspace around Nanocoder. Neutral hue-240 chassis, hairline strokes, one blue accent, dark first.
colors:
  primary: "#459bf7"
  primary-soft: "#232f3e"
  surface: "#161618"
  surface-panel: "#1d1d20"
  surface-elevated: "#242429"
  on-surface: "#e6e6ea"
  on-surface-muted: "#9797a5"
  stroke: "#e6e6ea14"
  stroke-soft: "#e6e6ea0d"
  success: "#5eba7d"
  error: "#e25a68"
  warning: "#dda73c"
  skill: "#e8c547"
  mention: "#38bdf8"
  heading: "#f9a8c9"
  diff-add: "#202d26"
  diff-del: "#332023"
  primary-light: "#0000ee"
  primary-soft-light: "#dadaf2"
  surface-light: "#f6f6f9"
  surface-panel-light: "#ededf2"
  surface-elevated-light: "#e5e5eb"
  on-surface-light: "#1b2132"
  on-surface-muted-light: "#5c6170"
  stroke-light: "#1b21321a"
  stroke-soft-light: "#1b21320f"
  success-light: "#1a7f37"
  error-light: "#cf222e"
  warning-light: "#9a6700"
  skill-light: "#a07c10"
  mention-light: "#0284c7"
  heading-light: "#be185d"
  diff-add-light: "#dce8e2"
  diff-del-light: "#f1dde1"
typography:
  body-md:
    fontFamily: Fira Code
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.55
  body-sm:
    fontFamily: Fira Code
    fontSize: 11.5px
    fontWeight: 400
    lineHeight: 1.55
  tab:
    fontFamily: Fira Code
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.55
  code-sm:
    fontFamily: Fira Code
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.5
  meta:
    fontFamily: Fira Code
    fontSize: 10.5px
    fontWeight: 400
    lineHeight: 1.5
  caption:
    fontFamily: Fira Code
    fontSize: 10px
    fontWeight: 400
    lineHeight: 1.5
  label-section:
    fontFamily: Fira Code
    fontSize: 9.5px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0.12em
  label-inline:
    fontFamily: Fira Code
    fontSize: 9.5px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0.1em
rounded:
  none: 0px
  sm: 4px
  md: 6px
  lg: 8px
  xl: 10px
  full: 9999px
spacing:
  xxs: 2px
  xs: 4px
  sm: 6px
  md: 8px
  lg: 10px
  xl: 14px
  xxl: 18px
  rail-width: 190px
  inspector-width: 240px
  bottom-panel-height: 164px
  stream-padding: 18px
  width-wide: 1240px
  width-mid: 1020px
  width-narrow: 840px
components:
  window:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
    rounded: "{rounded.xl}"
  title-bar:
    backgroundColor: "{colors.surface-panel}"
    textColor: "{colors.on-surface-muted}"
    typography: "{typography.tab}"
  session-tab:
    textColor: "{colors.on-surface-muted}"
    typography: "{typography.tab}"
    rounded: "{rounded.md}"
  session-tab-active:
    backgroundColor: "{colors.surface-elevated}"
    textColor: "{colors.on-surface}"
  status-badge:
    textColor: "{colors.on-surface-muted}"
    typography: "{typography.caption}"
    rounded: "{rounded.full}"
  status-badge-running:
    textColor: "{colors.success}"
  status-badge-approval:
    textColor: "{colors.warning}"
  status-badge-failed:
    textColor: "{colors.error}"
  project-rail:
    backgroundColor: "{colors.surface-panel}"
    textColor: "{colors.on-surface-muted}"
    width: "{spacing.rail-width}"
  rail-heading:
    textColor: "{colors.on-surface-muted}"
    typography: "{typography.label-section}"
  rail-item-active:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.on-surface}"
  message-user:
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
  message-agent:
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
  message-author:
    textColor: "{colors.on-surface-muted}"
    typography: "{typography.label-inline}"
  reasoning:
    textColor: "{colors.on-surface-muted}"
    typography: "{typography.body-sm}"
  tool-row:
    textColor: "{colors.on-surface-muted}"
    typography: "{typography.body-sm}"
  subagent-card:
    backgroundColor: "{colors.surface-panel}"
    textColor: "{colors.on-surface-muted}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.lg}"
  approval-card:
    backgroundColor: "{colors.surface-elevated}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.lg}"
  approval-card-title:
    textColor: "{colors.warning}"
    typography: "{typography.label-inline}"
  failure-banner:
    textColor: "{colors.error}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.lg}"
  view-only-notice:
    textColor: "{colors.on-surface-muted}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.lg}"
  composer:
    backgroundColor: "{colors.surface-panel}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.xl}"
    padding: 10px
  composer-pill:
    textColor: "{colors.on-surface-muted}"
    typography: "{typography.caption}"
    rounded: "{rounded.full}"
  composer-pill-mode:
    textColor: "{colors.primary}"
  context-gauge:
    backgroundColor: "{colors.primary}"
    height: 2px
  button:
    backgroundColor: "{colors.surface-panel}"
    textColor: "{colors.on-surface}"
    typography: "{typography.meta}"
    rounded: "{rounded.md}"
  button-allow:
    textColor: "{colors.success}"
  button-reject:
    textColor: "{colors.error}"
  inspector:
    backgroundColor: "{colors.surface-panel}"
    width: "{spacing.inspector-width}"
  inspector-tab:
    textColor: "{colors.on-surface-muted}"
    typography: "{typography.label-inline}"
    rounded: "{rounded.md}"
  inspector-tab-active:
    backgroundColor: "{colors.surface-elevated}"
    textColor: "{colors.on-surface}"
  touched-chip:
    textColor: "{colors.primary}"
    rounded: "{rounded.sm}"
  diff:
    typography: "{typography.code-sm}"
    rounded: "{rounded.lg}"
  diff-line-add:
    backgroundColor: "{colors.diff-add}"
    textColor: "{colors.success}"
  diff-line-del:
    backgroundColor: "{colors.diff-del}"
    textColor: "{colors.error}"
  diff-hunk:
    backgroundColor: "{colors.surface-panel}"
    textColor: "{colors.mention}"
  bottom-panel:
    backgroundColor: "{colors.surface-elevated}"
    height: "{spacing.bottom-panel-height}"
  terminal:
    textColor: "{colors.on-surface}"
    typography: "{typography.body-sm}"
  browser-address:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.md}"
  browser-viewport:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
  command-palette:
    backgroundColor: "{colors.surface-elevated}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.xl}"
    width: 520px
  palette-row-selected:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.on-surface}"
  toast:
    backgroundColor: "{colors.surface-elevated}"
    textColor: "{colors.on-surface}"
    typography: "{typography.tab}"
    rounded: "{rounded.lg}"
  divider:
    backgroundColor: "{colors.stroke}"
    height: 1px
  divider-soft:
    backgroundColor: "{colors.stroke-soft}"
    height: 1px
  skill-name:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.skill}"
  markdown-heading:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.heading}"
  window-light:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.on-surface-light}"
  panel-light:
    backgroundColor: "{colors.surface-panel-light}"
    textColor: "{colors.on-surface-muted-light}"
  elevated-light:
    backgroundColor: "{colors.surface-elevated-light}"
    textColor: "{colors.on-surface-muted-light}"
  divider-light:
    backgroundColor: "{colors.stroke-light}"
    height: 1px
  divider-soft-light:
    backgroundColor: "{colors.stroke-soft-light}"
    height: 1px
  rail-item-active-light:
    backgroundColor: "{colors.primary-soft-light}"
    textColor: "{colors.on-surface-light}"
  composer-pill-mode-light:
    backgroundColor: "{colors.surface-panel-light}"
    textColor: "{colors.primary-light}"
  status-badge-running-light:
    backgroundColor: "{colors.surface-panel-light}"
    textColor: "{colors.success-light}"
  status-badge-failed-light:
    backgroundColor: "{colors.surface-panel-light}"
    textColor: "{colors.error-light}"
  approval-card-title-light:
    backgroundColor: "{colors.surface-elevated-light}"
    textColor: "{colors.warning-light}"
  skill-name-light:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.skill-light}"
  mention-light:
    backgroundColor: "{colors.surface-panel-light}"
    textColor: "{colors.mention-light}"
  markdown-heading-light:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.heading-light}"
  diff-line-add-light:
    backgroundColor: "{colors.diff-add-light}"
    textColor: "{colors.success-light}"
  diff-line-del-light:
    backgroundColor: "{colors.diff-del-light}"
    textColor: "{colors.error-light}"
---

# Nanocoder Desktop design

How Nanocoder Desktop looks. Behaviour, states, data, keyboard access and accessibility rules live in [`planning/`](../planning/index.md); this file only says how they are drawn.

- Status: Draft
- Last updated: 2026-10-26
- Source: the [design sheet mockup][mockup] (version 12, 27 September 2026), which renders seven scenarios at three widths in both themes.
- Format: the [DESIGN.md format][spec] (version `alpha`). Tokens live in the YAML front matter; the prose says how to use them. Section headings follow the format's fixed names, so they keep its American spelling ("Colors"). The prose uses British spelling.

The tokens are normative. Where the prose and a token disagree, the token wins and the prose should be fixed.

## Overview

Nanocoder Desktop is a workspace for handing a task to an agent and reviewing the result, not an editor. The look follows from that and from Nanocoder's terminal roots.

- **Terminal-native.** Every surface is set in one monospace face. Icons are text glyphs, not an icon font. The window should feel like a well-organised terminal session, not a web dashboard.
- **Dense and calm.** Small type, tight rows and hairline strokes, so a long turn with many tool calls fits on screen. Colour is rare and always means something.
- **One accent.** Blue marks the active thing: the selected thread, the running turn, the current mode, focus. Green, red and amber are reserved for result states.
- **Dark first.** Dark is the default theme. Light is a full theme, not an afterthought, and every token has a light pair.
- **Honest states.** Running, waiting for approval, failed and view-only each look different at a glance, in both the rail and the title bar.

The chassis is the "monocode" language named in the mockup: a neutral hue-240 grey ramp with no saturation in the surfaces. The accent comes from the Nano Collective brand: CLI blue (`#3b82f6`) shifted lighter for dark backgrounds, and the docs site link blue (`#0000ee`) in light.

## Colors

Three tonal surfaces, two ink levels, one accent, three result colours and three syntax colours. Dark tokens have no suffix; each light token has the same name with `-light`. Soft fills are stored as solid colours (the mockup's translucent value composited over its usual surface) so contrast can be checked; strokes stay translucent because they never sit behind text.

| Role | Dark | Light | Used for |
|---|---|---|---|
| `surface` | `#161618` (hsl 240 6% 9%) | `#f6f6f9` (hsl 240 20% 97%) | Window background, chat stream, browser viewport. |
| `surface-panel` | `#1d1d20` (hsl 240 6% 12%) | `#ededf2` (hsl 240 16% 94%) | Title bar, project rail, inspector, composer, cards. |
| `surface-elevated` | `#242429` (hsl 240 6% 15%) | `#e5e5eb` (hsl 240 14% 91%) | Active tab, approval card, bottom panel, palette, toast. |
| `on-surface` | `#e6e6ea` (hsl 240 10% 91%) | `#1b2132` (hsl 225 30% 15%) | Primary text. |
| `on-surface-muted` | `#9797a5` (hsl 240 7% 62%) | `#5c6170` (hsl 225 10% 40%) | Secondary text, labels, inactive items. |
| `stroke` | ink at 8% | ink at 10% | Every border and divider. |
| `stroke-soft` | ink at 5% | ink at 6% | Row dividers inside cards and lists. |
| `primary` | `#459bf7` (hsl 211 92% 62%) | `#0000ee` | The accent. See below. |
| `primary-soft` | `#232f3e` (accent at 14% over panel) | `#dadaf2` (accent at 8% over panel) | Selected rail item, selected palette row. |
| `success` | `#5eba7d` | `#1a7f37` | Completed tool rows, allow buttons, added lines, `acp · ready`. |
| `error` | `#e25a68` | `#cf222e` | Failures, reject buttons, removed lines, cancel. |
| `warning` | `#dda73c` | `#9a6700` | Approval required, modified files, pending browser actions. |
| `skill` | `#e8c547` | `#a07c10` | Skill names in the stream and composer. |
| `mention` | `#38bdf8` | `#0284c7` | `@` mentions, URLs in the terminal, diff hunk headers. |
| `heading` | `#f9a8c9` | `#be185d` | Markdown headings in agent messages. |
| `diff-add`, `diff-del` | `#202d26`, `#332023` (14% over surface) | `#dce8e2`, `#f1dde1` (12% over surface) | Diff line backgrounds. |

Rules for the accent:

- Use `primary` for at most one "you are here" signal per region: the active thread, the active tab underline, the current mode pill, the focused composer border, the send button.
- A running state uses `primary` in the rail and stream (`●`, spinner) and `success` in the title bar badge.
- Never use `primary` for a destructive or approval action.

Result colours are always paired with a glyph (`✓`, `✕`, `▲`), so state never depends on colour alone.

Every text pairing must meet WCAG 2.2 AA (4.5:1 for normal text). Small sizes make this strict: `on-surface-muted` is the lightest ink allowed for text, and `stroke` is never used as a text colour.

Known contrast gaps. These are the mockup's values and they fall short of AA. Fix them before the first public release; the linter reports each one.

| Pairing | Theme | Ratio |
|---|---|---|
| `mention` on `surface-panel` | light | 3.51:1 |
| `skill` on `surface` | light | 3.62:1 |
| `warning` on `surface-elevated` (approval card title) | light | 3.88:1 |
| `success` on `diff-add` | light | 4.03:1 |
| `error` on `diff-del` | light | 4.12:1 |
| `error` on `diff-del` | dark | 4.30:1 |
| `success` on `surface-panel` | light | 4.35:1 |

## Typography

One family: **Fira Code**, with Consolas, Menlo and the system monospace as fallbacks. Weight is 400 throughout; hierarchy comes from size, colour, case and letter spacing, not bold. Ligatures are allowed in prose and off in diffs and the terminal, so code reads exactly as written.

| Token | Size | Used for |
|---|---|---|
| `body-md` | 12px, line height 1.55 | Messages, the composer, the default for the window. |
| `body-sm` | 11.5px | Tool rows, reasoning, file tree, cards, banners, terminal. |
| `tab` | 11px | Session tabs, the title bar, the browser bar, toasts. |
| `code-sm` | 11px, line height 1.5 | Diffs. |
| `meta` | 10.5px | Buttons, expanded tool detail, approval notes. |
| `caption` | 10px | Badges, composer pills, hints, token counts. |
| `label-section` | 9.5px, uppercase, 0.12em tracking | Rail and inspector section headings ("history · today", "working tree"). |
| `label-inline` | 9.5px, uppercase, 0.1em tracking | Message authors, approval card titles, inspector tabs. |

Reasoning text is italic. Nothing else is.

UI copy is lowercase, as in the Nanocoder CLI ("ask anything…", "approval required"). Paths, commands and model names keep their real case. The middle dot (`·`) separates facts on one line, for example `read src/auth/login.ts · +18 −6`.

The font ships inside the app. It is never loaded from a font CDN, since the app is local-first and its content security policy blocks remote fonts.

## Layout

A fixed desktop grid with three columns over an optional bottom panel, under a title bar.

```text
┌──────────────────────────────────────────────────────────────┐
│ title bar: session tabs · turn badge · acp badge · ⌘K       │
├────────────┬──────────────────────────────┬──────────────────┤
│ project    │ stream                       │ inspector        │
│ rail       │                              │ files | preview  │
│ 190px      │ flexible                     │ 240px            │
│            │ composer                     │                  │
├────────────┴──────────────────────────────┴──────────────────┤
│ bottom panel: terminal (164px, shown only when open)         │
└──────────────────────────────────────────────────────────────┘
```

- **Title bar.** Session tabs on the left (tabs are threads), then the turn state badge, the ACP process badge and the palette shortcut on the right.
- **Project rail.** The project and branch, then threads grouped by "today", "earlier" and "archived". A footer shows the Nanocoder version, provider health and settings.
- **Stream.** The conversation, with the composer pinned to the bottom. The composer has a control rail below the input for model, mode and context use.
- **Inspector.** Two tabs: "files" (tree, or the review list after a turn) and "preview" (the browser).
- **Bottom panel.** The terminal. It spans all three columns and is hidden when closed.

Widths tested in the mockup: 1240px, 1020px and 840px. At 840px and below, the inspector is hidden and its content opens on demand. The stream column never drops below a readable line length.

Spacing uses a small scale (`xxs` 2px to `xxl` 18px) because the type is small. Common values: 5px rows in the rail and lists, 9px between stream items, 16px by 18px stream padding, 10px by 14px composer padding.

## Elevation & Depth

Flat. Depth comes from the three tonal surfaces and hairline strokes, not shadows.

- `surface` is the floor. `surface-panel` holds chrome and cards. `surface-elevated` marks what is in front: the active tab, the approval card, the bottom panel and overlays.
- Every edge is a 1px `stroke`. Row dividers inside a card use `stroke-soft`.
- Only overlays cast a shadow: the command palette and shortcut sheet use `0 18px 48px` black at 35%, over a scrim of `surface` at 55%.
- Dashed strokes mean "not live": the new-tab button, the view-only notice, the context pill, review comments, the "touched this turn" strip.

## Shapes

Soft but small radii, scaled with the size of the element.

| Token | Radius | Used for |
|---|---|---|
| `sm` | 4px | Inline chips ("turn", subagent depth). |
| `md` | 6px | Tabs, buttons, the browser address field. |
| `lg` | 8px | Cards: subagent, approval, failure, view-only, diff, toast. |
| `xl` | 10px | The window, the composer, the command palette. |
| `full` | 9999px | Badges, composer pills, token chips. |

Left rules are part of the shape language: a 2px `primary` rule marks a user message and the selected rail item; a 1px dashed rule marks reasoning; a 1px `stroke` rule groups the tool rows of one turn.

## Components

Token values are in the front matter under `components`. This section covers what the tokens cannot say. Behaviour for each component is in the planning feature files.

### Title bar and status badges

- Session tabs show the thread title with `×` to close; the active tab sits on `surface-elevated` with a `stroke` border.
- Turn badge: `● running` (success), `◐ approval` (warning), `○ idle` (muted), `✕ failed` (error).
- ACP badge: `acp · ready` (success) or `acp · exited (1)` (muted). Badges are outlined pills; the outline takes the text colour.

### Project rail

- Each thread row starts with its state glyph: `●` running in `primary`, `◐` waiting in `warning`, `○` ready, `░` archived.
- The selected row has a `primary-soft` fill and a 2px `primary` left rule.

### Stream items

- **User message:** 2px `primary` left rule, author label "you · 14:02".
- **Agent message:** author label "✱ nanocoder · 14:03" in `primary`, a token chip (`+0.9k tok`) and a blinking `▌` cursor while streaming.
- **Reasoning:** `◌` glyph, italic, muted, dashed left rule, elapsed time at the end.
- **Tool row:** status glyph, tool name in `on-surface`, target in muted. Expandable rows show `▸` and reveal `meta`-size detail.
- **Subagent card:** `surface-panel` card with a header row (task, depth chip such as `depth 1/2`, state, elapsed, `✕` cancel in `error`) and indented child rows starting with `└`.
- **Approval card:** `warning` border, a slow pulse ring, title "▲ approval required · protected tool · normal mode", the command, a one-line effect note, then "allow once", "always for project" and "reject" buttons with their keys.
- **Failure banner:** `error` border and text, with "restart" and "resume" buttons on the right.
- **View-only notice:** dashed border, muted text, with "recover" and "open location" actions.

### Composer

- `›` prompt mark in `primary`, placeholder "ask anything…", a token estimate pill, a hint line ("⏎ send · ⇧⏎ newline · / ! @") and an outlined `▶` send button.
- Control rail below: model pill (`✳ qwen3-coder:30b ▾`), mode pill in `primary` (`normal ▾`), and a dashed context pill (`⌁ ctx 32%`).
- A 2px context gauge runs along the bottom edge in `primary`.
- The border turns `primary` on focus. When the thread cannot accept input, the composer drops to 50% opacity and says why.

### Inspector: files and review

- File tree: folders in `on-surface`, files in muted, Git status letters (`m` in `warning`, `a` in `success`) and line deltas (`+18` in `success`, `−6` in `error`).
- Review list: filter buttons (all, staged, unstaged), a dashed "touched this turn" strip, then changed files with a `turn` chip when the agent touched them.
- Diff: line numbers at 50% muted, hunk headers in `mention` on `surface-panel`, added and removed lines on `diff-add` and `diff-del`.
- Review comment: dashed card with the line reference and a "send to chat?" prompt.

### Terminal

- Bottom panel on `surface-elevated` with a tab strip (active tab underlined in `primary`) and restart, clear and stop buttons.
- An agent strip above the output shows the last agent command and its approval result, so it is clear the agent did not type into this terminal.
- Prompt `$` in `primary`, detected URLs in `mention` and underlined.

### Browser

- Address bar with back, forward and reload, the URL in a `surface` field, and outlined badges for origin safety (`localhost · safe` in `success`) and downloads (`⤓ deny`).
- The viewport is a plain `surface` area labelled "isolated preview · separate profile · no desktop bridge" when empty.
- An agent rail below lists the agent's actions as a chain (`snapshot ✓ → click [sign in] ✓ → ▲ type credentials · approval pending`) with "take control" and "reload" buttons and the current policy (`public http · off · downloads denied`).

### Overlays

- **Command palette (⌘K):** centred near the top, 520px wide, an input then rows with glyph, command and shortcut. The selected row uses `primary-soft`.
- **Shortcut sheet (?):** same shell as the palette, a list of action and key pairs.
- **Toast:** top right, `surface-elevated`, 2px `success` left rule, auto-hides after about 2.4 seconds. It is announced politely and never takes focus.

### Buttons

Outlined, `surface-panel` fill, `md` radius, `meta` text, with the key hint after the label at 55% opacity. "Allow" variants take `success` for border and text; "reject" variants take `error`. On hover, the border turns `on-surface`. There is no filled primary button in the window.

## Iconography

Text glyphs from the monospace font, so they align with text and scale with it.

| Glyph | Meaning | Glyph | Meaning |
|---|---|---|---|
| `○` | user, ready | `✓` | success |
| `✱` | Nanocoder | `▲` | approval, warning |
| `⌗` | file, subagent | `✕` | error, reject, close |
| `▸` `▾` | folder, collapsed or open | `⚒` | tool |
| `›` | composer prompt | `●` | running |
| `$` | bash, terminal | `◐` | waiting, in progress |
| `◌` | thinking, new | `◍` | browser, view-only |

A glyph never carries meaning alone: it always sits beside a word or has an accessible name.

## Motion

Motion only signals that something is live.

- Spinner (`◐` rotating): 1.1s linear loop on running tool rows.
- Cursor (`▌`): 1s two-step blink while the agent streams.
- Approval pulse: 2.2s ease-in-out ring in `warning` at 10% to 30%.
- Toast: 180ms fade and 6px slide. Theme switch: 200ms colour transition.

With "reduce motion" on, the spinner, cursor and pulse stop and transitions are instant. State is still shown by glyph and colour.

## Do's and Don'ts

- Do keep one accent. If two things want `primary` in one region, one of them is wrong.
- Do pair every state colour with a glyph and a word.
- Do keep `success`, `error` and `warning` for results and approvals, never for decoration.
- Do use tonal surfaces and strokes for hierarchy. Don't add shadows outside overlays.
- Do keep every text pairing at WCAG 2.2 AA or better in both themes.
- Don't use a second typeface, bold for emphasis, or an icon font.
- Don't style the browser viewport's page; it is the page's own content behind an isolation boundary.
- Don't make the terminal look like the agent's output. The agent strip is the only place agent commands appear in the bottom panel.
- Don't hide a disabled control without saying why.
- Don't load fonts, images or styles from the network.

## Open design questions

- **Product name in UI copy.** The mockup writes "nanocoder" in lowercase UI text. The [Brand Guidelines][brand] require "Nanocoder" in body copy. Decide whether UI chrome is exempt.
- **Light muted ink.** The mockup's token export says `hsl(225 10% 44%)` but the rendered frame uses `hsl(225 10% 40%)`. This file uses 40%, which has more contrast; confirm.
- **Narrow layout.** The mockup hides the inspector at 840px but does not show how it comes back. A drawer or a tab in the title bar both work.
- **High contrast and forced colours.** Not covered by the mockup.
- **Font licence.** Fira Code is under the SIL Open Font License 1.1, so its notice goes in the third-party notices (`REL-06`).

## Sources

- [Nanocoder Desktop design sheet][mockup], version 12, last modified 2026-09-27. Its own sources: [docs#107][docs107], the monocode chassis, [nanocollective.org][nc-site] and [nanocoder#907][nc907].
- [DESIGN.md format specification][spec], Google Labs, version `alpha`.
- [Nano Collective Brand Guidelines][brand].
- [Planning set](../planning/index.md), especially the feature files and the accessibility targets in [`testing-strategy.md`](../planning/testing-strategy.md#accessibility-targets).

[mockup]: https://bubbles.adityalogs.xyz/o/nanocoder-desktop-mockups/
[spec]: https://github.com/google-labs-code/design.md/blob/main/docs/spec.md
[brand]: https://docs.nanocollective.org/collective/organisation/brand
[docs107]: https://github.com/Nano-Collective/docs/pull/107
[nc-site]: https://nanocollective.org/
[nc907]: https://github.com/Nano-Collective/nanocoder/pull/907
