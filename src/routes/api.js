/**
 * API Routes
 *
 * POST /api/session              — create a new session
 * POST /api/session/:id/source   — attach a source (URL fetch or pasted text)
 * POST /api/session/:id/message  — send a chat message (clarification loop)
 * GET  /api/session/:id/generate — SSE stream: run the full pipeline
 * GET  /api/session/:id          — get current session state
 */
import { Router } from "express";
import { randomUUID } from "crypto";
import { fetchUrl } from "../tools/fetcher.js";
import { createClarifierSession, clarifyMessage } from "../agents/clarifier.js";
import { runPipeline } from "../agents/orchestrator.js";

const router = Router();

/** In-memory session store  { [id]: Session } */
const sessions = new Map();

/** Sessions expire 2 hours after creation. */
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

// Prune expired sessions every 10 minutes.
// .unref() ensures this timer won't keep an otherwise-idle Node process alive.
setInterval(
    () => {
        const cutoff = Date.now() - SESSION_TTL_MS;
        for (const [id, session] of sessions) {
            if (session.createdAt < cutoff) {
                if (session.copilotSession) {
                    session.copilotSession.disconnect().catch(() => {});
                }
                sessions.delete(id);
            }
        }
    },
    10 * 60 * 1000,
).unref();

/** Returns the session or null — never throws. */
function getSession(id) {
    return sessions.get(id) ?? null;
}

/**
 * Process a clarifier reply: push it to history, check for READY_TO_GENERATE,
 * update session state, and return { reply, readyToGenerate }.
 */
function processClarifierReply(session, full) {
    session.history.push({ role: "assistant", content: full });

    const readyToGenerate = full.includes("READY_TO_GENERATE");
    if (readyToGenerate) {
        session.intentSummary = full
            .split("READY_TO_GENERATE")[1]
            .trim()
            .replace(/^[\n\r:]+/, "");
        session.status = "ready";
    }
    return { reply: full, readyToGenerate };
}

/**
 * POST /api/session
 * Creates a blank session. Returns { id }.
 */
router.post("/session", (req, res) => {
    const id = randomUUID();
    sessions.set(id, {
        id,
        createdAt: Date.now(),
        source: null, // { url, title, description, text }
        sourceMessage: "", // first prompt sent to the clarifier SDK session
        copilotSession: null, // Copilot SDK session for clarification
        history: [], // conversation log [{role, content}] (for state endpoint)
        intentSummary: "", // extracted after READY_TO_GENERATE
        skill: null, // final markdown
        filename: null, // suggested filename (without .md)
        status: "idle", // idle | clarifying | generating | done | error
    });
    res.json({ id });
});

/**
 * POST /api/session/:id/source
 * Body: { url } OR { text, title? }
 * Fetches URL content or stores pasted text, then prepares source context.
 */
router.post("/session/:id/source", async (req, res) => {
    const session = getSession(req.params.id);
    if (!session) return res.status(404).json({ error: "Session not found" });
    const { url, text, title } = req.body ?? {};

    try {
        if (url) {
            session.source = await fetchUrl(url);
        } else if (text) {
            session.source = { url: "", title: title || "Pasted content", description: "", text };
        } else {
            return res.status(400).json({ error: 'Provide either "url" or "text"' });
        }

        // Build the source context message that will be the first prompt
        // to the clarifier SDK session.
        session.sourceMessage = [
            `I want to create a skills.md document from the following source.`,
            `Title: ${session.source.title}`,
            session.source.url ? `URL: ${session.source.url}` : "",
            session.source.description ? `Description: ${session.source.description}` : "",
            "",
            `Here's a preview of the content (first 500 chars):`,
            session.source.text.slice(0, 500),
        ]
            .filter(Boolean)
            .join("\n");

        session.history = [{ role: "user", content: session.sourceMessage }];
        session.status = "clarifying";
        res.json({ ok: true, source: { title: session.source.title, url: session.source.url } });
    } catch (err) {
        session.status = "error";
        res.status(500).json({ error: err.message });
    }
});
/**
 * POST /api/session/:id/clarify/start
 * Creates a Copilot SDK session for the clarifier and sends the source context
 * as the first message.  Returns: { reply: string, readyToGenerate: boolean }
 */
router.post("/session/:id/clarify/start", async (req, res) => {
    const session = getSession(req.params.id);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (!session.source) return res.status(400).json({ error: "Attach a source first" });

    try {
        // Create a persistent SDK session for the clarification conversation
        session.copilotSession = await createClarifierSession();
        const full = await clarifyMessage(session.copilotSession, session.sourceMessage);
        res.json(processClarifierReply(session, full));
    } catch (err) {
        session.status = "error";
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/session/:id/message
 * Body: { content: string }
 * Sends the user message to the existing clarifier SDK session.
 * Returns: { reply: string, readyToGenerate: boolean }
 */
router.post("/session/:id/message", async (req, res) => {
    const session = getSession(req.params.id);
    if (!session) return res.status(404).json({ error: "Session not found" });
    const { content } = req.body ?? {};
    if (!content?.trim()) return res.status(400).json({ error: "Message content required" });
    if (!session.source) return res.status(400).json({ error: "Attach a source first" });
    if (!session.copilotSession) return res.status(400).json({ error: "Start clarification first" });

    session.history.push({ role: "user", content: content.trim() });

    try {
        const full = await clarifyMessage(session.copilotSession, content.trim());
        res.json(processClarifierReply(session, full));
    } catch (err) {
        session.status = "error";
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/session/:id/generate
 * SSE stream. Runs the full agent pipeline and streams events.
 * Event format: data: <JSON>\n\n
 */
router.get("/session/:id/generate", async (req, res) => {
    const session = getSession(req.params.id);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (!session.source) {
        return res.status(400).json({ error: "No source attached to session" });
    }

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    // Abort the pipeline if the client disconnects
    const controller = new AbortController();
    req.on("close", () => controller.abort());

    const send = (event) => {
        if (!controller.signal.aborted) {
            res.write(`data: ${JSON.stringify(event)}\n\n`);
        }
    };

    session.status = "generating";

    try {
        // If the user hasn't gone through clarification, derive intent from history
        const userIntent = session.intentSummary || `Create a comprehensive skills.md for: ${session.source.title}`;

        const { skill, filename } = await runPipeline({
            sourceContent: session.source.text,
            sourceUrl: session.source.url,
            userIntent,
            send,
            signal: controller.signal,
        });

        session.skill = skill;
        session.filename = filename || "skill";
        session.status = "done";
    } catch (err) {
        send({ type: "error", message: err.message });
        session.status = "error";
    } finally {
        res.end();
    }
});

/**
 * GET /api/session/:id
 * Returns session metadata (no full source text to keep payload small).
 */
router.get("/session/:id", (req, res) => {
    const session = getSession(req.params.id);
    if (!session) return res.status(404).json({ error: "Session not found" });
    res.json({
        id: session.id,
        status: session.status,
        source: session.source ? { title: session.source.title, url: session.source.url } : null,
        historyLength: session.history.length,
        intentSummary: session.intentSummary,
        skill: session.skill,
        filename: session.filename,
    });
});

/**
 * DELETE /api/session/:id
 * Immediately removes the session and disconnects any SDK sessions.
 */
router.delete("/session/:id", (req, res) => {
    const session = getSession(req.params.id);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.copilotSession) {
        session.copilotSession.disconnect().catch(() => {});
    }
    sessions.delete(req.params.id);
    res.json({ ok: true });
});

export default router;
