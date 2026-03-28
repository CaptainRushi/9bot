const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { OpenAI } = require("openai");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Supabase Clients
const supabaseUrl = process.env.SUPABASE_URL || "https://nhazxhblzhmvljrofeqr.supabase.co";
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "missing_anon_key";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || "missing_service_key";

const supabase = createClient(supabaseUrl, supabaseAnonKey);
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

// ─── Rate Limiter ────────────────────────────────────────────────────────────
const rateLimits = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000;
const RATE_LIMIT_MAX = 30;

function rateLimit(req, res, next) {
  const key = req.ip;
  const now = Date.now();
  if (!rateLimits.has(key)) rateLimits.set(key, []);
  const timestamps = rateLimits.get(key).filter(t => now - t < RATE_LIMIT_WINDOW);
  if (timestamps.length >= RATE_LIMIT_MAX) {
    return res.status(429).json({ error: "Too many requests. Please slow down." });
  }
  timestamps.push(now);
  rateLimits.set(key, timestamps);
  next();
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const generateId = () => crypto.randomBytes(12).toString("hex");

// ─── Auth Middleware USING SUPABASE JWT ──────────────────────────────────────
async function requireAuth(req, res, next) {
  if (supabaseAnonKey === "missing_anon_key" || supabaseAnonKey.startsWith("http")) {
    return res.status(500).json({ error: "Server Error: SUPABASE_ANON_KEY is missing or invalid in .env" });
  }

  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Unauthorized. Please log in." });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return res.status(401).json({ error: "Unauthorized. Invalid or expired token." });
  }

  req.userId = user.id;
  req.supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  next();
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH ENDPOINTS (Forwarded to Supabase Auth)
// ═══════════════════════════════════════════════════════════════════════════════

app.post("/api/auth/signup", async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required." });

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name: name || email.split("@")[0] } },
  });

  if (error) return res.status(400).json({ error: error.message });

  const user = data.user;
  res.status(201).json({
    token: data.session?.access_token,
    user: { id: user.id, email: user.email, name: user.user_metadata?.name, plan: "free" },
  });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required." });

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return res.status(401).json({ error: error.message });

  res.json({
    token: data.session.access_token,
    user: { id: data.user.id, email: data.user.email, name: data.user.user_metadata?.name, plan: "free" },
  });
});

app.get("/api/auth/google", (req, res) => {
  const origin = req.get("origin") || req.protocol + "://" + req.get("host");
  // Pass the Supabase Anon Key as apikey in header or query if needed? No, /auth/v1/authorize?provider=google does NOT need Anon Key strictly, but supplying it as 'apikey' query parameter is safer for Supabase instances that enforce it.
  const redirectUrl = `${supabaseUrl}/auth/v1/authorize?provider=google&apikey=${supabaseAnonKey}&redirect_to=${encodeURIComponent(origin + "/dashboard.html")}`;
  res.redirect(redirectUrl);
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  const { data, error } = await req.supabase.from("profiles").select("*").eq("id", req.userId).single();
  // Using user metadata if profile trigger hasn't fired yet
  if (error || !data) {
     const { data: {user} } = await supabase.auth.getUser(req.headers.authorization.replace("Bearer ",""));
     return res.json({ id: user.id, email: user.email, name: user.user_metadata?.name, plan: "free" });
  }
  res.json({ id: data.id, email: data.email, name: data.name, plan: "free" });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BOT MANAGEMENT ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

app.get("/api/dashboard/bots", requireAuth, async (req, res) => {
  const { data: bots, error } = await req.supabase.from("bots").select("id, name, industry, theme_color, created_at, messages(id), leads(id)");
  if (error) return res.status(500).json({ error: error.message });

  const formattedBots = bots.map((b) => ({
    id: b.id, name: b.name, industry: b.industry, themeColor: b.theme_color, createdAt: b.created_at,
    messageCount: b.messages ? b.messages.length : 0, leadCount: b.leads ? b.leads.length : 0,
  }));
  res.json({ bots: formattedBots });
});

app.post("/api/dashboard/bots", requireAuth, async (req, res) => {
  const { name, industry, themeColor, systemPrompt, welcomeMessage, quickReplies, openaiApiKey } = req.body;
  if (!name) return res.status(400).json({ error: "Bot name is required." });

  const botId = generateId();
  const prompt = systemPrompt || "You are a helpful assistant.";
  const welcome = welcomeMessage || `Hi there! 👋 I'm ${name}. How can I help you today?`;
  
  const botConfig = {
    botId, botName: name, industry: industry || "General", version: "1.0.0", language: "en-US",
    prompts: { welcomeMessage: welcome, fallbackMessage: "I'm not sure. Let me connect you with someone." },
    quickReplies: quickReplies || [], openaiApiKey: openaiApiKey || "",
  };

  const { data: bot, error } = await req.supabase.from("bots").insert({
    id: botId, user_id: req.userId, name, industry: industry || "General", theme_color: themeColor || "#6366f1",
    system_prompt: prompt, openai_api_key: openaiApiKey || "", config: botConfig
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  res.status(201).json({
    bot: { id: bot.id, name: bot.name, industry: bot.industry, themeColor: bot.theme_color },
    embedScript: `<script src="${req.protocol}://${req.get("host")}/widget.js" data-bot-id="${bot.id}" async></script>`,
  });
});

app.get("/api/dashboard/bots/:botId", requireAuth, async (req, res) => {
  const { data: bot, error } = await req.supabase.from("bots").select("*, messages(id), leads(id)").eq("id", req.params.botId).single();
  if (error || !bot) return res.status(404).json({ error: "Bot not found." });

  res.json({
    id: bot.id, name: bot.name, industry: bot.industry, themeColor: bot.theme_color,
    systemPrompt: bot.system_prompt, config: bot.config, openaiApiKey: bot.openai_api_key ? "sk-...configured" : "",
    embedScript: `<script src="${req.protocol}://${req.get("host")}/widget.js" data-bot-id="${bot.id}" async></script>`,
    messageCount: bot.messages ? bot.messages.length : 0, leadCount: bot.leads ? bot.leads.length : 0,
  });
});

app.put("/api/dashboard/bots/:botId", requireAuth, async (req, res) => {
  const { name, themeColor, systemPrompt, welcomeMessage, quickReplies, industry, openaiApiKey } = req.body;

  const { data: bot, error } = await req.supabase.from("bots").select("config").eq("id", req.params.botId).single();
  if (error || !bot) return res.status(404).json({ error: "Bot not found." });

  let newConfig = { ...bot.config };
  if (name) newConfig.botName = name;
  if (industry) newConfig.industry = industry;
  if (welcomeMessage) newConfig.prompts.welcomeMessage = welcomeMessage;
  if (quickReplies) newConfig.quickReplies = quickReplies;
  if (openaiApiKey !== undefined) newConfig.openaiApiKey = openaiApiKey;

  const updatePayload = { config: newConfig };
  if (name) updatePayload.name = name;
  if (themeColor) updatePayload.theme_color = themeColor;
  if (industry) updatePayload.industry = industry;
  if (systemPrompt) updatePayload.system_prompt = systemPrompt;
  if (openaiApiKey !== undefined) updatePayload.openai_api_key = openaiApiKey;

  const { data: updatedBot, error: updateError } = await req.supabase.from("bots").update(updatePayload).eq("id", req.params.botId).select().single();
  if (updateError) return res.status(500).json({ error: updateError.message });

  res.json({ bot: { ...updatedBot, openai_api_key: updatedBot.openai_api_key ? "sk-...configured" : "" } });
});

app.delete("/api/dashboard/bots/:botId", requireAuth, async (req, res) => {
  const { error } = await req.supabase.from("bots").delete().eq("id", req.params.botId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

app.get("/api/dashboard/bots/:botId/messages", requireAuth, async (req, res) => {
  const { data: messages, error } = await req.supabase.from("messages").select("*").eq("bot_id", req.params.botId).order("timestamp", { ascending: true }).limit(200);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ messages });
});

app.get("/api/dashboard/bots/:botId/leads", requireAuth, async (req, res) => {
  const { data: leads, error } = await req.supabase.from("leads").select("*").eq("bot_id", req.params.botId).order("captured_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ leads });
});

// ═══════════════════════════════════════════════════════════════════════════════
// WIDGET ENDPOINTS (Public API)
// ═══════════════════════════════════════════════════════════════════════════════

app.get("/api/bots/:botId/config", rateLimit, async (req, res) => {
  if (supabaseServiceKey === "missing_service_key") return res.status(500).json({ error: "Missing Supabase Service Key on Server" });
  
  const { data: bot, error } = await supabaseAdmin.from("bots").select("config").eq("id", req.params.botId).single();
  if (error || !bot) return res.status(404).json({ error: "Bot not found." });
  
  const safeConfig = { ...bot.config, openaiApiKey: "" };
  res.json({ botConfig: safeConfig });
});

app.post("/api/chat", rateLimit, async (req, res) => {
  if (supabaseServiceKey === "missing_service_key") return res.status(500).json({ error: "Missing Supabase Service Key on Server" });

  const { botId, messages, sessionId, pageContext } = req.body;
  if (!botId || !messages) return res.status(400).json({ error: "botId and messages required." });

  try {
    const { data: bot, error } = await supabaseAdmin.from("bots").select("*").eq("id", botId).single();
    if (error || !bot) return res.status(404).json({ error: "Bot not found." });

    const clientApiKey = bot.openai_api_key;
    if (!clientApiKey || !clientApiKey.startsWith("sk-")) {
      return res.status(402).json({ error: "AI not configured. Site owner must add their OpenAI key." });
    }

    const lastUserMsg = messages[messages.length - 1]?.content || "";
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const foundEmails = lastUserMsg.match(emailRegex) || [];
    
    for (const email of foundEmails) {
      await supabase.from("leads").insert({ 
        bot_id: botId, session_id: sessionId || "anon", email, source: "chat" 
      });
    }

    let dynamicSystemPrompt = bot.system_prompt;
    if (pageContext) {
      dynamicSystemPrompt += `\n\n=== LIVE WEBSITE CONTEXT ===\n`;
      dynamicSystemPrompt += `IMPORTANT: Analyze the content below. This is the exact webpage the user is currently viewing. Use this as your primary knowledge base to answer their questions about the product/service:\n`;
      if (pageContext.title) dynamicSystemPrompt += `- Page Title: ${pageContext.title}\n`;
      if (pageContext.url) dynamicSystemPrompt += `- Page URL: ${pageContext.url}\n`;
      if (pageContext.metaDescription) dynamicSystemPrompt += `- Meta Description: ${pageContext.metaDescription}\n`;
      if (pageContext.content) {
        dynamicSystemPrompt += `\n- Extracted Page Content:\n"""\n${pageContext.content}\n"""\n`;
      }
    }

    const clientOpenAI = new OpenAI({ apiKey: clientApiKey });
    const aiResponse = await clientOpenAI.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: dynamicSystemPrompt }, ...messages],
      max_tokens: 500,
    });
    const botReply = aiResponse.choices[0].message.content;

    await supabase.from("messages").insert([
      { bot_id: botId, session_id: sessionId || "anon", role: "user", content: lastUserMsg },
      { bot_id: botId, session_id: sessionId || "anon", role: "assistant", content: botReply }
    ]);

    res.json({ reply: botReply });
  } catch (error) {
    if (error.status === 401) return res.status(401).json({ error: "Invalid OpenAI API key." });
    res.status(500).json({ error: "Failed to generate a response." });
  }
});

app.post("/api/analytics/event", rateLimit, (req, res) => res.json({ ok: true }));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 9bot Backend running on http://localhost:${PORT}`);
  });
}

module.exports = app;
