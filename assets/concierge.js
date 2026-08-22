/**
 * Ask Abbey AI — in-browser concierge.
 *
 * Used whenever no chat endpoint is configured (assets/chat-config.js), which
 * is the case on GitHub Pages. It fetches knowledge-base.md at runtime, indexes
 * it by section, and answers from the best-matching section. knowledge-base.md
 * stays the single source of truth: edit it and the answers change, exactly as
 * with the Claude-backed proxy.
 *
 * It will not invent an answer. Anything the knowledge base does not cover is
 * handed to the office rather than guessed at, matching the rules in the system
 * prompt in lib/prompt.js.
 */
(function () {
"use strict";

var KB_URL = "knowledge-base.md";
var PHONE = "+52 998 115 2244";

/* ------------------------------------------------------------- text utils */

// Sections written to the assistant rather than to a guest.
var SKIP_SECTION = /does NOT cover|Answering guidelines/i;

// A paragraph carrying any of these is internal guidance, not guest-facing copy.
var META = /\b(assistant|knowledge base|source material|placeholder|do not claim|treat questions|if a guest asks|never (?:invent|estimate))\b/i;

var STOP = {};
("a an and any are as at be been but by can could did do does for from get got had has have how " +
 "i if in into is it its me my need of on or our so some than that the their them then there " +
 "these they this to us was we were what when which who whom why will with would you your " +
 "about please tell know like want am el la los las de del que un una y o en es por para con mi su")
  .split(" ").forEach(function (w) { STOP[w] = true; });

// Guest wording -> words that actually appear in knowledge-base.md.
var EXPAND = {
  wifi: ["internet", "wireless", "mbps"], internet: ["wifi", "wireless", "mbps"],
  wi: ["wifi", "internet"], fi: ["wifi", "internet"],
  checkin: ["check", "arrival"], checkout: ["check", "departure"],
  arrive: ["arrival", "check"], arriving: ["arrival", "check"],
  beach: ["playa", "ocean", "sea", "shore"], playa: ["beach"],
  pool: ["infinity", "rooftop"], alberca: ["pool", "infinity", "rooftop"], piscina: ["pool", "rooftop"],
  airport: ["cancun", "cun", "terminal", "transfer", "flight"],
  cun: ["airport", "cancun"], transfer: ["airport", "ride", "taxi", "transport"],
  taxi: ["transport", "fare", "airport"], uber: ["taxi", "transport"],
  cancel: ["cancellation", "refund"], cancellation: ["refund"], refund: ["cancellation"],
  deposit: ["payment", "balance", "season"],
  pet: ["pets", "dog", "rules"], pets: ["dog", "rules"], dog: ["pets", "rules"],
  smoke: ["smoking", "rules"], smoking: ["rules"],
  kid: ["family", "children", "baby", "crib"], kids: ["family", "children", "baby", "crib"],
  child: ["children", "family", "baby"], children: ["family", "baby", "crib"],
  baby: ["crib", "equipment"], crib: ["baby", "equipment"],
  bike: ["bikes", "bicycles"], bikes: ["bicycles"], bicycle: ["bikes", "bicycles"],
  laundry: ["washer", "dryer", "load"], washer: ["laundry", "dryer"], dryer: ["laundry", "washer"],
  clean: ["housekeeping", "maid", "cleaning"], cleaning: ["housekeeping", "maid"],
  maid: ["housekeeping", "cleaning"], towel: ["towels", "provided"], towels: ["provided"],
  kitchen: ["cooking", "utensils", "equipped"],
  cook: ["kitchen", "cooking", "utensils"], cooking: ["kitchen", "utensils"],
  water: ["drinking", "filtered", "bottle"], drink: ["drinking", "water"],
  grocery: ["groceries", "market", "supermarket", "store"],
  groceries: ["market", "supermarket", "store"],
  supermarket: ["groceries", "market"], shop: ["shopping", "market", "store"],
  food: ["restaurants", "groceries", "market"], eat: ["restaurants", "dining"],
  restaurant: ["restaurants", "dining", "nightlife"], bar: ["nightlife", "restaurants"],
  weather: ["climate", "pack", "season", "rain"], pack: ["packing", "weather", "clothes"],
  rain: ["weather", "season"], december: ["weather", "season", "holiday"],
  money: ["banking", "atm", "cash", "pesos"], atm: ["banking", "money", "cash"],
  cash: ["money", "banking", "pesos"], peso: ["pesos", "money", "banking"],
  tip: ["tipping", "money"], tipping: ["money"],
  sleep: ["sleeps", "capacity", "bedroom", "beds"], sleeps: ["capacity", "bedroom", "beds"],
  bed: ["beds", "bedroom", "king", "queen"], bedroom: ["beds", "bedrooms", "capacity"],
  guest: ["guests", "sleeps", "capacity"], guests: ["sleeps", "capacity"],
  people: ["sleeps", "guests", "capacity"], person: ["sleeps", "guests"],
  big: ["larger", "sleeps", "bedrooms"], bigger: ["larger", "sleeps", "bedrooms"],
  large: ["larger", "sleeps"], group: ["sleeps", "guests", "capacity"],
  bathroom: ["bathrooms"], shower: ["bathroom", "bathrooms"],
  ac: ["conditioning", "air"], aircon: ["conditioning", "air"],
  tv: ["television", "smart"], television: ["smart"],
  car: ["rental", "driving", "checkpoints"], drive: ["driving", "car", "rental"],
  driving: ["car", "rental", "checkpoints"], police: ["checkpoints", "driving"],
  language: ["spanish", "english", "bilingual"], spanish: ["language", "bilingual"],
  passport: ["immigration", "customs"], customs: ["immigration", "arrival", "airport"],
  tour: ["tours", "snorkel", "reef", "cenote"], tours: ["snorkel", "reef", "cenote"],
  snorkel: ["reef", "tours", "snorkeling"], reef: ["snorkel", "tours"],
  cenote: ["cenotes", "tours"], ruins: ["tulum", "chichen", "tours"],
  square: ["town", "plaza"], town: ["square", "plaza", "village"],
  walk: ["walking", "minute", "block", "blocks", "location"],
  walking: ["minute", "block", "location"],
  far: ["distance", "minute", "block", "walk", "location"],
  distance: ["minute", "walk", "block", "location"],
  near: ["location", "nearby", "close", "block"], nearby: ["location", "near", "block"],
  close: ["location", "near", "block"], located: ["location"], where: ["location"],
  zone: ["time", "timezone"],
  office: ["front", "desk", "hours", "contact"], contact: ["office", "desk"],
  phone: ["mobile", "contact", "office"], call: ["phone", "mobile", "contact"],
  emergency: ["urgent", "mobile", "jin"], urgent: ["mobile", "jin", "contact"],
  book: ["booking", "reservation", "escapia"], booking: ["reservation", "escapia"],
  team: ["staff", "management", "front", "desk"], staff: ["team", "management"],
  patio: ["garden", "terrace", "rooftop"], garden: ["patio", "terrace"],
  view: ["views", "panoramic", "rooftop"],
  hora: ["time", "check", "hours"], habitacion: ["bedroom", "beds"],
  noche: ["night"], reserva: ["booking", "reservation"]
};

function fold(s) {
  // NFD + stripping combining marks means "cuánto" and "cuanto" both match.
  return String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function stem(t) {
  return t.length > 4
    ? t.replace(/ies$/, "y").replace(/(?:sses|shes|ches|xes)$/, "s").replace(/s$/, "")
    : t;
}

/** Expand a string into the token list used for matching. */
function tokenise(s) {
  var out = [];
  var parts = fold(s).replace(/[^a-z0-9\s-]/g, " ").split(/[\s-]+/);
  for (var i = 0; i < parts.length; i++) {
    var t = parts[i];
    if (!t || t.length < 2 || STOP[t]) continue;
    out.push(t);
    var st = stem(t);
    if (st !== t) out.push(st);
    var ex = EXPAND[t] || EXPAND[st];
    if (ex) out.push.apply(out, ex);
  }
  return out;
}

/** Markdown tables render badly in a chat bubble — turn them into bullets. */
function tablesToLists(text) {
  var lines = text.split("\n");
  var out = [];
  var i = 0;
  var isRow = function (l) { return /^\s*\|.*\|\s*$/.test(l || ""); };

  while (i < lines.length) {
    if (isRow(lines[i]) && isRow(lines[i + 1]) && /^[\s|:-]+$/.test(lines[i + 1])) {
      i += 2; // drop the header row and the separator
      while (i < lines.length && isRow(lines[i])) {
        var cells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map(function (c) { return c.trim(); });
        var rest = cells.slice(1).filter(Boolean).join(" · ");
        if (cells[0]) out.push("- **" + cells[0] + "** — " + rest);
        i += 1;
      }
    } else {
      out.push(lines[i]);
      i += 1;
    }
  }
  return out.join("\n");
}

/** Strip dividers and blockquote markers, drop internal guidance paragraphs. */
function cleanBody(text) {
  return tablesToLists(text)
    .replace(/^---+\s*$/gm, "")
    .split(/\n\s*\n/)
    .map(function (p) { return p.trim(); })
    .filter(function (p) { return p && !META.test(p); })
    .map(function (p) { return p.replace(/^>\s?/gm, ""); })
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ------------------------------------------------------------- the index */

function parse(md) {
  var chunks = [];
  var sec = "", sub = "", buf = [];

  function flush() {
    var body = cleanBody(buf.join("\n"));
    buf = [];
    if (!body || SKIP_SECTION.test(sec)) return;

    var tf = {};
    var count = function (list) {
      for (var i = 0; i < list.length; i++) tf[list[i]] = (tf[list[i]] || 0) + 1;
    };
    count(tokenise(sec));
    count(tokenise(sub));
    count(tokenise(body));

    chunks.push({ sec: sec, sub: sub, body: body, tf: tf, head: fold(sec + " " + sub) });
  }

  var lines = md.split("\n");
  for (var i = 0; i < lines.length; i++) {
    var h2 = lines[i].match(/^##\s+(.+?)\s*$/);
    var h3 = lines[i].match(/^###\s+(.+?)\s*$/);
    if (h2) { flush(); sec = h2[1].replace(/^\d+\.\s*/, "").trim(); sub = ""; }
    else if (h3) { flush(); sub = h3[1].replace(/^[^A-Za-z0-9]+/, "").trim(); }
    else buf.push(lines[i]);
  }
  flush();
  return chunks;
}

var INDEX = null;
var loading = null;

function load() {
  if (!loading) {
    loading = fetch(KB_URL, { cache: "no-cache" })
      .then(function (r) {
        if (!r.ok) throw new Error("knowledge base " + r.status);
        return r.text();
      })
      .then(function (text) { INDEX = parse(text); return INDEX; })
      .catch(function (err) { loading = null; throw err; });
  }
  return loading;
}

/* ------------------------------------------------------------- retrieval */

function rank(query) {
  var qt = tokenise(query);
  if (!qt.length) return [];

  var uniq = [], seen = {};
  for (var i = 0; i < qt.length; i++) {
    if (!seen[qt[i]]) { seen[qt[i]] = true; uniq.push(qt[i]); }
  }

  var fq = fold(query);

  // The page is Casa Daniela, so unqualified questions mean Casa Daniela. Only
  // reach for the rest of the portfolio when the guest names another house or
  // asks for something Casa Daniela can't be (bigger, different, an alternative).
  var wantsOther =
    /casa (debra|sonoma|catalina|cuatro|aurora|mulder|zarah|anita)/.test(fq) ||
    /\b(bigger|larger|another|other|others|alternative|alternatives|different|else|instead|too small|more (?:people|space|room|bedrooms))\b/.test(fq) ||
    /\b(?:7|8|9|10|11|12|seven|eight|nine|ten|twelve)\s+(?:people|guests|adults|of us)\b/.test(fq);

  return INDEX.map(function (c) {
    var s = 0;
    for (var j = 0; j < uniq.length; j++) {
      var t = uniq[j];
      if (c.head.indexOf(t) !== -1) s += 6;
      var n = c.tf[t];
      if (n) s += 2 + Math.min(n, 3);
    }

    var isOther = /Other Abbey del Sol properties/i.test(c.sec);
    if (wantsOther) {
      if (isOther) s *= 1.4;
      else if (/CASA DANIELA/i.test(c.sec)) s *= 0.55;
    } else if (/CASA DANIELA/i.test(c.sec)) {
      s *= 1.25;
    } else if (isOther) {
      // Otherwise the other houses' longer amenity lists outrank Casa Daniela's.
      s *= 0.6;
    }
    return { c: c, s: s };
  })
  .filter(function (r) { return r.s > 0; })
  .sort(function (a, b) { return b.s - a.s; });
}

/* --------------------------------------------------------- canned answers */

// Accented letters alone are not a signal — "Cancún" is in half the English
// questions this widget gets. Spanish punctuation and function words are.
var ES_HINT = /[¿¡]|\b(hola|buenas|buenos dias|gracias|por favor|cuanto|cuantos|cuantas|donde|cuando|como|cual|cuales|que|quien|tiene|tienen|hay|puedo|podemos|quiero|necesito|somos|esta|estan|alberca|piscina|habitacion|habitaciones|precio|precios|noche|noches|reserva|reservar|llegar|desde|para|nino|ninos|bano|banos|cocina|toalla|toallas|mascotas)\b/i;

function isSpanish(q) {
  return ES_HINT.test(q) || ES_HINT.test(fold(q));
}

function pick(es, esText, enText) {
  return es ? esText : enText;
}

function contactLine(es) {
  return pick(es,
    "La oficina abre de 8am a 5pm todos los días, y para algo urgente puedes llamar a Jin al " + PHONE + ".",
    "The office is open 8am–5pm daily, or for anything urgent you can reach Jin on " + PHONE + ".");
}

var WORD_NUM = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12, trece: 13
};

/** "eight people" -> "8 people", so one set of patterns covers both. */
function digits(f) {
  return f.replace(/\b[a-z]+\b/g, function (w) {
    return WORD_NUM[w] !== undefined ? String(WORD_NUM[w]) : w;
  });
}

/** Party size if the guest stated one, else null. Expects digits(fold(q)). */
function partySize(f) {
  var m = f.match(/\b(\d{1,2})\s*(?:people|persons|guests|adults|pax|of us|personas|adultos|huespedes)\b/) ||
          f.match(/\b(?:for|sleeps?|fits?|accommodate|accommodates|somos|para)\s+(\d{1,2})\b/) ||
          f.match(/\b(?:party|group|grupo|familia) of\s+(\d{1,2})\b/) ||
          f.match(/\bwe(?:'?re| are)\s+(\d{1,2})\b/);
  if (!m) return null;
  var n = parseInt(m[1], 10);
  return n > 0 && n < 40 ? n : null;
}

function gapAnswer(es, topicEs, topicEn) {
  return pick(es,
    "No tengo " + topicEs + ", y prefiero no adivinar en algo así. El equipo te lo confirma. " + contactLine(true),
    "I don't have " + topicEn + " on file, and I'd rather pass that to the team than guess at it. " + contactLine(false));
}

// Checked before retrieval; the first match wins.
var INTERCEPTS = [
  {
    test: function (q) {
      return /^(hi|hey|hello|yo|hola|buenas|buenos dias|good (morning|afternoon|evening))\b[\s!.,]*$/i.test(q);
    },
    reply: function (es) {
      return pick(es,
        "¡Hola! Soy la asistente de Abbey del Sol. Pregúntame lo que quieras sobre Casa Daniela — la playa, el check-in, la cocina, cómo llegar desde el aeropuerto — y te doy los detalles.",
        "Hello! I'm the Abbey del Sol assistant. Ask me anything about Casa Daniela — the beach, check-in, the kitchen, getting here from the airport — and I'll give you the details.");
    }
  },
  {
    test: function (q) {
      return /\b(thanks|thank you|gracias|cheers|bye|adios)\b/i.test(fold(q)) && q.split(/\s+/).length <= 4;
    },
    reply: function (es) {
      return pick(es,
        "¡Con gusto! Si surge algo más, aquí estoy. " + contactLine(true),
        "Any time — if anything else comes up, just ask. " + contactLine(false));
    }
  },
  {
    // Rates and availability are deliberately absent from the knowledge base.
    // Skip this when the guest asks about a cost that IS on file (transfers,
    // taxis, laundry, tours) so those still get real numbers.
    test: function (q) {
      return /\b(rate|rates|price|prices|pricing|cost|costs|nightly|per night|how much|total|fee|fees|tax|taxes|discount|cheaper|available|availability|vacancy|precio|precios|tarifa|cuesta|disponible|disponibilidad)\b/i.test(fold(q)) &&
        !/\b(transfer|traslado|airport|taxi|ride mexico|laundry|lavanderia|bike|bikes|tour|tours|cleaning|maid|shuttle|water|bottle|porter|tip)\b/i.test(fold(q));
    },
    reply: function (es) {
      return pick(es,
        "No tengo tarifas ni disponibilidad en vivo — los números de esta página son de referencia, no una cotización real. Para fechas y el total exacto, el sistema de reservas (bookings-abbeydelsol.escapia.com) o el front desk te lo confirman al momento. " + contactLine(true),
        "I don't have live rates or availability — the figures on this page are placeholders, not a real quote. For dates and an exact total, the booking system (bookings-abbeydelsol.escapia.com) or the front desk can confirm on the spot. " + contactLine(false));
    }
  },
  {
    // The knowledge base explicitly flags this as something not to promise.
    test: function (q) {
      return /\b(pool|alberca|piscina)\b/i.test(fold(q)) &&
        /\b(private|exclusive|shared|share|sharing|only|privad\w*|comparti\w*)\b/i.test(fold(q));
    },
    reply: function (es) {
      return pick(es,
        "La azotea — alberca infinity, tumbonas y la palapa con sombra — es parte del edificio y está disponible para los huéspedes de Casa Daniela, con vista al Caribe y al manglar. No quiero prometerte uso exclusivo, porque eso no lo tengo confirmado; la oficina te lo puede aclarar. " + contactLine(true),
        "The rooftop — infinity pool, sun loungers and the shaded palapa — is part of the building and available to Casa Daniela guests, looking out over the Caribbean and the mangroves. I don't want to promise you exclusive use of it, though, as that isn't something I have confirmed. The office can clear that up. " + contactLine(false));
    }
  },
  {
    // Matching a party to a property is arithmetic, not keyword overlap, so it
    // gets handled here. Every capacity below is stated in knowledge-base.md.
    test: function (q) {
      var f = digits(fold(q));
      var n = partySize(f);
      var wantsBigger =
        /\b(bigger|larger|another (?:place|property|house|option|unit)|other (?:propert\w+|places|houses|options|units)|alternatives?|something else|too small|more (?:space|bedrooms|room))\b/.test(f);
      // A stated party size only takes over when the guest is actually asking
      // about fit — "is there wifi for 2 people" is a Wi-Fi question.
      var asksFit = /\b(fits?|work|enough|room|sleeps?|accommodates?|too small|ok|okay|caben?|entran?|alcanza)\b/.test(f);
      return wantsBigger || (n !== null && (n > 6 || asksFit));
    },
    reply: function (es, q) {
      var n = partySize(digits(fold(q)));

      if (n !== null && n <= 6) {
        return pick(es,
          "Casa Daniela duerme hasta 6 personas, así que ustedes " + n + " entran bien: recámara king, segunda recámara con cama matrimonial y sofá cama queen en la sala, más 2.5 baños. " + contactLine(true),
          "Casa Daniela sleeps up to 6, so a party of " + n + " fits comfortably: a king bedroom, a second bedroom with a full-size bed, and a queen sleeper sofa in the living area, plus 2.5 bathrooms. " + contactLine(false));
      }

      if (n !== null && n > 13) {
        return pick(es,
          "Casa Daniela duerme 6, y la propiedad más grande que tengo registrada es Casa Cuatro Estaciones con capacidad para 13. Para un grupo de " + n + " habría que combinar propiedades, y eso mejor lo arma el equipo. " + contactLine(true),
          "Casa Daniela sleeps 6, and the largest property I have on file is Casa Cuatro Estaciones at 13. A group of " + n + " would mean combining properties, which is something the team should put together for you. " + contactLine(false));
      }

      var head = n !== null
        ? pick(es,
            "Casa Daniela duerme hasta 6, así que para " + n + " se queda corta. Estas sí dan el tamaño:",
            "Casa Daniela sleeps up to 6, so it would be tight for " + n + ". These are the larger ones:")
        : pick(es,
            "Casa Daniela duerme hasta 6. Si necesitas algo más grande:",
            "Casa Daniela sleeps up to 6. If you need something larger:");

      return head + "\n\n" +
        "- **Casa Debra** — " + pick(es, "duerme 8", "sleeps 8") + ". 4 " +
          pick(es, "recámaras, 4 baños, alberca privada, área de BBQ, en un fraccionamiento privado a poca distancia en coche del pueblo.",
                   "bedrooms, 4 bathrooms, a private pool and a BBQ area, in a gated community a short drive from town.") + "\n" +
        "- **Casa Cuatro Estaciones** — " + pick(es, "duerme hasta 13", "sleeps up to 13") + ". 5 " +
          pick(es, "recámaras, elevador a los tres pisos, alberca privada en la azotea, a unos pasos de la playa. Es de las más solicitadas, conviene reservar con anticipación.",
                   "bedrooms, an elevator serving all three floors, a private rooftop pool, steps from the beach. It's one of the most in-demand, so book well ahead.") + "\n" +
        "- **Casa Catalina** — " + pick(es,
            "dos apartamentos independientes que se pueden rentar juntos, buenos para familias o grupos. No tengo su capacidad total registrada.",
            "two independent apartments that can be rented together, good for families or groups. I don't have its combined capacity on file.") + "\n\n" +
        contactLine(es);
    }
  },
  {
    test: function (q) { return /\b(parking|estacionamiento|garage|valet|park my car)\b/i.test(fold(q)); },
    reply: function (es) { return gapAnswer(es, "nada sobre estacionamiento", "anything about parking"); }
  },
  {
    test: function (q) {
      return /\b(wheelchair|accessib\w*|accesib\w*|step-free|step free|mobility|elevator|lift|silla de ruedas)\b/i.test(fold(q));
    },
    reply: function (es) {
      return pick(es,
        "No tengo los detalles de accesibilidad de Casa Daniela — acceso sin escalones, ancho de puertas, regaderas accesibles — y no quiero suponer. De todo el portafolio, sólo Casa Cuatro Estaciones aparece documentada con elevador. El equipo puede revisar la propiedad concreta. " + contactLine(true),
        "I don't have accessibility details for Casa Daniela — step-free access, door widths, roll-in showers — and I don't want to assume. Across the portfolio, only Casa Cuatro Estaciones is documented as having an elevator. The team can check the specific property for you. " + contactLine(false));
    }
  },
  {
    test: function (q) {
      return /\b(sargassum|sargazo|seaweed|forecast|current weather|weather right now|weather today|hurricane (now|today|right now))\b/i.test(fold(q));
    },
    reply: function (es) {
      return gapAnswer(es,
        "las condiciones en vivo como el clima, el sargazo o el estado de alguna tormenta",
        "live conditions — weather, sargassum or storm status");
    }
  },
  {
    test: function (q) {
      return /\b(exact address|street address|direccion exacta|unit number|floor number|apartment number)\b/i.test(fold(q));
    },
    reply: function (es) {
      return gapAnswer(es,
        "la dirección exacta, el piso ni el número de unidad",
        "the exact street address, floor or unit number");
    }
  },
  {
    test: function (q) { return /\b(high ?chair|cot|extra bed|silla alta)\b/i.test(fold(q)); },
    reply: function (es) {
      return pick(es,
        "Lo que sí tengo confirmado es una cuna portátil disponible — la ropa de cama para la cuna no se incluye, así que trae la tuya — y un topper de espuma en la oficina si los colchones se sienten firmes. Más allá de eso no tengo confirmado qué otro equipo infantil hay, mejor que el equipo te lo confirme. " + contactLine(true),
        "What I can confirm is a port-a-crib — crib bedding isn't provided, so bring your own — and a foam mattress topper from the office if the beds feel firm. Beyond that I don't have what other child equipment exists, so it's worth having the team confirm. " + contactLine(false));
    }
  }
];

/* ----------------------------------------------------------------- compose */

/**
 * Some sections cover several topics in one bullet list — "Paper products,
 * laundry, bikes" is one list answering three different questions. When only a
 * small minority of the bullets match, show those and drop the rest. Never
 * trims when most bullets match, so answers whose conditions live in sibling
 * bullets (the cancellation terms, say) stay whole.
 */
function focusBullets(body, uniq) {
  var lines = body.split("\n");
  var intro = [], items = [], cur = null;

  for (var i = 0; i < lines.length; i++) {
    if (/^[-•]\s+/.test(lines[i])) {
      if (cur) items.push(cur);
      cur = [lines[i]];
    } else if (cur) {
      cur.push(lines[i]);           // indented continuation of the bullet above
    } else {
      intro.push(lines[i]);
    }
  }
  if (cur) items.push(cur);
  if (items.length < 3) return body;

  var hits = items.filter(function (it) {
    var seen = {};
    tokenise(it.join(" ")).forEach(function (t) { seen[t] = true; });
    return uniq.some(function (t) { return seen[t]; });
  });

  // Keep everything unless the matches are a clear minority.
  if (!hits.length || hits.length * 3 > items.length) return body;

  var head = intro.join("\n").trim();
  var kept = hits.map(function (it) { return it.join("\n"); }).join("\n");
  return (head ? head + "\n" : "") + kept;
}

function compose(results, es, query) {
  var best = results[0];
  var uniq = [], seen = {};
  tokenise(query).forEach(function (t) { if (!seen[t]) { seen[t] = true; uniq.push(t); } });

  var parts = [focusBullets(best.c.body, uniq)];

  // A close runner-up under a different heading usually completes the answer,
  // e.g. "getting here" wants both the airport route and the transfer rates.
  var second = results[1];
  if (second && second.s >= best.s * 0.72 && second.c.sub &&
      second.c.sec === best.c.sec && second.c.sub !== best.c.sub &&
      best.c.body.length < 900) {
    parts.push("**" + second.c.sub + "**\n" + focusBullets(second.c.body, uniq));
  }

  var out = parts.join("\n\n");
  if (es) {
    out = "Con gusto — aquí están los detalles (nuestro front desk es bilingüe si prefieres seguir en español):\n\n" + out;
  }
  return out;
}

function noMatch(es) {
  return pick(es,
    "Esa no la tengo con certeza, y prefiero no inventarte una respuesta. El equipo te la puede confirmar directamente. " + contactLine(true),
    "That's not something I have on file, and I'd rather not invent an answer for you. The team can confirm it directly. " + contactLine(false));
}

/**
 * Answer a guest question from knowledge-base.md.
 * Resolves to a markdown string; rejects only if the knowledge base won't load.
 */
function answer(question) {
  var q = String(question || "").trim();
  var es = isSpanish(q);

  for (var i = 0; i < INTERCEPTS.length; i++) {
    if (INTERCEPTS[i].test(q)) return Promise.resolve(INTERCEPTS[i].reply(es, q));
  }

  return load().then(function () {
    var results = rank(q);
    if (!results.length || results[0].s < 10) return noMatch(es);
    return compose(results, es, q);
  });
}

/** Warm the index when the widget opens, so the first answer is instant. */
function warm() {
  load()["catch"](function () {});
}

window.AbbeyConcierge = { answer: answer, warm: warm };

})();
