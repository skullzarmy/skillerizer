/**
 * GitHub Copilot SDK client factory.
 *
 * Manages a singleton CopilotClient and provides helpers to create
 * per-agent sessions.  Supports native Copilot auth (default) plus
 * BYOK for OpenAI, Ollama, and Anthropic.
 */
import "dotenv/config";
import { CopilotClient, approveAll } from "@github/copilot-sdk";

const provider = (process.env.LLM_PROVIDER || "github").toLowerCase();

const DEFAULT_MODELS = {
    github: "gpt-4o-mini",
    openai: "gpt-4o-mini",
    ollama: "llama3",
    anthropic: "claude-sonnet-4.5",
};

export const model = process.env.LLM_MODEL ?? DEFAULT_MODELS[provider] ?? "gpt-4o-mini";

/** Build BYOK provider config, or null for native Copilot auth. */
function buildProviderConfig() {
    switch (provider) {
        case "openai":
            return {
                type: "openai",
                baseUrl: "https://api.openai.com/v1",
                apiKey: process.env.OPENAI_API_KEY,
            };
        case "ollama":
            return {
                type: "openai",
                baseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
            };
        case "anthropic":
            return {
                type: "anthropic",
                baseUrl: "https://api.anthropic.com",
                apiKey: process.env.ANTHROPIC_API_KEY,
            };
        case "github":
        default:
            return null;
    }
}

// ── Singleton CopilotClient ──────────────────────────────────────────────────

let _client = null;

/**
 * Return (and lazily start) the shared CopilotClient.
 */
export async function getClient() {
    if (!_client) {
        const options = {};
        if (process.env.GITHUB_TOKEN) {
            options.githubToken = process.env.GITHUB_TOKEN;
        }
        _client = new CopilotClient(options);
        await _client.start();
    }
    return _client;
}

/**
 * Gracefully stop the shared CopilotClient.
 */
export async function stopClient() {
    if (_client) {
        await _client.stop();
        _client = null;
    }
}

// ── Session helpers ──────────────────────────────────────────────────────────

/**
 * Create a Copilot SDK session pre-configured with a system prompt.
 *
 * @param {string}  systemPrompt  — full system prompt for the agent
 * @param {object}  [opts]
 * @param {boolean} [opts.streaming=false] — enable streaming delta events
 * @returns {Promise<import('@github/copilot-sdk').CopilotSession>}
 */
export async function createAgentSession(systemPrompt, { streaming = false } = {}) {
    const client = await getClient();

    const config = {
        model,
        onPermissionRequest: approveAll,
        streaming,
        systemMessage: { mode: "replace", content: systemPrompt },
    };

    const providerConfig = buildProviderConfig();
    if (providerConfig) {
        config.provider = providerConfig;
    }

    return client.createSession(config);
}
