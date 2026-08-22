# Casa Daniela — Abbey del Sol

A single-page, Airbnb-style listing for Casa Daniela, rebuilt from the crawled
abbeydelsol.com content, with an "Ask Abbey AI" concierge widget powered by Claude.

```
abbey-del-sol/
├── index.html          the whole page — markup, styles, behaviour
├── knowledge-base.md   everything the AI knows (edit this, not the code)
├── server.js           static host + Anthropic proxy, zero dependencies
├── api/chat.js         the same proxy as a serverless function
├── lib/prompt.js       system prompt + Anthropic call, shared by both
├── .env.example        copy to .env and paste your key
├── .nojekyll           stops GitHub Pages preprocessing knowledge-base.md
└── assets/
    ├── chat-config.js  where the widget sends messages (empty = static mode)
    ├── concierge.js    in-browser fallback that answers from knowledge-base.md
    ├── logo.jpg
    └── photos/         23 Casa Daniela photos
```

## Running it

Needs Node 18 or newer. No `npm install` — there are no dependencies.

```bash
cp .env.example .env
```

Open `.env`, paste your Anthropic API key, then:

```bash
node server.js
```

Open <http://localhost:3000>.

On Windows PowerShell, use `Copy-Item .env.example .env` for the first step.

## How the AI widget works

The browser never sees your API key. It POSTs the conversation to `/api/chat` on
your own server; `server.js` attaches the key and forwards the request to
Anthropic, then returns just the reply text.

```
browser  ──POST /api/chat──>  server.js  ──x-api-key──>  api.anthropic.com
```

`knowledge-base.md` is read once at startup and injected into the system prompt.
**Edit that file and restart the server to change what the assistant knows** — no
code changes needed.

The assistant is instructed to answer only from the knowledge base, to never
invent prices or policies, and to hand off to the office or to Jin's mobile when
it doesn't know something.

### Model

Defaults to `claude-sonnet-5` — fast and inexpensive, which suits short concierge
answers. Set `ANTHROPIC_MODEL=claude-opus-5` in `.env` for maximum answer quality
at higher cost.

## GitHub Pages

**Pages is a static host.** It cannot run `server.js`, and it cannot keep an
`ANTHROPIC_API_KEY` secret — anything committed to this repo is public. So the
widget has two back ends and picks whichever is available:

```
  endpoint configured in assets/chat-config.js?
  │
  ├─ yes ──> POST to the proxy ──> api.anthropic.com
  │          (server.js locally, api/chat.js hosted)
  │
  └─ no ───> assets/concierge.js answers in the browser
             from knowledge-base.md, no API key needed
```

On Pages, no endpoint is configured, so guests get the in-browser concierge:
it fetches `knowledge-base.md`, indexes it by section, and answers from the
best-matching section. It follows the same rules as the Claude prompt — it never
invents rates, it won't promise the rooftop pool is private, and anything section
8 lists as unknown gets handed to the office instead of guessed at. Sections
written *to* the assistant rather than to a guest are stripped out before
anything is shown.

`knowledge-base.md` stays the single source of truth for both paths. Edit it and
the answers change, with no code changes either way.

### Switching Pages over to real Claude answers

1. Deploy this repo somewhere that runs server code — `api/chat.js` and
   `vercel.json` are ready for Vercel as-is.
2. Set `ANTHROPIC_API_KEY` in that host's environment settings.
3. Put the function URL in `assets/chat-config.js`:

   ```js
   window.ABBEY_CHAT = { endpoint: "https://your-app.vercel.app/api/chat" };
   ```

The widget will use the proxy and quietly fall back to the local concierge if it
is ever unreachable, so the page never shows a guest a dead assistant. **Never
put the API key in `chat-config.js`** — that file ships to the browser.

Running `node server.js` locally needs no config: on `localhost` the widget tries
`/api/chat` on its own.

## Things to change before this goes live

- **Pricing is fake.** `$30/night`, the fees and the `$76` total are placeholders
  — the crawled site has no nightly rates anywhere, because Abbey del Sol keeps
  rates behind their Escapia booking system. Search `PLACEHOLDER PRICING` in
  `index.html`. The AI is separately instructed to refuse pricing questions and
  redirect to the front desk, so it won't repeat these numbers.
- **The rating is fake.** "4.9 (64 reviews)" and the Superhost badge came from the
  reference mockup, not from real data.
- **The host avatar** is currently a property photo. Swap in a real team photo.
- **Buttons are inert.** "Book Now", "Check availability", "Share" and the nav
  links don't submit anywhere yet. "Check availability" opens the assistant with a
  prefilled question, which is a reasonable interim behaviour. Point these at
  `bookings-abbeydelsol.escapia.com` when you're ready.
- **Photos are 640×457.** That's all the source zip contained. They hold up in the
  thumbnail strip and the gallery grid, but the hero is upscaled roughly 1.3× on a
  large monitor and looks slightly soft. Higher-resolution originals would be a
  visible improvement.
- **Rate limiting is thin.** `api/chat.js` caps requests per IP per minute, but
  serverless instances get recycled, so it's a speed bump rather than a quota. If
  you point the widget at a public proxy, put a durable store or your host's WAF
  in front of it, or the endpoint can be used to spend your API credit.

## Where the content came from

All copy and every fact in `knowledge-base.md` was taken from `CrawlerData.json`
(278 crawled pages of abbeydelsol.com). Nothing was invented. The knowledge base
covers:

- Casa Daniela in detail, plus Casa Debra, Casa Sonoma Apt 3, Casa Catalina,
  Casa Cuatro Estaciones, Abbey del Sol apartments 6–12 and Casa La Aurora
- Deposits by season, cancellation rules, house rules, what's supplied in each unit
- Housekeeping, laundry, bikes, baby equipment
- Cancún airport arrival, Ride Mexico transfer prices, taxis, car rental,
  police checkpoints
- Weather by month, packing, time zone, banking, drinking water, markets,
  nightlife, language
- Activities: reef, cenotes, ruins, adventure parks, yoga, islands and more
- The team, office hours, and contact numbers

Section 8 of the knowledge base is a **deliberate list of what it does not know** —
parking, accessibility, whether the rooftop pool is exclusive, Casa Daniela's exact
Wi-Fi speed, and so on. This exists because the assistant will otherwise fill those
gaps with confident, plausible, wrong answers. When you add a new fact, delete the
matching line from section 8. When you notice the assistant guessing about
something, add a line there.
