---
"durablews": minor
---

Add `durablews/middleware`, a tree-shakable pack of built-in middleware (RFC 0002), starting with `auth`. Import only what you use; unused middleware add zero bundle bytes.

`auth({ token, inject })` is outbound middleware that resolves a credential at transmission time and injects it into each message, so a message queued across a reconnect still goes out with a fresh token.
