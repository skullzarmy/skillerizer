# 🎯 Skillerizer

**Feed a website or any content source, get a comprehensive Claude-style `skills.md` document.**

Skillerizer is a locally-hosted web interface powered by an agentic LLM pipeline. It has an upfront conversation to understand exactly what kind of skill you need — interactive guidance, knowledge extraction, or both — then coordinates multiple specialised AI agents to produce a high-quality `skills.md` document ready for use as AI agent context.

![Skillerizer UI](https://github.com/user-attachments/assets/8d536db7-0dce-4585-8434-977b66b40812)

---

## Features

- 🗣️ **Upfront clarification conversation** — the AI asks focused questions to understand your intent before generating anything
- 🤖 **Agentic pipeline** (OpenClaw-style coordination):
  - **Clarifier** — captures skill purpose, consumer, and emphasis
  - **Analyzer** — classifies the source as `interaction`, `extraction`, or `hybrid` and extracts structured facts
  - **Writer** — streams a complete, well-formatted `skills.md` document
- 🔗 **URL or paste** — fetch any public URL, or paste raw text/docs directly
- ⚡ **Real-time streaming** via SSE — watch the skill being written token by token
- 📋 **Copy / Download** the final `skills.md` with one click
- 🎨 **Modern dark-theme UI** — buttery-smooth, zero external framework dependencies

---

## Quickstart

### 1. Prerequisites

- **Node.js ≥ 18** (uses native `fetch`)
- A **GitHub Personal Access Token** with the `models` scope (free — [create one here](https://github.com/settings/tokens))

### 2. Install & configure

```bash
git clone https://github.com/skullzarmy/skillerizer
cd skillerizer
npm install
cp .env.example .env
# Edit .env and set GITHUB_TOKEN=ghp_...
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

| Variable | Default | Description |
|---|---|---|
| `GITHUB_TOKEN` | — | GitHub PAT with `models` scope (GitHub Models provider) |
| `LLM_PROVIDER` | `github` | `github` \| `openai` \| `ollama` |
| `OPENAI_API_KEY` | — | Required if `LLM_PROVIDER=openai` |
| `OLLAMA_BASE_URL` | `http://localhost:11434/v1` | Required if `LLM_PROVIDER=ollama` |
| `LLM_MODEL` | `openai/gpt-4o-mini` | Override model (e.g. `openai/gpt-4o`, `meta/llama-3.1-70b-instruct`) |
| `PORT` | `3000` | HTTP server port |

---

## How It Works

```
User provides URL / pasted text
        │
        ▼
  ┌─────────────┐
  │  Clarifier  │  ← Asks 1-2 focused questions per turn
  └─────────────┘    until intent is fully understood
        │
        ▼
  ┌─────────────┐
  │   Analyzer  │  ← Classifies skill type, extracts structured facts (JSON)
  └─────────────┘
        │
        ▼
  ┌─────────────┐
  │    Writer   │  ← Streams the complete skills.md (SSE)
  └─────────────┘
        │
        ▼
  Final skills.md  →  Copy / Download
```

---

## API

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/session` | Create new session → `{id}` |
| `POST` | `/api/session/:id/source` | Attach URL or text |
| `POST` | `/api/session/:id/clarify/start` | Trigger first AI question |
| `POST` | `/api/session/:id/message` | Send a chat reply |
| `GET` | `/api/session/:id/generate` | SSE stream — run full pipeline |
| `GET` | `/api/session/:id` | Session state |

---

## Project Structure

```
skillerizer/
├── server.js              # Express entry point
├── src/
│   ├── config.js          # LLM client factory (GitHub Models / OpenAI / Ollama)
│   ├── agents/
│   │   ├── clarifier.js   # Clarification conversation agent
│   │   ├── analyzer.js    # Structured content analysis agent
│   │   ├── writer.js      # skills.md generation agent
│   │   └── orchestrator.js# Pipeline coordinator
│   ├── tools/
│   │   └── fetcher.js     # URL → clean text extractor
│   └── routes/
│       └── api.js         # REST + SSE routes
└── public/
    ├── index.html
    ├── css/main.css
    └── js/app.js
```
