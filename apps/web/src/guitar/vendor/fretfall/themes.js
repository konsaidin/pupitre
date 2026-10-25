// Style tokens, shared by the app and design/gen.mjs. A theme is one look + one palette + one font set.

export const LOOKS = { // the notes' shape, and nothing else
  stage: { label: 'Square', gem: 'glass' },
  workbench: { label: 'Rounded', gem: 'pill' },
};

export const COLORS = {
  stage: {
    label: 'Stage',
    bg: 'radial-gradient(60% 45% at 50% 30%, rgba(34, 86, 150, 0.45) 0%, rgba(34, 86, 150, 0) 70%), linear-gradient(180deg, #080d19 0%, #04060c 100%)',
    ink: '#070b16', text: '#e9eef7', muted: '#7f8ba3', accent: '#ffb547',
    floor0: '#0f2442', floor1: '#070b16', lane: '#5eb4ff', anchorLane: '#a8d8ff', anchorFill: '#3fa2ff', anchorOpacity: 0.22,
    measure: 'rgba(140, 205, 255, 0.55)', beat: 'rgba(140, 205, 255, 0.16)',
    str: ['#ff4d4d', '#ffe44d', '#3fa2ff', '#ff9a3c', '#45e08a', '#c16cff', '#26c6da', '#ec407a'],
    post: 'rgba(201, 214, 232, 0.28)', anchorPost: '#ffffff', nut: '#e8e2d0', board: 'rgba(8, 14, 28, 0.6)', inlayDot: 'rgba(200, 220, 255, 0.35)', inlay: '#5eb4ff',
    chordBox: 'rgba(233, 238, 247, 0.8)', chordFill: 'rgba(233, 238, 247, 0.05)', flash: '#ffe2a8',
    numOn: '#ffffff', numOff: '#46526b', phraseDone: '#3fa2ff', phraseTodo: 'rgba(233, 238, 247, 0.10)',
    chip: 'rgba(233, 238, 247, 0.07)', chipBorder: 'rgba(233, 238, 247, 0.14)',
  },
  chart: {
    label: 'Chart',
    bg: '#0e1014', ink: '#0e1014', text: '#e8eaef', muted: '#7b8190', accent: '#c8f04a',
    floor0: '#161920', floor1: '#0e1014', lane: '#3a404c', anchorLane: '#6b7280', anchorFill: '#262b36', anchorOpacity: 1,
    measure: '#4a515e', beat: '#22262e',
    str: ['#e5484d', '#f5c542', '#3e8ef7', '#f08c3a', '#3ecf7a', '#a66ef0', '#26c6da', '#ec407a'],
    post: '#2e333d', anchorPost: '#e8eaef', nut: '#d8d4c8', board: 'rgba(20, 23, 30, 0.7)', inlayDot: 'rgba(232, 234, 239, 0.3)', inlay: '#8fa3c7',
    chordBox: '#e8eaef', chordFill: 'rgba(232, 234, 239, 0.03)', flash: '#c8f04a',
    numOn: '#e8eaef', numOff: '#4a505c', phraseDone: '#e8eaef', phraseTodo: '#23272f',
    chip: '#171a20', chipBorder: '#2a2f38',
  },
  workbench: {
    label: 'Workbench',
    bg: 'radial-gradient(55% 40% at 50% 24%, rgba(255, 190, 120, 0.16) 0%, rgba(255, 190, 120, 0) 70%), linear-gradient(180deg, #1d1410 0%, #120c09 100%)',
    ink: '#1d1410', text: '#f4e9dc', muted: '#a8927b', accent: '#ffcf8a',
    floor0: '#3b2618', floor1: '#1d1410', lane: '#d8b98a', anchorLane: '#f0d3a4', anchorFill: '#ffcf8a', anchorOpacity: 0.13,
    measure: 'rgba(240, 211, 164, 0.5)', beat: 'rgba(240, 211, 164, 0.15)',
    str: ['#e07a6a', '#e3c46b', '#7aa6e0', '#e39a5f', '#86c48f', '#b594d6', '#7fc8c8', '#d98fb0'],
    post: '#7a624a', anchorPost: '#f0d3a4', nut: '#f0e6cc', board: 'rgba(40, 26, 18, 0.7)', inlayDot: 'rgba(240, 225, 200, 0.45)', inlay: '#e3c46b',
    chordBox: 'rgba(244, 233, 220, 0.75)', chordFill: 'rgba(244, 233, 220, 0.05)', flash: '#ffcf8a',
    numOn: '#f4e9dc', numOff: '#6e5a47', phraseDone: '#d8b98a', phraseTodo: 'rgba(216, 185, 138, 0.16)',
    chip: 'rgba(244, 233, 220, 0.06)', chipBorder: 'rgba(244, 233, 220, 0.14)',
  },
  // ПАТЧ Пюпитра (6): набор «Рампы» (ui-spec §10.1) — поля один-в-один с наборами апстрима
  rampa: {
    label: 'Rampa',
    bg: 'radial-gradient(70% 55% at 50% 22%, rgba(150,170,235,.16) 0%, rgba(150,170,235,0) 70%), linear-gradient(180deg, #06070C 0%, #040509 100%)',
    ink: '#06070B', text: '#F4F6FB', muted: '#8C93A7', accent: '#F5F7FF',
    floor0: '#0C0F18', floor1: '#05060A', lane: 'rgba(205,215,245,.13)', anchorLane: 'rgba(245,247,255,.72)',
    anchorFill: '#F5F7FF', anchorOpacity: 0.11, measure: 'rgba(225,232,255,.42)', beat: 'rgba(225,232,255,.10)',
    str: ['#FF4F5A', '#E2C102', '#1DACF9', '#FF9216', '#3FCC0C', '#C825ED', '#26C6DA', '#EC407A'],
    post: 'rgba(205,215,240,.28)', anchorPost: '#FFFFFF', nut: '#E9ECF5', board: 'rgba(10,12,20,.75)',
    inlayDot: 'rgba(225,232,255,.30)', inlay: '#F5F7FF', chordBox: 'rgba(244,246,251,.86)', chordFill: 'rgba(244,246,251,.045)',
    flash: '#FFFFFF', numOn: '#F4F6FB', numOff: 'rgba(140,147,167,.6)', phraseDone: '#F5F7FF', phraseTodo: 'rgba(244,246,251,.10)',
    chip: 'rgba(244,246,251,.06)', chipBorder: 'rgba(244,246,251,.14)',
  },
};

export const FONTS = {
  stage: {
    label: 'Chakra Petch', href: null, // ПАТЧ Пюпитра (VENDOR.md, п. 1): без Google Fonts — шрифты только локальные
    ui: "'Barlow', 'Helvetica Neue', sans-serif", num: "'Chakra Petch', 'Barlow', sans-serif", lyric: "'Barlow', 'Helvetica Neue', sans-serif", lyricStyle: 'normal',
  },
  chart: {
    label: 'IBM Plex', href: null, // ПАТЧ Пюпитра (VENDOR.md, п. 1): без Google Fonts — шрифты только локальные
    ui: "'IBM Plex Sans Condensed', 'Arial Narrow', sans-serif", num: "'IBM Plex Mono', ui-monospace, monospace", lyric: "'IBM Plex Sans Condensed', 'Arial Narrow', sans-serif", lyricStyle: 'normal',
  },
  workbench: {
    label: 'Bricolage', href: null, // ПАТЧ Пюпитра (VENDOR.md, п. 1): без Google Fonts — шрифты только локальные
    ui: "'Bricolage Grotesque', 'Avenir Next', sans-serif", num: "'Bricolage Grotesque', 'Avenir Next', sans-serif", lyric: "'Instrument Serif', Georgia, serif", lyricStyle: 'italic',
  },
  // ПАТЧ Пюпитра (6): шрифты Рампы (подключает CSS раздела, href — null)
  rampa: { label: 'Rampa', href: null, ui: "'Rampa Sans', system-ui, sans-serif", num: "'Rampa Mono', ui-monospace, monospace",
    lyric: "'Rampa Sans', system-ui, sans-serif", lyricStyle: 'normal' },
};

// String colour presets, lowest string first. Default keeps the colour theme's own; the rest replace it
export const STRINGS = {
  default: { label: 'Default' },
  neon: { label: 'Neon', str: ['#e5393e', '#22c3d1', '#34c05a', '#f08a24', '#e2398f', '#cdb82e', '#8f6bff', '#26c6da'] },
  safe: { label: 'Colour-blind', str: ['#d55e00', '#f0e442', '#56b4e9', '#e69f00', '#009e73', '#cc79a7', '#0072b2', '#ffffff'] }, // Okabe-Ito
  mono: { label: 'Mono', str: ['#ffffff', '#d6dce6', '#adb6c6', '#8792a7', '#66728a', '#4b566e', '#3a4459', '#2c3446'] }, // bright to dark, low string to high
  cb: { label: 'Для дальтоников', str: ['#C12A2A', '#A3F400', '#1DACF9', '#DB7F41', '#00C68E', '#7648A8', '#26C6DA', '#EC407A'] }, // ПАТЧ Пюпитра (6)
};

// ПАТЧ Пюпитра (6): по умолчанию — Рампа; ноты — «стекло» (look stage). Апстрим: colors 'stage', fonts 'workbench'
export const DEFAULT_STYLE = { look: 'stage', colors: 'rampa', fonts: 'rampa', strings: 'default' };

export const theme = (style) => ({ ...LOOKS[style.look], ...COLORS[style.colors], ...FONTS[style.fonts], ...(STRINGS[style.strings]?.str && { str: STRINGS[style.strings].str }) });

// The CSS variables the player's chrome draws with (its sheets, readouts and the intro card), from a theme. A colour or
// font set may also give `display` (the intro's title face, else `num`), `headline` and `plate` (its two inks: the
// title's colour, else `text`, and a print offset under it, else none) and `glass: false` (sheets and the status flat,
// with no blur behind them: for a page that never blurs over a moving canvas)
export const chromeVars = (t) => ({
  bg: t.bg, ink: t.ink, text: t.text, muted: t.muted, accent: t.accent, chip: t.chip, 'chip-border': t.chipBorder,
  done: t.phraseDone, todo: t.phraseTodo, ui: t.ui, num: t.num, lyric: t.lyric, 'lyric-style': t.lyricStyle,
  display: t.display ?? t.num, headline: t.headline ?? t.text, plate: t.plate ?? 'transparent',
  glass: t.glass === false ? 'none' : 'blur(18px)',
});
