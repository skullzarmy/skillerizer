/**
 * Skillerizer — frontend application
 *
 * State machine:
 *   idle → sourcing → clarifying → ready → generating → done
 *
 * Communicates with the backend via:
 *   - REST  (session create, source attach, chat messages)
 *   - SSE   (skill generation stream)
 */

/* ── State ─────────────────────────────────────────────────────────────────── */
const state = {
  sessionId: null,
  status: 'idle',   // idle | sourcing | clarifying | ready | generating | done
  skill: '',
};

/* ── DOM refs ──────────────────────────────────────────────────────────────── */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const stepSource   = $('#step-source');
const stepClarify  = $('#step-clarify');
const stepGenerate = $('#step-generate');
const stepOutput   = $('#step-output');

const chatMessages = $('#chat-messages');
const chatInput    = $('#chat-input');
const sendBtn      = $('#send-btn');
const generateBtn  = $('#generate-btn');

const agentLog     = $('#agent-log');
const previewArea  = $('#preview-area');
const statusBadge  = $('#status-badge');

/* ── Utility ───────────────────────────────────────────────────────────────── */
async function api(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

function setStatus(status) {
  state.status = status;
  // Map internal states to existing badge CSS classes
  const badgeClass = {
    idle: 'idle',
    sourcing: 'clarifying',
    clarifying: 'clarifying',
    ready: 'clarifying',
    generating: 'generating',
    done: 'done',
    error: 'error',
  }[status] ?? 'idle';
  statusBadge.className = `badge badge-${badgeClass}`;
  statusBadge.textContent = status;
}

function scrollBottom(el) {
  el.scrollTop = el.scrollHeight;
}

function addMsg(role, text) {
  const div = document.createElement('div');
  div.className = `msg msg-${role}`;
  div.textContent = text;
  chatMessages.appendChild(div);
  scrollBottom(chatMessages);
  return div;
}

function addAgentEvent({ type, agent, message }) {
  const icons = {
    pipeline_start: '🚀',
    agent_start:    '⚙️',
    agent_complete: '✅',
    agent_error:    '❌',
    pipeline_done:  '🎉',
    error:          '💥',
  };
  const cls = type === 'agent_complete' || type === 'pipeline_done' ? 'done'
            : type === 'agent_error'    || type === 'error'         ? 'error'
            : 'start';

  const el = document.createElement('div');
  el.className = `agent-event ${cls}`;
  el.innerHTML = `
    <span class="icon">${icons[type] ?? '•'}</span>
    ${agent ? `<span class="agent-tag">${agent}</span>` : ''}
    <span class="text">${escHtml(message ?? type)}</span>
  `;
  agentLog.appendChild(el);
  scrollBottom(agentLog.parentElement);
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Strip the sentinel marker the clarifier uses to signal completion. */
function stripReadyMarker(text) {
  return text.replace(/READY_TO_GENERATE[\s\S]*/i, '').trim() || text;
}

/** Handle readyToGenerate flag from clarifier responses. */
function handleClarifierReady() {
  addMsg('system', '✅ Intent captured. Ready to generate your skill!');
  activateStep('generate');
  setStatus('ready');
}

/* ── Syntax highlight for the monospace preview ───────────────────────────── */
function renderPreview(md) {
  // Very lightweight coloring: we just display raw markdown but tint headings/code
  previewArea.textContent = md; // safe — plain text
}

/* ── Tab switching (URL vs Paste) ─────────────────────────────────────────── */
$$('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === target));
    $$('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${target}`));
  });
});

/* ── New session ───────────────────────────────────────────────────────────── */
async function newSession() {
  const { id } = await api('POST', '/session');
  state.sessionId = id;
  state.skill = '';
  previewArea.textContent = '';
  chatMessages.innerHTML = '';
  agentLog.innerHTML = '';
  setStatus('idle');
  activateStep('source');
}

/* ── Activate a step ──────────────────────────────────────────────────────── */
function activateStep(name) {
  const steps = { source: stepSource, clarify: stepClarify, generate: stepGenerate, output: stepOutput };
  Object.entries(steps).forEach(([key, el]) => {
    el.classList.remove('active', 'done', 'hidden');
    if (key === name) {
      el.classList.add('active');
    } else if (stepOrder(key) < stepOrder(name)) {
      el.classList.add('done');
    } else {
      el.classList.add('hidden');
    }
  });
}

function stepOrder(name) {
  return { source: 0, clarify: 1, generate: 2, output: 3 }[name] ?? 99;
}

/* ── Attach source ────────────────────────────────────────────────────────── */
$('#attach-btn').addEventListener('click', async () => {
  const btn = $('#attach-btn');
  btn.disabled = true;

  try {
    const activeTab = $$('.tab').find((t) => t.classList.contains('active'))?.dataset.tab;
    let body;

    if (activeTab === 'url') {
      const url = $('#url-input').value.trim();
      if (!url) { alert('Please enter a URL.'); return; }
      body = { url };
    } else {
      const text = $('#paste-input').value.trim();
      const title = $('#paste-title').value.trim() || 'Pasted content';
      if (!text) { alert('Please paste some content.'); return; }
      body = { text, title };
    }

    setStatus('sourcing');
    btn.innerHTML = '<span class="spinner"></span> Fetching…';

    const result = await api('POST', `/session/${state.sessionId}/source`, body);

    addMsg('system', `✅ Source loaded: "${result.source.title}"`);
    activateStep('clarify');
    setStatus('clarifying');

    // Trigger the first AI clarifying question (no user message — uses source context)
    await startClarification();
  } catch (err) {
    alert(`Error: ${err.message}`);
    setStatus('idle');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Analyze Source';
  }
});

/* ── Chat ─────────────────────────────────────────────────────────────────── */
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
});
sendBtn.addEventListener('click', handleSend);

async function startClarification() {
  const placeholder = document.createElement('div');
  placeholder.className = 'msg msg-ai';
  placeholder.textContent = '…';
  chatMessages.appendChild(placeholder);
  scrollBottom(chatMessages);

  try {
    const data = await api('POST', `/session/${state.sessionId}/clarify/start`);
    placeholder.textContent = stripReadyMarker(data.reply ?? '');
    if (data.readyToGenerate) handleClarifierReady();
  } catch (err) {
    placeholder.textContent = `⚠️ ${err.message}`;
  }
  scrollBottom(chatMessages);
}

async function handleSend() {
  const text = chatInput.value.trim();
  if (!text || state.status !== 'clarifying') return;
  chatInput.value = '';
  chatInput.disabled = true;
  sendBtn.disabled = true;

  addMsg('user', text);
  await sendMessage(text);

  chatInput.disabled = false;
  sendBtn.disabled = false;
  chatInput.focus();
}

async function sendMessage(content) {
  // Use a placeholder for AI streaming
  const placeholder = document.createElement('div');
  placeholder.className = 'msg msg-ai';
  placeholder.textContent = '…';
  chatMessages.appendChild(placeholder);
  scrollBottom(chatMessages);

  try {
    const data = await api('POST', `/session/${state.sessionId}/message`, { content });
    placeholder.textContent = stripReadyMarker(data.reply ?? '');
    if (data.readyToGenerate) handleClarifierReady();
  } catch (err) {
    placeholder.textContent = `⚠️ ${err.message}`;
  }

  scrollBottom(chatMessages);
}

/* ── Generate ─────────────────────────────────────────────────────────────── */
generateBtn.addEventListener('click', startGeneration);

async function startGeneration() {
  if (!state.sessionId) return;

  generateBtn.disabled = true;
  setStatus('generating');
  activateStep('generate');
  agentLog.innerHTML = '';
  previewArea.textContent = '';

  const evtSource = new EventSource(`/api/session/${state.sessionId}/generate`);
  let skillBuffer = '';

  evtSource.onmessage = (e) => {
    const event = JSON.parse(e.data);

    if (event.type === 'skill_chunk') {
      skillBuffer += event.chunk;
      renderPreview(skillBuffer);
    } else if (event.type === 'pipeline_done') {
      state.skill = event.skill;
      evtSource.close();
      setStatus('done');
      activateStep('output');
      generateBtn.disabled = false;
    } else if (event.type === 'error') {
      addAgentEvent({ type: 'error', message: event.message });
      evtSource.close();
      setStatus('error');
      generateBtn.disabled = false;
    } else {
      addAgentEvent(event);
    }
  };

  evtSource.onerror = () => {
    evtSource.close();
    if (state.status === 'generating') {
      addAgentEvent({ type: 'error', message: 'Connection lost.' });
      setStatus('error');
      generateBtn.disabled = false;
    }
  };
}

/* ── Copy / Download ──────────────────────────────────────────────────────── */
$('#copy-btn').addEventListener('click', async () => {
  const text = state.skill || previewArea.textContent;
  if (!text) return;
  await navigator.clipboard.writeText(text);
  const btn = $('#copy-btn');
  const orig = btn.textContent;
  btn.textContent = '✅ Copied!';
  setTimeout(() => { btn.textContent = orig; }, 2000);
});

$('#download-btn').addEventListener('click', () => {
  const text = state.skill || previewArea.textContent;
  if (!text) return;
  const blob = new Blob([text], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'skill.md';
  a.click();
  URL.revokeObjectURL(a.href);
});

/* ── New session button ───────────────────────────────────────────────────── */
$('#new-session-btn').addEventListener('click', () => {
  if (state.status !== 'idle' && !confirm('Start a new session? Current progress will be lost.')) return;
  newSession();
});

/* ── Boot ─────────────────────────────────────────────────────────────────── */
newSession();
