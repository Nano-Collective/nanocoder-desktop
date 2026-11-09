# Browser

The isolated, agent-controlled browser: navigation, agent control, approvals, downloads, settings, and annotations as a follow-up.

- Status: Draft
- Last updated: 2026-11-09
- Drafted by: @akramcodez

## Purpose

A user-visible preview for a running application or a reference page. The user can navigate it, or ask Nanocoder to inspect the page and take bounded actions, and can pause, interrupt or take control at any time ([whitepaper, Agent-controlled browser][wp-browser]). Visual design: see [`DESIGN.md`](../../DESIGN.md).

## v1 requirements

| ID | Requirement | Status and source |
|---|---|---|
| BRW-01 | A dedicated `WebContentsView` with a persistent partition for each profile (`DEC-49`), sandboxed, with no Node, preload or desktop IPC. | Decided ([whitepaper][wp-browser-sec]) |
| BRW-02 | Open from a clicked chat or terminal URL or an address bar; back, forward, reload, stop. | Decided ([whitepaper][wp-browser]) |
| BRW-03 | Localhost by default; public HTTP(S) only after the user enables it in settings. | Decided ([whitepaper][wp-browser]) |
| BRW-04 | Expose the current origin and loading and security state. | Decided ([whitepaper][wp-browser]) |
| BRW-05 | Browser profiles separate from the user's normal browser: a persistent Default, named profiles and an in-memory Incognito, with each project starting on its own persistent profile. | Decided ([whitepaper][wp-browser]); profile model in `DEC-49` |
| BRW-06 | Visible downloads with destination confirmation. | Decided ([whitepaper][wp-browser]) |
| BRW-07 | Default-deny browser permissions, popups, external protocols and file uploads (`SEC-10`). | Decided ([whitepaper][wp-browser]) |
| BRW-08 | Clear browser data from settings, for each profile. Removing a project leaves its profile alone. | Decided ([whitepaper][wp-browser]); per profile in `DEC-49` |
| BRW-09 | Open the current URL externally. | Decided ([whitepaper][wp-browser]) |
| BRW-10 | Send the current URL and title to the active chat. | Decided ([whitepaper][wp-browser]) |
| BRW-11 | The agent can request typed navigation, waiting, page snapshots, screenshots, clicks, text entry and scrolling, through the desktop's MCP server passed in `mcpServers`. | Decided (operations, [whitepaper][wp-arch]); the route is Proposed (awaiting @will-lamerton) ([#116][i116]); route decided in `DEC-47`; the Nanocoder side is released in 1.32.0, and the route is built in phase 3.7 |
| BRW-12 | Each agent action, observation and pending approval is shown in the chat and the browser activity. | Decided ([whitepaper][wp-browser]) |
| BRW-13 | Sensitive submissions, purchases, permission changes, deletion and downloads need desktop approval. | Decided ([whitepaper][wp-browser-sec]) |
| BRW-14 | The user can pause agent control, interrupt an action, or take control. | Decided ([whitepaper][wp-browser]) |
| BRW-15 | Observations are labelled as untrusted page data and size-bounded. | Proposed (awaiting @will-lamerton) ([#108][i108]) |
| BRW-16 | Agent control of public sites only while the session is in `normal` mode; localhost in every mode. | Proposed (awaiting @will-lamerton) ([#108][i108]) |
| BRW-17 | Advertise agent browser control only when the adapter and the browser view are both ready; otherwise it is unavailable, with no privileged fallback. | Decided ([whitepaper][wp-arch]) |
| BRW-18 | Nanocoder's built-in `browser` tool stays available beside the in-app browser, under Nanocoder's own approvals. The public-site rules (`BRW-03`, `BRW-16`) cover the in-app browser only, and a desktop setting turns Nanocoder's browser off for a session. | Decided (`DEC-48`); the Nanocoder side is merged and unreleased |
| BRW-19 | Annotations: select an element or region, record URL, viewport, selector or rectangle and comment, send to chat. User-authored annotations work even with agent control off. | Decided as a follow-up, not v1 ([whitepaper][wp-browser]) |
| BRW-20 | Pages that need the user's regular profile open externally without agent control. | Decided ([whitepaper][wp-browser-sec]) |

## Adapter transport

Decided (`DEC-47`): HTTP on `127.0.0.1` with a secret in the headers for each session, passed in `mcpServers` ([#116][i116], released in Nanocoder 1.32.0). The three ways the desktop's server could reach Nanocoder, of which Nanocoder supports stdio and HTTP:

| Transport | How | Trade-off |
|---|---|---|
| Stdio | Nanocoder spawns a small helper the desktop names; the helper connects back to the desktop over a local socket or pipe with a per-session secret. | Works with any MCP client; one more process and a local channel to secure. |
| HTTP | The desktop listens on a random localhost port; the per-session secret goes in a header (ACP's HTTP server type carries headers). | No helper; an open localhost port other local software can probe. |
| MCP over ACP | ACP SDK 1.4.0 defines an unstable `acp` server type with `mcp/connect` and `mcp/message` over the existing connection. | No port and no helper; marked unstable in the SDK and not implemented by Nanocoder. |

## Typed operations

Decided in outline ([whitepaper, Architecture][wp-arch]). The parameters and bounds below are what phase 3.8 built; the tools are named `desktop_browser_<operation>`. Every operation acts on the single active tab only.

| Operation | Parameters | Bounds | Sensitive |
|---|---|---|---|
| `open` | `url` | `http:` or `https:`; origin policy below | No, unless it triggers a download |
| `back`, `reload` | none | | No |
| `wait` | `for`: load, selector or text; `value`; `timeoutMs` | Timeout at most 30 seconds, 10 by default; network idle is not offered | No |
| `snapshot` | `maxChars` | Text and an outline of links, buttons and fields with references such as `[e12]`; 500 to 20,000 characters, 20,000 by default; at most 1,000 references and 20,000 nodes | No |
| `screenshot` | none | The viewport only, at most 1,280 pixels wide, as JPEG; full-page capture is not offered | No |
| `click` | `ref` or `selector` (at most 500 characters) | Target must exist, be visible, in view after scrolling, enabled, and not covered by another element | Yes when the target submits a form, follows a download, chooses a file, or matches the sensitive rules |
| `type` | `ref` or `selector`, `text`, `clear` | Text 1 to 2,000 characters; never presses Enter; only into fields that take text | Yes for password, payment, one-time code and file fields |
| `scroll` | `direction` and `amount`, or `ref` or `selector` | Amount 1 to 10,000 pixels, 600 by default | No |

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

### Phase 3.4 behaviour

The browser is the third tab of the right workbench. `BRW-03` is the user's own setting, `publicBrowsingEnabled`, read at every decision, so turning it off refuses at once. A typed address, a redirect and a clicked link all go through the same check in main; the renderer only normalises what the user typed (`localhost:5173` gets `http://`, a bare site gets `https://`). A refused address is remembered in the snapshot so the panel can explain it: for a public site it asks, and "turn on public sites and open it" saves the setting and opens that address, while "stay on localhost" only dismisses the question. The per-site prompt for agent visits in `DEC-50` is separate and arrives with phases 3.8 and 3.9. Because the native view draws above the page, the panel reports its viewport rectangle and the view hides while any dialog is open. A toast can still be covered by the view.

### Phase 3.5 behaviour

- **Denied by default (`BRW-07`, `SEC-10`).** Every permission request and check is refused without a prompt, so camera, microphone, location and notifications never ask. A popup is denied and leaves a notice in the panel. A link or redirect to a non-web scheme (`mailto:` and the like) is refused by the origin policy and never reaches the operating system. The File System Access pickers (`showOpenFilePicker`, `showSaveFilePicker`, `showDirectoryPicker`) are removed from the view.
- **Uploads, a known limit.** Electron has no hook for the native chooser behind `<input type="file">`, and a preload is not allowed (`SEC-12`). A page can therefore still open that operating system dialog, but it only receives a file the user picked there. Agent-driven uploads do not exist (see the typed operations) and stay deferred.
- **Downloads (`BRW-06`).** A download follows the same origin policy as a page, including `blob:` addresses, and a refused one is cancelled before anything is saved. The file name is made safe, and the operating system's save dialog opens at the downloads folder, so the user confirms the destination every time. The last five downloads show in the panel with their state.
- **Profiles (`BRW-05`, `DEC-49`).** Each project starts on its own persistent profile. The panel can switch it to the shared Default, a named profile or incognito, which is an in-memory partition wiped when its page closes. Switching closes the current page. Named profiles are created and removed from the panel, which stands in for Settings until one exists.
- **Clearing data (`BRW-08`).** Clearing a profile asks first, then removes its cookies, storage and cache and closes any page using it. Removing a named profile does the same and sends its projects back to their own profile. Removing a project leaves its profile alone.
- **Open outside (`BRW-09`, `SEC-16`).** The address is taken from the browser's own state, never from the renderer, only `http:` and `https:` are accepted, and a native question shows the exact address with Cancel as the default.

### Phase 3.6 behaviour

- **Localhost links (`TERM-05`).** `source/shared/local-url.ts` finds `http`, `https` and bare `host:port` addresses for `localhost`, `127.x.x.x` and `[::1]`. It trims trailing punctuation, ignores colour codes, refuses credentials and look-alike hosts such as `localhost.evil.com`, and does not offer an address that sits inside another URL. In the terminal each such address is a link, and the toolbar shows a button for the newest one so opening a dev server is one action and works from the keyboard. In chat only a link that is entirely one localhost address becomes a button; its target host is shown beside the text, and every other link stays inert. Opening goes through the same origin policy as a typed address, so main still decides. A terminal address that wraps over two lines is not linked.
- **Other addresses.** `TERM-05` also asks for other addresses to open outside the app after a confirmation. Only the current page of the browser can do that today (`BRW-09`); other addresses in terminal output or chat stay plain text.
- **Send the page to chat (`BRW-10`).** The attachment names the page by address only. Main takes the title and address from the browser's own state when the prompt is sent, refuses it if that page is no longer the one that was attached, keeps the title to one bounded line, and labels the block as page data, not instructions (`BRW-15`). It rides with one prompt and is not stored (`CHAT-16`).

### Phase 3.7 behaviour

- **One server in main (`DEC-47`).** [`mcp-server.ts`](../../source/main/browser-control/mcp-server.ts) listens on `127.0.0.1` on a random port once the store is open, and stops on quit. It speaks MCP Streamable HTTP with JSON answers only: `POST /mcp` carries one JSON-RPC message, a notification gets `202`, and there is no event stream, batch or MCP session ID. It answers `initialize`, `ping`, `tools/list` and `tools/call`, and nothing else.
- **A secret for each session.** Each `session/new` and `session/resume` gets a fresh 256-bit secret, sent only inside that ACP request as `Authorization: Bearer`, never in the environment, so the agent's shell cannot read it. The server keeps only the secret's SHA-256 digest and the project it belongs to. The secret is revoked when its session fails to start or set its mode, is resumed again, is deleted, or when the connection closes or Nanocoder exits, and a call still running when its secret is revoked gets no answer. Nanocoder's stderr ring already redacts a bearer value, so a secret Nanocoder echoed would not reach diagnostics.
- **Refusals, in order.** A request with any `Origin` header is refused (`403`), so no web page can reach the server, whatever the secret. Then a `Host` other than the exact loopback address and port (`403`, against DNS rebinding), another path (`404`), a missing or unknown secret (`401`), another method (`405`), a type other than JSON (`415`), a body over 64 KiB (`413`) and an MCP protocol version it does not speak (`400`). Malformed JSON, batches and invalid JSON-RPC are refused before any tool runs.
- **When sessions get it (`BRW-17`).** Only when Nanocoder reports `mcpCapabilities.http`, its version is 1.32.0 or later, and the server is listening; otherwise every session gets an empty `mcpServers` list and the `browserControl` gate gives the reason. The capabilities dialog does not show this gate yet, because its rows follow the approved design.
- **One read-only tool.** `desktop_browser_status` reports whether the in-app browser has a page for this project, with its status, address, origin and title, labelled as page data from the in-app browser, not instructions (`BRW-15`). The title and address are one bounded line each. It takes no arguments, is marked `readOnlyHint`, and answers only for the project its secret was issued to while that project is the active one. Nanocoder asks before it in `normal` mode like any MCP tool (`DEC-50`). The typed operations arrive in phase 3.8; approvals and the per-site prompt in phase 3.9.
- **Proof against the pinned Nanocoder.** [`browser-server.acp.ts`](../../source/main/browser-control/browser-server.acp.ts) shows that the headers reach Nanocoder's MCP client and the tool runs for its project, that the tool exists only in the session given the server, that a wrong secret leaves the session working without the tool, that a resumed session gets a fresh secret, and that the user's configuration and the project gain no MCP files.

### Phase 3.8 behaviour

- **The broker (`BRW-11`).** [`broker.ts`](../../source/main/browser-control/broker.ts) adds nine tools to the phase 3.7 server: `desktop_browser_open`, `_back`, `_reload`, `_wait`, `_snapshot`, `_screenshot`, `_click`, `_type` and `_scroll`. Arguments are checked against a strict schema each, and an answer from the page is checked against a schema before anything is passed on. Snapshot, screenshot and wait are marked `readOnlyHint`, so `plan` mode can look but not act (`DEC-50`).
- **No script from the agent (`SEC-13`).** There is no operation that runs code. The broker runs only the fixed functions in [`page-scripts.ts`](../../source/main/browser-control/page-scripts.ts), in an isolated world of the page, so the page's own scripts can neither see the helpers nor replace the DOM methods they use. Agent values reach them only as JSON data. Clicks and typing are real input events from main (`sendInputEvent`, `insertText`), not script calls, and typing never presses Enter.
- **Where the agent can act (`BRW-17`).** The tool list is fixed for a session, so readiness is checked on every call: the project must be the active one, the browser tab must be on screen (the agent never acts where the user cannot see it), and for anything but `open` a page must be open. Calls run one at a time.
- **Local addresses only, until approvals (`BRW-16`).** Until phase 3.9 brings the mode rule and the per-site question in `DEC-50`, the agent can open and act only on `localhost`, `127.x.x.x` and `[::1]`, whatever the public sites setting. While an action runs, a page that tries to leave local addresses is stopped without raising the user's public-site question, and the result says so.
- **Sensitive actions are refused, not asked (`BRW-13`).** The rules under Sensitive actions are checked in main, from facts the page script reports: a click that would submit a form, start a download, choose a file, or whose label, name or id suggests a purchase, payment, deletion or confirmation, and typing into password, payment, one-time code or file fields. Until phase 3.9 adds the approval, these are refused with the reason. While an action runs and while a navigation it starts settles, a request other than `GET`, `HEAD` or `OPTIONS` from that page is cancelled, which also catches a submit made by the page's own script, and any download is cancelled. Reading the page holds nothing, so it never cancels the user's own requests.
- **Observations (`BRW-15`).** Every result carries the page's status, address and title under the page data label, each one bounded line. A snapshot lists headings, text and each link, button and field with a reference; password values are never included. A new snapshot retires earlier references, and numbering never restarts, so an old reference cannot name a new element.
- **Screenshots.** A screenshot is returned as a text label followed by the JPEG. Nanocoder 1.32.0 passes the model only the first block of an MCP result, so the model receives the label; showing it the image needs a Nanocoder change.
- **Proof.** [`browser-agent.e2e.ts`](../../e2e/browser-agent.e2e.ts) drives a real in-app browser through the server with the session's own secret: opening a local page, a snapshot, a click that changes the page, waiting for the change, typing into a field and replacing its text, scrolling, a screenshot, following a link and going back. It also proves each refusal: submit, download, password field, covered element, a script-sent `POST` (the server receives none), leaving localhost, opening a public site, a page that tampers with DOM methods, a stale reference and the browser off screen.

## Explicit deferrals

Annotations (`BRW-19`), multiple tabs, browser extensions, raw CDP, arbitrary JavaScript, file uploads by the agent, blocking the plain file chooser (no Electron hook), a Settings screen for profiles (managed from the browser tab until then), unrestricted computer use.

## Edge cases and failure modes

- A page that redirects from localhost to a public origin while public browsing is off: stop and ask.
- A page that opens popups or `window.open`: denied, shown in the activity list.
- The dev server stops while the agent waits: the wait times out with an error result.
- The agent targets an element that is gone: error result, no retry loop in the broker.
- Download started by the agent: approval plus destination confirmation.
- Nanocoder's own `browser` tool reaching a public site while desktop public browsing is off. Expected while its setting is on (`DEC-48`); the docs and the settings screen say so.

## Platform notes

Chromium behaviour is the same on all three platforms because Electron bundles it. Downloads default folders and external protocol handlers differ per OS.

## Security notes

`SEC-10` to `SEC-13`, `SEC-16`, and the [browser-to-agent boundary](../security.md#browser-to-agent-trust-boundary).

## Dependencies on Nanocoder changes

All merged in Nanocoder `main` and unreleased until 1.32.0 ([#12](https://github.com/Nano-Collective/nanocoder-desktop/issues/12)): `mcpServers` for each session ([#116][i116]), `set_mode` mid-turn ([nanocoder#1857][nc1857]), `_meta["nanocoder/disabledTools"]` to turn off the built-in `browser` tool for a session (`DEC-48`), and a way to read the effective approval policy, since `alwaysAllow` skips approvals even in `normal` (`DEC-31`).

## Open questions

`OQ-06`, `OQ-11`, `OQ-13` and `OQ-17` are answered in `DEC-49`, `DEC-50`, `DEC-48` and `DEC-47`.

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
