/**
 * Abbey del Sol — static host + Anthropic proxy.
 *
 * The API key lives here, in the server process, and is read from .env.
 * It is never sent to the browser. The browser POSTs to /api/chat, this
 * process adds the key and forwards to Anthropic.
 *
 * Run:  node server.js      (Node 18+, no dependencies)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

// ---------------------------------------------------------------- config

// Minimal .env reader so there are no npm dependencies to install.
function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
  }
}
loadEnv();

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

// The knowledge base is read once at boot. Restart the server after editing it.
const KNOWLEDGE = fs.readFileSync(path.join(ROOT, 'knowledge-base.md'), 'utf8');

const SYSTEM_PROMPT = `You are "Abbey AI", the guest concierge for Abbey del Sol, a vacation rental company in Puerto Morelos, Quintana Roo, Mexico. You are embedded on the listing page for Casa Daniela and are speaking with a prospective or current guest.

Answer only from the knowledge base below. It is the complete record of what you know about these properties and this town.

Rules:
- Be warm, direct and brief. Two or three short paragraphs at most. This is a hospitality chat window, not an essay.
- Assume questions are about Casa Daniela unless the guest names another property.
- Never invent prices, availability, dates, distances, or policies. If something is not in the knowledge base, say plainly that you don't have it and offer to pass the question to the team.
- Do not infer, deduce or assume. If a detail is not stated outright in the knowledge base, you do not know it, even when a confident answer would sound reasonable. Absence of a fact is not evidence either way: never upgrade "not mentioned" into "yes" or "no". Section 8 lists the known gaps — treat it as binding.
- A guest is better served by "let me check that for you" than by a confident guess. Wrong details here become complaints on arrival.
- You do NOT have live rates or availability. The figures on the page are placeholders. Direct all pricing and booking questions to the booking system or the front desk.
- For urgent on-the-ground problems, give Jin's mobile: +52-998-115-2244. Otherwise point to the office, open 8am-5pm daily.
- Reply in the language the guest writes in. The real team is bilingual English/Spanish.
- Never mention that you are reading a "knowledge base" or a "document". You simply know these things.

--- KNOWLEDGE BASE ---
${KNOWLEDGE}
--- END KNOWLEDGE BASE ---`;

// ---------------------------------------------------------------- helpers

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) reject(new Error('payload too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------- routes

async function handleChat(req, res) {
  if (!API_KEY) {
    return send(res, 500, {
      error:
        'No ANTHROPIC_API_KEY found. Copy .env.example to .env, paste your key, and restart the server.',
    });
  }

  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    return send(res, 400, { error: 'Invalid JSON body.' });
  }

  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  if (!messages.length) return send(res, 400, { error: 'No messages provided.' });

  // Only the last 20 turns are forwarded, so a long session can't grow unbounded.
  const trimmed = messages.slice(-20).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content || '').slice(0, 4000),
  }));

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: trimmed,
      }),
    });

    const data = await upstream.json();

    if (!upstream.ok) {
      console.error('Anthropic error:', upstream.status, data);
      return send(res, upstream.status, {
        error: data?.error?.message || 'The assistant is unavailable right now.',
      });
    }

    const reply = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    send(res, 200, { reply: reply || "Sorry, I couldn't put an answer together." });
  } catch (err) {
    console.error('Proxy failure:', err);
    send(res, 502, { error: 'Could not reach the assistant. Check your connection.' });
  }
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.join(ROOT, rel);

  // Keep requests inside the project directory.
  if (!file.startsWith(ROOT)) return send(res, 403, { error: 'Forbidden' });

  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(buf);
  });
}

// ---------------------------------------------------------------- boot

http
  .createServer((req, res) => {
    if (req.url.split('?')[0] === '/api/chat') {
      if (req.method !== 'POST') return send(res, 405, { error: 'Use POST.' });
      return handleChat(req, res);
    }
    serveStatic(req, res);
  })
  .listen(PORT, () => {
    console.log(`\n  Abbey del Sol running at  http://localhost:${PORT}\n`);
    console.log(`  Model:         ${MODEL}`);
    console.log(`  Knowledge base: ${(KNOWLEDGE.length / 1024).toFixed(1)} KB loaded`);
    console.log(
      API_KEY
        ? '  API key:       loaded from .env\n'
        : '  API key:       MISSING — copy .env.example to .env and paste your key\n'
    );
  });
