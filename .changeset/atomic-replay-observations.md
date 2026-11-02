---
"@nanocollective/nanocoder-desktop": patch
---

Commit structural replay identities and safe subagent metadata before replacing a thread's readable history.

Keep the old prefix on storage failure, retry only the saved session, and stop treating synthetic historical tool completion as proven success.
