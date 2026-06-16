# Roadmap

The live plan for DurableWS, updated as work lands. Ordering within a
section is by leverage, not commitment. Scheduled items become GitHub
issues when work starts; architecture-level items get an RFC first (see
[rfcs/README.md](rfcs/README.md)). The v2 design itself — milestones
M1–M4, shipped as `durablews@2.0.0` — is recorded in
[RFC 0001](rfcs/0001-v2-architecture.md); milestone numbering continues
from there.

## Now — M5: adoption follow-through

- **Dynamic URL provider.** Accept `url` as a sync or async function,
  re-resolved on every (re)connect attempt — the token-in-URL auth
  pattern. Closes the first concession in the docs'
  [comparison page](https://durablews.imns.co/comparison/).
- **Built-in middleware pack — RFC 0002.** A `durablews/middleware`
  subpath: named exports, side-effect-free, tree-shakable — middleware you
  don't import costs zero bundle bytes, enforced with a dedicated
  size-limit budget in CI. The RFC's spine is the public **middleware
  authoring contract** (the API third-party `durablews-plugin-*` middleware
  write against — the part expensive to reverse); the in-box set and the
  tree-shaking guarantee hang off it. Production-grounded candidate set
  (still to be confirmed): **auth/token-refresh** (the canonical async
  outbound case), **logger/devtools with redaction**, **idempotency/dedup**
  (outbound idempotency-key stamping makes the queue-flush safe; inbound
  drops replays), and possibly an **order-preserving outbound rate
  limiter** (the one pacing form §9 sanctions). Compression, signing, and
  metrics/tracing (→ the OTel pack) ship as authoring *examples*, not
  in-box. Explicitly out of scope, redirected in the RFC: codecs
  (socket.io), plugins (channels, acks, sequencing), and AsyncAPI. Per-key
  debounce/batch stay send-wrappers, not middleware (RFC 0001 §9).
- **Examples in the docs.** One page per runnable example (its thesis,
  the load-bearing code excerpt, run instructions, GitHub link) plus an
  Examples card on the docs homepage. Follow-up: "Open in StackBlitz"
  buttons — WebContainers can run the example servers in-browser, so live
  demos need no hosted infrastructure.

## Next — M6

- **Channels** — the v2.x headline feature. Starts as RFC 0003: API
  surface, the plugin vocabulary (RFC 0001 §4.6), and what it expects of
  servers. (The first plugin-shaped feature; message acks and
  sequence-gap/replay are plugin-adjacent and likely fold in here or
  follow it.)
- **Stress/soak harness.** Long-running chaos runs: server kill loops,
  queue pressure at the bound, reconnect storms, memory growth over
  hours. Durability claims should be measured, not asserted.

## Later — unscheduled ideas

- **Svelte binding** — the agreed fast-follow once there's demand
  (RFC 0001 §8).
- **AsyncAPI codegen** — generate a typed client from an AsyncAPI
  document; core already has every seam it needs (RFC 0001 §9).
- **OpenTelemetry pack** — a `durablews/otel` middleware + subscriber
  over the existing seams; decide on demand (RFC 0001 §9 records the
  caveats: no stable WS semantic conventions yet).
- **socket.io codec** — wire-format interop with socket.io servers.
- **Send-wrapper recipes** — debounce/batch/dedupe helpers composed in
  front of `send()`; a docs recipes page or a tiny helpers module
  (RFC 0001 §9).
- **WHATWG conformance audit** — measure `durablews/compat` against the
  [WHATWG WebSocket standard](https://websockets.spec.whatwg.org/) and turn
  the result into a conformance test suite; sharpens the compat layer's
  known-deviations table. Orthogonal to middleware.
