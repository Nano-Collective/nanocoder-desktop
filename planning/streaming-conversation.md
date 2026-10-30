# Streaming conversation

Phase 1.6 and U.4 implement `CHAT-05`, `ACP-12`, `CHAT-19`, `CHAT-20` and `PERF-04`. `DEC-39` remains proposed.

## Update boundary

`toTurnEvent` covers the installed SDK's 19 `session/update` discriminants. Agent text and reasoning stay separate. Replayed user chunks become user messages; live user echoes are ignored because sending already inserts the local user message. Distinct reported message IDs do not merge. Unsupported images, audio and resources become truthful text placeholders, never resource loads.

Tool updates merge by the exact opaque tool call ID. A title-only update preserves omitted classification, status, input/output, locations and content. Supplied content and location arrays replace previous arrays, including explicit empty arrays. A `subagent:` prefix has no routing meaning.

Plans replace by ID and can be removed. Compaction summary chunks append in receive order; patch omissions retain data and explicit null clears it. Inter-session messages preserve sender/recipient identity, replace or clear complete content, and append streamed chunks. Subagent updates are bounded plain rows only, with no child actions or inferred attribution. Session-info titles are deliberately ignored here: ThreadService owns them.

## Metadata and reported usage

`turn-metadata.ts` projects only `nanocoder/usage`, `nanocoder/response-usage`, `nanocoder/durationMs`, `nanocoder/outcome` and `nanocoder/artifacts`. Unknown keys are ignored. Malformed known namespaces are dropped atomically and warnings contain fixed field names only, never values or parser errors. Counts and amounts must be finite and non-negative; artefacts are bounded descriptors, not file access.

At `fc01e239`, live token counts are on the prompt response's `usage`, with cost under `nanocoder/usage`. The main-only `NanocoderTurnResult` retains validated metadata. Replay may put usage, duration and outcome on an empty assistant chunk, which becomes a metadata-only turn event. Token chips never invent totals; reported cost is shown without assuming an unreported currency. The context gauge appears only for actual `usage_update` context figures, never per-turn token totals.

Usage stays within its turn's user-message boundary. It attaches to the latest answer in that turn, or to a separate turn-details row when no answer exists. Further metadata updates that turn-details row even if an answer arrives later. A later turn never changes an earlier turn's reported usage or outcome.

The temporary technical gate publishes prompt metadata through its existing event channel, after checking the captured project and session still match. Its renderer listener accepts metadata only, preventing duplicate text/tool events. ThreadService must replace both pieces with its mapped per-thread event path when the technical gate retires.

## Ordered rendering

`createStreamBatcher` accepts a thread ID and ordered event arrays, schedules a cancellable 16ms delivery and exposes `flush`, `remove` and `dispose`. Contiguous events are batched without reordering interleaved thread queues. The owner flushes before terminal state, replay replacement, approval display/answer and thread changes. Cleanup cancels pending callbacks.

`applyEvents` makes one transcript update per delivery. Untouched settled rows keep object identity. Rows and agent Markdown are memoised. `ConversationStream` accepts plain transcript/running props and an approval child slot; it does not own a desktop capability.

## Markdown and commands

Only `AgentMarkdown` imports exactly pinned `react-markdown` 10.1.0. There are no added remark/rehype plugins. CommonMark headings, lists, blockquotes and code render; raw HTML is skipped, all images are text placeholders and all links are inert spans with their targets removed. There is no external-link IPC or automatic navigation. This small module can be replaced without changing the stream contract.

The resolved dependency graph contains 83 package versions, 78 newly locked. All have lockfile integrity; licences are MIT except `@ungap/structured-clone` (ISC). None has an install lifecycle script. Full upstream copyright/licence texts are in `THIRD-PARTY-NOTICES.txt`. This does not complete the later whole-application release-notices work.

Slash suggestions come only from `available_commands_update`. Selecting one inserts a draft and focuses the message input; it never submits. There is no fabricated desktop `/help`. Running disables sending, not drafting, as specified in [chats and sessions](features/chats-and-sessions.md#composer-by-thread-state). Drafts stay in renderer memory only (`DATA-10`).

## Verification and remaining scope

Unit tests cover mapping, patch semantics, metadata projection/refusal, project/thread usage ownership, batching cancellation and Markdown resource/navigation refusal. The retired legacy event channel is absent from preload; built-app tests prove literal legacy events cannot change the transcript. Built-app tests use fake content and a fresh `--user-data-dir`, never a real provider or conversation.

`e2e/streaming.e2e.ts` drives a monotonic fake stream, asserts the achieved rate is at least 100 updates/sec and measures maximum input-to-frame, scroll-to-frame, frame gap and MessageChannel event-loop delay against 100ms. It checks ordered content, memory-only drafts, native disclosure keyboard focus, reduced-motion cursor/spinner, both themes and 1240/1020/840 widths. Condition/event waits replace fixed sleeps.

The UI uses existing design tokens and preserves known design contrast gaps rather than changing designer-owned values. Full platform screen-reader acceptance, throttled stream announcements, advanced subagent controls and main-owned external-link navigation remain later work. No transcript, tool output or resource body is persisted by the desktop.
