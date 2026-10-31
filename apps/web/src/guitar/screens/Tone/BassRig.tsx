// Басовый комплект экрана «Тон»: голова на кабинете 4×10. Голова — винил с кантом, сверху две хромированные ручки и
// жалюзи с тёплым отсветом изнутри; панель — шлифованный алюминий с синей полосой под подписями: входы, шильдик, три
// голоса со светодиодами, VU-стрелка по уровню входа, лампа и тумблер питания; ниже — тумблеры Ultra Lo/Hi, ручки и
// поворотный переключатель частоты середины. Кабинет — чёрная перфорированная сталь, сквозь неё видны четыре динамика
// (литая корзина, катаный подвес, бумажный диффузор, алюминиевый колпачок) и рупор между ними; внизу —
// шильдик с тумблерами кабинета и рупора, колёса. Колпачки слегка ходят по уровню входа (при «меньше движения» стоят).
// Всё пишет settings.tone.bassAmp (питание — общее с гитарой: settings.tone.on).
import { useEffect, useId, useRef, type KeyboardEvent, type PointerEvent, type Ref } from 'react';
import { BASS_MID_FREQS, BASS_MODELS, DEFAULT_TONE, type BassAmpShape, type BassModelName, type ToneShape } from '../../../audio/guitar/tone';
import { t } from '../../../lib/i18n';
import { useLevelFrames } from '../../input/useInput';
import { Corners, Jewel, Screws, ToggleSwitch } from './Hardware';
import { Knob } from './Knob';
import { PupitreLogo } from './PupitreLogo';
import './bass.css';

type UpdateTone = (patch: (tone: ToneShape) => Partial<ToneShape>) => void;

const MODEL_UI: Record<BassModelName, { label: string }> = {
  vintage: { label: 'Vintage' },
  modern: { label: 'Modern' },
  grit: { label: 'Grit' },
};
const dial = (v: number) => (v * 10).toFixed(1).replace('.', ',');
const db = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(v % 1 ? 1 : 0)} ${t('dB')}`;
const hz = (v: number) => (v >= 1000 ? `${(v / 1000).toString().replace('.', ',')} ${t('kHz')}` : `${v} ${t('Hz')}`);
const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

// ——— VU ———

/** 0 VU — −18 dBFS сухого входа (опорный уровень цифровой записи); шкала VU: напряжение, а не децибелы. */
const VU_REF_DB = -18;
const VU_SPAN = 1.413;
const vuAngle = (vu: number) => -50 + 100 * (Math.min(VU_SPAN, Math.max(0, 10 ** (vu / 20))) / VU_SPAN);
const VU_TICKS = [-20, -10, -7, -5, -3, -2, -1, 0, 1, 2, 3];
const VU_LABELS = new Set([-20, -10, -5, 0, 3]);
/** Инерция стрелки VU: 99 % хода за 300 мс. */
const VU_TAU_S = 0.065;
const PIVOT = { x: 70, y: 96 };
const onArc = (r: number, deg: number) => {
  const a = (deg * Math.PI) / 180;
  return { x: PIVOT.x + r * Math.sin(a), y: PIVOT.y - r * Math.cos(a) };
};

/** Стрелочный индикатор уровня входа с подсветкой шкалы; при выключенном питании стрелка падает влево. */
function VuMeter({ on }: { on: boolean }) {
  const id = useId().replace(/:/g, '');
  const needle = useRef<SVGGElement>(null);
  const state = useRef({ v: 0, at: 0 });
  const place = (angle: number) => needle.current?.setAttribute('transform', `rotate(${angle.toFixed(2)} ${PIVOT.x} ${PIVOT.y})`);
  useLevelFrames(on, (level) => {
    const now = performance.now();
    const s = state.current;
    const dt = s.at ? Math.min(0.1, (now - s.at) / 1000) : 0;
    s.at = now;
    const target = Number.isFinite(level.rmsDb) ? Math.min(VU_SPAN, 10 ** ((level.rmsDb - VU_REF_DB) / 20)) : 0;
    s.v += (target - s.v) * (1 - Math.exp(-dt / VU_TAU_S));
    place(-50 + 100 * (s.v / VU_SPAN));
  });
  useEffect(() => {
    if (on) return;
    state.current = { v: 0, at: 0 };
    place(-50);
  }, [on]);
  const red = [onArc(64, vuAngle(0)), onArc(64, vuAngle(3))];
  return (
    <span className="vu" data-on={on || undefined} aria-hidden="true">
      <svg viewBox="0 0 140 84">
        <defs>
          <linearGradient id={`${id}-bezel`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fdfdfd" />
            <stop offset="0.45" stopColor="#a9acb1" />
            <stop offset="0.55" stopColor="#6d7075" />
            <stop offset="1" stopColor="#d2d4d8" />
          </linearGradient>
          <radialGradient id={`${id}-lit`} cx="0.5" cy="0.9" r="0.85">
            <stop offset="0" stopColor="#fff3cf" />
            <stop offset="0.55" stopColor="#ffd98a" />
            <stop offset="1" stopColor="#e7a945" />
          </radialGradient>
          <linearGradient id={`${id}-glass`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.45" />
            <stop offset="0.4" stopColor="#fff" stopOpacity="0.06" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <clipPath id={`${id}-face`}>
            <rect x="6" y="6" width="128" height="72" rx="3" />
          </clipPath>
        </defs>
        <rect x="0.5" y="0.5" width="139" height="83" rx="7" fill={`url(#${id}-bezel)`} stroke="#1c1d20" strokeOpacity="0.7" />
        <rect x="4.5" y="4.5" width="131" height="75" rx="4" fill="#141416" />
        <g clipPath={`url(#${id}-face)`}>
          <rect x="6" y="6" width="128" height="72" fill="#8f8574" />
          <rect className="vu__lit" x="6" y="6" width="128" height="72" fill={`url(#${id}-lit)`} />
          {/* шкала: деления, красная зона от 0 до +3, подписи */}
          <path d={`M${red[0].x} ${red[0].y}A64 64 0 0 1 ${red[1].x} ${red[1].y}`} fill="none" stroke="#c4271b" strokeWidth="4" />
          {VU_TICKS.map((vu) => {
            const a = vuAngle(vu);
            const [p, q] = [onArc(61, a), onArc(VU_LABELS.has(vu) ? 70 : 67, a)];
            return <line key={vu} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={vu > 0 ? '#c4271b' : '#2b2117'} strokeWidth={VU_LABELS.has(vu) ? 1.3 : 0.8} />;
          })}
          {VU_TICKS.filter((vu) => VU_LABELS.has(vu)).map((vu) => {
            const p = onArc(53, vuAngle(vu));
            return (
              <text key={vu} x={p.x} y={p.y + 2.5} className="vu__num" textAnchor="middle" fill={vu > 0 ? '#b3241a' : '#2b2117'}>
                {vu > 0 ? `+${vu}` : vu < 0 ? `−${-vu}` : '0'}
              </text>
            );
          })}
          <text x="70" y="62" className="vu__name" textAnchor="middle">VU</text>
          <text x="128" y="74" className="vu__brand" textAnchor="end">INPUT</text>
          {/* стрелка и её тень на шкале */}
          <g ref={needle} transform={`rotate(-50 ${PIVOT.x} ${PIVOT.y})`}>
            <line x1={PIVOT.x + 1.6} y1={PIVOT.y + 1} x2={PIVOT.x + 1.6} y2={PIVOT.y - 79} stroke="#000" strokeOpacity="0.18" strokeWidth="1.4" />
            <line x1={PIVOT.x} y1={PIVOT.y} x2={PIVOT.x} y2={PIVOT.y - 80} stroke="#191512" strokeWidth="1.1" />
          </g>
          {/* мостик над осью */}
          <path d="M6 78V70Q70 60 134 70V78Z" fill="#1b1c1f" />
          <path d="M6 70Q70 60 134 70" fill="none" stroke="#fff" strokeOpacity="0.18" strokeWidth="0.8" />
          <rect x="6" y="6" width="128" height="72" fill={`url(#${id}-glass)`} />
        </g>
      </svg>
    </span>
  );
}

// ——— поворотный переключатель ———

/** Галетный переключатель с «клювом»: положения — по дуге ±60°, подписи вокруг (клик по подписи — сразу туда). */
function RotarySwitch(props: {
  value: number; labels: string[]; spoken: string[]; initial: number; onChange: (v: number) => void; label: string; name: string; ui: string;
}) {
  const { value, labels, onChange } = props;
  const id = useId().replace(/:/g, '');
  const last = labels.length - 1;
  const angle = (i: number) => -60 + (120 * i) / last;
  const drag = useRef<{ y: number; value: number } | null>(null);
  const set = (v: number) => {
    const next = Math.min(last, Math.max(0, Math.round(v)));
    if (next !== value) onChange(next);
  };
  const rad = (deg: number) => ((deg - 90) * Math.PI) / 180;
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 };
    if (e.key in moves) set(value + moves[e.key]);
    else if (e.key === 'Home') set(0);
    else if (e.key === 'End') set(last);
    else return;
    e.preventDefault();
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const label = (e.target as Element).closest?.('[data-pos]');
    if (label) {
      set(Number(label.getAttribute('data-pos')));
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    drag.current = { y: e.clientY, value };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d) set(d.value + (d.y - e.clientY) / 28);
  };
  return (
    <div className="knob rotary" data-ui={props.ui}>
      <div className="knob__dial" role="slider" tabIndex={0} aria-label={props.name} aria-valuemin={0} aria-valuemax={last} aria-valuenow={value}
        aria-valuetext={props.spoken[value]} style={{ width: 92, height: 76 }} onKeyDown={onKeyDown} onPointerDown={onPointerDown}
        onPointerMove={onPointerMove} onPointerUp={() => (drag.current = null)} onPointerCancel={() => (drag.current = null)}
        onDoubleClick={() => set(props.initial)}>
        <svg viewBox="-60 -50 120 100" width="92" height="76" aria-hidden="true">
          <defs>
            <radialGradient id={`${id}-body`} cx="0.36" cy="0.3" r="0.8">
              <stop offset="0" stopColor="#4c4e53" />
              <stop offset="0.5" stopColor="#1c1d20" />
              <stop offset="1" stopColor="#060607" />
            </radialGradient>
            <radialGradient id={`${id}-shadow`} cx="0.56" cy="0.62" r="0.5">
              <stop offset="0.5" stopColor="#000" stopOpacity="0.5" />
              <stop offset="1" stopColor="#000" stopOpacity="0" />
            </radialGradient>
          </defs>
          {labels.map((text, i) => {
            const a = rad(angle(i));
            return (
              <g key={text} data-pos={i} className="rotary__pos" data-on={i === value || undefined}>
                <circle cx={Math.cos(a) * 30} cy={Math.sin(a) * 30 + 10} r="1.8" className="rotary__dot" />
                <text x={Math.cos(a) * 43} y={Math.sin(a) * 43 + 13} textAnchor="middle" className="rotary__label">{text}</text>
              </g>
            );
          })}
          <g transform={`translate(0 10)`}>
            <circle r="24" fill={`url(#${id}-shadow)`} transform="translate(3 4)" />
            <g transform={`rotate(${angle(value)})`}>
              {/* клюв: сужается к концу, светлая риска по оси */}
              <path d="M-8.5 -6L-2.6 -27Q0 -29.5 2.6 -27L8.5 -6Z" fill={`url(#${id}-body)`} stroke="#000" strokeOpacity="0.6" strokeWidth="0.6" />
              <circle r="15" fill={`url(#${id}-body)`} stroke="#000" strokeOpacity="0.6" strokeWidth="0.6" />
              <circle r="11" fill="none" stroke="#fff" strokeOpacity="0.1" />
              <line x1="0" y1="-8" x2="0" y2="-25" stroke="#f3efe4" strokeWidth="2" strokeLinecap="round" />
            </g>
            <ellipse cx="-5" cy="-6" rx="6" ry="3.4" transform="rotate(-30 -5 -6)" fill="#fff" fillOpacity="0.1" />
          </g>
        </svg>
      </div>
      <span className="knob__label">{props.label}</span>
      <span className="knob__value rp-num" aria-hidden="true">{props.spoken[value]}</span>
    </div>
  );
}

// ——— фурнитура ———

/** Хромированная ручка-скоба на крышке: две опоры на винтах, тень на винил. */
function BarHandle({ side }: { side: 'l' | 'r' }) {
  const id = useId().replace(/:/g, '');
  const bar = 'M14 34V18Q14 9 23 9H97Q106 9 106 18V34';
  return (
    <svg className={`bass-head__bar bass-head__bar--${side}`} viewBox="0 0 120 44" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-chrome`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.35" stopColor="#c1c4c9" />
          <stop offset="0.6" stopColor="#5d6065" />
          <stop offset="1" stopColor="#cfd2d6" />
        </linearGradient>
        <filter id={`${id}-soft`} x="-20%" y="-40%" width="140%" height="180%">
          <feGaussianBlur stdDeviation="1.6" />
        </filter>
      </defs>
      <path d={bar} transform="translate(3 5)" fill="none" stroke="#000" strokeOpacity="0.5" strokeWidth="7" filter={`url(#${id}-soft)`} />
      <path d={bar} fill="none" stroke="#2a2b2e" strokeWidth="7.4" strokeLinecap="round" />
      <path d={bar} fill="none" stroke={`url(#${id}-chrome)`} strokeWidth="6" strokeLinecap="round" />
      <path d="M16 30V18.5Q16 11 23.5 11H96" fill="none" stroke="#fff" strokeOpacity="0.75" strokeWidth="1.1" strokeLinecap="round" />
      {[4, 96].map((x) => (
        <g key={x}>
          <rect x={x} y="31" width="20" height="12" rx="3" fill={`url(#${id}-chrome)`} stroke="#1c1d20" strokeOpacity="0.7" strokeWidth="0.6" />
          <circle cx={x + 10} cy="37" r="2.4" fill="#d4d6da" stroke="#2a2c30" strokeOpacity="0.6" strokeWidth="0.5" />
          <path d={`M${x + 8.4} 37H${x + 11.6}`} stroke="#2a2c30" strokeWidth="0.7" />
        </g>
      ))}
    </svg>
  );
}

/** Колесо кабинета: хромированная площадка, вилка, резиновое колесо с бликом. */
function Caster({ side }: { side: 'l' | 'r' }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg className={`bass-cab__caster bass-cab__caster--${side}`} viewBox="0 0 64 44" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-chrome`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f6f7f8" />
          <stop offset="0.5" stopColor="#8d9095" />
          <stop offset="1" stopColor="#3d3f43" />
        </linearGradient>
        <radialGradient id={`${id}-tyre`} cx="0.4" cy="0.35" r="0.7">
          <stop offset="0" stopColor="#3b3c3f" />
          <stop offset="0.7" stopColor="#121214" />
          <stop offset="1" stopColor="#050506" />
        </radialGradient>
      </defs>
      <ellipse cx="34" cy="41" rx="22" ry="3" fill="#000" fillOpacity="0.55" />
      <rect x="10" y="0" width="44" height="6" rx="2" fill={`url(#${id}-chrome)`} />
      <path d="M22 6H42L40 20H24Z" fill={`url(#${id}-chrome)`} />
      <circle cx="32" cy="27" r="13" fill={`url(#${id}-tyre)`} />
      <path d="M22.5 20.5A12 12 0 0 1 36 15.4" fill="none" stroke="#fff" strokeOpacity="0.22" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="32" cy="27" r="4.2" fill={`url(#${id}-chrome)`} />
      <circle cx="32" cy="27" r="1.4" fill="#2a2b2e" />
    </svg>
  );
}

// ——— кабинет ———

/** Закрытый 4×10: динамики квадратом, рупор — в середине между ними. */
const BAFFLE = { w: 400, h: 360 };
const DRIVERS = [
  { x: 100, y: 96 }, { x: 300, y: 96 },
  { x: 100, y: 264 }, { x: 300, y: 264 },
];
const DRIVER_R = 84;

/** Динамик 10″: литая корзина на четырёх болтах, катаный подвес, бумажный диффузор с рёбрами, алюминиевый колпачок. */
function Driver({ x, y, ids }: { x: number; y: number; ids: string }) {
  const r = DRIVER_R;
  return (
    <g>
      <circle cx={x + 3} cy={y + 5} r={r + 2} fill="#000" fillOpacity="0.55" />
      <circle cx={x} cy={y} r={r} fill={`url(#${ids}-basket)`} />
      <circle cx={x} cy={y} r={r - 1} fill="none" stroke="#fff" strokeOpacity="0.12" />
      {[45, 135, 225, 315].map((a) => {
        const rad = (a * Math.PI) / 180;
        return <circle key={a} cx={x + Math.cos(rad) * (r - 6)} cy={y + Math.sin(rad) * (r - 6)} r="3.6" fill={`url(#${ids}-bolt)`} />;
      })}
      <circle cx={x} cy={y} r={r * 0.86} fill="#0b0b0c" />
      <circle cx={x} cy={y} r={r * 0.8} fill="none" stroke={`url(#${ids}-roll)`} strokeWidth={r * 0.11} />
      <circle cx={x} cy={y} r={r * 0.72} fill={`url(#${ids}-cone)`} />
      <circle cx={x} cy={y} r={r * 0.72} fill={`url(#${ids}-light)`} />
      {[0.6, 0.48, 0.38].map((k) => (
        <circle key={k} cx={x} cy={y} r={r * k} fill="none" stroke="#000" strokeOpacity="0.32" strokeWidth="1.1" />
      ))}
      <circle cx={x} cy={y} r={r * 0.3} fill="#000" fillOpacity="0.45" />
      <g className="bass-cab__cap" style={{ transformOrigin: `${x}px ${y}px` }}>
        <circle cx={x} cy={y} r={r * 0.26} fill={`url(#${ids}-cap)`} />
        <ellipse cx={x - r * 0.08} cy={y - r * 0.1} rx={r * 0.11} ry={r * 0.06} transform={`rotate(-30 ${x - r * 0.08} ${y - r * 0.1})`} fill="#fff" fillOpacity="0.7" />
      </g>
    </g>
  );
}

function Drivers({ svg }: { svg: Ref<SVGSVGElement> }) {
  const ids = useId().replace(/:/g, '');
  return (
    <svg ref={svg} className="bass-cab__drivers" viewBox={`0 0 ${BAFFLE.w} ${BAFFLE.h}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id={`${ids}-basket`} x1="0.1" y1="0.05" x2="0.9" y2="0.95">
          <stop offset="0" stopColor="#56585d" />
          <stop offset="0.45" stopColor="#25262a" />
          <stop offset="1" stopColor="#0b0b0c" />
        </linearGradient>
        <radialGradient id={`${ids}-bolt`} cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#f2f3f4" />
          <stop offset="0.6" stopColor="#8a8d92" />
          <stop offset="1" stopColor="#36383c" />
        </radialGradient>
        <linearGradient id={`${ids}-roll`} x1="0.15" y1="0.1" x2="0.85" y2="0.9">
          <stop offset="0" stopColor="#4c4d51" />
          <stop offset="0.45" stopColor="#1d1d20" />
          <stop offset="1" stopColor="#060607" />
        </linearGradient>
        <radialGradient id={`${ids}-cone`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#2c2c2f" />
          <stop offset="0.55" stopColor="#1c1c1e" />
          <stop offset="1" stopColor="#0d0d0e" />
        </radialGradient>
        <linearGradient id={`${ids}-light`} x1="0.1" y1="0.05" x2="0.9" y2="0.95">
          <stop offset="0" stopColor="#fff" stopOpacity="0.12" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.3" />
        </linearGradient>
        <radialGradient id={`${ids}-cap`} cx="0.38" cy="0.32" r="0.75">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.28" stopColor="#d6d8dc" />
          <stop offset="0.62" stopColor="#8f9297" />
          <stop offset="1" stopColor="#45484c" />
        </radialGradient>
        <linearGradient id={`${ids}-horn`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2e2f33" />
          <stop offset="1" stopColor="#0c0c0e" />
        </linearGradient>
      </defs>
      <rect width={BAFFLE.w} height={BAFFLE.h} fill="#0d0d0f" />
      {DRIVERS.map((d) => <Driver key={`${d.x}-${d.y}`} {...d} ids={ids} />)}
      {/* рупор: литой раструб в рамке на четырёх винтах, горло в середине */}
      <g transform={`translate(${BAFFLE.w / 2} ${BAFFLE.h / 2})`}>
        <rect x="-31" y="-21" width="62" height="42" rx="6" fill="#000" fillOpacity="0.5" transform="translate(2 3)" />
        <rect x="-31" y="-21" width="62" height="42" rx="6" fill={`url(#${ids}-horn)`} stroke="#000" />
        <rect x="-25" y="-16" width="50" height="32" rx="5" fill="#060607" stroke="#3d3e42" strokeOpacity="0.7" />
        <rect x="-17" y="-10.5" width="34" height="21" rx="4" fill="#111214" stroke="#2f3034" strokeOpacity="0.8" />
        <rect x="-9" y="-5.5" width="18" height="11" rx="3" fill="#18191c" stroke="#36373b" strokeOpacity="0.8" />
        <circle r="3.6" fill="#000" />
        {[[-27, -17], [27, -17], [-27, 17], [27, 17]].map(([cx, cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.7" fill={`url(#${ids}-bolt)`} />)}
      </g>
    </svg>
  );
}

// ——— комплект ———

export function BassRig({ tone, update }: { tone: ToneShape; update: UpdateTone }) {
  const amp: BassAmpShape = { ...DEFAULT_TONE.bassAmp, ...tone.bassAmp };
  const set = (patch: Partial<BassAmpShape>) => update((now) => ({ bassAmp: { ...DEFAULT_TONE.bassAmp, ...now.bassAmp, ...patch } }));
  const knob = (id: 'gain' | 'comp' | 'bass' | 'mid' | 'treble' | 'blend', label: string, name: string, shown?: string) => (
    <Knob ui={`tone-bass-${id}`} label={label} name={name} value={amp[id]} min={0} max={1} step={0.01} initial={DEFAULT_TONE.bassAmp[id]}
      shown={shown ?? dial(amp[id])} size={60} cap="black" numbers onChange={(v) => set({ [id]: v })} />
  );
  // ход колпачков по уровню входа: прямо в DOM, без перерисовки
  const drivers = useRef<SVGSVGElement>(null);
  const motion = useRef({ throw: 0, still: reducedMotion() });
  useLevelFrames(tone.on && amp.cab && !motion.current.still, (level) => {
    const m = motion.current;
    const target = Number.isFinite(level.rmsDb) ? Math.min(1, Math.max(0, (level.rmsDb + 46) / 36)) : 0;
    m.throw = target > m.throw ? target : m.throw * 0.86;
    drivers.current?.style.setProperty('--throw', m.throw.toFixed(3));
  });
  useEffect(() => {
    if (!(tone.on && amp.cab)) drivers.current?.style.setProperty('--throw', '0');
  }, [tone.on, amp.cab]);

  return (
    <div className="amp amp--bass" data-on={tone.on || undefined}>
      <section className="bass-head" aria-label={t('Bass amp')} data-ui="tone-bass-amp">
        <BarHandle side="l" />
        <BarHandle side="r" />
        <Corners small />
        <div className="bass-head__vents" data-hot={tone.on || undefined} aria-hidden="true">
          <i className="bass-head__glow" />
          <i className="bass-head__louvers" />
        </div>
        <div className="amp-head__bezel">
          <div className="bass-head__panel">
            <Screws />
            <div className="bass-head__jacks" aria-hidden="true">
              <span className="bass-head__jack"><span className="jack" /><span className="bass-head__engrave">PASSIVE</span></span>
              <span className="bass-head__jack"><span className="jack" /><span className="bass-head__engrave">ACTIVE</span></span>
            </div>
            <div className="bass-head__brand">
              <span className="amp-head__badge">
                <PupitreLogo finish="chrome" className="amp-head__logo" />
              </span>
              <span className="bass-head__model" aria-hidden="true">BASS • 300</span>
            </div>
            <div className="bass-head__voices" role="radiogroup" aria-label={t('Bass amp')} data-ui="tone-bass-model">
              {BASS_MODELS.map((model) => (
                <button key={model} type="button" className="amp-btn" role="radio" aria-checked={amp.model === model} onClick={() => set({ model })}>
                  <i className="amp-btn__led" aria-hidden="true" />
                  <span className="amp-btn__label">{t(MODEL_UI[model].label)}</span>
                </button>
              ))}
            </div>
            <VuMeter on={tone.on} />
            <div className="amp-head__power bass-head__power">
              <Jewel on={tone.on} />
              <ToggleSwitch checked={tone.on} onToggle={() => update((now) => ({ on: !now.on }))} label={t('Processor')}
                title={tone.on ? t('Processor on') : t('Clean signal')} ui="tone-bass-on" />
              <span className="amp-head__state" aria-hidden="true">POWER</span>
            </div>
            <div className="bass-head__knobs">
              <span className="bass-head__ultra">
                <ToggleSwitch checked={amp.ultraLo} onToggle={() => set({ ultraLo: !amp.ultraLo })} label={t('Ultra low')} ui="tone-bass-ultra-lo" />
                <span className="bass-head__engrave">ULTRA LO</span>
              </span>
              {knob('gain', 'Gain', t('Gain'))}
              {knob('comp', 'Comp', t('Compressor'), amp.comp > 0 ? dial(amp.comp) : t('off'))}
              {knob('bass', 'Bass', t('Bass'))}
              {knob('mid', 'Middle', t('Middle'))}
              <RotarySwitch ui="tone-bass-freq" label="Freq" name={t('Mid frequency')} value={amp.midFreq} initial={DEFAULT_TONE.bassAmp.midFreq}
                labels={BASS_MID_FREQS.map((f) => (f >= 1000 ? `${f / 1000}K` : String(f)))} spoken={BASS_MID_FREQS.map(hz)}
                onChange={(midFreq) => set({ midFreq })} />
              {knob('treble', 'Treble', t('Treble'))}
              {knob('blend', 'Blend', t('Blend'), `${Math.round(amp.blend * 100)} %`)}
              <Knob ui="tone-bass-level" label="Master" name={t('Volume')} value={amp.levelDb} min={-24} max={12} step={0.5} initial={0} shown={db(amp.levelDb)}
                size={60} cap="black" numbers onChange={(levelDb) => set({ levelDb })} />
              <span className="bass-head__ultra">
                <ToggleSwitch checked={amp.ultraHi} onToggle={() => set({ ultraHi: !amp.ultraHi })} label={t('Ultra high')} ui="tone-bass-ultra-hi" />
                <span className="bass-head__engrave">ULTRA HI</span>
              </span>
            </div>
          </div>
        </div>
        <i className="amp-head__foot amp-head__foot--l" aria-hidden="true" />
        <i className="amp-head__foot amp-head__foot--r" aria-hidden="true" />
      </section>

      <section className="bass-cab" aria-label={t('Cabinet 4×10')} data-ui="tone-bass-cab" data-off={!amp.cab || undefined}>
        <Corners />
        <div className="bass-cab__baffle">
          <Drivers svg={drivers} />
          <i className="bass-cab__grille" aria-hidden="true" />
          <PupitreLogo finish="chrome" className="bass-cab__badge" />
        </div>
        <div className="bass-cab__plate">
          <span className="bass-cab__spec" aria-hidden="true">PUPITRE 4 × 10<br />8 Ω · 800 W</span>
          <span className="bass-cab__switch">
            <span className="bass-cab__engrave" aria-hidden="true">CAB</span>
            <ToggleSwitch checked={amp.cab} onToggle={() => set({ cab: !amp.cab })} label={t('Cabinet 4×10')}
              title={amp.cab ? t('Cabinet 4×10') : t('No cabinet')} ui="tone-bass-cab-switch" />
          </span>
          <span className="bass-cab__switch">
            <span className="bass-cab__engrave" aria-hidden="true">HORN</span>
            <ToggleSwitch checked={amp.horn} onToggle={() => set({ horn: !amp.horn })} label={t('Horn')} ui="tone-bass-horn" />
          </span>
        </div>
        <Caster side="l" />
        <Caster side="r" />
      </section>
    </div>
  );
}
