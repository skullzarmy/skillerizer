# 🎯 Skillerizer

**Feed a website or any content source, get a comprehensive Claude-style `skills.md` document.**

Skillerizer is a locally-hosted web interface powered by the [**GitHub Copilot SDK**](https://github.com/github/copilot-sdk). It uses an agentic pipeline backed by Copilot's production-tested agent runtime. It has an upfront conversation to understand exactly what kind of skill you need — interactive guidance, knowledge extraction, or both — then coordinates multiple specialised AI agents to produce a high-quality `skills.md` document ready for use as AI agent context.

![Skillerizer UI](https://github.com/user-attachments/assets/8d536db7-0dce-4585-8434-977b66b40812)

---

## Features

- 🗣️ **Upfront clarification conversation** — the AI asks focused questions to understand your intent before generating anything
- 🤖 **Agentic pipeline** powered by `@github/copilot-sdk`:
    - **Clarifier** — captures skill purpose, consumer, and emphasis (persistent SDK session)
    - **Analyzer** — classifies the source as `interaction`, `extraction`, or `hybrid` and extracts structured facts (ephemeral SDK session)
    - **Writer** — streams a complete, well-formatted `skills.md` document (ephemeral SDK session with streaming)
- 🔗 **URL or paste** — fetch any public URL, or paste raw text/docs directly
- ⚡ **Real-time streaming** via SSE — watch the skill being written token by token
- 📋 **Copy / Download** the final `skills.md` with one click
- 🎨 **Modern dark-theme UI** — buttery-smooth, zero external framework dependencies
- 🔑 **BYOK support** — use your own OpenAI, Anthropic, or Ollama keys via the SDK's provider config

---

## Quickstart

### 1. Prerequisites

- **Node.js ≥ 18**
- **GitHub Copilot CLI** installed and in your PATH ([installation guide](https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli))
    ```bash
    copilot --version   # verify it's installed
    ```
- A **GitHub Copilot subscription** (free tier available), or BYOK API keys

### 2. Install & configure

```bash
git clone https://github.com/skullzarmy/skillerizer
cd skillerizer
npm install
# Optional — only needed for BYOK providers (OpenAI, Anthropic, Ollama)
cp .env.example .env
```

### 3. Run

```bash
npm start
# → http://localhost:3000
```

Or for development with auto-reload:

```bash
npm run dev
```

---

## Configuration (`.env`)

> **If you're using the default GitHub Copilot provider**, you don't need to configure any environment variables. The GitHub Copilot CLI handles authentication automatically once installed and logged in (`copilot auth login`). The `.env` file is only needed for **BYOK (Bring Your Own Key)** setups when using a non-GitHub provider like OpenAI, Anthropic, or Ollama.

| Variable            | Default                     | Description                                                   |
| ------------------- | --------------------------- | ------------------------------------------------------------- |
| `GITHUB_TOKEN`      | —                           | GitHub token (only needed if not using Copilot CLI auth)      |
| `LLM_PROVIDER`      | `github`                    | `github` \| `openai` \| `ollama` \| `anthropic`               |
| `OPENAI_API_KEY`    | —                           | Required if `LLM_PROVIDER=openai`                             |
| `OLLAMA_BASE_URL`   | `http://localhost:11434/v1` | Override if `LLM_PROVIDER=ollama`                             |
| `ANTHROPIC_API_KEY` | —                           | Required if `LLM_PROVIDER=anthropic`                          |
| `LLM_MODEL`         | `gpt-4o-mini`               | Override model (e.g. `gpt-4o`, `claude-sonnet-4.5`, `llama3`) |
| `PORT`              | `3000`                      | HTTP server port                                              |

---

## How It Works

```
User provides URL / pasted text
        │
        ▼
  ┌─────────────┐
  │  Clarifier  │  ← Persistent SDK session; asks 1-2 questions per turn
  └─────────────┘    until intent is fully understood
        │
        ▼
  ┌─────────────┐
  │   Analyzer  │  ← Ephemeral SDK session; classifies & extracts JSON
  └─────────────┘
        │
        ▼
  ┌─────────────┐
  │    Writer   │  ← Ephemeral SDK session w/ streaming; writes skills.md
  └─────────────┘
        │
        ▼
  Final skills.md  →  Copy / Download
```

Each agent is a **Copilot SDK session** with a specialised system prompt. The SDK manages conversation history, model interaction, and the underlying Copilot CLI process.

---

## API

| Method | Path                             | Description                    |
| ------ | -------------------------------- | ------------------------------ |
| `POST` | `/api/session`                   | Create new session → `{id}`    |
| `POST` | `/api/session/:id/source`        | Attach URL or text             |
| `POST` | `/api/session/:id/clarify/start` | Trigger first AI question      |
| `POST` | `/api/session/:id/message`       | Send a chat reply              |
| `GET`  | `/api/session/:id/generate`      | SSE stream — run full pipeline |
| `GET`  | `/api/session/:id`               | Session state                  |

---

## Project Structure

```
skillerizer/
├── server.js              # Express entry point + Copilot SDK lifecycle
├── src/
│   ├── config.js          # CopilotClient singleton + session factory + BYOK
│   ├── agents/
│   │   ├── clarifier.js   # Clarification agent (persistent SDK session)
│   │   ├── analyzer.js    # Content analysis agent (ephemeral SDK session)
│   │   ├── writer.js      # skills.md generation agent (streaming SDK session)
│   │   └── orchestrator.js# Pipeline coordinator
│   ├── tools/
│   │   └── fetcher.js     # URL → clean text extractor
│   └── routes/
│       └── api.js         # REST + SSE routes + SDK session management
└── public/
    ├── index.html
    ├── css/main.css
    └── js/app.js
```
