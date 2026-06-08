# DurableWS (Durable Web Sockets)

DurableWS is a resilient, TypeScript-based WebSocket client designed for modern web applications. It offers robust connection handling, automatic reconnection with exponential backoff, idle detection, message queueing, and easy subscription management, ensuring your application maintains a reliable real-time connection under varying network conditions.

## Features

-   **Automatic Reconnection**: Implements exponential backoff strategy to handle disconnections gracefully.
-   **Idle Detection**: Automatically detects idle states and triggers custom handlers.
-   **Message Queueing**: Outgoing messages are queued when the connection is down and sent when it's restored.
-   **TypeScript Support**: Fully typed interfaces for a better development experience.

## Installation

```bash
npm install durablews
```
