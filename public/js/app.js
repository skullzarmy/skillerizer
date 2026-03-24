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
    status: "idle", // idle | sourcing | clarifying | ready | generating | done
    skill: "",
};

/* ── DOM refs ──────────────────────────────────────────────────────────────── */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const stepSource = $("#step-source");
const stepClarify = $("#step-clarify");
const stepGenerate = $("#step-generate");
const stepOutput = $("#step-output");

const chatMessages = $("#chat-messages");
const chatInput = $("#chat-input");
const sendBtn = $("#send-btn");
const generateBtn = $("#generate-btn");

const agentLog = $("#agent-log");
const previewArea = $("#preview-area");
const statusBadge = $("#status-badge");

/* ── Utility ───────────────────────────────────────────────────────────────── */
async function api(method, path, body) {
    const res = await fetch(`/api${path}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : {},
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
    const badgeClass =
        {
            idle: "idle",
            sourcing: "clarifying",
            clarifying: "clarifying",
            ready: "clarifying",
            generating: "generating",
            done: "done",
            error: "error",
        }[status] ?? "idle";
    statusBadge.className = `badge badge-${badgeClass}`;
    statusBadge.textContent = status;
}

function scrollBottom(el) {
    el.scrollTop = el.scrollHeight;
}

function addMsg(role, text) {
    const div = document.createElement("div");
    div.className = `msg msg-${role}`;
    div.textContent = text;
    chatMessages.appendChild(div);
    scrollBottom(chatMessages);
    return div;
}

function addAgentEvent({ type, agent, message }) {
    const icons = {
        pipeline_start: "🚀",
        agent_start: "⚙️",
        agent_complete: "✅",
        agent_error: "❌",
        pipeline_done: "🎉",
        error: "💥",
    };
    const cls =
        type === "agent_complete" || type === "pipeline_done"
            ? "done"
            : type === "agent_error" || type === "error"
              ? "error"
              : "start";

    const el = document.createElement("div");
    el.className = `agent-event ${cls}`;
    el.innerHTML = `
    <span class="icon">${icons[type] ?? "•"}</span>
    ${agent ? `<span class="agent-tag">${agent}</span>` : ""}
    <span class="text">${escHtml(message ?? type)}</span>
  `;
    agentLog.appendChild(el);
    scrollBottom(agentLog.parentElement);
}

function escHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Strip the sentinel marker the clarifier uses to signal completion. */
function stripReadyMarker(text) {
    return text.replace(/READY_TO_GENERATE[\s\S]*/i, "").trim() || text;
}

/** Handle readyToGenerate flag from clarifier responses. */
function handleClarifierReady() {
    addMsg("system", "✅ Intent captured. Ready to generate your skill!");
    activateStep("generate");
    setStatus("ready");
}

/* ── Syntax highlight for the monospace preview ───────────────────────────── */
function renderPreview(md) {
    // Very lightweight coloring: we just display raw markdown but tint headings/code
    previewArea.textContent = md; // safe — plain text
}

/* ── Tab switching (URL vs Paste) ─────────────────────────────────────────── */
$$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
        const target = tab.dataset.tab;
        $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === target));
        $$(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === `tab-${target}`));
    });
});

/* ── New session ───────────────────────────────────────────────────────────── */
async function newSession() {
    hideLoadingAnimation();
    hidePreviewActions();
    const { id } = await api("POST", "/session");
    state.sessionId = id;
    state.skill = "";
    previewArea.textContent = "";
    chatMessages.innerHTML = "";
    agentLog.innerHTML = "";
    setStatus("idle");
    activateStep("source");
}

/* ── Activate a step ──────────────────────────────────────────────────────── */
function activateStep(name) {
    const steps = { source: stepSource, clarify: stepClarify, generate: stepGenerate, output: stepOutput };
    Object.entries(steps).forEach(([key, el]) => {
        el.classList.remove("active", "done", "hidden");
        if (key === name) {
            el.classList.add("active");
        } else if (stepOrder(key) < stepOrder(name)) {
            el.classList.add("done");
        } else {
            el.classList.add("hidden");
        }
    });
}

function stepOrder(name) {
    return { source: 0, clarify: 1, generate: 2, output: 3 }[name] ?? 99;
}

/* ── Attach source ────────────────────────────────────────────────────────── */
$("#attach-btn").addEventListener("click", async () => {
    const btn = $("#attach-btn");
    btn.disabled = true;

    try {
        const activeTab = $$(".tab").find((t) => t.classList.contains("active"))?.dataset.tab;
        let body;

        if (activeTab === "url") {
            const url = $("#url-input").value.trim();
            if (!url) {
                alert("Please enter a URL.");
                return;
            }
            body = { url };
        } else {
            const text = $("#paste-input").value.trim();
            const title = $("#paste-title").value.trim() || "Pasted content";
            if (!text) {
                alert("Please paste some content.");
                return;
            }
            body = { text, title };
        }

        setStatus("sourcing");
        btn.innerHTML = '<span class="spinner"></span> Fetching…';

        const result = await api("POST", `/session/${state.sessionId}/source`, body);

        addMsg("system", `✅ Source loaded: "${result.source.title}"`);
        activateStep("clarify");
        setStatus("clarifying");

        // Trigger the first AI clarifying question (no user message — uses source context)
        await startClarification();
    } catch (err) {
        alert(`Error: ${err.message}`);
        setStatus("idle");
    } finally {
        btn.disabled = false;
        btn.innerHTML = "Analyze Source";
    }
});

/* ── Chat ─────────────────────────────────────────────────────────────────── */
chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
    }
});
sendBtn.addEventListener("click", handleSend);

async function startClarification() {
    const placeholder = document.createElement("div");
    placeholder.className = "msg msg-ai";
    placeholder.textContent = "…";
    chatMessages.appendChild(placeholder);
    scrollBottom(chatMessages);

    try {
        const data = await api("POST", `/session/${state.sessionId}/clarify/start`);
        placeholder.textContent = stripReadyMarker(data.reply ?? "");
        if (data.readyToGenerate) handleClarifierReady();
    } catch (err) {
        placeholder.textContent = `⚠️ ${err.message}`;
    }
    scrollBottom(chatMessages);
}

async function handleSend() {
    const text = chatInput.value.trim();
    if (!text || state.status !== "clarifying") return;
    chatInput.value = "";
    chatInput.disabled = true;
    sendBtn.disabled = true;

    addMsg("user", text);
    await sendMessage(text);

    chatInput.disabled = false;
    sendBtn.disabled = false;
    chatInput.focus();
}

async function sendMessage(content) {
    // Use a placeholder for AI streaming
    const placeholder = document.createElement("div");
    placeholder.className = "msg msg-ai";
    placeholder.textContent = "…";
    chatMessages.appendChild(placeholder);
    scrollBottom(chatMessages);

    try {
        const data = await api("POST", `/session/${state.sessionId}/message`, { content });
        placeholder.textContent = stripReadyMarker(data.reply ?? "");
        if (data.readyToGenerate) handleClarifierReady();
    } catch (err) {
        placeholder.textContent = `⚠️ ${err.message}`;
    }

    scrollBottom(chatMessages);
}

/* ── Page-Transfer Loading Animation ───────────────────────────────────────── */
let _loadingAnim = null;

function _svgSquiggle(w) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("width", String(w));
    svg.setAttribute("height", "4");
    svg.setAttribute("viewBox", `0 0 ${w} 4`);
    svg.style.display = "block";

    let d = "M0,2";
    for (let x = 0; x < w; x += 6) {
        const cy = Math.floor(x / 6) % 2 ? 3.5 : 0.5;
        d += ` Q${x + 3},${cy} ${Math.min(x + 6, w)},2`;
    }

    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", d);
    p.setAttribute("stroke", "currentColor");
    p.setAttribute("stroke-width", "2");
    p.setAttribute("fill", "none");
    p.setAttribute("stroke-linecap", "round");
    svg.appendChild(p);
    return svg;
}

function _buildLoadingAnim() {
    const WIDTHS = [88, 62, 95, 48, 78, 40];
    const COLORS = [
        "var(--accent)",
        "var(--accent2)",
        "var(--accent)",
        "var(--accent2)",
        "var(--accent)",
        "var(--accent2)",
    ];
    const X = 35,
        Y0 = 52,
        GAP = 22;

    const wrap = document.createElement("div");
    wrap.className = "loading-animation";

    const scene = document.createElement("div");
    scene.className = "la-scene";

    const pL = document.createElement("div");
    pL.className = "la-page la-page-left";
    const pR = document.createElement("div");
    pR.className = "la-page la-page-right";
    scene.append(pL, pR);

    const lines = WIDTHS.map((w, i) => {
        const el = document.createElement("div");
        el.className = "la-line";
        el.style.cssText = `left:${X}px;top:${Y0 + i * GAP}px;width:${w}px;color:${COLORS[i]}`;
        el.appendChild(_svgSquiggle(w));
        scene.appendChild(el);
        return el;
    });

    const label = document.createElement("p");
    label.className = "la-label";
    label.textContent = "Generating your skill document\u2026";

    wrap.append(scene, label);
    return { wrap, pR, lines };
}

const _sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function _animLoop(ctx) {
    while (ctx.active) {
        const { pR, lines } = ctx;

        // Staggered fade-in on left page
        for (let i = 0; i < lines.length; i++) {
            if (!ctx.active) return;
            lines[i].className = "la-line la-visible";
            await _sleep(80);
        }
        await _sleep(400);

        // Transfer lines one by one
        for (const l of lines) {
            if (!ctx.active) return;
            l.className = "la-line la-transfer";
            await _sleep(380);
        }

        // Wait for last line to land
        await _sleep(750);
        if (!ctx.active) return;

        // Fly everything away
        pR.className = "la-page la-page-right la-fly";
        for (const l of lines) l.className = "la-line la-fly";
        await _sleep(700);
        if (!ctx.active) return;

        // Instant reset (no transition)
        pR.className = "la-page la-page-right la-reset";
        for (const l of lines) l.className = "la-line";
        await _sleep(50);
        pR.className = "la-page la-page-right";
        await _sleep(250);
    }
}

function showLoadingAnimation() {
    hideLoadingAnimation();
    const ctx = _buildLoadingAnim();
    ctx.active = true;
    _loadingAnim = ctx;
    previewArea.style.display = "none";
    $("#right-panel").appendChild(ctx.wrap);
    _animLoop(ctx);
}

function hideLoadingAnimation() {
    if (!_loadingAnim) return;
    _loadingAnim.active = false;
    _loadingAnim.wrap.remove();
    _loadingAnim = null;
    previewArea.style.display = "";
}

/* ── Generate ─────────────────────────────────────────────────────────────── */
generateBtn.addEventListener("click", startGeneration);

async function startGeneration() {
    if (!state.sessionId) return;

    generateBtn.disabled = true;
    setStatus("generating");
    activateStep("generate");
    agentLog.innerHTML = "";
    previewArea.textContent = "";
    showLoadingAnimation();

    const evtSource = new EventSource(`/api/session/${state.sessionId}/generate`);
    let skillBuffer = "";

    evtSource.onmessage = (e) => {
        const event = JSON.parse(e.data);

        if (event.type === "skill_chunk") {
            hideLoadingAnimation();
            skillBuffer += event.chunk;
            renderPreview(skillBuffer);
            showPreviewActions();
        } else if (event.type === "pipeline_done") {
            hideLoadingAnimation();
            state.skill = event.skill;
            evtSource.close();
            setStatus("done");
            activateStep("output");
            generateBtn.disabled = false;
        } else if (event.type === "error") {
            hideLoadingAnimation();
            addAgentEvent({ type: "error", message: event.message });
            evtSource.close();
            setStatus("error");
            generateBtn.disabled = false;
        } else {
            addAgentEvent(event);
        }
    };

    evtSource.onerror = () => {
        hideLoadingAnimation();
        evtSource.close();
        if (state.status === "generating") {
            addAgentEvent({ type: "error", message: "Connection lost." });
            setStatus("error");
            generateBtn.disabled = false;
        }
    };
}

/* ── Copy / Download (step 4 + preview toolbar) ───────────────────────────── */
function copySkill(btn) {
  const text = state.skill || previewArea.textContent;
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = '✅ Copied!';
    setTimeout(() => { btn.textContent = orig; }, 2000);
  });
}

function downloadSkill() {
  const text = state.skill || previewArea.textContent;
  if (!text) return;
  const blob = new Blob([text], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'skill.md';
  a.click();
  URL.revokeObjectURL(a.href);
}

function showPreviewActions() {
  $('#preview-copy-btn').style.display = '';
  $('#preview-download-btn').style.display = '';
}

function hidePreviewActions() {
  $('#preview-copy-btn').style.display = 'none';
  $('#preview-download-btn').style.display = 'none';
}

$('#copy-btn').addEventListener('click', () => copySkill($('#copy-btn')));
$('#download-btn').addEventListener('click', downloadSkill);
$('#preview-copy-btn').addEventListener('click', () => copySkill($('#preview-copy-btn')));
$('#preview-download-btn').addEventListener('click', downloadSkill);

/* ── New session button ───────────────────────────────────────────────────── */
$("#new-session-btn").addEventListener("click", () => {
    if (state.status !== "idle" && !confirm("Start a new session? Current progress will be lost.")) return;
    newSession();
});

/* ── Boot ─────────────────────────────────────────────────────────────────── */
newSession();
