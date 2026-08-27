/* ==========================================================================
 * assistant.js  —  Gemini Web Assistant (GitHub-hosted application)
 * --------------------------------------------------------------------------
 * This is the full application, loaded on demand by the tiny bookmarklet.
 * It renders entirely inside a Shadow DOM so the host page cannot break its
 * styling and it cannot break the host page.
 *
 * SECURITY: No API key lives in this file. Keys are entered by the user in
 * Settings -> AI and stored in localStorage on the user's own device, or a
 * server-side proxy (config.PROXY_URL) is used so the key stays server-side.
 * ========================================================================== */
(function () {
  "use strict";

  /* If already running, focus and stop. Belt-and-suspenders with the loader. */
  if (window.__GEMINI_ASSISTANT__) {
    try { window.__GEMINI_ASSISTANT__.open(); } catch (e) {}
    return;
  }

  var VERSION = window.__GEMINI_ASSISTANT_VERSION__ || "1.0.4";
  var BASE = (window.__GEMINI_ASSISTANT_BASE__ || "").replace(/\/+$/, "");

  /* ------------------------------------------------------------------ *
   * Config: prefer window.GEMINI_ASSISTANT_CONFIG (from config.js).
   * If config.js was not loaded (e.g. assistant.js loaded standalone),
   * we fetch it from BASE, then fall back to sane defaults.
   * ------------------------------------------------------------------ */
  var DEFAULT_CONFIG = {
    GITHUB_SCRIPT_URL: BASE,
    VERSION: VERSION,
    PROXY_URL: "",
    MODELS: [
      { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash" },
      { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite" },
    ],
    DEFAULT_MODEL: "gemini-3.6-flash",
    DEFAULT_MODE: "game",
    ENABLE_UPDATE_CHECK: true,
    CACHE_BUSTING: true,
  };

  var STORAGE_KEY = "geminiAssistant.settings.v1";
  var HISTORY_KEY = "geminiAssistant.history.v1";

  /* ------------------------------------------------------------------ *
   * Small helpers
   * ------------------------------------------------------------------ */
  function bust(url) {
    var cfg = window.GEMINI_ASSISTANT_CONFIG || DEFAULT_CONFIG;
    if (!cfg.CACHE_BUSTING) return url;
    return url + (url.indexOf("?") === -1 ? "?" : "&") + "v=" + encodeURIComponent(cfg.VERSION || VERSION);
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function debounce(fn, ms) {
    var t; return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms); };
  }
  function loadSettings() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return {};
  }
  function saveSettings(s) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (e) {}
  }

  /* ------------------------------------------------------------------ *
   * State
   * ------------------------------------------------------------------ */
  var CONFIG = window.GEMINI_ASSISTANT_CONFIG || DEFAULT_CONFIG;
  var stored = loadSettings();
  var state = {
    enabled: stored.enabled !== false,
    mode: stored.mode || CONFIG.DEFAULT_MODE || "game",
    apiKey: stored.apiKey || "",
    model: stored.model || CONFIG.DEFAULT_MODEL || "gemini-3.6-flash",
    temperature: typeof stored.temperature === "number" ? stored.temperature : 0.4,
    theme: stored.theme || "dark",
    scale: typeof stored.scale === "number" ? stored.scale : 1,
    opacity: typeof stored.opacity === "number" ? stored.opacity : 1,
    compact: !!stored.compact,
    answerSize: stored.answerSize || "large",
    position: stored.position || null,
    size: stored.size || null,
    // game mode
    autoAnalyze: stored.autoAnalyze !== false,
    detectQuestions: stored.detectQuestions !== false,
    detectAnswers: stored.detectAnswers !== false,
    answerOnly: !!stored.answerOnly,
    showExplanation: stored.showExplanation !== false,
    showConfidence: stored.showConfidence !== false,
    analysisDelay: typeof stored.analysisDelay === "number" ? stored.analysisDelay : 1200,
    // privacy
    saveHistory: stored.saveHistory !== false,
    privateMode: !!stored.privateMode,
    // context controls
    ctx: Object.assign({
      question: true, choices: true, pageText: true,
      selection: false, title: false, conversation: false,
    }, stored.ctx || {}),
    // advanced
    debug: !!stored.debug,
    proxyUrl: stored.proxyUrl || CONFIG.PROXY_URL || "",
    scriptUrl: stored.scriptUrl || CONFIG.GITHUB_SCRIPT_URL || BASE || "",
  };

  var runtime = {
    conversation: [],           // {role, text}
    lastQuestionSig: "",        // to detect question changes
    busy: false,
    observer: null,
    minimized: false,
  };

  function persist() {
    saveSettings({
      enabled: state.enabled, mode: state.mode, apiKey: state.apiKey, model: state.model,
      temperature: state.temperature, theme: state.theme, scale: state.scale, opacity: state.opacity,
      compact: state.compact, answerSize: state.answerSize, position: state.position, size: state.size,
      autoAnalyze: state.autoAnalyze, detectQuestions: state.detectQuestions, detectAnswers: state.detectAnswers,
      answerOnly: state.answerOnly, showExplanation: state.showExplanation, showConfidence: state.showConfidence,
      analysisDelay: state.analysisDelay, saveHistory: state.saveHistory, privateMode: state.privateMode,
      ctx: state.ctx, debug: state.debug, proxyUrl: state.proxyUrl, scriptUrl: state.scriptUrl,
    });
  }
  function log() {
    if (state.debug) { try { console.log.apply(console, ["[GeminiAssistant]"].concat([].slice.call(arguments))); } catch (e) {} }
  }

  /* ================================================================== *
   * Shadow DOM host + stylesheet injection
   * ================================================================== */
  var host = document.createElement("div");
  host.id = "gemini-assistant-host";
  // Reset the host itself; nothing leaks in or out beyond position.
  host.style.cssText = "all:initial;position:fixed;z-index:2147483647;top:0;left:0;width:0;height:0;";
  document.documentElement.appendChild(host);
  var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;

  // Load external stylesheet into the shadow root, with an inline fallback.
  function injectStyles() {
    var applied = false;
    if (BASE) {
      var link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = bust(BASE + "/styles.css");
      link.onload = function () { applied = true; log("styles.css loaded"); };
      link.onerror = function () { if (!applied) injectFallbackStyles(); };
      root.appendChild(link);
      // Also add fallback shortly after in case link fails silently.
      setTimeout(function () { if (!applied) injectFallbackStyles(); }, 1500);
    } else {
      injectFallbackStyles();
    }
  }
  function injectFallbackStyles() {
    if (root.getElementById && root.getElementById("ga-fallback-style")) return;
    var st = document.createElement("style");
    st.id = "ga-fallback-style";
    st.textContent = FALLBACK_CSS;
    root.appendChild(st);
    log("fallback CSS injected");
  }

  /* Minimal inline CSS so the assistant is usable even if styles.css fails.
     The full, polished styling lives in styles.css. */
  var FALLBACK_CSS = [
    ":host,*{box-sizing:border-box}",
    ".ga-panel{position:fixed;top:80px;right:24px;width:380px;max-width:92vw;",
    "font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#e8eaf0;",
    "background:#12141c;border:1px solid #2a2f42;border-radius:16px;overflow:hidden;",
    "box-shadow:0 20px 60px rgba(0,0,0,.5);display:flex;flex-direction:column;max-height:80vh}",
    ".ga-header{display:flex;align-items:center;gap:8px;padding:12px 14px;background:#1a1d29;cursor:move;user-select:none}",
    ".ga-body{padding:14px;overflow:auto}",
    ".ga-btn{background:#5b6cff;color:#fff;border:0;border-radius:10px;padding:8px 12px;cursor:pointer;font-size:14px}",
    ".ga-btn.secondary{background:#242a3d;color:#c7cbe0}",
    ".ga-input,.ga-textarea,.ga-select{width:100%;background:#0d0f16;color:#e8eaf0;border:1px solid #2a2f42;border-radius:10px;padding:9px 11px;font-size:14px}",
    ".ga-answer{font-size:34px;font-weight:800;text-align:center;padding:16px;color:#fff}",
    ".ga-tabbar{display:flex;flex-wrap:wrap;gap:4px;padding:8px}",
    ".ga-tabbar button{flex:1;background:#1a1d29;color:#c7cbe0;border:0;padding:8px;border-radius:8px;cursor:pointer;font-size:12px}",
    ".ga-tabbar button.active{background:#5b6cff;color:#fff}",
  ].join("");

  injectStyles();

  /* ================================================================== *
   * Build the panel
   * ================================================================== */
  var panel = document.createElement("div");
  panel.className = "ga-panel" + (state.compact ? " ga-compact" : "");
  panel.setAttribute("data-theme", state.theme);
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Gemini Assistant");

  // Apply saved geometry / appearance
  function applyGeometry() {
    if (state.position) {
      panel.style.left = state.position.left + "px";
      panel.style.top = state.position.top + "px";
      panel.style.right = "auto";
    }
    if (state.size) {
      panel.style.width = state.size.w + "px";
      panel.style.height = state.size.h + "px";
    }
    panel.style.opacity = String(state.opacity);
    panel.style.transform = "scale(" + state.scale + ")";
    panel.style.transformOrigin = "top right";
    panel.setAttribute("data-theme", state.theme);
    panel.setAttribute("data-answersize", state.answerSize);
  }

  var MODE_LABELS = {
    general: "GENERAL AI",
    game: "GAME MODE",
    study: "STUDY MODE",
    analyze: "ANALYZE PAGE",
  };
  var MODE_ICONS = { general: "\u{1F4AC}", game: "\u{1F3AE}", study: "\u{1F4D6}", analyze: "\u{1F9E0}" };

  panel.innerHTML = [
    '<div class="ga-header" data-drag>',
    '  <span class="ga-brand">\u2726 Gemini Assistant</span>',
    '  <span class="ga-mode-badge" data-mode-badge>' + MODE_ICONS[state.mode] + " " + MODE_LABELS[state.mode] + "</span>",
    '  <span class="ga-spacer"></span>',
    '  <button class="ga-icon" data-act="min" title="Minimize" aria-label="Minimize">\u2212</button>',
    '  <button class="ga-icon" data-act="settings" title="Settings" aria-label="Settings">\u2699</button>',
    '  <button class="ga-icon" data-act="close" title="Close" aria-label="Close">\u2715</button>',
    "</div>",
    '<div class="ga-modebar" data-modebar>',
    '  <button data-mode="general">\u{1F4AC} General</button>',
    '  <button data-mode="game">\u{1F3AE} Game</button>',
    '  <button data-mode="study">\u{1F4D6} Study</button>',
    '  <button data-mode="analyze">\u{1F9E0} Analyze</button>',
    "</div>",
    '<div class="ga-body" data-body></div>',
    '<div class="ga-resize" data-resize aria-hidden="true"></div>',
  ].join("");

  root.appendChild(panel);
  applyGeometry();

  var elBody = panel.querySelector("[data-body]");
  var elModeBadge = panel.querySelector("[data-mode-badge]");
  var elModebar = panel.querySelector("[data-modebar]");

  function refreshModeUI() {
    elModeBadge.textContent = MODE_ICONS[state.mode] + " " + MODE_LABELS[state.mode];
    Array.prototype.forEach.call(elModebar.querySelectorAll("button"), function (b) {
      b.classList.toggle("active", b.getAttribute("data-mode") === state.mode);
    });
  }

  /* ================================================================== *
   * VIEWS
   * ================================================================== */
  var currentView = "mode"; // "mode" | "settings"

  function render() {
    if (currentView === "settings") { renderSettings(); return; }
    refreshModeUI();
    if (state.mode === "game") renderGame();
    else if (state.mode === "analyze") renderAnalyze();
    else renderChat(); // general + study share the chat view with different prompts
  }

  /* ---------------------------- GAME VIEW --------------------------- */
  var gameData = { question: "", choices: [], answer: "", explanation: "", confidence: "" };

  function renderGame() {
    elBody.innerHTML = [
      '<div class="ga-section">',
      '  <div class="ga-row">',
      '    <button class="ga-btn" data-act="analyze-now">\u{1F50D} Analyze Question</button>',
      '    <button class="ga-btn secondary" data-act="manual-q">\u270D Manual</button>',
      "  </div>",
      '  <div class="ga-label">QUESTION</div>',
      '  <div class="ga-question" data-q>' + (gameData.question ? esc(gameData.question) : '<span class="ga-muted">Waiting for a question\u2026</span>') + "</div>",
      state.answerOnly ? "" : renderChoicesBlock(),
      '  <div class="ga-label">ANSWER</div>',
      '  <div class="ga-answer" data-answer>' + (gameData.answer ? renderAnswer() : '<span class="ga-muted">\u2014</span>') + "</div>",
      state.showExplanation && gameData.explanation
        ? '<div class="ga-label">Explanation</div><div class="ga-explain" data-explain>' + esc(gameData.explanation) + "</div>"
        : "",
      "</div>",
      '<div class="ga-manualbox" data-manualbox hidden>',
      '  <textarea class="ga-textarea" data-manual-input placeholder="Paste or type the question (and choices) here\u2026" rows="3"></textarea>',
      '  <button class="ga-btn" data-act="manual-run">Analyze</button>',
      "</div>",
      '<div class="ga-status" data-status></div>',
    ].join("");
    bindGame();
    // Auto analyze on first open if enabled.
    if (state.autoAnalyze) scheduleAutoAnalyze();
  }
  function renderChoicesBlock() {
    if (!gameData.choices.length) return "";
    var items = gameData.choices.map(function (c) {
      var correct = gameData.answer && (c === gameData.answer || String(gameData.answer).toLowerCase().indexOf(String(c).toLowerCase()) !== -1);
      return '<li class="' + (correct ? "correct" : "") + '">' + esc(c) + "</li>";
    }).join("");
    return '<div class="ga-label">CHOICES</div><ul class="ga-choices">' + items + "</ul>";
  }
  function renderAnswer() {
    var conf = "";
    if (state.showConfidence && gameData.confidence) {
      var c = String(gameData.confidence).toLowerCase();
      var dot = c.indexOf("high") !== -1 ? "\u{1F7E2}" : c.indexOf("low") !== -1 ? "\u{1F534}" : "\u{1F7E1}";
      conf = '<span class="ga-conf">' + dot + "</span> ";
    }
    return conf + esc(gameData.answer);
  }
  function bindGame() {
    elBody.querySelector('[data-act="analyze-now"]').onclick = function () { analyzeQuestion(true); };
    var manualBox = elBody.querySelector("[data-manualbox]");
    elBody.querySelector('[data-act="manual-q"]').onclick = function () { manualBox.hidden = !manualBox.hidden; };
    elBody.querySelector('[data-act="manual-run"]').onclick = function () {
      var v = elBody.querySelector("[data-manual-input]").value.trim();
      if (v) analyzeQuestion(true, v);
    };
  }

  /* --------------------------- CHAT VIEW ---------------------------- */
  function renderChat() {
    var placeholder = state.mode === "study" ? "Ask to explain, summarize, or make practice questions\u2026" : "Ask Gemini anything\u2026";
    elBody.innerHTML = [
      '<div class="ga-chat" data-chat></div>',
      '<div class="ga-composer">',
      '  <textarea class="ga-textarea" data-chat-input placeholder="' + esc(placeholder) + '" rows="2"></textarea>',
      '  <div class="ga-row">',
      '    <button class="ga-btn" data-act="send">Send</button>',
      '    <button class="ga-btn secondary" data-act="regen" title="Regenerate last answer">Regenerate</button>',
      '    <button class="ga-btn secondary" data-act="clear" title="Clear chat">Clear</button>',
      '    <button class="ga-btn secondary" data-act="newconv" title="New conversation">New</button>',
      "  </div>",
      "</div>",
      '<div class="ga-status" data-status></div>',
    ].join("");
    bindChat();
    renderConversation();
  }
  function renderConversation() {
    var box = elBody.querySelector("[data-chat]");
    if (!box) return;
    if (!runtime.conversation.length) {
      box.innerHTML = '<div class="ga-muted ga-empty">No messages yet.</div>';
      return;
    }
    box.innerHTML = runtime.conversation.map(function (m, i) {
      var tools = m.role === "assistant"
        ? '<div class="ga-msg-tools"><button data-copy="' + i + '">Copy</button></div>' : "";
      return '<div class="ga-msg ' + m.role + '"><div class="ga-msg-text">' + esc(m.text) + "</div>" + tools + "</div>";
    }).join("");
    box.scrollTop = box.scrollHeight;
    Array.prototype.forEach.call(box.querySelectorAll("[data-copy]"), function (btn) {
      btn.onclick = function () {
        var idx = +btn.getAttribute("data-copy");
        try { navigator.clipboard.writeText(runtime.conversation[idx].text); btn.textContent = "Copied"; setTimeout(function(){btn.textContent="Copy";}, 1200); } catch (e) {}
      };
    });
  }
  function bindChat() {
    var input = elBody.querySelector("[data-chat-input]");
    function send() {
      var v = input.value.trim();
      if (!v) return;
      input.value = "";
      sendChat(v);
    }
    elBody.querySelector('[data-act="send"]').onclick = send;
    elBody.querySelector('[data-act="regen"]').onclick = regenerate;
    elBody.querySelector('[data-act="clear"]').onclick = function () { runtime.conversation = []; saveHistoryMaybe(); renderConversation(); };
    elBody.querySelector('[data-act="newconv"]').onclick = function () { runtime.conversation = []; saveHistoryMaybe(); renderConversation(); };
    input.addEventListener("keydown", function (e) {
      // Enter to send, Shift+Enter for newline. Respect IME composition.
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent?.isComposing && e.keyCode !== 229 && !e.isComposing) {
        e.preventDefault(); send();
      }
    });
  }

  /* -------------------------- ANALYZE VIEW -------------------------- */
  function renderAnalyze() {
    elBody.innerHTML = [
      '<div class="ga-section">',
      '  <p class="ga-muted ga-small">Extracts readable text from this page (visible DOM content) and asks Gemini to summarize / analyze it. It cannot capture the physical screen \u2014 only accessible page content.</p>',
      '  <div class="ga-row">',
      '    <button class="ga-btn" data-act="analyze-page">\u{1F50D} Analyze Page</button>',
      '    <button class="ga-btn secondary" data-act="analyze-selection">Analyze Selection</button>',
      "  </div>",
      '  <label class="ga-filelabel">Optional image (multimodal): <input type="file" accept="image/*" data-image></label>',
      '  <div class="ga-result" data-result><span class="ga-muted">Results appear here.</span></div>',
      "</div>",
      '<div class="ga-status" data-status></div>',
    ].join("");
    elBody.querySelector('[data-act="analyze-page"]').onclick = function () { analyzePage(false); };
    elBody.querySelector('[data-act="analyze-selection"]').onclick = function () { analyzePage(true); };
  }

  /* ================================================================== *
   * Page content extraction
   * ================================================================== */
  function getPageText(limit) {
    limit = limit || 8000;
    var clone;
    try {
      // Prefer main/article if present.
      var main = document.querySelector("main, article, [role=main]") || document.body;
      clone = main.cloneNode(true);
      Array.prototype.forEach.call(clone.querySelectorAll("script,style,noscript,svg,canvas,iframe"), function (n) { n.remove(); });
    } catch (e) { clone = document.body; }
    var text = (clone.innerText || clone.textContent || "").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    return text.slice(0, limit);
  }
  function getSelectionText() {
    try { return String(window.getSelection ? window.getSelection().toString() : "").trim(); } catch (e) { return ""; }
  }
  function getPageTitle() { return document.title || location.hostname; }

  // Heuristic question + choices detection for quiz/game pages.
  function detectQuestion() {
    var q = "", choices = [];
    // Common quiz containers by role or class hints.
    var qSelectors = [
      "[data-functional-selector*=question]", ".question-title", ".question-text",
      "[class*=question]", "[id*=question]", "h1", "h2",
    ];
    for (var i = 0; i < qSelectors.length && !q; i++) {
      var node = document.querySelector(qSelectors[i]);
      if (node && node.innerText && node.innerText.trim().length > 3) q = node.innerText.trim();
    }
    // Choice buttons: Kahoot/Blooket/quizlet-like.
    var cSelectors = ["[data-functional-selector*=answer]", "[class*=answer] button", "[class*=choice]", "[class*=option]", "button"];
    for (var j = 0; j < cSelectors.length; j++) {
      var nodes = document.querySelectorAll(cSelectors[j]);
      if (nodes && nodes.length >= 2 && nodes.length <= 8) {
        var texts = Array.prototype.map.call(nodes, function (n) { return (n.innerText || "").trim(); })
          .filter(function (t) { return t && t.length < 120; });
        // De-dupe and require at least 2 plausible short choices.
        texts = texts.filter(function (v, k, a) { return a.indexOf(v) === k; });
        if (texts.length >= 2 && texts.length <= 6) { choices = texts; break; }
      }
    }
    return { question: q, choices: choices };
  }

  /* ================================================================== *
   * Context assembly (respects Context Controls / Privacy)
   * ================================================================== */
  function buildContext(extra) {
    var parts = [];
    var c = state.ctx;
    if (extra && extra.question && c.question) parts.push("Question:\n" + extra.question);
    if (extra && extra.choices && extra.choices.length && c.choices) parts.push("Answer choices:\n- " + extra.choices.join("\n- "));
    if (c.title) parts.push("Page title: " + getPageTitle());
    if (c.selection) { var sel = getSelectionText(); if (sel) parts.push("Selected text:\n" + sel); }
    if (c.pageText && extra && extra.includePageText) parts.push("Page content:\n" + getPageText());
    return parts.join("\n\n");
  }

  /* ================================================================== *
   * Gemini calls (direct or via proxy)
   * ================================================================== */
  function setStatus(msg, kind) {
    var el = elBody.querySelector("[data-status]");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "ga-status" + (kind ? " " + kind : "");
  }

  function callGemini(opts) {
    // opts: { system, user, image (dataURL|null) } -> Promise<string>
    var cfg = window.GEMINI_ASSISTANT_CONFIG || CONFIG;
    var model = state.model || cfg.DEFAULT_MODEL;
    var proxy = state.proxyUrl || cfg.PROXY_URL || "";

    var contentsParts = [];
    if (opts.user) contentsParts.push({ text: opts.user });
    if (opts.image) {
      var m = /^data:(.*?);base64,(.*)$/.exec(opts.image);
      if (m) contentsParts.push({ inline_data: { mime_type: m[1], data: m[2] } });
    }

    var payload = {
      contents: [{ role: "user", parts: contentsParts.length ? contentsParts : [{ text: opts.user || "" }] }],
      generationConfig: { temperature: state.temperature },
    };
    if (opts.system) payload.systemInstruction = { parts: [{ text: opts.system }] };

    var url, headers = { "Content-Type": "application/json" }, body;

    if (proxy) {
      // Proxy keeps the key server-side. Send model + payload; proxy adds key.
      url = proxy;
      body = JSON.stringify({ model: model, payload: payload });
    } else {
      if (!state.apiKey) return Promise.reject(new Error("No API key. Add one in Settings -> AI, or configure a proxy."));
      url = "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent";
      headers["x-goog-api-key"] = state.apiKey;
      body = JSON.stringify(payload);
    }

    log("callGemini", { model: model, proxy: !!proxy });
    return fetch(url, { method: "POST", headers: headers, body: body })
      .then(function (r) {
        return r.text().then(function (t) {
          var json;
          try { json = JSON.parse(t); } catch (e) { json = null; }
          if (!r.ok) {
            var em = (json && json.error && json.error.message) || ("HTTP " + r.status);
            throw new Error(em);
          }
          return json;
        });
      })
      .then(function (json) {
        try {
          var cand = json.candidates && json.candidates[0];
          var text = cand && cand.content && cand.content.parts
            ? cand.content.parts.map(function (p) { return p.text || ""; }).join("")
            : "";
          return text || "(No text returned.)";
        } catch (e) { return "(Unexpected response.)"; }
      });
  }

  /* ================================================================== *
   * Actions: Game analysis
   * ================================================================== */
  var scheduleAutoAnalyze = debounce(function () {
    if (state.mode === "game" && state.autoAnalyze) analyzeQuestion(false);
  }, 300);

  function analyzeQuestion(force, manualText) {
    if (runtime.busy) return;
    var detected = manualText
      ? parseManual(manualText)
      : (state.detectQuestions ? detectQuestion() : { question: "", choices: [] });

    if (!detected.question && !manualText) {
      setStatus("No question detected. Try Manual input.", "warn");
      return;
    }
    var sig = detected.question + "|" + detected.choices.join("|");
    if (!force && sig === runtime.lastQuestionSig) return; // no change
    runtime.lastQuestionSig = sig;

    gameData.question = detected.question;
    gameData.choices = state.detectAnswers ? detected.choices : [];
    gameData.answer = ""; gameData.explanation = ""; gameData.confidence = "";
    render();

    var system =
      "You are a fast, accurate quiz-answering assistant. Given a question and optional choices, " +
      "respond ONLY as compact JSON: {\"answer\":\"...\",\"confidence\":\"high|medium|low\"" +
      (state.showExplanation ? ",\"explanation\":\"one short sentence\"" : "") +
      "}. If choices are given, answer must be exactly one of them.";
    var user = buildContext({ question: detected.question, choices: detected.choices, includePageText: state.ctx.pageText });

    runBusy(function () {
      setStatus("Analyzing\u2026");
      return callGemini({ system: system, user: user }).then(function (text) {
        var parsed = safeJson(text);
        if (parsed) {
          gameData.answer = parsed.answer || "";
          gameData.confidence = parsed.confidence || "";
          gameData.explanation = parsed.explanation || "";
        } else {
          gameData.answer = text.trim();
        }
        setStatus("");
        render();
      });
    });
  }
  function parseManual(text) {
    var lines = text.split("\n").map(function (l) { return l.trim(); }).filter(Boolean);
    return { question: lines[0] || text, choices: lines.slice(1) };
  }
  function safeJson(text) {
    try {
      var m = text.match(/\{[\s\S]*\}/);
      return m ? JSON.parse(m[0]) : null;
    } catch (e) { return null; }
  }

  /* ------------------------- Actions: Chat -------------------------- */
  function sendChat(text) {
    if (runtime.busy) return;
    runtime.conversation.push({ role: "user", text: text });
    saveHistoryMaybe();
    renderConversation();

    var system = state.mode === "study"
      ? "You are a patient study tutor. Explain clearly, summarize when asked, and offer practice questions. Keep answers concise and well structured."
      : "You are a helpful, concise AI assistant.";

    var ctx = buildContext({ includePageText: state.ctx.pageText });
    var convo = state.ctx.conversation
      ? runtime.conversation.map(function (m) { return (m.role === "user" ? "User: " : "Assistant: ") + m.text; }).join("\n")
      : "User: " + text;
    var user = (ctx ? ctx + "\n\n" : "") + convo;

    runBusy(function () {
      setStatus("Thinking\u2026");
      return callGemini({ system: system, user: user }).then(function (answer) {
        runtime.conversation.push({ role: "assistant", text: answer });
        saveHistoryMaybe();
        setStatus("");
        renderConversation();
      });
    });
  }
  function regenerate() {
    // Remove trailing assistant msg (if any) and resend last user msg.
    if (runtime.busy) return;
    for (var i = runtime.conversation.length - 1; i >= 0; i--) {
      if (runtime.conversation[i].role === "assistant") { runtime.conversation.splice(i, 1); break; }
    }
    var lastUser = null;
    for (var j = runtime.conversation.length - 1; j >= 0; j--) {
      if (runtime.conversation[j].role === "user") { lastUser = runtime.conversation[j].text; break; }
    }
    renderConversation();
    if (lastUser) {
      // Avoid double-pushing the user msg.
      var text = lastUser;
      runtime.conversation.pop && null;
      // Re-run by calling model directly with existing history.
      sendChatResend();
    }
  }
  function sendChatResend() {
    var system = state.mode === "study"
      ? "You are a patient study tutor. Explain clearly and concisely."
      : "You are a helpful, concise AI assistant.";
    var convo = runtime.conversation.map(function (m) { return (m.role === "user" ? "User: " : "Assistant: ") + m.text; }).join("\n");
    runBusy(function () {
      setStatus("Regenerating\u2026");
      return callGemini({ system: system, user: convo }).then(function (answer) {
        runtime.conversation.push({ role: "assistant", text: answer });
        saveHistoryMaybe(); setStatus(""); renderConversation();
      });
    });
  }

  /* ----------------------- Actions: Analyze ------------------------- */
  function analyzePage(selectionOnly) {
    if (runtime.busy) return;
    var content = selectionOnly ? getSelectionText() : getPageText(12000);
    if (!content) { setStatus(selectionOnly ? "No text selected." : "No readable text found.", "warn"); return; }
    var fileInput = elBody.querySelector("[data-image]");
    var resultEl = elBody.querySelector("[data-result]");

    function run(imageDataUrl) {
      var system = "You analyze webpage content. Provide: a 2-3 sentence summary, key points as bullets, and anything notable. Be concise.";
      var user = "Page title: " + getPageTitle() + "\n\nContent:\n" + content;
      runBusy(function () {
        setStatus("Analyzing page\u2026");
        resultEl.innerHTML = '<span class="ga-muted">Analyzing\u2026</span>';
        return callGemini({ system: system, user: user, image: imageDataUrl }).then(function (text) {
          resultEl.innerHTML = "<div class='ga-msg-text'>" + esc(text) + "</div>";
          setStatus("");
        });
      });
    }

    if (fileInput && fileInput.files && fileInput.files[0]) {
      var reader = new FileReader();
      reader.onload = function () { run(reader.result); };
      reader.readAsDataURL(fileInput.files[0]);
    } else {
      run(null);
    }
  }

  /* ------------------------- Busy wrapper --------------------------- */
  function runBusy(fn) {
    runtime.busy = true;
    Promise.resolve()
      .then(fn)
      .catch(function (err) { setStatus(String(err && err.message || err), "error"); log("error", err); })
      .then(function () { runtime.busy = false; });
  }
  function saveHistoryMaybe() {
    if (!state.saveHistory || state.privateMode) return;
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(runtime.conversation.slice(-50))); } catch (e) {}
  }
  function loadHistoryMaybe() {
    if (!state.saveHistory || state.privateMode) return;
    try { var raw = localStorage.getItem(HISTORY_KEY); if (raw) runtime.conversation = JSON.parse(raw) || []; } catch (e) {}
  }
  loadHistoryMaybe();

  /* ================================================================== *
   * SETTINGS
   * ================================================================== */
  var settingsTab = "general";
  function renderSettings() {
    elBody.innerHTML = [
      '<div class="ga-tabbar">',
      tabBtn("general", "General"), tabBtn("ai", "AI"), tabBtn("game", "Game"),
      tabBtn("appearance", "Appearance"), tabBtn("privacy", "Privacy"),
      tabBtn("advanced", "Advanced"), tabBtn("about", "About"),
      "</div>",
      '<div class="ga-settings" data-settings></div>',
      '<div class="ga-row"><button class="ga-btn secondary" data-act="back">\u2190 Back to Assistant</button></div>',
    ].join("");
    elBody.querySelector('[data-act="back"]').onclick = function () { currentView = "mode"; render(); };
    Array.prototype.forEach.call(elBody.querySelectorAll("[data-tab]"), function (b) {
      b.onclick = function () { settingsTab = b.getAttribute("data-tab"); renderSettingsBody(); markTabs(); };
    });
    markTabs();
    renderSettingsBody();
  }
  function tabBtn(id, label) { return '<button data-tab="' + id + '">' + label + "</button>"; }
  function markTabs() {
    Array.prototype.forEach.call(elBody.querySelectorAll("[data-tab]"), function (b) {
      b.classList.toggle("active", b.getAttribute("data-tab") === settingsTab);
    });
  }
  function renderSettingsBody() {
    var box = elBody.querySelector("[data-settings]");
    if (settingsTab === "general") box.innerHTML = tGeneral();
    else if (settingsTab === "ai") box.innerHTML = tAI();
    else if (settingsTab === "game") box.innerHTML = tGame();
    else if (settingsTab === "appearance") box.innerHTML = tAppearance();
    else if (settingsTab === "privacy") box.innerHTML = tPrivacy();
    else if (settingsTab === "advanced") box.innerHTML = tAdvanced();
    else if (settingsTab === "about") box.innerHTML = tAbout();
    bindSettings();
  }

  function row(label, control, hint) {
    return '<div class="ga-field"><div class="ga-field-label">' + esc(label) + "</div>" + control +
      (hint ? '<div class="ga-hint">' + esc(hint) + "</div>" : "") + "</div>";
  }
  function toggle(key, label, hint) {
    return '<label class="ga-toggle"><input type="checkbox" data-set="' + key + '" ' + (state[key] ? "checked" : "") + "><span>" + esc(label) + "</span></label>" +
      (hint ? '<div class="ga-hint">' + esc(hint) + "</div>" : "");
  }

  function tGeneral() {
    return [
      row("Assistant", toggle("enabled", "Enabled")),
      row("Default mode",
        '<select class="ga-select" data-set="mode">' +
        ["general", "game", "study", "analyze"].map(function (m) {
          return '<option value="' + m + '"' + (state.mode === m ? " selected" : "") + ">" + MODE_LABELS[m] + "</option>";
        }).join("") + "</select>"),
      row("Startup behavior",
        '<select class="ga-select" data-set="startup">' +
        '<option value="remember"' + (stored.startup === "restore" ? "" : " selected") + ">Open last mode</option>" +
        '<option value="restore"' + (stored.startup === "restore" ? " selected" : "") + ">Restore previous session</option>" +
        "</select>"),
    ].join("");
  }
  function tAI() {
    var models = (CONFIG.MODELS || DEFAULT_CONFIG.MODELS).map(function (m) {
      return '<option value="' + esc(m.id) + '"' + (state.model === m.id ? " selected" : "") + ">" + esc(m.label) + " (" + esc(m.id) + ")</option>";
    }).join("");
    return [
      '<div class="ga-field"><div class="ga-field-label">Gemini API Key</div>',
      '  <div class="ga-keyrow">',
      '    <input class="ga-input" type="password" data-set="apiKey" value="' + esc(state.apiKey) + '" placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" autocomplete="off">',
      '    <button class="ga-btn secondary" data-act="key-show">Show</button>',
      "  </div>",
      '  <div class="ga-row">',
      '    <button class="ga-btn" data-act="key-save">Save</button>',
      '    <button class="ga-btn secondary" data-act="key-test">Test Connection</button>',
      "  </div>",
      '  <div class="ga-hint">Stored only in this browser (localStorage). Never committed to GitHub. For production, use a server-side proxy (Advanced tab).</div>',
      '  <div class="ga-testresult" data-testresult></div>',
      "</div>",
      row("Model", '<select class="ga-select" data-set="model">' + models + "</select>", "Default: Gemini 3.6 Flash"),
      row("Response creativity (temperature)",
        '<input type="range" min="0" max="1" step="0.1" data-set="temperature" value="' + state.temperature + '"><span class="ga-rangeval">' + state.temperature + "</span>"),
    ].join("");
  }
  function tGame() {
    return [
      toggle("autoAnalyze", "Auto Analyze", "Automatically analyze when a new question is detected."),
      toggle("detectQuestions", "Detect questions"),
      toggle("detectAnswers", "Detect answer choices"),
      toggle("answerOnly", "Answer-only mode", "Hide choices/explanation, show just the answer."),
      toggle("showExplanation", "Show explanation"),
      toggle("showConfidence", "Confidence indicator"),
      row("Analysis delay (ms)", '<input class="ga-input" type="number" min="0" step="100" data-set="analysisDelay" value="' + state.analysisDelay + '">',
        "How long to wait after a page change before auto-analyzing."),
    ].join("");
  }
  function tAppearance() {
    return [
      row("Theme",
        '<select class="ga-select" data-set="theme">' +
        ['dark', 'light'].map(function (t) { return '<option value="' + t + '"' + (state.theme === t ? " selected" : "") + ">" + t + "</option>"; }).join("") + "</select>"),
      row("UI scale", '<input type="range" min="0.7" max="1.4" step="0.05" data-set="scale" value="' + state.scale + '"><span class="ga-rangeval">' + state.scale + "</span>"),
      row("Opacity", '<input type="range" min="0.4" max="1" step="0.05" data-set="opacity" value="' + state.opacity + '"><span class="ga-rangeval">' + state.opacity + "</span>"),
      row("Position",
        '<select class="ga-select" data-set="reposition">' +
        '<option value="">(dragged position)</option><option value="tr">Top Right</option><option value="tl">Top Left</option><option value="br">Bottom Right</option><option value="bl">Bottom Left</option>' +
        "</select>"),
      toggle("compact", "Compact mode"),
      row("Answer card size",
        '<select class="ga-select" data-set="answerSize">' +
        ['small', 'medium', 'large'].map(function (s) { return '<option value="' + s + '"' + (state.answerSize === s ? " selected" : "") + ">" + s + "</option>"; }).join("") + "</select>"),
    ].join("");
  }
  function tPrivacy() {
    var c = state.ctx;
    function ctxBox(key, label, def) {
      return '<label class="ga-toggle"><input type="checkbox" data-ctx="' + key + '" ' + (c[key] ? "checked" : "") + "><span>" + esc(label) + "</span></label>";
    }
    return [
      toggle("saveHistory", "Save history"),
      toggle("privateMode", "Private mode", "Disables persistent history storage."),
      '<div class="ga-field"><div class="ga-field-label">Context sent to Gemini</div>',
      ctxBox("question", "Detected question"),
      ctxBox("choices", "Answer choices"),
      ctxBox("pageText", "Current webpage text"),
      ctxBox("selection", "Selected text"),
      ctxBox("title", "Page title"),
      ctxBox("conversation", "Previous conversation"),
      '<div class="ga-hint">Only the items checked here are included in requests.</div></div>',
      '<div class="ga-row"><button class="ga-btn secondary" data-act="clear-local">Clear Local Data</button></div>',
      '<div class="ga-notice"><strong>Privacy notice:</strong> Webpage content is sent to Gemini only when you request analysis. ' +
      'The selected model processes the request. Local settings/history are stored in your browser. ' +
      'Private Mode disables persistent history. Never commit API keys to GitHub; prefer a server-side proxy for production.</div>',
    ].join("");
  }
  function tAdvanced() {
    return [
      toggle("debug", "Debug mode", "Logs to the browser console with a [GeminiAssistant] prefix."),
      row("Update checking", toggle("_updchk", "Check for updates on launch")),
      row("GitHub script URL (base)", '<input class="ga-input" type="text" data-set="scriptUrl" value="' + esc(state.scriptUrl) + '" placeholder="https://user.github.io/repo">',
        "Where assistant.js/styles.css/config.js are hosted."),
      row("Secure proxy URL (optional)", '<input class="ga-input" type="text" data-set="proxyUrl" value="' + esc(state.proxyUrl) + '" placeholder="https://your-app.vercel.app/api/gemini">',
        "If set, requests go through your backend so the API key stays server-side."),
      '<div class="ga-field"><div class="ga-field-label">Cache</div><button class="ga-btn secondary" data-act="clear-cache">Clear Cached Data</button></div>',
      '<div class="ga-field"><div class="ga-field-label">Version</div><div class="ga-version">Version ' + esc(VERSION) + ' <span data-update-slot></span></div>',
      '  <button class="ga-btn secondary" data-act="check-update">Check for Updates</button></div>',
    ].join("");
  }
  function tAbout() {
    return [
      '<div class="ga-about">',
      '  <div class="ga-about-title">\u2726 Gemini Assistant</div>',
      '  <p>Universal AI assistant for the web.</p>',
      '  <p class="ga-muted">Modes: General AI, Game / Quiz, Study, Analyze Page.</p>',
      '  <p class="ga-version">Version ' + esc(VERSION) + "</p>",
      '  <p class="ga-credit">Created by Ash \u{1F62C}</p>',
      "</div>",
    ].join("");
  }

  function bindSettings() {
    // Generic inputs with data-set
    Array.prototype.forEach.call(elBody.querySelectorAll("[data-set]"), function (input) {
      var key = input.getAttribute("data-set");
      var evt = (input.type === "checkbox" || input.tagName === "SELECT" || input.type === "range" || input.type === "number") ? "change" : "input";
      input.addEventListener(evt, function () {
        var val;
        if (input.type === "checkbox") val = input.checked;
        else if (input.type === "range" || input.type === "number") val = parseFloat(input.value);
        else val = input.value;
        applySetting(key, val, input);
      });
      if (input.type === "range") input.addEventListener("input", function () {
        var span = input.parentNode.querySelector(".ga-rangeval"); if (span) span.textContent = input.value;
      });
    });
    // Context toggles
    Array.prototype.forEach.call(elBody.querySelectorAll("[data-ctx]"), function (input) {
      input.addEventListener("change", function () {
        state.ctx[input.getAttribute("data-ctx")] = input.checked; persist();
      });
    });
    // Buttons
    var byAct = function (a) { return elBody.querySelector('[data-act="' + a + '"]'); };
    if (byAct("key-show")) byAct("key-show").onclick = function () {
      var f = elBody.querySelector('[data-set="apiKey"]');
      if (f.type === "password") { f.type = "text"; this.textContent = "Hide"; }
      else { f.type = "password"; this.textContent = "Show"; }
    };
    if (byAct("key-save")) byAct("key-save").onclick = function () {
      state.apiKey = elBody.querySelector('[data-set="apiKey"]').value.trim(); persist();
      var r = elBody.querySelector("[data-testresult]"); if (r) { r.textContent = "Saved."; r.className = "ga-testresult ok"; }
    };
    if (byAct("key-test")) byAct("key-test").onclick = function () {
      var r = elBody.querySelector("[data-testresult]");
      state.apiKey = elBody.querySelector('[data-set="apiKey"]').value.trim(); persist();
      r.textContent = "Testing\u2026"; r.className = "ga-testresult";
      callGemini({ user: "Reply with the single word: OK" })
        .then(function (t) { r.textContent = "Connection OK \u2713 (" + t.trim().slice(0, 20) + ")"; r.className = "ga-testresult ok"; })
        .catch(function (e) { r.textContent = "Failed: " + (e.message || e); r.className = "ga-testresult error"; });
    };
    if (byAct("clear-local")) byAct("clear-local").onclick = function () {
      try { localStorage.removeItem(HISTORY_KEY); } catch (e) {}
      runtime.conversation = []; alert("Local history cleared.");
    };
    if (byAct("clear-cache")) byAct("clear-cache").onclick = function () {
      try { localStorage.removeItem(HISTORY_KEY); } catch (e) {}
      alert("Cached data cleared.");
    };
    if (byAct("check-update")) byAct("check-update").onclick = function () { checkForUpdates(true); };
    var updChk = elBody.querySelector('[data-set="_updchk"]');
    if (updChk) { updChk.checked = CONFIG.ENABLE_UPDATE_CHECK !== false; updChk.onchange = function () { CONFIG.ENABLE_UPDATE_CHECK = updChk.checked; }; }
  }

  function applySetting(key, val, input) {
    if (key === "startup") { stored.startup = val; try { var s = loadSettings(); s.startup = val; saveSettings(s); } catch (e) {} return; }
    if (key === "reposition") { repositionTo(val); return; }
    if (key === "_updchk") return;
    state[key] = val;
    persist();
    // Live-apply visual settings.
    if (key === "opacity" || key === "scale" || key === "theme" || key === "answerSize") applyGeometry();
    if (key === "compact") panel.classList.toggle("ga-compact", !!val);
    if (key === "mode") { /* default mode; also switch current view */ }
  }
  function repositionTo(pos) {
    if (!pos) return;
    var pad = 20, w = panel.offsetWidth || 380, h = panel.offsetHeight || 400;
    var left, top;
    if (pos === "tr") { left = window.innerWidth - w - pad; top = pad; }
    else if (pos === "tl") { left = pad; top = pad; }
    else if (pos === "br") { left = window.innerWidth - w - pad; top = window.innerHeight - h - pad; }
    else if (pos === "bl") { left = pad; top = window.innerHeight - h - pad; }
    state.position = { left: Math.max(0, left), top: Math.max(0, top) };
    persist(); applyGeometry();
  }

  /* ================================================================== *
   * Header actions: minimize, settings, close
   * ================================================================== */
  panel.querySelector('[data-act="min"]').onclick = function () { toggleMinimize(); };
  panel.querySelector('[data-act="settings"]').onclick = function () {
    currentView = currentView === "settings" ? "mode" : "settings"; render();
  };
  panel.querySelector('[data-act="close"]').onclick = function () { destroy(); };

  // Mode switching
  Array.prototype.forEach.call(elModebar.querySelectorAll("button"), function (b) {
    b.onclick = function () {
      state.mode = b.getAttribute("data-mode");
      currentView = "mode";
      persist();
      render();
    };
  });

  function toggleMinimize() {
    runtime.minimized = !runtime.minimized;
    panel.classList.toggle("ga-minimized", runtime.minimized);
  }

  /* ================================================================== *
   * Drag + Resize (touch friendly for iPad)
   * ================================================================== */
  (function enableDrag() {
    var handle = panel.querySelector("[data-drag]");
    var dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    function down(e) {
      if (e.target.closest(".ga-icon")) return; // don't drag when hitting buttons
      dragging = true;
      var p = point(e);
      var rect = panel.getBoundingClientRect();
      sx = p.x; sy = p.y; ox = rect.left; oy = rect.top;
      document.addEventListener("mousemove", move, { passive: false });
      document.addEventListener("touchmove", move, { passive: false });
      document.addEventListener("mouseup", up);
      document.addEventListener("touchend", up);
    }
    function move(e) {
      if (!dragging) return;
      e.preventDefault();
      var p = point(e);
      var left = ox + (p.x - sx), top = oy + (p.y - sy);
      left = Math.max(0, Math.min(left, window.innerWidth - 40));
      top = Math.max(0, Math.min(top, window.innerHeight - 40));
      panel.style.left = left + "px"; panel.style.top = top + "px"; panel.style.right = "auto";
    }
    function up() {
      if (!dragging) return; dragging = false;
      var rect = panel.getBoundingClientRect();
      state.position = { left: rect.left, top: rect.top }; persist();
      document.removeEventListener("mousemove", move);
      document.removeEventListener("touchmove", move);
      document.removeEventListener("mouseup", up);
      document.removeEventListener("touchend", up);
    }
    handle.addEventListener("mousedown", down);
    handle.addEventListener("touchstart", down, { passive: true });
  })();

  (function enableResize() {
    var grip = panel.querySelector("[data-resize]");
    var resizing = false, sx = 0, sy = 0, sw = 0, sh = 0;
    function down(e) {
      resizing = true; var p = point(e);
      var rect = panel.getBoundingClientRect();
      sx = p.x; sy = p.y; sw = rect.width; sh = rect.height;
      document.addEventListener("mousemove", move, { passive: false });
      document.addEventListener("touchmove", move, { passive: false });
      document.addEventListener("mouseup", up);
      document.addEventListener("touchend", up);
      e.preventDefault();
    }
    function move(e) {
      if (!resizing) return; e.preventDefault();
      var p = point(e);
      var w = Math.max(280, sw + (p.x - sx)), h = Math.max(220, sh + (p.y - sy));
      panel.style.width = w + "px"; panel.style.height = h + "px";
    }
    function up() {
      if (!resizing) return; resizing = false;
      var rect = panel.getBoundingClientRect();
      state.size = { w: Math.round(rect.width), h: Math.round(rect.height) }; persist();
      document.removeEventListener("mousemove", move);
      document.removeEventListener("touchmove", move);
      document.removeEventListener("mouseup", up);
      document.removeEventListener("touchend", up);
    }
    grip.addEventListener("mousedown", down);
    grip.addEventListener("touchstart", down, { passive: true });
  })();

  function point(e) {
    if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    if (e.changedTouches && e.changedTouches[0]) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    return { x: e.clientX, y: e.clientY };
  }

  /* ================================================================== *
   * Auto-detect question changes (Game mode)
   * ================================================================== */
  function startObserver() {
    if (runtime.observer) return;
    if (!window.MutationObserver) return;
    var handler = debounce(function () {
      if (state.mode === "game" && state.autoAnalyze && currentView === "mode") {
        analyzeQuestion(false);
      }
    }, state.analysisDelay);
    runtime.observer = new MutationObserver(handler);
    try {
      runtime.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    } catch (e) { log("observer failed", e); }
  }
  function stopObserver() {
    if (runtime.observer) { runtime.observer.disconnect(); runtime.observer = null; }
  }
  startObserver();

  /* ================================================================== *
   * Update system
   * ================================================================== */
  function checkForUpdates(manual) {
    var base = state.scriptUrl || BASE;
    if (!base) { if (manual) alert("Set the GitHub script URL in Advanced settings first."); return; }
    var url = base.replace(/\/+$/, "") + "/config.js";
    // Cache-bust hard for the check itself.
    fetch(url + "?_=" + Date.now())
      .then(function (r) { return r.text(); })
      .then(function (txt) {
        var m = txt.match(/VERSION\s*:\s*["']([^"']+)["']/);
        var remote = m && m[1];
        if (!remote) { if (manual) alert("Could not read remote version."); return; }
        var slot = elBody.querySelector("[data-update-slot]");
        if (compareVersions(remote, VERSION) > 0) {
          showUpdateBanner(remote);
          if (slot) slot.innerHTML = '<span class="ga-update">\u2728 ' + esc(remote) + " available</span>";
          if (manual) log("update available", remote);
        } else {
          if (slot) slot.innerHTML = '<span class="ga-uptodate">Up to date</span>';
          if (manual) alert("You are on the latest version (" + VERSION + ").");
        }
      })
      .catch(function (e) { if (manual) alert("Update check failed: " + (e.message || e)); });
  }
  function compareVersions(a, b) {
    var pa = String(a).split("."), pb = String(b).split(".");
    for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
      var na = parseInt(pa[i] || "0", 10), nb = parseInt(pb[i] || "0", 10);
      if (na > nb) return 1; if (na < nb) return -1;
    }
    return 0;
  }
  function showUpdateBanner(remote) {
    if (root.getElementById && root.getElementById("ga-update-banner")) return;
    var banner = document.createElement("div");
    banner.id = "ga-update-banner";
    banner.className = "ga-updatebanner";
    banner.innerHTML = '\u2728 Update available (' + esc(remote) + ') <button data-act="reload">Reload Assistant</button> <button data-act="dismiss" aria-label="Dismiss">\u2715</button>';
    panel.insertBefore(banner, panel.firstChild.nextSibling);
    banner.querySelector('[data-act="reload"]').onclick = function () {
      // Do NOT auto-reload mid-session; user explicitly opted in here.
      var base = (state.scriptUrl || BASE).replace(/\/+$/, "");
      destroy();
      var s = document.createElement("script");
      s.src = base + "/assistant.js?v=" + encodeURIComponent(remote) + "&t=" + Date.now();
      window.__GEMINI_ASSISTANT_VERSION__ = remote;
      (document.head || document.documentElement).appendChild(s);
    };
    banner.querySelector('[data-act="dismiss"]').onclick = function () { banner.remove(); };
  }
  if (CONFIG.ENABLE_UPDATE_CHECK !== false) setTimeout(function () { checkForUpdates(false); }, 2500);

  /* ================================================================== *
   * Public API + lifecycle
   * ================================================================== */
  function open() {
    host.style.display = "";
    panel.style.display = "flex";
    if (runtime.minimized) toggleMinimize();
    // Bring to front by re-appending host.
    document.documentElement.appendChild(host);
  }
  function destroy() {
    stopObserver();
    try { host.remove(); } catch (e) {}
    window.__GEMINI_ASSISTANT__ = null;
    window.__GEMINI_ASSISTANT_LOADING__ = false;
  }

  window.__GEMINI_ASSISTANT__ = {
    version: VERSION,
    open: open,
    close: function () { host.style.display = "none"; },
    destroy: destroy,
    setMode: function (m) { state.mode = m; currentView = "mode"; render(); },
  };

  // Initial render.
  if (!state.enabled) { host.style.display = "none"; }
  render();
  log("assistant ready", VERSION, "mode:", state.mode);
})();
