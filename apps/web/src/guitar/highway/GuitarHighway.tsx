// Дорожка (ui-spec §10, этап 10b): canvas fretfall на весь контейнер, свой rAF, кадр по часам песни + visualOffsetMs.
// Масштаб рендера — по бюджету пикселей (2.2 МП в Electron, 0.9 МП в браузере; не выше DPR и 2), адаптивное качество:
// средний кадр > 16 мс 2 с — масштаб −0.25 (не ниже 0.6), после двух шагов ещё и без софита; < 9 мс 5 с — +0.25 до потолка.
// Цифры ладов на нотах — DOM-слой (GemLabelLayer): чёткие при любом масштабе. Отклик судьи: перед кадром — время смены
// статусов (stampStatuses, от него дорожка ведёт вспышки и гашение промахов), после — подписи вердиктов из пула (verdicts.ts).
// В кадре нет setState и аллокаций сверх fretfall (текст подписи — один раз на вердикт); эффект идемпотентен под
// StrictMode (создаёт и освобождает в одном эффекте).
import { useEffect, useRef } from 'react';
import { drawHighway, drawTab, type FfCamera, type FfDrawTheme, type FfGemLabel } from '../vendor/fretfall/highway.js';
import { DEFAULT_STYLE, theme } from '../vendor/fretfall/themes.js';
import type { GuitarSettings } from '../model/types';
import { GuitarIcon } from '../ui/GuitarIcon';
import { stampStatuses, type AdaptedMap } from './adapter';
import { chipOpacity, chipText, collectChips, layoutChips, newChip, type VerdictChipKind } from './verdicts';
import './highway.css';

export interface HighwayView {
  mode: GuitarSettings['view']['mode'];
  stringOrder: GuitarSettings['view']['stringOrder'];
  noteSpeed: number;
  gemLabel: GuitarSettings['view']['gemLabel'];
  leftHanded: boolean;
}

interface Props {
  adapted: AdaptedMap;
  /** Мс песни, которые сейчас слышно (transport.heardSongMs). Читается в каждом кадре. */
  songMs: () => number;
  visualOffsetMs: number;
  view: HighwayView;
  /** Телефон: упреждение короче, чтобы дальний край не уходил под HUD (ui-spec §10.2). */
  compact?: boolean;
}

const PIXEL_BUDGET = typeof navigator !== 'undefined' && /Electron/.test(navigator.userAgent) ? 2.2e6 : 0.9e6;
const MIN_SCALE = 0.6;
const LABEL_POOL = 128;
const LABEL_PX = 32;
const VERDICT_SLOTS = [0, 1, 2, 3, 4, 5, 6, 7];

/** Стартовый масштаб рендера: не выше DPR и 2, и не больше бюджета пикселей. */
export function startScale(cssW: number, cssH: number, dpr = globalThis.devicePixelRatio || 1, budget = PIXEL_BUDGET): number {
  return Math.max(MIN_SCALE, Math.min(dpr, 2, Math.sqrt(budget / Math.max(1, cssW * cssH))));
}

/** Адаптивное качество: шаги масштаба по скользящему среднему длительности кадра. Чистая функция — тестируется. */
export interface Quality {
  scale: number;
  ceiling: number;
  ema: number;
  slowMs: number;
  fastMs: number;
  steps: number;
}
export function nextQuality(q: Quality, frameMs: number, dtMs: number): Quality {
  const ema = q.ema ? q.ema * 0.9 + frameMs * 0.1 : frameMs;
  let { scale, steps } = q;
  let slowMs = ema > 16 ? q.slowMs + dtMs : 0;
  let fastMs = ema < 9 ? q.fastMs + dtMs : 0;
  if (slowMs >= 2000 && scale > MIN_SCALE) {
    scale = Math.max(MIN_SCALE, scale - 0.25);
    steps++;
    slowMs = 0;
  }
  if (fastMs >= 5000 && scale < q.ceiling) {
    scale = Math.min(q.ceiling, scale + 0.25);
    steps = Math.max(0, steps - 1);
    fastMs = 0;
  }
  return { scale, ceiling: q.ceiling, ema, slowMs, fastMs, steps };
}

export function GuitarHighway({ adapted, songMs, visualOffsetMs, view, compact = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const verdictsRef = useRef<HTMLDivElement>(null);
  // Свежие пропсы — через ref: цикл кадров живёт весь срок компонента и не пересоздаётся на каждый рендер.
  const live = useRef({ adapted, songMs, visualOffsetMs, view, compact });
  live.current = { adapted, songMs, visualOffsetMs, view, compact };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const layer = labelsRef.current!;
    const pool: HTMLSpanElement[] = [];
    for (let i = 0; i < LABEL_POOL; i++) {
      const span = document.createElement('span');
      span.className = 'rp-gemlabel';
      span.style.opacity = '0';
      layer.append(span);
      pool.push(span);
    }
    const sink: FfGemLabel[] = [];
    const cam: FfCamera = {};
    // подписи вердиктов: элементы рисует React (иконки), кадр меняет класс, текст, transform и opacity
    const verdictEls = [...verdictsRef.current!.children] as HTMLElement[];
    const verdictTexts = verdictEls.map((el) => el.querySelector<HTMLElement>('.rp-verdict__text')!);
    const shownKind: Array<VerdictChipKind | ''> = verdictEls.map(() => '');
    const shownText = verdictEls.map(() => '');
    const chips = verdictEls.map(newChip);
    /** Текст подписи ноты — на её вердикт (момент statusAt): после перемотки та же нота получает новый. */
    const texts = new Map<number, { at: number; text: string }>();
    let chipsShown = 0;
    let textsOf: AdaptedMap | null = null;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    let quality: Quality = { scale: 1, ceiling: 2, ema: 0, slowMs: 0, fastMs: 0, steps: 0 };
    let sizeKey = '';
    let raf = 0;
    let last = performance.now();
    let shown = 0;
    let disposed = false;
    // Тема — один объект на вид: кэши fretfall (полоса пола, картинки грифа и колодки) ключуются её identity, поэтому
    // по кадрам меняются только скаляры (масштаб, reduce-motion, софит), а объект пересобирается лишь при смене вида.
    let t: FfDrawTheme | null = null;
    let viewKey = '';

    const frame = () => {
      if (disposed) return;
      raf = requestAnimationFrame(frame);
      const { adapted: a, songMs: clock, visualOffsetMs: offset, view: v, compact: phone } = live.current;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      const key = `${w}x${h}`;
      if (key !== sizeKey) {
        sizeKey = key;
        const start = startScale(w, h);
        quality = { ...quality, scale: start, ceiling: start, steps: 0 };
      }
      const t0 = performance.now();
      const now = (clock() + offset) / 1000;
      sink.length = 0;
      const vk = `${v.noteSpeed}|${v.stringOrder}|${v.leftHanded}|${v.gemLabel}|${phone}`;
      if (!t || vk !== viewKey) {
        viewKey = vk;
        t = {
          ...theme(DEFAULT_STYLE),
          headstock: 'inline',
          fill: true,
          // ui-spec §10.2: 21 ширина лада/с (0.75× fretfall), упреждение ≈ 3.4 с (телефон 2.7 с)
          noteSpeed: 0.75 * v.noteSpeed,
          drawDistance: (phone ? 2.7 : 3.4) / 4,
          stringOrder: v.stringOrder === 'high-top' ? 'high' : 'low',
          leftHanded: v.leftHanded,
          gemLabel: v.gemLabel,
          gemSink: sink,
        };
      }
      t.renderScale = quality.scale;
      t.reduceMotion = reduce.matches;
      t.soffit = quality.steps < 2;
      stampStatuses(a, now);
      if (v.mode === 'tab') drawTab(canvas, a.arr, now, t);
      else drawHighway(canvas, a.arr, now, t, cam);
      // Метки: только transform и opacity; текст меняется, лишь когда меняется цифра. Приёмник заполняется от дальних
      // нот к ближним — при переполнении пула оставляем ближние.
      const count = v.mode === 'tab' ? 0 : Math.min(sink.length, LABEL_POOL);
      const first = sink.length - count;
      for (let i = 0; i < count; i++) {
        const l = sink[first + i], span = pool[i];
        if (span.textContent !== l.text) span.textContent = l.text;
        span.style.transform = `translate(${l.x.toFixed(1)}px, ${l.y.toFixed(1)}px) scale(${(l.size / LABEL_PX).toFixed(3)}) translate(-50%, -50%)`;
        span.style.opacity = l.alpha.toFixed(2);
      }
      for (let i = count; i < shown; i++) pool[i].style.opacity = '0';
      shown = count;
      // Вердикты: над грифом на ладу ноты (у аккорда — над серединой его нот), с подъёмом и разведением.
      const above = cam.projectAbove;
      if (textsOf !== a) {
        textsOf = a;
        texts.clear();
      }
      const n = v.mode === 'tab' || !above ? 0 : collectChips(a, now, chips);
      for (let k = 0; k < n; k++) {
        const c = chips[k];
        const at = a.arr.statusAt[c.note];
        let cached = texts.get(c.note);
        if (!cached || cached.at !== at) {
          if (texts.size > 256) texts.clear();
          texts.set(c.note, (cached = { at, text: chipText(a, c.note, c.kind) }));
        }
        c.text = cached.text;
        const ffs = a.ffOfEvent[a.fromFf[c.note * 2]];
        let x = 0;
        let y = Infinity;
        for (const f of ffs) {
          const p = above!(f);
          x += p.x;
          y = Math.min(y, p.y);
        }
        c.x = x / ffs.length;
        c.y = y;
      }
      layoutChips(chips, n, reduce.matches);
      for (let k = 0; k < n; k++) {
        const c = chips[k], el = verdictEls[k];
        if (shownKind[k] !== c.kind) {
          shownKind[k] = c.kind;
          el.className = `rp-verdict rp-verdict--${c.kind}`;
        }
        if (shownText[k] !== c.text) verdictTexts[k].textContent = shownText[k] = c.text;
        el.style.transform = `translate(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px) translate(-50%, -100%)`;
        el.style.opacity = chipOpacity(c.age).toFixed(2);
      }
      for (let k = n; k < chipsShown; k++) verdictEls[k].style.opacity = '0';
      chipsShown = n;
      const t1 = performance.now();
      quality = nextQuality(quality, t1 - t0, t1 - last);
      last = t1;
    };

    let cancelled = false;
    // Шрифты Рампы — до первого кадра: иначе подписи на канвасе первых кадров уйдут в запасной шрифт.
    Promise.all([document.fonts.load(`16px "Rampa Sans"`), document.fonts.load(`16px "Rampa Mono"`)])
      .catch(() => undefined)
      .then(() => {
        if (!cancelled) raf = requestAnimationFrame(frame);
      });
    return () => {
      cancelled = true;
      disposed = true;
      cancelAnimationFrame(raf);
      layer.replaceChildren();
    };
  }, []);

  return (
    <div className="rp-highway" data-ui="highway">
      <canvas ref={canvasRef} className="rp-highway__canvas" />
      <div ref={labelsRef} className="rp-highway__labels" aria-hidden="true" />
      <div ref={verdictsRef} className="rp-highway__verdicts" data-ui="highway-verdicts" aria-hidden="true">
        {VERDICT_SLOTS.map((k) => (
          <div key={k} className="rp-verdict">
            <GuitarIcon name="arrow-left" className="rp-verdict__early" />
            <GuitarIcon name="x" className="rp-verdict__wrong" />
            <span className="rp-verdict__text" />
            <GuitarIcon name="arrow-right" className="rp-verdict__late" />
          </div>
        ))}
      </div>
    </div>
  );
}
