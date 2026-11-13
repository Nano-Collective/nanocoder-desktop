---
"@nanocollective/nanocoder-desktop": patch
---

Add the release flow. Merging the version pull request now builds installers for macOS (arm64 and x64), Windows and Linux, checks each with the packaged smoke test, and publishes them with their SHA-256 checksums as a GitHub prerelease. The release notes say the build is pre-v0.1 and unsigned.
