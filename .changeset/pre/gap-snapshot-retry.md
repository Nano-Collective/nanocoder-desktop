---
"@nanocollective/nanocoder-desktop": patch
---

A chat whose catch-up read failed now retries it and resumes the live stream, instead of staying frozen until another event arrives, and it no longer holds an unbounded number of waiting events.
