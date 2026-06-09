import { defineConfig, devices } from "@playwright/test";

// Real-browser e2e: a static server exposes the built ESM bundle so a real
// Chromium can drive the client over a real WebSocket (see e2e/echo-server.mjs).
export default defineConfig({
    testDir: "./e2e",
    testMatch: "**/*.e2e.ts",
    reporter: "list",
    forbidOnly: !!process.env.CI,
    use: {
        baseURL: "http://localhost:5173"
    },
    webServer: {
        command: "node e2e/static-server.mjs",
        url: "http://localhost:5173/e2e/app.html",
        reuseExistingServer: !process.env.CI,
        env: { PORT: "5173" },
        timeout: 30_000
    },
    projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }]
});
