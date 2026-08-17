# Casa Daniela — Abbey del Sol

A single-page, Airbnb-style listing for Casa Daniela, rebuilt from the crawled
abbeydelsol.com content, with an "Ask Abbey AI" concierge widget powered by Claude.

```
abbey-del-sol/
├── index.html          the whole page — markup, styles, behaviour
├── knowledge-base.md   everything the AI knows (edit this, not the code)
├── server.js           static host + Anthropic proxy, zero dependencies
├── .env.example        copy to .env and paste your key
└── assets/
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

The page is deployed to GitHub Pages, but **Pages is a static host and cannot run
`server.js`**. There is no `/api/chat` endpoint there, so the assistant replies
with a "static preview" notice pointing guests at the office instead. Everything
else — gallery, lightbox, booking card, responsive layout — works normally.

To get a working assistant on a public URL, host it somewhere that runs server
code. The proxy is ~40 lines and ports directly to a serverless function:

| Host | What to do |
|---|---|
| Vercel | Move the handler to `api/chat.js`, set `ANTHROPIC_API_KEY` as an env var |
| Netlify | Same, as `netlify/functions/chat.js` |
| Cloudflare Workers | Same logic, key as a Worker secret |
| Any VPS / Render / Railway | Run `node server.js` unchanged |

Keep the key in the host's environment variables. Never put it in the client.

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
- **No rate limiting.** The `/api/chat` endpoint is open. Before putting this on a
  public host, add rate limiting per IP, or the endpoint can be used to spend your
  API credit.

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
