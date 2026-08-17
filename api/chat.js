/**
 * Serverless concierge endpoint (Vercel / Netlify-compatible Node runtime).
 *
 * The browser posts here; this function attaches the API key from the host's
 * environment variables and forwards to Anthropic. The key is never exposed
 * to the client, exactly as in the local server.
 *
 * Set ANTHROPIC_API_KEY (and optionally ANTHROPIC_MODEL) in your host's
 * environment settings. Do NOT commit it.
 */
const { normaliseMessages, askClaude } = require('../lib/prompt');

// Crude per-instance rate limit. Serverless instances are recycled, so this is
// a speed bump against casual abuse, not a real quota. For production put a
// durable store (KV/Redis) or your host's WAF in front of this.
const HITS = new Map();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 12;

function rateLimited(ip) {
  const now = Date.now();
  const rec = HITS.get(ip);
  if (!rec || now - rec.start > WINDOW_MS) {
    HITS.set(ip, { start: now, count: 1 });
    return false;
  }
  rec.count += 1;
  if (HITS.size > 5000) HITS.clear();
  return rec.count > MAX_PER_WINDOW;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST.' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error: 'The assistant is not configured. Set ANTHROPIC_API_KEY in the host environment.',
    });
    return;
  }

  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown';

  if (rateLimited(ip)) {
    res.status(429).json({ error: 'Too many messages just now. Please wait a moment.' });
    return;
  }

  // Vercel parses JSON bodies; fall back to manual parsing elsewhere.
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }

  const messages = normaliseMessages(body && body.messages);
  if (!messages.length) {
    res.status(400).json({ error: 'No messages provided.' });
    return;
  }

  try {
    const reply = await askClaude({
      apiKey,
      model: process.env.ANTHROPIC_MODEL,
      messages,
    });
    res.status(200).json({ reply });
  } catch (err) {
    console.error('Anthropic call failed:', err.status, err.message);
    res.status(err.status || 502).json({
      error: err.status === 401
        ? 'The assistant is not configured correctly.'
        : 'Could not reach the assistant. Please try again.',
    });
  }
};
