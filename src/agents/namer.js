/**
 * Namer Agent
 *
 * Takes the structured analysis and generated skill content and produces
 * a descriptive, filesystem-safe filename for the skill document.
 *
 * Uses an ephemeral Copilot SDK session — created, used once, then disconnected.
 */
import { createAgentSession } from "../config.js";

const SYSTEM = `You are Skillerizer's file-naming specialist.
Given a skill document's analysis metadata, produce a short, descriptive, filesystem-safe filename
(without the .md extension — the system adds that automatically).

Rules:
- Use lowercase kebab-case (e.g. "docker-compose-networking")
- Keep it concise: 2–5 words max
- It should clearly convey the skill's subject at a glance
- No special characters beyond hyphens
- No generic names like "skill", "document", "output", or "untitled"
- Respond with ONLY the filename — no explanation, no extension, no quotes`;

/**
 * @param {object} analysis — output from the Analyzer agent
 * @param {AbortSignal} [signal] — optional signal to cancel the LLM call
 * @returns {Promise<string>} suggested filename (without .md extension)
 */
export async function suggestFilename(analysis, signal) {
    const userMsg = [
        `TITLE: ${analysis.title}`,
        `DOMAIN: ${analysis.domain}`,
        `SKILL TYPE: ${analysis.skillType}`,
        `KEY TOPICS: ${(analysis.keyTopics || []).join(", ")}`,
        `SUMMARY: ${analysis.summary}`,
        "",
        "Suggest a filename for this skill document.",
    ].join("\n");

    const session = await createAgentSession(SYSTEM, { disableTools: true });

    if (signal) {
        signal.addEventListener("abort", () => session.abort().catch(() => {}), { once: true });
    }

    try {
        const response = await session.sendAndWait({ prompt: userMsg }, 30_000);
        const raw = (response?.data?.content ?? "").trim();

        // Sanitise: strip quotes, extension, and any non-kebab characters
        const sanitised = raw
            .replace(/['""`]/g, "")
            .replace(/\.md$/i, "")
            .replace(/[^a-z0-9-]/gi, "-")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, "")
            .toLowerCase();

        return sanitised || "skill";
    } finally {
        await session.disconnect().catch(() => {});
    }
}
