/**
 * Clarifier Agent
 *
 * Has a focused conversation with the user to understand:
 *  - The purpose of the skill (extraction vs. interaction instructions vs. both)
 *  - Target consumers (human reader, AI agent, copilot context)
 *  - Emphasis areas, detail level, any constraints
 *
 * Uses a persistent Copilot SDK session per user session so the conversation
 * history is maintained automatically by the SDK.
 */
import { createAgentSession } from "../config.js";

const SYSTEM = `You are Skillerizer's clarification specialist.
Your goal is to have a focused, friendly conversation to understand what kind of skills.md document the user needs.

Key dimensions to uncover (ask naturally, not as a checklist):
1. PURPOSE — Should the skill teach an AI how to *interact* with something (browse a site, call an API, use a tool), or should it *extract and encode knowledge* from the source, or both?
2. CONSUMER — Who will use this skill? A human reading claude.md files? An AI agent loading it as context? A copilot extension?
3. EMPHASIS — Are there specific workflows, edge-cases, or data points that must be captured?
4. DEPTH — Quick reference card vs. comprehensive guide?

Rules:
- Ask at most 2 focused questions per message.
- Be conversational and concise — no bullet-point interrogations.
- When you have enough information to proceed, say exactly: "READY_TO_GENERATE" on its own line, then briefly summarise the intent.
- Never produce the skill itself — that is another agent's job.
- Respond with text only.`;

/**
 * Create a new Copilot SDK session for the clarifier agent.
 * The returned session maintains its own conversation history.
 *
 * @returns {Promise<import('@github/copilot-sdk').CopilotSession>}
 */
export async function createClarifierSession() {
    return createAgentSession(SYSTEM);
}

/**
 * Send a message to an existing clarifier session and return the full response.
 *
 * @param {import('@github/copilot-sdk').CopilotSession} session — SDK session
 * @param {string} message — the user message to send
 * @returns {Promise<string>} full assistant response
 */
export async function clarifyMessage(session, message) {
    const response = await session.sendAndWait({ prompt: message }, 120_000);
    return response?.data?.content ?? "";
}
