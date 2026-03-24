/**
 * Skillerizer — server entry point
 *
 * Serves the SPA from /public and mounts the REST/SSE API under /api.
 */
import 'dotenv/config';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import express from 'express';
import apiRouter from './src/routes/api.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT ?? '3000', 10);

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.static(join(__dirname, 'public')));

// ── API ───────────────────────────────────────────────────────────────────────
app.use('/api', apiRouter);

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  const status = err.status ?? 500;
  res.status(status).json({ error: err.message ?? 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const server = createServer(app);
server.listen(PORT, () => {
  const addr = `http://localhost:${PORT}`;
  console.log(`\n🎯 Skillerizer running at ${addr}\n`);
  if (!process.env.GITHUB_TOKEN && !process.env.OPENAI_API_KEY) {
    console.warn(
      '⚠️  No LLM credentials found. Copy .env.example → .env and add your GITHUB_TOKEN.\n'
    );
  }
});

export default app;
