/**
 * Where the "Ask Abbey AI" widget sends messages.
 *
 * GitHub Pages is a static host: it cannot run api/chat.js and it cannot keep
 * an ANTHROPIC_API_KEY secret. Anything committed here is public. So the widget
 * ships with no endpoint and answers from knowledge-base.md in the browser
 * (see assets/concierge.js) — that is what makes the live Pages link work.
 *
 * To switch the live site over to real Claude answers, deploy this repo's
 * api/chat.js somewhere that runs server code (Vercel, Netlify, a Worker),
 * set ANTHROPIC_API_KEY in that host's environment, and paste the function URL
 * below. The widget will use it and fall back to the local concierge if it is
 * ever unreachable. Never paste an API key into this file.
 */
window.ABBEY_CHAT = {
  // e.g. "https://abbey-del-sol.vercel.app/api/chat"
  endpoint: ""
};
