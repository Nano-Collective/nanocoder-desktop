---
"@nanocollective/nanocoder-desktop": patch
---

The in-app browser now applies the public sites setting to embedded frames. A localhost page can no longer show a public site in an `iframe`, `object` or `embed`, or through a frame that redirects, while public sites are off, and during an agent action a frame must also pass the agent's site rules. The agent is refused a click on an element that is or lands in a frame, where it used to click blind.
