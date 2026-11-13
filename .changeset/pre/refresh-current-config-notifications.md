---
"@nanocollective/nanocoder-desktop": patch
---

Refresh project model controls when the current ready Nanocoder session reports a valid config change, without another controls read. Ignore malformed, empty, replayed, replaced and disposed notifications, and retain pending modes and config uncertainty.
