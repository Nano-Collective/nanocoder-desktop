---
"@nanocollective/nanocoder-desktop": patch
---

Data a page sends through its service worker during an agent action is now held and asked about, like a request the page sends itself. Worker requests used to pass the in-app browser's request filter unchecked.
