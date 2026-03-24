/**
 * Analyzer Agent
 *
 * Reads the source material (web content or pasted text) and produces a
 * structured JSON analysis that the Writer agent uses to build the skill.
 *
 * Output schema:
 * {
 *   title: string,
 *   domain: string,         // e.g. "web application", "API docs", "article"
 *   skillType: "interaction" | "extraction" | "hybrid",
 *   summary: string,
 *   keyTopics: string[],
 *   interactionPatterns: string[],  // UI flows, commands, API endpoints
 *   extractedFacts: string[],       // key data points / knowledge
 *   prerequisites: string[],
 *   caveats: string[],
 *   suggestedSections: string[]     // ordered list of sections for the skill
 * }
 */
import { chat } from '../config.js';

const SYSTEM = `You are Skillerizer's content analysis specialist.
Given a source document and the user's stated intent, produce a precise JSON analysis.
Your analysis directly feeds the skill-writing agent — be thorough but factual.
Do NOT invent information not present in the source.
Respond ONLY with valid JSON matching the schema below — no markdown fences, no explanation.

Schema:
{
  "title": "string",
  "domain": "string",
  "skillType": "interaction" | "extraction" | "hybrid",
  "summary": "string (2-4 sentences)",
  "keyTopics": ["string"],
  "interactionPatterns": ["string"],
  "extractedFacts": ["string"],
  "prerequisites": ["string"],
  "caveats": ["string"],
  "suggestedSections": ["string"]
}`;

/**
 * @param {string} sourceContent — raw text of the source
 * @param {string} userIntent — summary of what the user wants (from clarifier)
 * @param {AbortSignal} [signal] — optional signal to cancel the LLM call
 * @returns {Promise<object>} parsed analysis object
 */
export async function analyze(sourceContent, userIntent, signal) {
  const userMsg = `USER INTENT:\n${userIntent}\n\nSOURCE CONTENT:\n${sourceContent}`;
  const raw = await chat({
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: userMsg },
    ],
    temperature: 0.3,
    maxTokens: 2048,
    signal,
  });

  // Strip any accidental markdown fences
  const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    return JSON.parse(clean);
  } catch {
    // Fallback: return minimal structure so the pipeline doesn't break
    return {
      title: 'Untitled Source',
      domain: 'unknown',
      skillType: 'extraction',
      summary: sourceContent.slice(0, 300),
      keyTopics: [],
      interactionPatterns: [],
      extractedFacts: [],
      prerequisites: [],
      caveats: [],
      suggestedSections: ['Overview', 'Key Concepts', 'Usage', 'Examples'],
      _parseError: clean.slice(0, 200),
    };
  }
}
