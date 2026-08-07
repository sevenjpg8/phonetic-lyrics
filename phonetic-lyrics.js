// ==========================================================================
// Phonetic Lyrics — Spicetify Extension
// Muestra la pronunciación fonética aproximada de letras en inglés
// inyectada directamente debajo de los versos de Spotify.
// ==========================================================================

(function PhoneticLyrics() {
  if (
    !Spicetify?.Platform ||
    !Spicetify?.Player ||
    !Spicetify?.CosmosAsync
  ) {
    setTimeout(PhoneticLyrics, 300);
    return;
  }

  const STORAGE_PREFIX = "phonetic-lyrics:";
  const BUTTON_ID = "phonetic-lyrics-button";

  // ------------------------------------------------------------------------
  // 1. Estilos
  // ------------------------------------------------------------------------
  function injectStyles() {
    if (document.getElementById("phonetic-lyrics-styles")) return;
    const style = document.createElement("style");
    style.id = "phonetic-lyrics-styles";
    style.textContent = `
      #${BUTTON_ID} {
        background: transparent;
        border: none;
        cursor: pointer;
        color: var(--spice-subtext, #b3b3b3);
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        margin: 0 4px;
        transition: color 0.15s ease, background 0.15s ease;
      }
      #${BUTTON_ID}:hover {
        color: var(--spice-text, #fff);
        background: rgba(255,255,255,0.1);
      }
      #${BUTTON_ID}.pl-active {
        color: var(--spice-button-active, #1ed760) !important;
      }
      #${BUTTON_ID} svg {
        width: 16px;
        height: 16px;
      }
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
      [class*="active"] .pl-inline-phonetic,
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
        const res = await fetch(CMUDICT_URL);
        let text = await res.text();
        text = text.replace(/^\/\*\*.*?\*\/\s*/s, "");
        text = text.replace(/^export const dictionary = /, "").replace(/;\s*$/, "");
        cmuDict = JSON.parse(text);
      } catch (e) {
        cmuDict = {};
      }
      return cmuDict;
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

  function convertWord(rawToken) {
    const m = rawToken.match(/^([^a-zA-Z']*)([a-zA-Z']+)([^a-zA-Z']*)$/);
    if (!m) return rawToken;
    const [, prefix, core, suffix] = m;
    const bare = core.toLowerCase().replace(/'/g, "");

    if (EXCEPTIONS[bare]) return prefix + EXCEPTIONS[bare] + suffix;
    if (cmuDict && cmuDict[bare]) return prefix + arpabetToSpanish(cmuDict[bare]) + suffix;

    return prefix + bare + suffix;
  }

  function convertLine(line) {
    if (!line || !line.trim()) return "";
    let text = line;
    for (const [pattern, replacement] of PHRASE_REDUCTIONS) {
      text = text.replace(pattern, replacement);
    }
    return text
      .split(/(\s+)/)
      .map((token) => (/^\s+$/.test(token) ? token : convertWord(token)))
      .join("");
  }

  async function generateAutoPhonetics(lines) {
    await loadCmuDict();
    return lines.map((l) => convertLine(l));
  }

  // ------------------------------------------------------------------------
  // 3. Storage & API
  // ------------------------------------------------------------------------
  function loadManual(uri) {
    try {
      const raw = localStorage.getItem(`${STORAGE_PREFIX}${uri}`);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  async function fetchLyrics(trackUri) {
    try {
      const trackId = trackUri.split(":")[2];
      const res = await Spicetify.CosmosAsync.get(
        `https://spclient.wg.spotify.com/color-lyrics/v2/track/${trackId}?format=json&vocalRemoval=false`
      );
      const lines = res?.lyrics?.lines || [];
      return lines.map((l) => ({ text: l.words || "", timeMs: l.startTimeMs }));
    } catch (e) {
      return null;
    }
  }

  // ------------------------------------------------------------------------
  // 4. Inyección Inline y Sincronización DOM
  // ------------------------------------------------------------------------
  const state = {
    open: false,
    currentUri: null,
    originalLines: [], // Declaración explícita del estado
    displayLines: [],
    timer: null
  };

  function cleanText(str) {
    if (!str) return "";
    return str.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "").trim();
  }

  function injectInlinePhonetics() {
    if (!state.open || !state.displayLines.length || !state.originalLines.length) return;

    const selectors = [
      '.main-lyrics-lyricsContent-lyric',
      '[data-testid="fullscreen-lyric"]',
      'div[class*="LyricsContent__Lyric"]',
      'div[class*="lyricsContent"] > div'
    ];

    let lyricElements = [];
    for (const sel of selectors) {
      const elements = document.querySelectorAll(sel);
      if (elements.length > 0) {
        lyricElements = Array.from(elements);
        break;
      }
    }

    if (!lyricElements.length) return;

    lyricElements.forEach((lineEl) => {
      if (lineEl.querySelector('.pl-inline-phonetic')) return;

      const clone = lineEl.cloneNode(true);
      const existingPhonetic = clone.querySelector('.pl-inline-phonetic');
      if (existingPhonetic) existingPhonetic.remove();

      const rawVisibleText = clone.textContent || "";
      const cleanedVisible = cleanText(rawVisibleText);

      if (!cleanedVisible) return;

      const matchIndex = state.originalLines.findIndex((orig) => {
        const cleanedOrig = cleanText(orig.text);
        if (!cleanedOrig) return false;
        return cleanedOrig === cleanedVisible || cleanedOrig.includes(cleanedVisible) || cleanedVisible.includes(cleanedOrig);
      });

      if (matchIndex !== -1 && state.displayLines[matchIndex]) {
        const phoneticEl = document.createElement('span');
        phoneticEl.className = 'pl-inline-phonetic';
        phoneticEl.textContent = state.displayLines[matchIndex];
        lineEl.appendChild(phoneticEl);
      }
    });
  }

  function startInlineSync() {
    stopInlineSync();
    state.timer = setInterval(() => {
      injectInlinePhonetics();
    }, 400);
  }

  function stopInlineSync() {
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
    document.querySelectorAll('.pl-inline-phonetic').forEach((el) => el.remove());
  }

  async function openInlinePhonetics() {
    const track = Spicetify.Player.data?.item || Spicetify.Player.data?.track;
    const uri = track?.uri;
    if (!uri) {
      Spicetify.showNotification("Asegúrate de reproducir una canción con letras.");
      return;
    }

    state.currentUri = uri;
    const manual = loadManual(uri);
    const lyricsData = await fetchLyrics(uri);

    if (manual) {
      state.originalLines = manual.text.split("\n").map((t) => ({ text: t }));
      state.displayLines = manual.text.split("\n");
    } else if (lyricsData && lyricsData.length) {
      state.originalLines = lyricsData; // Se guarda la fuente original para la comparación de texto
      state.displayLines = await generateAutoPhonetics(lyricsData.map((l) => l.text));
    } else {
      state.originalLines = [];
      state.displayLines = [];
      Spicetify.showNotification("No se obtuvieron letras para esta canción.");
      return;
    }

    state.open = true;
    const btn = document.getElementById(BUTTON_ID);
    if (btn) btn.classList.add("pl-active");

    startInlineSync();
  }

  function toggleOverlay(e) {
    if (e) e.stopPropagation();
    if (state.open) {
      stopInlineSync();
      state.open = false;
      const btn = document.getElementById(BUTTON_ID);
      if (btn) btn.classList.remove("pl-active");
    } else {
      openInlinePhonetics();
    }
  }

  // ------------------------------------------------------------------------
  // 5. Creación del Botón
  // ------------------------------------------------------------------------
  const ICON_SVG = `
    <svg viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M2 2.5A1.5 1.5 0 0 1 3.5 1h9A1.5 1.5 0 0 1 14 2.5v8A1.5 1.5 0 0 1 12.5 12H8.7l-2.9 2.6a.5.5 0 0 1-.8-.37V12H3.5A1.5 1.5 0 0 1 2 10.5v-8Z"/>
      <text x="8" y="8.6" font-size="6" font-family="sans-serif" text-anchor="middle" fill="var(--spice-card, #181818)">Ph</text>
    </svg>
  `;

  function createButton() {
    const btn = document.createElement("button");
    btn.id = BUTTON_ID;
    btn.title = "Activar/Desactivar Fonética";
    btn.innerHTML = ICON_SVG;
    btn.addEventListener("click", toggleOverlay);
    return btn;
  }

  function injectButton() {
    if (document.getElementById(BUTTON_ID)) return;

    // Buscar el botón nativo del micrófono (letras)
    const lyricsBtnSelectors = [
      'button[data-testid="lyrics-button"]',
      'button[aria-label*="Lyrics"]',
      'button[aria-label*="Letras"]'
    ];

    let lyricsBtn = null;
    for (const sel of lyricsBtnSelectors) {
      lyricsBtn = document.querySelector(sel);
      if (lyricsBtn) break;
    }

    const newBtn = createButton();

    if (lyricsBtn && lyricsBtn.parentNode) {
      // Insertar exactamente ANTES del botón del micrófono
      lyricsBtn.parentNode.insertBefore(newBtn, lyricsBtn);
    } else {
      // Fallback: si no encuentra el micrófono, se añade al contenedor general
      const container = document.querySelector(
        ".main-nowPlayingBar-extraControls, .main-nowPlayingBar-right"
      );
      if (container) container.insertBefore(newBtn, container.firstChild);
    }
  }

  // ------------------------------------------------------------------------
  // Init
  // ------------------------------------------------------------------------
  injectStyles();
  injectButton();

  const observer = new MutationObserver(() => injectButton());
  observer.observe(document.body, { childList: true, subtree: true });

  Spicetify.Player.addEventListener("songchange", () => {
    if (state.open) {
      stopInlineSync();
      openInlinePhonetics();
    }
  });
})();