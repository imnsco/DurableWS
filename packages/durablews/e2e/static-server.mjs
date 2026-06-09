import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

// Serve the package root so the browser can `import("/dist/index.js")` (the
// built ESM bundle) and load `/e2e/app.html`.
const root = fileURLToPath(new URL("..", import.meta.url));
const port = Number(process.env.PORT) || 5173;

const CONTENT_TYPES = {
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".html": "text/html",
    ".json": "application/json",
    ".map": "application/json",
    ".css": "text/css"
};

createServer(async (req, res) => {
    try {
        const path = decodeURIComponent((req.url || "/").split("?")[0]);
        // Block path traversal, then resolve under the package root.
        const safe = normalize(path).replace(/^(\.\.[/\\])+/, "");
        const body = await readFile(join(root, safe));
        res.setHeader(
            "Content-Type",
            CONTENT_TYPES[extname(safe)] || "application/octet-stream"
        );
        res.end(body);
    } catch {
        res.statusCode = 404;
        res.end("not found");
    }
}).listen(port, () => {
    console.log(`e2e static server on http://localhost:${port}`);
});
