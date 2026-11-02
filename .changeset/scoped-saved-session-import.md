---
"@nanocollective/nanocoder-desktop": patch
---

Offer saved Nanocoder sessions for explicit import in their exact project root. Import desktop metadata only, preserve existing thread ownership and archive state, and resume history only when the user opens the imported thread.

Keep focus in the composer if the user moves there during import. Keyboard-only focus return stays within the project that began the import.
