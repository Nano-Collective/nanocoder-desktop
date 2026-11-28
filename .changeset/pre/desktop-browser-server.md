---
"@nanocollective/nanocoder-desktop": minor
---

Give each desktop Nanocoder session its own connection to the desktop's browser tool server, on the loopback address with a fresh secret per session that is revoked when the session ends. Its first tool lets the agent see which page the in-app browser shows for the project, labelled as page data. Nanocoder 1.32.0 or later is needed; older builds keep working without it.
