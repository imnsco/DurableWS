# Chat — Vue and React, one server

The bread-and-butter demo: a broadcast chat with presence and typing
indicators, implemented twice — once with the Vue composable, once with the
React hook — against the same server and the same zod schema. Open both side
by side and talk to yourself.

```bash
pnpm install && pnpm -F durablews build   # once, from the repo root

pnpm -F example-chat dev:server   # terminal 1 — ws://localhost:8789
pnpm -F example-chat dev:vue      # terminal 2 — http://localhost:5174
pnpm -F example-chat dev:react    # terminal 3 — http://localhost:5175
```

What it shows:

- **`useWebSocket` in both idioms** — config-owned client, auto-connect,
  cleanup on unmount, reactive `state`.
- **One zod schema, both clients** ([shared/schema.ts](shared/schema.ts)):
  message types are *inferred* and every inbound frame is runtime-validated
  before a handler sees it.
- **History is app state** — `lastMessage` holds only the latest; each client
  accumulates its own list via `client.on("message", …)`, the boundary
  DurableWS deliberately doesn't cross.
- **Typing indicators as a call-site policy** (throttle in front of `send()`),
  per the middleware guide's layering rule.
- **Durability for free**: kill the server mid-conversation (`Ctrl-C`,
  restart it) — both clients walk through `reconnecting` and resume; anything
  sent while down queues and flushes.
