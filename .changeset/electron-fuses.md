---
"@nanocollective/nanocoder-desktop": minor
---

Harden the shipped app. Turn off the Electron fuses that let an environment variable or a debugger make the app run other code (`ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS`, `--inspect`), load the app only from its archive, with an integrity check on macOS and Windows, and give file pages no extra privileges. The installers are checked on every platform by installing, launching and removing them.
