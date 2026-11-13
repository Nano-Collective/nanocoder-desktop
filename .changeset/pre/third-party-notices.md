---
"@nanocollective/nanocoder-desktop": minor
---

Ship complete third-party notices. Every build now lists each open source package it includes, with its licence and the licence text, for the desktop and for the bundled Node.js and Nanocoder, including Nanocoder's own copyright and MIT licence. The notices are generated from what is actually bundled, and the build fails on a package with no licence or a licence the project has not accepted.
