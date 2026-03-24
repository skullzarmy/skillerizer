/**
 * Skillerizer — server entry point
 *
 * Serves the SPA from /public and mounts the REST/SSE API under /api.
 * Manages the Copilot SDK client lifecycle.
 */
import "dotenv/config";
import { createServer } from "http";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import express from "express";
import apiRouter from "./src/routes/api.js";
import { getClient, stopClient } from "./src/config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT ?? "3000", 10);

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: "2mb" }));
app.use(express.static(join(__dirname, "public")));

// ── API ───────────────────────────────────────────────────────────────────────
app.use("/api", apiRouter);

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
    const status = err.status ?? 500;
    res.status(status).json({ error: err.message ?? "Internal server error" });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const server = createServer(app);
server.listen(PORT, () => {
    const addr = `http://localhost:${PORT}`;
    console.log(`\n🎯 Skillerizer running at ${addr}\n`);

    // Warm up the Copilot SDK client asynchronously
    getClient()
        .then(() => console.log("✅ Copilot SDK client connected.\n"))
        .catch((err) => {
            console.warn("⚠️  Copilot SDK client failed to start:", err.message);
            console.warn("   Ensure the Copilot CLI is installed: copilot --version");
            console.warn("   Or configure BYOK with LLM_PROVIDER and API keys.\n");
        });
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
async function shutdown() {
    console.log("\n🛑 Shutting down…");
    await stopClient().catch(() => {});
    server.close();
    process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

export default app;
