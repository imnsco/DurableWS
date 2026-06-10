---
"durablews": minor
---

durablews 2.0.0 — stable.

Everything from the alpha line, graduated: automatic reconnection
(full-jitter exponential backoff, `shouldReconnect` veto), bounded message
queueing with observable drops, opt-in heartbeat (close code 4408),
typed + Standard-Schema-validated messages, middleware in both directions
(transmission-time, ordered async), a pluggable codec, Vue and React
bindings (`durablews/vue`, `durablews/react`), and a drop-in `WebSocket`
class (`durablews/compat`) — zero runtime dependencies, core ≤ 3 KB brotli
(CI-enforced), tested in browsers (Playwright), Node 22, Deno 2, and Bun.

Docs: https://durablews.imns.co
