# Resilience playground

The flagship DurableWS demo: a server you can sabotage from the client, and a
connection that survives it. Drop it, mute it, flood it while it's down,
then watch the state machine, retry counter, and queue recover.

```bash
pnpm install && pnpm -F durablews build   # once, from the repo root
pnpm -F example-resilience-playground dev # server + Vite (one command)
```

Open the printed Vite URL. Things to try:

- **💣 Drop**: the server closes you with code 1012. The badge walks
  `open → reconnecting → connecting → open`; the retry counter resets on
  success.
- **🔇 Mute**: the server stays connected but goes silent. The heartbeat
  (2s interval here) declares the link dead, closes with code `4408`, and the
  normal reconnect machinery gets you a fresh, unmuted connection.
- **📬 Burst while down**: hit Drop, then immediately Burst. The messages
  queue (watch the gauge), then flush in order the moment the socket reopens.
- **Close, then Burst**: a deliberate close drops the queue *observably*:
  every message surfaces in the log as a `drop` event. Nothing is silently
  lost, ever.
