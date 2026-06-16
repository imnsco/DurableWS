---
"durablews": minor
---

Add `dedup` to `durablews/middleware`: inbound middleware that drops duplicate messages (by a `key` you extract), so a server that redelivers never reaches your handler twice. Memory is bounded by `window` (drop-oldest), like the core send queue. Tree-shakable, like the rest of the pack.
