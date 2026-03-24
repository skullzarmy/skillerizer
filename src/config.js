/**
 * LLM client factory.
 * Supports GitHub Models (default), OpenAI, and Ollama.
 */
import 'dotenv/config';
import OpenAI from 'openai';

const provider = (process.env.LLM_PROVIDER || 'github').toLowerCase();

function buildClient() {
  switch (provider) {
    case 'openai':
      return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    case 'ollama':
      return new OpenAI({
        apiKey: 'ollama',
        baseURL: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1',
      });

    case 'github':
    default:
      return new OpenAI({
        apiKey: process.env.GITHUB_TOKEN,
        baseURL: 'https://models.github.ai/inference',
      });
  }
}

// Default model per provider
const DEFAULT_MODELS = {
  github: 'openai/gpt-4o-mini',
  openai: 'gpt-4o-mini',
  ollama: process.env.LLM_MODEL ?? 'llama3',
};

export const llm = buildClient();
export const model = process.env.LLM_MODEL ?? DEFAULT_MODELS[provider] ?? 'openai/gpt-4o-mini';

/**
 * Convenience: stream a chat completion and call `onChunk(text)` for each delta.
 * Returns the full accumulated text.
 */
export async function streamChat({ messages, onChunk, temperature = 0.7, maxTokens }) {
  const stream = await llm.chat.completions.create({
    model,
    messages,
    stream: true,
    temperature,
    ...(maxTokens ? { max_tokens: maxTokens } : {}),
  });

  let full = '';
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? '';
    if (delta) {
      full += delta;
      onChunk(delta);
    }
  }
  return full;
}

/**
 * Convenience: non-streaming chat, returns full text.
 */
export async function chat({ messages, temperature = 0.7, maxTokens }) {
  const res = await llm.chat.completions.create({
    model,
    messages,
    temperature,
    ...(maxTokens ? { max_tokens: maxTokens } : {}),
  });
  return res.choices[0].message.content ?? '';
}
