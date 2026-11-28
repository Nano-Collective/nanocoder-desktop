---
"@nanocollective/nanocoder-desktop": patch
---

Stop "open in editor" from running a file. With the system default editor, a file marked executable, or a script, program or shortcut such as `setup.command`, `.bat`, `.js` or `.lnk`, was run instead of opened. It is now refused with a message that suggests revealing it or choosing an editor in settings.
