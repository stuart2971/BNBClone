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

// Prompt, knowledge base and the Anthropic call live in lib/prompt.js so this
// server and the serverless api/chat.js behave identically.
// The knowledge base is read once at boot — restart after editing it.
const { KNOWLEDGE, normaliseMessages, askClaude } = require('./lib/prompt');

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

  // Only the last 20 turns are forwarded, so a long session can't grow unbounded.
  const messages = normaliseMessages(payload.messages);
  if (!messages.length) return send(res, 400, { error: 'No messages provided.' });

  try {
    const reply = await askClaude({ apiKey: API_KEY, model: MODEL, messages });
    send(res, 200, { reply });
  } catch (err) {
    console.error('Anthropic error:', err.status || '', err.message);
    send(res, err.status || 502, {
      error: err.message || 'Could not reach the assistant. Check your connection.',
    });
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
