/**
 * Writer Agent
 *
 * Takes the structured analysis and user intent and produces a complete
 * Claude-style skills.md document via streaming.
 *
 * Emits text chunks via `emit` callback.
 * Returns the full accumulated skill text.
 */
import { streamChat } from '../config.js';

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

Tone: precise, informative, AI-assistant-friendly`;

/**
 * @param {object} analysis — output from the Analyzer agent
 * @param {string} userIntent — clarified user intent
 * @param {string} sourceUrl — original source URL (empty string if paste)
 * @param {function(string): void} emit — called with each streaming text chunk
 * @returns {Promise<string>} full skill markdown text
 */
export async function writeSkill(analysis, userIntent, sourceUrl, emit) {
  const contextBlock = JSON.stringify(analysis, null, 2);
  const userMsg = [
    `SOURCE URL: ${sourceUrl || '(pasted text)'}`,
    `USER INTENT: ${userIntent}`,
    '',
    'STRUCTURED ANALYSIS:',
    '```json',
    contextBlock,
    '```',
    '',
    'Please write the complete skills.md document now.',
  ].join('\n');

  return streamChat({
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: userMsg },
    ],
    onChunk: emit,
    temperature: 0.5,
    maxTokens: 4096,
  });
}
