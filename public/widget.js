(function () {
  // ─── Bootstrap: Read config from script tag ────────────────────────────────
  const scriptTag = document.currentScript || (function() {
    const scripts = document.getElementsByTagName("script");
    for (let i = scripts.length - 1; i >= 0; i--) {
      if (scripts[i].getAttribute("data-bot-id")) return scripts[i];
    }
    return null;
  })();

  if (!scriptTag) { console.error("[Chatbot] Script tag not found."); return; }
  
  const botId = scriptTag.getAttribute("data-bot-id");
  if (!botId) { console.error("[Chatbot] data-bot-id attribute missing."); return; }
  
  const API_BASE = scriptTag.getAttribute("data-api-url") 
    || scriptTag.src.replace(/\/widget\.js.*$/, "") 
    || window.location.origin;

  // ─── Helpers ───────────────────────────────────────────────────────────────
  function hexToRgb(hex) {
    hex = hex.replace(/^#/, "");
    if (hex.length === 3) hex = hex.split("").map(c => c + c).join("");
    const n = parseInt(hex, 16);
    return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
  }

  function generateSessionId() {
    try { return crypto.randomUUID(); } catch(e) {
      return "s_" + Math.random().toString(36).substring(2) + Date.now().toString(36);
    }
  }

  // ─── Icons (inline SVG) ────────────────────────────────────────────────────
  const ICONS = {
    bot: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>`,
    x: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
    send: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>`,
    paperclip: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>`,
    mic: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>`,
  };

  // ─── Main Widget Class ─────────────────────────────────────────────────────
  class ChatbotWidget {
    constructor(id) {
      this.botId = id;
      this.sessionId = generateSessionId();
      this.config = null;
      this.themeColor = "#6366f1";
      this.themeRgb = hexToRgb(this.themeColor);
      this.isOpen = false;
      this.messages = [];
      this.isTyping = false;
      this.init();
    }

    async init() {
      try {
        const res = await fetch(`${API_BASE}/api/bots/${this.botId}/config`);
        if (!res.ok) throw new Error("Config fetch failed");
        const data = await res.json();
        this.config = data.botConfig || data;
      } catch (e) {
        console.error("[Chatbot] Failed to load config:", e);
        return;
      }

      // Extract theme from config or use default
      if (this.config.themeColor) {
        this.themeColor = this.config.themeColor;
        this.themeRgb = hexToRgb(this.themeColor);
      }

      this.injectStyles();
      this.createWidget();

      // Welcome message
      const welcome = this.config.prompts?.welcomeMessage || `Hi! I'm ${this.config.botName || "AI Assistant"}. How can I help?`;
      this.appendMessage("bot", welcome, true);
    }

    // ─── Inject Scoped CSS ─────────────────────────────────────────────────
    injectStyles() {
      const id = "cb-styles-" + this.botId;
      if (document.getElementById(id)) return;
      
      const style = document.createElement("style");
      style.id = id;
      style.textContent = `
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');
        
        #cb-root-${this.botId} {
          font-family: 'Inter', system-ui, -apple-system, sans-serif;
          position: fixed; bottom: 24px; right: 24px; z-index: 2147483647;
          box-sizing: border-box; line-height: 1.5;
        }
        #cb-root-${this.botId} *, #cb-root-${this.botId} *::before, #cb-root-${this.botId} *::after {
          box-sizing: border-box; margin: 0; padding: 0;
        }

        /* ── Floating Button ── */
        .cb-fab {
          width: 60px; height: 60px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.2);
          cursor: pointer; display: flex; align-items: center; justify-content: center;
          background: linear-gradient(135deg, rgba(${this.themeRgb},0.85), rgba(${this.themeRgb},1));
          box-shadow: 0 0 20px rgba(${this.themeRgb},0.6), 0 0 40px rgba(${this.themeRgb},0.35),
                      0 4px 15px rgba(0,0,0,0.2);
          transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
          position: relative; color: white;
        }
        .cb-fab:hover { transform: scale(1.1); box-shadow: 0 0 30px rgba(${this.themeRgb},0.8), 0 0 60px rgba(${this.themeRgb},0.4); }
        .cb-fab .cb-fab-ping {
          position: absolute; inset: 0; border-radius: 50%; background: rgba(${this.themeRgb},0.4);
          animation: cb-ping 2s cubic-bezier(0,0,0.2,1) infinite;
        }
        .cb-fab svg { position: relative; z-index: 1; transition: transform 0.3s; }

        @keyframes cb-ping { 75%,100% { transform: scale(1.6); opacity: 0; } }
        @keyframes cb-slideUp {
          from { opacity: 0; transform: translateY(16px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes cb-dots {
          0%,80%,100% { transform: scale(0.6); opacity: 0.4; }
          40% { transform: scale(1); opacity: 1; }
        }

        /* ── Chat Window ── */
        .cb-window {
          position: absolute; bottom: 76px; right: 0;
          width: 400px; max-width: calc(100vw - 32px);
          height: 560px; max-height: calc(100vh - 120px);
          border-radius: 20px;
          background: linear-gradient(165deg, #1e1e22 0%, #141417 100%);
          border: 1px solid rgba(255,255,255,0.08);
          box-shadow: 0 25px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05);
          display: flex; flex-direction: column; overflow: hidden;
          animation: cb-slideUp 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .cb-window[hidden] { display: none !important; }

        /* ── Header ── */
        .cb-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 16px 20px; border-bottom: 1px solid rgba(255,255,255,0.06);
          background: rgba(255,255,255,0.02);
        }
        .cb-header-left { display: flex; align-items: center; gap: 10px; }
        .cb-header-avatar {
          width: 36px; height: 36px; border-radius: 10px;
          background: linear-gradient(135deg, rgba(${this.themeRgb},0.3), rgba(${this.themeRgb},0.6));
          display: flex; align-items: center; justify-content: center; color: white;
        }
        .cb-header-avatar svg { width: 20px; height: 20px; }
        .cb-header-info h3 { font-size: 14px; font-weight: 600; color: #f0f0f0; }
        .cb-header-info span { font-size: 11px; color: #22c55e; display: flex; align-items: center; gap: 4px; }
        .cb-header-info span::before {
          content: ''; width: 6px; height: 6px; border-radius: 50%; background: #22c55e;
          display: inline-block; animation: cb-pulse 2s infinite;
        }
        @keyframes cb-pulse { 50% { opacity: 0.5; } }
        .cb-close {
          background: transparent; border: none; color: #888; cursor: pointer;
          width: 32px; height: 32px; border-radius: 8px;
          display: flex; align-items: center; justify-content: center;
          transition: all 0.2s;
        }
        .cb-close:hover { background: rgba(255,255,255,0.08); color: white; }

        /* ── Messages ── */
        .cb-messages {
          flex: 1; padding: 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px;
          scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.1) transparent;
        }
        .cb-messages::-webkit-scrollbar { width: 4px; }
        .cb-messages::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
        
        .cb-msg {
          max-width: 82%; padding: 12px 16px; border-radius: 16px;
          font-size: 14px; line-height: 1.55; word-wrap: break-word;
          animation: cb-slideUp 0.25s ease-out;
        }
        .cb-msg-bot {
          align-self: flex-start; background: rgba(255,255,255,0.07);
          border: 1px solid rgba(255,255,255,0.06); color: #e4e4e7;
          border-bottom-left-radius: 4px;
        }
        .cb-msg-user {
          align-self: flex-end; color: white;
          background: ${this.themeColor}; border: 1px solid rgba(255,255,255,0.12);
          border-bottom-right-radius: 4px;
          box-shadow: 0 2px 8px rgba(${this.themeRgb},0.3);
        }

        /* ── Quick Replies ── */
        .cb-qr-wrap { display: flex; flex-wrap: wrap; gap: 8px; align-self: flex-start; }
        .cb-qr {
          background: rgba(255,255,255,0.06); border: 1px solid rgba(${this.themeRgb},0.3);
          color: ${this.themeColor}; padding: 8px 14px; border-radius: 20px;
          font-size: 12px; cursor: pointer; transition: all 0.2s; font-family: inherit;
        }
        .cb-qr:hover { background: ${this.themeColor}; color: white; border-color: ${this.themeColor}; }

        /* ── Typing Indicator ── */
        .cb-typing {
          align-self: flex-start; display: flex; gap: 4px;
          padding: 14px 18px; background: rgba(255,255,255,0.07);
          border-radius: 16px; border-bottom-left-radius: 4px;
          border: 1px solid rgba(255,255,255,0.06);
        }
        .cb-typing-dot {
          width: 7px; height: 7px; border-radius: 50%; background: #888;
        }
        .cb-typing-dot:nth-child(1) { animation: cb-dots 1.4s infinite 0s; }
        .cb-typing-dot:nth-child(2) { animation: cb-dots 1.4s infinite 0.2s; }
        .cb-typing-dot:nth-child(3) { animation: cb-dots 1.4s infinite 0.4s; }

        /* ── Input Area ── */
        .cb-input-area {
          padding: 12px 16px; border-top: 1px solid rgba(255,255,255,0.06);
          background: rgba(0,0,0,0.2);
        }
        .cb-input-row { display: flex; align-items: flex-end; gap: 8px; }
        .cb-textarea {
          flex: 1; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
          border-radius: 12px; padding: 10px 14px; color: #f0f0f0;
          font-size: 14px; font-family: inherit; resize: none; outline: none;
          min-height: 40px; max-height: 120px; line-height: 1.4;
          transition: border-color 0.2s;
        }
        .cb-textarea::placeholder { color: #666; }
        .cb-textarea:focus { border-color: rgba(${this.themeRgb},0.5); }
        .cb-send {
          width: 40px; height: 40px; border: none; border-radius: 10px; cursor: pointer;
          background: ${this.themeColor}; color: white;
          display: flex; align-items: center; justify-content: center;
          transition: all 0.2s; flex-shrink: 0;
          box-shadow: 0 2px 8px rgba(${this.themeRgb},0.3);
        }
        .cb-send:hover { transform: scale(1.08); box-shadow: 0 4px 14px rgba(${this.themeRgb},0.5); }
        .cb-send:active { transform: scale(0.95); }
        .cb-send:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

        .cb-footer {
          padding: 8px 16px; border-top: 1px solid rgba(255,255,255,0.04);
          text-align: center; font-size: 10px; color: #555;
        }
        .cb-footer a { color: #777; text-decoration: none; }
        .cb-footer a:hover { color: ${this.themeColor}; }

        /* ── Mobile (≤480px) ── */
        @media (max-width: 480px) {
          #cb-root-${this.botId} { bottom: 12px; right: 12px; }
          .cb-window {
            width: calc(100vw - 24px); height: calc(100vh - 100px);
            bottom: 72px; right: 0; border-radius: 16px;
          }
          .cb-fab { width: 52px; height: 52px; }
        }
      `;
      document.head.appendChild(style);
    }

    // ─── Create DOM ──────────────────────────────────────────────────────────
    createWidget() {
      // Root container
      this.root = document.createElement("div");
      this.root.id = `cb-root-${this.botId}`;
      document.body.appendChild(this.root);

      // FAB
      this.fab = document.createElement("button");
      this.fab.className = "cb-fab";
      this.fab.setAttribute("aria-label", "Open chat");
      this.fab.innerHTML = `<div class="cb-fab-ping"></div>${ICONS.bot}`;
      this.fab.onclick = () => this.toggle();
      this.root.appendChild(this.fab);

      // Window
      this.win = document.createElement("div");
      this.win.className = "cb-window";
      this.win.hidden = true;

      const botName = this.config.botName || "AI Assistant";

      this.win.innerHTML = `
        <div class="cb-header">
          <div class="cb-header-left">
            <div class="cb-header-avatar">${ICONS.bot}</div>
            <div class="cb-header-info">
              <h3>${this._esc(botName)}</h3>
              <span>Online</span>
            </div>
          </div>
          <button class="cb-close" aria-label="Close chat">${ICONS.x}</button>
        </div>
        <div class="cb-messages"></div>
        <div class="cb-input-area">
          <div class="cb-input-row">
            <textarea class="cb-textarea" placeholder="Type your message..." rows="1"></textarea>
            <button class="cb-send" aria-label="Send">${ICONS.send}</button>
          </div>
        </div>
        <div class="cb-footer">Powered by <a href="#">AI Chatbot</a></div>
      `;
      this.root.appendChild(this.win);

      // Cache DOM refs
      this.msgArea = this.win.querySelector(".cb-messages");
      this.input = this.win.querySelector(".cb-textarea");
      this.sendBtn = this.win.querySelector(".cb-send");
      const closeBtn = this.win.querySelector(".cb-close");

      // Events
      closeBtn.onclick = () => this.toggle(false);
      this.sendBtn.onclick = () => this.handleSend();
      
      this.input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          this.handleSend();
        }
      });

      // Auto-resize textarea
      this.input.addEventListener("input", () => {
        this.input.style.height = "auto";
        this.input.style.height = Math.min(this.input.scrollHeight, 120) + "px";
      });

      // Close on outside click
      document.addEventListener("mousedown", (e) => {
        if (this.isOpen && !this.root.contains(e.target)) this.toggle(false);
      });
    }

    // ─── Toggle Window ───────────────────────────────────────────────────────
    toggle(force) {
      this.isOpen = force !== undefined ? force : !this.isOpen;

      if (this.isOpen) {
        this.win.hidden = false;
        this.fab.innerHTML = ICONS.x;
        setTimeout(() => this.input.focus(), 100);
      } else {
        this.win.hidden = true;
        this.fab.innerHTML = `<div class="cb-fab-ping"></div>${ICONS.bot}`;
      }
    }

    // ─── Send Message ────────────────────────────────────────────────────────
    handleSend() {
      const text = this.input.value.trim();
      if (!text || this.isTyping) return;
      
      this.input.value = "";
      this.input.style.height = "auto";
      this.appendMessage("user", text);
      this.messages.push({ role: "user", content: text });
      this.fetchReply();
    }

    // ─── Render Message ──────────────────────────────────────────────────────
    appendMessage(sender, text, showQuickReplies = false) {
      const div = document.createElement("div");
      div.className = `cb-msg cb-msg-${sender}`;

      if (sender === "bot") {
        // Basic markdown: bold, line breaks, links
        let html = this._esc(text)
          .replace(/\*\*(.*?)\*\*/g, "<b>$1</b>")
          .replace(/\n/g, "<br>")
          .replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" style="color:' + this.themeColor + '">$1</a>');
        div.innerHTML = html;
      } else {
        div.textContent = text;
      }

      this.msgArea.appendChild(div);

      // Quick Replies
      if (showQuickReplies && this.config.quickReplies?.length > 0) {
        const qrWrap = document.createElement("div");
        qrWrap.className = "cb-qr-wrap";
        this.config.quickReplies.forEach(qr => {
          const btn = document.createElement("button");
          btn.className = "cb-qr";
          btn.textContent = qr.label;
          btn.onclick = () => {
            const val = qr.value || qr.label;
            this.input.value = val;
            this.handleSend();
            qrWrap.remove();
          };
          qrWrap.appendChild(btn);
        });
        this.msgArea.appendChild(qrWrap);
      }

      this.scrollToBottom();
    }

    // ─── Typing Indicator ────────────────────────────────────────────────────
    showTyping() {
      this.isTyping = true;
      this.sendBtn.disabled = true;
      const el = document.createElement("div");
      el.className = "cb-typing";
      el.id = `cb-typing-${this.botId}`;
      el.innerHTML = `<div class="cb-typing-dot"></div><div class="cb-typing-dot"></div><div class="cb-typing-dot"></div>`;
      this.msgArea.appendChild(el);
      this.scrollToBottom();
    }

    hideTyping() {
      this.isTyping = false;
      this.sendBtn.disabled = false;
      const el = document.getElementById(`cb-typing-${this.botId}`);
      if (el) el.remove();
    }

    // ─── Fetch AI Reply ──────────────────────────────────────────────────────
    async fetchReply() {
      this.showTyping();

      try {
        const res = await fetch(`${API_BASE}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            botId: this.botId,
            messages: this.messages,
            sessionId: this.sessionId,
          }),
        });

        const data = await res.json();
        this.hideTyping();

        const reply = data.reply || "Sorry, something went wrong. Please try again.";
        this.messages.push({ role: "assistant", content: reply });
        this.appendMessage("bot", reply);

      } catch (err) {
        console.error("[Chatbot] API error:", err);
        this.hideTyping();
        this.appendMessage("bot", "Connection error. Please check your internet and try again.");
      }
    }

    // ─── Utilities ───────────────────────────────────────────────────────────
    scrollToBottom() {
      requestAnimationFrame(() => {
        this.msgArea.scrollTo({ top: this.msgArea.scrollHeight, behavior: "smooth" });
      });
    }

    _esc(str) {
      const d = document.createElement("div");
      d.textContent = str;
      return d.innerHTML;
    }
  }

  // ─── Public API ────────────────────────────────────────────────────────────
  // Method 1: Auto-init from <script data-bot-id="...">
  if (botId) {
    new ChatbotWidget(botId);
  }

  // Method 2: Manual init via window.initChatbot({ botId, themeColor })
  window.initChatbot = function(options) {
    if (!options.botId) { console.error("[Chatbot] botId is required."); return; }
    new ChatbotWidget(options.botId);
  };
})();
