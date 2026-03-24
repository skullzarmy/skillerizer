/**
 * API Routes
 *
 * POST /api/session              — create a new session
 * POST /api/session/:id/source   — attach a source (URL fetch or pasted text)
 * POST /api/session/:id/message  — send a chat message (clarification loop)
 * GET  /api/session/:id/generate — SSE stream: run the full pipeline
 * GET  /api/session/:id          — get current session state
 */
import { Router } from 'express';
import { randomUUID } from 'crypto';
import { fetchUrl } from '../tools/fetcher.js';
import { clarify } from '../agents/clarifier.js';
import { runPipeline } from '../agents/orchestrator.js';

const router = Router();

/** In-memory session store  { [id]: Session } */
const sessions = new Map();

function getSession(id) {
  const s = sessions.get(id);
  if (!s) {
    const err = new Error('Session not found');
    err.status = 404;
    throw err;
  }
  return s;
}

/**
 * Process a clarifier reply: push it to history, check for READY_TO_GENERATE,
 * update session state, and return { reply, readyToGenerate }.
 */
function processClarifierReply(session, full) {
  session.history.push({ role: 'assistant', content: full });

  const readyToGenerate = full.includes('READY_TO_GENERATE');
  if (readyToGenerate) {
    session.intentSummary = full.split('READY_TO_GENERATE')[1].trim().replace(/^[\n\r:]+/, '');
    session.status = 'ready';
  }
  return { reply: full, readyToGenerate };
}

/**
 * POST /api/session
 * Creates a blank session. Returns { id }.
 */
router.post('/session', (req, res) => {
  const id = randomUUID();
  sessions.set(id, {
    id,
    createdAt: Date.now(),
    source: null,        // { url, title, description, text }
    history: [],         // clarification conversation [{role, content}]
    intentSummary: '',   // extracted after READY_TO_GENERATE
    skill: null,         // final markdown
    status: 'idle',      // idle | clarifying | generating | done | error
  });
  res.json({ id });
});

/**
 * POST /api/session/:id/source
 * Body: { url } OR { text, title? }
 * Fetches URL content or stores pasted text, then starts the clarifier.
 */
router.post('/session/:id/source', async (req, res) => {
  const session = getSession(req.params.id);
  const { url, text, title } = req.body ?? {};

  try {
    if (url) {
      session.source = await fetchUrl(url);
    } else if (text) {
      session.source = { url: '', title: title || 'Pasted content', description: '', text };
    } else {
      return res.status(400).json({ error: 'Provide either "url" or "text"' });
    }

    // Seed the conversation with an invisible system context message
    // so the clarifier knows what it's working with
    session.history = [
      {
        role: 'user',
        content: [
          `I want to create a skills.md document from the following source.`,
          `Title: ${session.source.title}`,
          session.source.url ? `URL: ${session.source.url}` : '',
          session.source.description ? `Description: ${session.source.description}` : '',
          '',
          `Here's a preview of the content (first 500 chars):`,
          session.source.text.slice(0, 500),
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ];

    session.status = 'clarifying';
    res.json({ ok: true, source: { title: session.source.title, url: session.source.url } });
  } catch (err) {
    session.status = 'error';
    res.status(500).json({ error: err.message });
  }
});
/**
 * POST /api/session/:id/clarify/start
 * Triggers the first AI clarification question using the seeded source context.
 * No user message is added — the clarifier responds to the source context directly.
 * Returns: { reply: string, readyToGenerate: boolean }
 */
router.post('/session/:id/clarify/start', async (req, res) => {
  const session = getSession(req.params.id);
  if (!session.source) return res.status(400).json({ error: 'Attach a source first' });

  try {
    let full = '';
    await clarify(session.history, (chunk) => { full += chunk; });
    res.json(processClarifierReply(session, full));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/session/:id/message
 * Body: { content: string }
 * Appends the user message to history, runs the clarifier, and returns the AI response.
 * If the response contains READY_TO_GENERATE, extracts the intent summary.
 * Returns: { reply: string, readyToGenerate: boolean }
 */
router.post('/session/:id/message', async (req, res) => {
  const session = getSession(req.params.id);
  const { content } = req.body ?? {};
  if (!content?.trim()) return res.status(400).json({ error: 'Message content required' });
  if (!session.source) return res.status(400).json({ error: 'Attach a source first' });

  session.history.push({ role: 'user', content: content.trim() });

  try {
    let full = '';
    await clarify(session.history, (chunk) => { full += chunk; });
    res.json(processClarifierReply(session, full));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/session/:id/generate
 * SSE stream. Runs the full agent pipeline and streams events.
 * Event format: data: <JSON>\n\n
 */
router.get('/session/:id/generate', async (req, res) => {
  const session = getSession(req.params.id);
  if (!session.source) {
    return res.status(400).json({ error: 'No source attached to session' });
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  session.status = 'generating';

  try {
    // If the user hasn't gone through clarification, derive intent from history
    const userIntent =
      session.intentSummary ||
      `Create a comprehensive skills.md for: ${session.source.title}`;

    const skill = await runPipeline({
      sourceContent: session.source.text,
      sourceUrl: session.source.url,
      userIntent,
      send,
    });

    session.skill = skill;
    session.status = 'done';
  } catch (err) {
    send({ type: 'error', message: err.message });
    session.status = 'error';
  } finally {
    res.end();
  }
});

/**
 * GET /api/session/:id
 * Returns session metadata (no full source text to keep payload small).
 */
router.get('/session/:id', (req, res) => {
  const session = getSession(req.params.id);
  res.json({
    id: session.id,
    status: session.status,
    source: session.source
      ? { title: session.source.title, url: session.source.url }
      : null,
    historyLength: session.history.length,
    intentSummary: session.intentSummary,
    skill: session.skill,
  });
});

export default router;
