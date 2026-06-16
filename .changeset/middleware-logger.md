---
"durablews": minor
---

Add `logger` to `durablews/middleware`: structured logging of every message in both directions, with a `redact` hook that scrubs secrets/PII for the logs only (the wire and your handlers see the real message). Tree-shakable, like the rest of the pack.
