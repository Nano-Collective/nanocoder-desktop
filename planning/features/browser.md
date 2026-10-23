# Browser

The isolated, agent-controlled browser: navigation, agent control, approvals, downloads, settings, and annotations as a follow-up.

- Status: Draft
- Last updated: 2026-10-23
- Drafted by: @akramcodez

## Purpose

A user-visible preview for a running application or a reference page. The user can navigate it, or ask Nanocoder to inspect the page and take bounded actions, and can pause, interrupt or take control at any time ([whitepaper, Agent-controlled browser][wp-browser]). Visual design: see `DESIGN.md` (not yet written).

## v1 requirements

| ID | Requirement | Status and source |
|---|---|---|
| BRW-01 | A dedicated `WebContentsView` with a persistent partition, sandboxed, with no Node, preload or desktop IPC. | Decided ([whitepaper][wp-browser-sec]) |
| BRW-02 | Open from a clicked chat or terminal URL or an address bar; back, forward, reload, stop. | Decided ([whitepaper][wp-browser]) |
| BRW-03 | Localhost by default; public HTTP(S) only after the user enables it in settings. | Decided ([whitepaper][wp-browser]) |
| BRW-04 | Expose the current origin and loading and security state. | Decided ([whitepaper][wp-browser]) |
| BRW-05 | A browser profile separate from the user's normal browser. | Decided ([whitepaper][wp-browser]) |
| BRW-06 | Visible downloads with destination confirmation. | Decided ([whitepaper][wp-browser]) |
| BRW-07 | Default-deny browser permissions, popups, external protocols and file uploads (`SEC-10`). | Decided ([whitepaper][wp-browser]) |
| BRW-08 | Clear browser data from settings. | Decided ([whitepaper][wp-browser]) |
| BRW-09 | Open the current URL externally. | Decided ([whitepaper][wp-browser]) |
| BRW-10 | Send the current URL and title to the active chat. | Decided ([whitepaper][wp-browser]) |
| BRW-11 | The agent can request typed navigation, waiting, page snapshots, screenshots, clicks, text entry and scrolling, through the desktop's MCP server passed in `mcpServers`. | Decided (operations, [whitepaper][wp-arch]); the route is Proposed (awaiting @will-lamerton) ([#116][i116]) |
| BRW-12 | Each agent action, observation and pending approval is shown in the chat and the browser activity. | Decided ([whitepaper][wp-browser]) |
| BRW-13 | Sensitive submissions, purchases, permission changes, deletion and downloads need desktop approval. | Decided ([whitepaper][wp-browser-sec]) |
| BRW-14 | The user can pause agent control, interrupt an action, or take control. | Decided ([whitepaper][wp-browser]) |
| BRW-15 | Observations are labelled as untrusted page data and size-bounded. | Proposed (awaiting @will-lamerton) ([#108][i108]) |
| BRW-16 | Agent control of public sites only while the session is in `normal` mode; localhost in every mode. | Proposed (awaiting @will-lamerton) ([#108][i108]) |
| BRW-17 | Advertise agent browser control only when the adapter and the browser view are both ready; otherwise it is unavailable, with no privileged fallback. | Decided ([whitepaper][wp-arch]) |
| BRW-18 | Nanocoder's built-in `browser` tool is handled consistently with `BRW-03` and `BRW-16`. | Open (`OQ-13`) |
| BRW-19 | Annotations: select an element or region, record URL, viewport, selector or rectangle and comment, send to chat. User-authored annotations work even with agent control off. | Decided as a follow-up, not v1 ([whitepaper][wp-browser]) |
| BRW-20 | Pages that need the user's regular profile open externally without agent control. | Decided ([whitepaper][wp-browser-sec]) |

## Adapter transport

Open (`OQ-17`). Once Nanocoder honours `mcpServers` ([#116][i116]), the desktop's server can reach Nanocoder three ways:

| Transport | How | Trade-off |
|---|---|---|
| Stdio | Nanocoder spawns a small helper the desktop names; the helper connects back to the desktop over a local socket or pipe with a per-session secret. | Works with any MCP client; one more process and a local channel to secure. |
| HTTP | The desktop listens on a random localhost port; the per-session secret goes in a header (ACP's HTTP server type carries headers). | No helper; an open localhost port other local software can probe. |
| MCP over ACP | ACP SDK 1.4.0 defines an unstable `acp` server type with `mcp/connect` and `mcp/message` over the existing connection. | No port and no helper; marked unstable in the SDK and not implemented by Nanocoder. |

## Typed operations

Decided in outline ([whitepaper, Architecture][wp-arch]); parameters and bounds are Suggestion (not discussed). Every operation acts on the single active tab only.

| Operation | Parameters | Bounds | Sensitive |
|---|---|---|---|
| `open` | `url` | `http:` or `https:`; origin policy below | No, unless it triggers a download |
| `back`, `reload` | none | | No |
| `wait` | `for`: load, network idle, selector, or text; `timeoutMs` | Timeout at most 30 seconds | No |
| `snapshot` | `maxChars` | Text and accessibility-tree outline, capped (proposed 20,000 characters) | No |
| `screenshot` | `fullPage` | Viewport by default; image size capped | No |
| `click` | `target` (selector or snapshot reference) | Target must exist and be visible | Yes when the target submits a form, follows a download, or matches the sensitive rules |
| `type` | `target`, `text` | Text capped (proposed 2,000 characters); never into password or payment fields without approval | Yes for password, payment and other sensitive fields |
| `scroll` | `direction`, `amount` or `target` | | No |

### Sensitive actions

The broker asks the user before an action when any of these is true (`BRW-13`):

- it submits a form, or clicks an element that submits one;
- the target field or form is for a password, payment card, one-time code or account deletion;
- it starts a download;
- the page asks for a permission (these are denied anyway, `BRW-07`);
- the target's text or label matches purchase, payment, delete or confirm wording.

The rule list is conservative: a false positive costs one approval, a false negative can cost the user money or data.

### Observations

Every result returned to Nanocoder is wrapped so the model and the reader can tell it apart from user instructions (`BRW-15`, Proposed in [#108][i108]): the origin and URL it came from, a fixed marker saying it is untrusted page content, and the content itself, size-capped. Screenshots are returned as images with the same origin label.

### Origin policy

1. `localhost` and loopback addresses are always allowed.
2. Any other `http:` or `https:` origin is allowed only when public browsing is on in settings (`BRW-03`) and, for agent actions, only when the session is in `normal` mode (`BRW-16`).
3. Every other scheme is refused, and `file:` is never loaded.
4. A redirect is checked against the same rules before it is followed.
5. The user's own navigation follows rules 1 to 4 except the mode check.

## Explicit deferrals

Annotations (`BRW-19`), multiple tabs, browser extensions, raw CDP, arbitrary JavaScript, file uploads, unrestricted computer use.

## Edge cases and failure modes

- A page that redirects from localhost to a public origin while public browsing is off: stop and ask.
- A page that opens popups or `window.open`: denied, shown in the activity list.
- The dev server stops while the agent waits: the wait times out with an error result.
- The agent targets an element that is gone: error result, no retry loop in the broker.
- Download started by the agent: approval plus destination confirmation.
- Nanocoder's own `browser` tool reaching a public site while desktop public browsing is off (`OQ-13`).

## Platform notes

Chromium behaviour is the same on all three platforms because Electron bundles it. Downloads default folders and external protocol handlers differ per OS.

## Security notes

`SEC-10` to `SEC-13`, `SEC-16`, and the [browser-to-agent boundary](../security.md#browser-to-agent-trust-boundary).

## Dependencies on Nanocoder changes

`mcpServers` ([#116][i116]), `set_mode` mid-turn ([nanocoder#1857][nc1857]), a way to disable the built-in `browser` tool (`OQ-13`).

## Open questions

`OQ-06` (profile scope), `OQ-11` (browser subagent), `OQ-13`, `OQ-17`.

## Acceptance criteria

| Criterion | Success item |
|---|---|
| The agent opens the local dev server, takes a snapshot and clicks a button, and each action appears in the chat. | `SP-11` |
| A form submission by the agent asks for approval first. | `SP-11` |
| A public URL is refused until the user enables public browsing. | `SP-11` |
| The browser view cannot reach any desktop API (no preload, no IPC). | `SP-11` |

[wp-arch]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L235-L246
[wp-browser]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L473-L505
[wp-browser-sec]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L507-L515
[i108]: https://github.com/Nano-Collective/docs/issues/108
[i116]: https://github.com/Nano-Collective/docs/issues/116
[nc1857]: https://github.com/Nano-Collective/nanocoder/issues/1857
