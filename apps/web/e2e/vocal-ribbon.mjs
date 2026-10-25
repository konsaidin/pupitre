// Вокальная лента: пиксели ЦВЕТА ЛЕНТЫ слева от линии «сейчас» — во время отсчёта (негатив, ≈ 0) и через 7.5 с пения
// (позитив, > порога). Фейковый микрофон Firefox поёт ~1 кГц (MIDI ≈ 83): профиль засеян диапазоном 72–92, чтобы
// упражнение и окно ленты включали эту высоту. Пиксель ленты — лежит на отрезке «фон → цвет ленты» (ribbonColor
// в components/VocalRibbon.tsx: мимо, в допуске, расщепление) с прозрачностью 0.3–0.95 (лента рисуется с альфой
// 0.9 − 0.28·k), остаток ≤ 6 по каналам. Затем проверяется переключение лента ↔ ролл.
// --negative: заглушка отключает заливку ленты (fill(Path2D) — так рисуется только лента), сценарий ОБЯЗАН упасть;
// обёртка печатает NEGATIVE_OK, если так и вышло.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startVite, launchFirefox, seedAndReload, shoot, scenario, emojiWoff2Firefox } from './lib/browser.mjs';

if (process.argv.includes('--negative')) {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--no-ribbon'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  process.stdout.write(r.stdout);
  const failed = /^E2E_FAIL/m.test(r.stdout) && r.status === 1;
  console.log(failed ? 'NEGATIVE_OK' : 'NEGATIVE_FAIL: сценарий без ленты не упал');
  process.exit(failed ? 0 : 1);
}
const NO_RIBBON = process.argv.includes('--no-ribbon');
// Пороги по замерам 2026-10-24 (вывод «ribbon:»): отсчёт — 58, через 7.5 с — 5317/5318, без заливки ленты — 75.
const MIN_RIBBON = 3000;
const MAX_BACKGROUND = 200;

// Подсчёт в странице: фон и цвета ленты — константы VocalRibbon.tsx.
function countRibbon() {
  const canvas = document.querySelector('.pianoroll-wrap canvas');
  if (!canvas) return { error: 'canvas не найден' };
  const { width: w, height: h } = canvas;
  const img = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const BG = [26, 30, 40]; // C.bg '#1A1E28' (--rp-surface-3)
  const COLORS = [[141, 183, 255], [69, 227, 162], [255, 160, 110]]; // мимо, в допуске, расщепление (палитра Рампы)
  const dirs = COLORS.map((c) => c.map((v, i) => v - BG[i]));
  const nowX = Math.floor(w * 0.3);
  let ribbon = 0;
  let background = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < nowX; x++) {
      const i = (y * w + x) * 4;
      const d = [img[i] - BG[0], img[i + 1] - BG[1], img[i + 2] - BG[2]];
      if (Math.abs(d[0]) + Math.abs(d[1]) + Math.abs(d[2]) < 9) { background++; continue; }
      for (const dir of dirs) {
        const a = (d[0] * dir[0] + d[1] * dir[1] + d[2] * dir[2]) / (dir[0] ** 2 + dir[1] ** 2 + dir[2] ** 2);
        if (a < 0.3 || a > 0.95) continue;
        if (d.every((v, k) => Math.abs(v - a * dir[k]) <= 6)) { ribbon++; break; }
      }
    }
  }
  return { canvasW: w, canvasH: h, region: nowX * h, background, ribbon };
}

await scenario(async (track) => {
  const base = join(homedir(), '.cache/pupitre/e2e');
  await mkdir(base, { recursive: true });
  const output = await mkdtemp(join(base, 'vocal-ribbon-'));
  console.log(`Артефакты: ${output}`);
  const size = { width: 1280, height: 800 };
  const vite = await startVite();
  let browser;
  try {
    browser = await launchFirefox();
    const page = await browser.newPage();
    const log = track(page, { knownPreexisting: [emojiWoff2Firefox] });
    if (NO_RIBBON) {
      // Только лента заливается Path2D; остальные fill() — без аргументов (кружки, плашки).
      await page.evaluateOnNewDocument(() => {
        const fill = CanvasRenderingContext2D.prototype.fill;
        CanvasRenderingContext2D.prototype.fill = function (...args) {
          if (args[0] instanceof Path2D) return;
          return fill.apply(this, args);
        };
      });
    }
    await page.setViewport(size);
    await page.goto(vite.url);
    await seedAndReload(page, { lang: 'en', profile: {
      range: { lowMidi: 72, highMidi: 92 }, difficulty: 'beginner', headphonesWarned: true,
      // Теперь дефолт — roll; для проверки именно ленты выбираем её явно.
      vocalView: 'ribbon', reduceMotion: false,
    } });
    await page.goto(`${vite.url}#/exercises`);
    await page.waitForSelector('.card-head .btn.primary', { visible: true });
    await page.click('.card-head .btn.primary');
    await page.waitForSelector('.setup-start', { visible: true });
    await page.click('.setup-start');
    // Отсчёт 3 с: ленты ещё нет — негатив.
    await page.waitForSelector('.pianoroll-wrap canvas', { visible: true });
    await new Promise((resolve) => setTimeout(resolve, 800));
    const during = await page.evaluate(countRibbon);
    await shoot(page, join(output, 'countdown.png'), size);
    await new Promise((resolve) => setTimeout(resolve, 6700));
    const after = await page.evaluate(countRibbon);
    await shoot(page, join(output, 'ribbon.png'), size);
    console.log(`ribbon: отсчёт ${JSON.stringify(during)}; через 7.5 с ${JSON.stringify(after)}`);
    assert.ok(!during.error && !after.error, during.error ?? after.error);
    assert.ok(during.ribbon <= MAX_BACKGROUND, `Цвет ленты до пения: ${during.ribbon} > ${MAX_BACKGROUND}`);
    assert.ok(after.ribbon > MIN_RIBBON, `Лента: ${after.ribbon} пикселей цвета ленты ≤ ${MIN_RIBBON}`);
    const segButtons = await page.$$('.game-header .seg .seg-btn');
    await segButtons[1].click();
    await new Promise((resolve) => setTimeout(resolve, 800));
    await shoot(page, join(output, 'roll.png'), size);
    const rollHasKeyboard = await page.evaluate(() => {
      const canvas = document.querySelector('.pianoroll-wrap canvas');
      const ctx = canvas.getContext('2d');
      const img = ctx.getImageData(0, 0, 40, canvas.height).data;
      let light = 0;
      for (let i = 0; i < img.length; i += 4) {
        if (img[i] > 180 && img[i + 1] > 180 && img[i + 2] > 180) light++;
      }
      return light > 500; // белые клавиши слева
    });
    console.log('roll keyboard visible:', rollHasKeyboard);
    assert.ok(rollHasKeyboard, 'Не видны белые клавиши пиано-ролла');
    await segButtons[0].click();
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.ok(await segButtons[0].evaluate((el) => el.classList.contains('active')), 'Не вернулись на ленту');
    assert.deepEqual(log.errors(), [], 'Неожиданные ошибки сценария');
  } finally {
    try { await browser?.close(); } finally { await vite.close(); }
  }
});
