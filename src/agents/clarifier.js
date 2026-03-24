/**
 * Clarifier Agent
 *
 * Has a focused conversation with the user to understand:
 *  - The purpose of the skill (extraction vs. interaction instructions vs. both)
 *  - Target consumers (human reader, AI agent, copilot context)
 *  - Emphasis areas, detail level, any constraints
 *
 * Emits SSE events via `emit` callback.
 * Returns the latest AI message so the caller can relay it to the user.
 */
import { streamChat } from '../config.js';

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
- Never produce the skill itself — that is another agent's job.`;

/**
 * @param {Array<{role: string, content: string}>} history — full conversation so far
 * @param {function(string): void} emit — called with each text chunk
 * @returns {Promise<string>} full assistant response
 */
export async function clarify(history, emit) {
  const messages = [{ role: 'system', content: SYSTEM }, ...history];
  return streamChat({ messages, onChunk: emit, temperature: 0.7 });
}
