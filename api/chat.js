// /api/chat.js
// Vercel serverless function (Node runtime).
// Holds the Gemini API key server-side. The browser never sees it.
//
// SETUP:
// 1. In your Vercel project: Settings -> Environment Variables
//    Add GEMINI_API_KEY = <your key from https://aistudio.google.com/apikey>
// 2. Redeploy. That's it — the frontend already calls /api/chat.
//
// Optional hardening once you're live:
// - In Google AI Studio, restrict the key to your Vercel domain.
// - Add a rate limiter (e.g. Upstash Ratelimit) keyed on IP to stop abuse,
//   since this endpoint is public and will consume your Gemini quota.

const GEMINI_MODEL = "gemini-3.6-flash";
const MAX_OUTPUT_TOKENS = 220;
const MAX_HISTORY_MESSAGES = 8;
const MAX_MESSAGE_CHARS = 2000;

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server is missing GEMINI_API_KEY. Set it in your hosting provider's environment variables." });
    return;
  }

  try {
    const { systemInstruction, contents } = req.body || {};

    if (!systemInstruction || typeof systemInstruction !== "string") {
      res.status(400).json({ error: "Missing systemInstruction" });
      return;
    }
    if (!Array.isArray(contents) || contents.length === 0) {
      res.status(400).json({ error: "Missing contents" });
      return;
    }

    // Basic server-side guardrails, independent of whatever the client sends.
    const trimmedContents = contents.slice(-MAX_HISTORY_MESSAGES).map((turn) => ({
      role: turn.role === "model" ? "model" : "user",
      parts: [{ text: String(turn?.parts?.[0]?.text ?? "").slice(0, MAX_MESSAGE_CHARS) }],
    }));

    const body = {
      systemInstruction: { parts: [{ text: String(systemInstruction).slice(0, 8000) }] },
      contents: trimmedContents,
      generationConfig: { temperature: 0.6, topP: 0.9, maxOutputTokens: MAX_OUTPUT_TOKENS },
    };

    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
      }
    );

    if (!upstream.ok) {
      let msg = `Upstream request failed (${upstream.status})`;
      try {
        const j = await upstream.json();
        if (j?.error?.message) msg = j.error.message;
      } catch (_) {}
      res.status(upstream.status).json({ error: msg });
      return;
    }

    const data = await upstream.json();
    const text =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("").trim() ||
      "I'm sorry, I couldn't quite generate a response there - could you try rephrasing?";

    res.status(200).json({ text });
  } catch (err) {
    res.status(500).json({ error: "Unexpected server error: " + err.message });
  }
};
