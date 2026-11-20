// ==========================================================================
// Phonetic Lyrics — Spicetify Extension
// Muestra la pronunciación fonética aproximada de letras en inglés
// inyectada directamente debajo de los versos de Spotify.
// ==========================================================================

(function PhoneticLyrics() {
  if (
    !globalThis.Spicetify?.Player?.addEventListener ||
    !globalThis.Spicetify?.Playbar?.Button ||
    !document.body
  ) {
    setTimeout(PhoneticLyrics, 300);
    return;
  }

  const INLINE_CLASS = "pl-inline-phonetic";
  const LYRIC_SELECTOR = [
    '[data-testid="lyrics-line"]',
    '[data-testid="fullscreen-lyric"]',
    ".lyrics-lyricsContent-lyric",
    ".main-lyrics-lyricsContent-lyric",
  ].join(", ");

  // ------------------------------------------------------------------------
  // 1. Estilos
  // ------------------------------------------------------------------------
  function injectStyles() {
    if (document.getElementById("phonetic-lyrics-styles")) return;
    const style = document.createElement("style");
    style.id = "phonetic-lyrics-styles";
    style.textContent = `
      .pl-inline-phonetic {
        display: block;
        font-size: 0.65em;
        line-height: 1.2;
        color: rgba(255, 255, 255, 0.6);
        font-weight: normal;
        margin-top: 2px;
        pointer-events: none;
      }
      /* Resaltar la fonética en la línea activa nativa de Spotify */
      .lyrics-lyricsContent-active .pl-inline-phonetic,
      .main-lyrics-lyricsContent-active .pl-inline-phonetic,
      [data-active="true"] .pl-inline-phonetic {
        color: rgba(255, 255, 255, 0.95);
        font-weight: bold;
      }
    `;
    document.head.appendChild(style);
  }

  // ------------------------------------------------------------------------
  // 2. Diccionario CMU y Motor de Reglas
  // ------------------------------------------------------------------------
  const CMUDICT_URL = "https://unpkg.com/cmu-pronouncing-dictionary@3.0.0/index.js";
  let cmuDict = null;
  let cmuDictPromise = null;

  async function loadCmuDict() {
    if (cmuDict) return cmuDict;
    if (cmuDictPromise) return cmuDictPromise;

    cmuDictPromise = (async () => {
      try {
        const res = await fetch(CMUDICT_URL, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const match = text.match(/export const dictionary = (\{[\s\S]*\})\s*;?\s*$/);
        if (!match) throw new Error("Formato del diccionario inesperado");
        cmuDict = JSON.parse(match[1]);
        return cmuDict;
      } finally {
        cmuDictPromise = null;
      }
    })();

    return cmuDictPromise;
  }

  const ARPABET_VOWELS = {
    AA: "a", AE: "a", AH: "a", AO: "o", AW: "au", AY: "ai",
    EH: "e", ER: "er", EY: "ei", IH: "i", IY: "i", OW: "ou",
    OY: "oi", UH: "u", UW: "u",
  };
  const ARPABET_CONSONANTS = {
    B: "b", CH: "ch", D: "d", DH: "d", F: "f", G: "g", HH: "j",
    JH: "y", K: "k", L: "l", M: "m", N: "n", NG: "ng", P: "p",
    R: "r", S: "s", SH: "sh", T: "t", TH: "z", V: "v", W: "u",
    Y: "y", Z: "z", ZH: "y",
  };
  const SPANISH_ACCENTS = { a: "á", e: "é", i: "í", o: "ó", u: "ú" };

  function addSpanishAccent(vowelGroup) {
    const first = vowelGroup[0];
    return SPANISH_ACCENTS[first] ? SPANISH_ACCENTS[first] + vowelGroup.slice(1) : vowelGroup;
  }

  function arpabetToSpanish(pronunciation) {
    const clean = pronunciation.split("#")[0].trim();
    const phones = clean.split(/\s+/);
    const vowelCount = phones.filter((p) => ARPABET_VOWELS[p.replace(/[0-2]$/, "")]).length;

    let out = "";
    let sawStress = false;
    for (const raw of phones) {
      const m = raw.match(/([A-Z]+)([0-2])?$/);
      if (!m) continue;
      const symbol = m[1];
      const stress = m[2];

      if (ARPABET_VOWELS[symbol]) {
        let v = ARPABET_VOWELS[symbol];
        if (stress === "1" && !sawStress && vowelCount > 1) {
          v = addSpanishAccent(v);
          sawStress = true;
        }
        out += v;
      } else if (ARPABET_CONSONANTS[symbol]) {
        out += ARPABET_CONSONANTS[symbol];
      }
    }
    return out;
  }

  const EXCEPTIONS = {
    i: "ái", you: "iú", he: "ji", she: "shi", we: "güí", they: "déi",
    me: "mi", my: "mái", your: "yor", our: "áuer", us: "as",
    this: "dis", that: "dat", the: "de", these: "díz", those: "dóuz",
    what: "guát", where: "güér", when: "güén", why: "guái", who: "ju",
    how: "jáu", and: "and", or: "or", but: "bat", for: "for",
    to: "tu", of: "óv", with: "güiz", from: "from",
    have: "jav", has: "jaz", had: "jad", do: "du", does: "daz", did: "did",
    can: "kan", "can't": "kent", will: "güil", "won't": "wóunt",
    would: "gud", could: "kud", should: "shud",
    them: "dem", then: "den", than: "dan", there: "dér", their: "dér",
    because: "bikóz", cuz: "kaz", love: "lav", like: "láik", life: "láif"
  };

  const PHRASE_REDUCTIONS = [
    [/\bgoing to\b/gi, "góna"], [/\bwant to\b/gi, "uána"],
    [/\bgot to\b/gi, "gáda"], [/\bhave to\b/gi, "jáfta"],
    [/\bgive me\b/gi, "guívmi"], [/\blet me\b/gi, "lémi"],
    [/\bdon't\b/gi, "dóunt"], [/\bI'm\b/gi, "áim"], [/\byou're\b/gi, "yor"]
  ];

  const PHONETIC_PATTERN = new RegExp(
    [...PHRASE_REDUCTIONS.map(([pattern]) => pattern.source), "[a-zA-Z]+(?:'[a-zA-Z]+)*"].join("|"),
    "gi",
  );

  function convertLine(line) {
    return line.replace(/’/g, "'").replace(PHONETIC_PATTERN, (token) => {
      const reduction = PHRASE_REDUCTIONS.find(([pattern]) =>
        token.replace(pattern, "") !== token
      );
      if (reduction) return reduction[1];

      const word = token.toLowerCase();
      if (Object.hasOwn(EXCEPTIONS, word)) return EXCEPTIONS[word];
      if (cmuDict && Object.hasOwn(cmuDict, word)) return arpabetToSpanish(cmuDict[word]);
      return token;
    });
  }

  const renderedLines = new WeakMap();
  let enabled = false;
  let frame = null;

  function syncLyrics() {
    frame = null;
    for (const line of document.querySelectorAll(LYRIC_SELECTOR)) {
      if (line.querySelector(LYRIC_SELECTOR)) continue;

      const phonetic = line.querySelector(`:scope > .${INLINE_CLASS}`);
      const original = Array.from(line.childNodes, (node) =>
        node === phonetic ? "" : node.textContent
      ).join("").trim();
      if (phonetic && renderedLines.get(phonetic) === original) continue;
      phonetic?.remove();
      if (!/[a-z]/i.test(original)) continue;

      const pronunciation = document.createElement("span");
      pronunciation.className = INLINE_CLASS;
      pronunciation.textContent = convertLine(original);
      renderedLines.set(pronunciation, original);
      line.appendChild(pronunciation);
    }
  }

  function scheduleSync() {
    if (enabled && frame === null) frame = requestAnimationFrame(syncLyrics);
  }

  const observer = new MutationObserver(scheduleSync);
  let activation = 0;

  function clearLyrics() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    document.querySelectorAll(`.${INLINE_CLASS}`).forEach((line) => line.remove());
  }

  async function togglePhonetics(button) {
    const currentActivation = ++activation;
    enabled = !enabled;
    button.active = enabled;
    if (!enabled) {
      observer.disconnect();
      clearLyrics();
      return;
    }

    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    scheduleSync();

    if (cmuDict) return;
    try {
      await loadCmuDict();
      if (enabled && currentActivation === activation) {
        clearLyrics();
        scheduleSync();
      }
    } catch (error) {
      if (enabled && currentActivation === activation) {
        console.warn("[Phonetic Lyrics] Error al cargar el diccionario CMU:", error);
        Spicetify.showNotification("Phonetic Lyrics: diccionario no disponible. Desactiva y vuelve a activar para reintentar.");
      }
    }
  }

  const ICON_SVG = `
    <svg viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M2 2.5A1.5 1.5 0 0 1 3.5 1h9A1.5 1.5 0 0 1 14 2.5v8A1.5 1.5 0 0 1 12.5 12H8.7l-2.9 2.6a.5.5 0 0 1-.8-.37V12H3.5A1.5 1.5 0 0 1 2 10.5v-8Z"/>
      <text x="8" y="8.6" font-size="6" font-family="sans-serif" text-anchor="middle" fill="var(--spice-card, #181818)">Ph</text>
    </svg>
  `;

  injectStyles();
  const button = new Spicetify.Playbar.Button("Phonetic Lyrics", ICON_SVG, togglePhonetics);
  button.element.id = "phonetic-lyrics-button";

  Spicetify.Player.addEventListener("songchange", () => {
    if (enabled) {
      clearLyrics();
      scheduleSync();
    }
  });
})();
