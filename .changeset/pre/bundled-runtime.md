---
"@nanocollective/nanocoder-desktop": minor
---

Ship the Node.js and Nanocoder the app runs with. A packaged app now carries a pinned Node.js 22 and Nanocoder 1.32.0 with their checksums verified at build time, runs them without searching the machine's `PATH`, and so works on a computer with neither installed. `NANOCODER_DESKTOP_CLI` and `NANOCODER_DESKTOP_NODE` still choose another runtime, which is checked and warned about like before.
