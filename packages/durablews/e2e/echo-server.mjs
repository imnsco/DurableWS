import { WebSocketServer } from "ws";

/**
 * Starts a throwaway WebSocket server on a random free port for the browser
 * e2e tests. It echoes any message back, with two special textual commands:
 * "ping" is answered with "pong" (pingpong middleware), and "drop" makes the
 * server close that connection — the server stays up, so a reconnecting
 * client can come back (reconnection e2e).
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
                if (text === "drop") {
                    socket.close(1012, "server drop");
                    return;
                }
                socket.send(text === "ping" ? "pong" : text);
            });
        });
    });
}
