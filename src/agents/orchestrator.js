/**
 * Orchestrator
 *
 * OpenClaw-style coordinator that manages the multi-agent pipeline.
 * Emits structured SSE events through the provided `send` function.
 *
 * Pipeline:
 *   1. [clarifier]  conversation loop (managed externally via /message endpoint)
 *   2. [analyzer]   parallel content analysis
 *   3. [writer]     streaming skill generation
 *
 * `send(event)` signature:  send({ type, agent?, message?, chunk?, result? })
 */
import { analyze } from './analyzer.js';
import { writeSkill } from './writer.js';

/**
 * Run the generation pipeline after clarification is complete.
 *
 * @param {object} opts
 * @param {string}   opts.sourceContent  — raw text of the source
 * @param {string}   opts.sourceUrl      — original URL (or '')
 * @param {string}   opts.userIntent     — distilled intent from clarifier
 * @param {function} opts.send           — SSE emitter: send({type, ...})
 * @returns {Promise<string>}  the finished skill markdown
 */
export async function runPipeline({ sourceContent, sourceUrl, userIntent, send }) {
  // ── Step 1: Announce pipeline start ────────────────────────────────────────
  send({ type: 'pipeline_start', message: 'Starting agentic skill-generation pipeline…' });

  // ── Step 2: Analyzer ───────────────────────────────────────────────────────
  send({
    type: 'agent_start',
    agent: 'analyzer',
    message: 'Analyzing source content and classifying skill type…',
  });

  let analysis;
  try {
    analysis = await analyze(sourceContent, userIntent);
    send({
      type: 'agent_complete',
      agent: 'analyzer',
      message: `Analysis complete. Skill type: ${analysis.skillType} | Domain: ${analysis.domain}`,
      result: analysis,
    });
  } catch (err) {
    send({ type: 'agent_error', agent: 'analyzer', message: err.message });
    throw err;
  }

  // ── Step 3: Writer (streaming) ─────────────────────────────────────────────
  send({
    type: 'agent_start',
    agent: 'writer',
    message: `Writing ${analysis.skillType} skill: "${analysis.title}"…`,
  });

  let skill = '';
  try {
    skill = await writeSkill(analysis, userIntent, sourceUrl, (chunk) => {
      send({ type: 'skill_chunk', chunk });
    });
    send({
      type: 'agent_complete',
      agent: 'writer',
      message: 'Skill document complete.',
    });
  } catch (err) {
    send({ type: 'agent_error', agent: 'writer', message: err.message });
    throw err;
  }

  // ── Step 4: Done ───────────────────────────────────────────────────────────
  send({ type: 'pipeline_done', skill });
  return skill;
}
