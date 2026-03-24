/**
 * Writer Agent
 *
 * Takes the structured analysis and user intent and produces a complete
 * Claude-style skills.md document via streaming.
 *
 * Uses an ephemeral Copilot SDK session with streaming enabled.
 * Emits text chunks via `emit` callback as `assistant.message_delta` events arrive.
 * Returns the full accumulated skill text.
 */
import { createAgentSession } from "../config.js";

const SYSTEM = `You are Skillerizer's skill writing specialist.
You produce professional, Claude-style skills.md documents optimised for use as AI agent context.

Formatting rules:
- Use clean GitHub-flavoured Markdown
- Start with a H1 title: # Skill: <descriptive name>
- Include a metadata block right after the title:
  \`\`\`yaml
  skill_type: interaction | extraction | hybrid
  domain: <domain>
  version: 1.0
  \`\`\`
- Organise into the sections suggested by the analysis (use H2 headings)
- For INTERACTION skills: include step-by-step instructions with numbered lists, example commands/URLs, and "What to expect" notes
- For EXTRACTION skills: include structured facts, tables where appropriate, and clear categorisation
- For HYBRID skills: cover both dimensions
- End with a ## Caveats & Limitations section if there are any
- Be specific and actionable — avoid vague prose
- Aim for completeness; a reader should not need the original source

Tone: precise, informative, AI-assistant-friendly
Respond with text only.`;

/**
 * @param {object} analysis — output from the Analyzer agent
 * @param {string} userIntent — clarified user intent
 * @param {string} sourceUrl — original source URL (empty string if paste)
 * @param {function(string): void} emit — called with each streaming text chunk
 * @param {AbortSignal} [signal] — optional signal to cancel the LLM call
 * @returns {Promise<string>} full skill markdown text
 */
export async function writeSkill(analysis, userIntent, sourceUrl, emit, signal) {
    const contextBlock = JSON.stringify(analysis, null, 2);
    const userMsg = [
        `SOURCE URL: ${sourceUrl || "(pasted text)"}`,
        `USER INTENT: ${userIntent}`,
        "",
        "STRUCTURED ANALYSIS:",
        "```json",
        contextBlock,
        "```",
        "",
        "Please write the complete skills.md document now.",
    ].join("\n");

    const session = await createAgentSession(SYSTEM, { streaming: true });

    if (signal) {
        signal.addEventListener("abort", () => session.abort().catch(() => {}), { once: true });
    }

    // Stream chunks to the caller as they arrive
    const unsub = session.on("assistant.message_delta", (event) => {
        if (event.data?.deltaContent) {
            emit(event.data.deltaContent);
        }
    });

    try {
        const response = await session.sendAndWait({ prompt: userMsg });
        return response?.data?.content ?? "";
    } finally {
        unsub();
        await session.disconnect().catch(() => {});
    }
}
