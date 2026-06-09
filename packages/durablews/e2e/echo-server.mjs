import { WebSocketServer } from "ws";

/**
 * Starts a throwaway WebSocket server on a random free port for the browser
 * e2e tests. It echoes any message back, except a textual "ping" which it
 * answers with "pong" (so the pingpong middleware can be exercised end-to-end).
 *
 * @returns the chosen port and a close() that resolves once the server is down.
 */
export function startEchoServer() {
    return new Promise((resolve) => {
        const wss = new WebSocketServer({ port: 0 }, () => {
            const address = wss.address();
            const port =
                typeof address === "object" && address ? address.port : 0;
            resolve({
                port,
                close: () => new Promise((done) => wss.close(() => done()))
            });
        });

        wss.on("connection", (socket) => {
            socket.on("message", (data) => {
                const text = data.toString();
                socket.send(text === "ping" ? "pong" : text);
            });
        });
    });
}
