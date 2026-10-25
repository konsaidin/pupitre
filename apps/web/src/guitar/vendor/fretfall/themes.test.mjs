import assert from 'node:assert/strict';
import { COLORS, DEFAULT_STYLE, FONTS, chromeVars, theme } from './themes.js';

// The player's own themes keep the chrome they always had: the intro in the figures' face and the text colour, glass
const own = chromeVars(theme(DEFAULT_STYLE));
assert.equal(own.display, FONTS[DEFAULT_STYLE.fonts].num);
assert.equal(own.headline, COLORS[DEFAULT_STYLE.colors].text);
assert.equal(own.plate, 'transparent');
assert.equal(own.glass, 'blur(18px)');
assert.equal(own['chip-border'], COLORS[DEFAULT_STYLE.colors].chipBorder);

// A page's own set can name the title's face and inks, and turn the glass off
COLORS.page = { ...COLORS.chart, label: 'Page', headline: '#ffc247', plate: '#ff3d8b', glass: false };
FONTS.page = { ...FONTS.chart, label: 'Page', display: "'Big Shoulders Display', sans-serif" };
const page = chromeVars(theme({ ...DEFAULT_STYLE, colors: 'page', fonts: 'page' }));
assert.equal(page.display, "'Big Shoulders Display', sans-serif");
assert.equal(page.headline, '#ffc247');
assert.equal(page.plate, '#ff3d8b');
assert.equal(page.glass, 'none');
delete COLORS.page;
delete FONTS.page;
