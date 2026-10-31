// Педалборд экрана «Тон»: рама с алюминиевыми ламелями, педали в два ряда, патч-кабели и коробка петли эффектов.
// Сигнал идёт змейкой справа налево, как на настоящих бордах (вход педали справа, выход слева): ряд за рядом, между
// рядами — длинный кабель в щели борда. Коробка FX LOOP — звено цепочки: справа в неё входят педали перед усилителем
// (её правый джек — на вход усилителя), из левого джека выходит посыл петли — педали за ней звучат после усилителя и
// кабинета. Педали и коробку переставляют за шильдик — мышью или стрелками; порядок уходит в ядро (settings.tone.board →
// PARAM_SLOT_*). Кабели — SVG поверх деки по offset-координатам джеков: zoom установки их не искажает.
import { useId, useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { boardOf, DEFAULT_TONE, DELAY_MIX_ON, toggleUtility, utilitiesOn, type PedalId, type ToneShape } from '../../../audio/guitar/tone';
import { t } from '../../../lib/i18n';
import { Knob } from './Knob';
import { AutisticScreamerLogo, HerachiloLogo, KiborgLogo } from './PedalLogos';
import { PupitreLogo } from './PupitreLogo';

type Item = PedalId | 'loop';
/** Правка тона от его актуального состояния: события ручек и клавиш приходят быстрее перерисовки. */
type UpdateTone = (patch: (tone: ToneShape) => Partial<ToneShape>) => void;

/** Нижний край ручки порога; ниже стоит только порог из настроек до кнопки гейта — выключенный. */
const GATE_MIN_DB = -90;
const db = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(v % 1 ? 1 : 0)} ${t('dB')}`;
const pct = (v: number) => `${Math.round(v * 100)} %`;
const dial = (v: number) => (v * 10).toFixed(1).replace('.', ',');

/** Название на корпусе — как на железе, без перевода; функция педали для диктора — переводом. */
const PEDAL_UI: Record<PedalId, { name: string; label: string }> = {
  fuzz: { name: 'Кiборг', label: 'Fuzz' },
  screamer: { name: 'AutisticScreamer', label: 'Overdrive' },
  boost: { name: 'YUHAN chtobi Herachilo Booster', label: 'Boost' },
  gate: { name: 'Gov. Censorship Noisegate', label: 'Noise gate' },
  delay: { name: 'Forgor?…', label: 'Delay' },
  room: { name: 'Серфинг', label: 'Room' },
};

const listOf = (board: ToneShape['board']): Item[] => [...board.order.slice(0, board.loop), 'loop', ...board.order.slice(board.loop)];
const boardFrom = (list: Item[]): ToneShape['board'] => ({ order: list.filter((i): i is PedalId => i !== 'loop'), loop: list.indexOf('loop') });

/** Шильдик, за который переставляют, и место, куда бросают. */
interface Handle {
  grip: {
    draggable: true;
    tabIndex: 0;
    role: 'button';
    'data-grip': true;
    onDragStart: (e: DragEvent<HTMLElement>) => void;
    onDragEnd: () => void;
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  };
  node: {
    ref: (el: HTMLElement | null) => void;
    'data-dragging'?: true;
    onDragOver: (e: DragEvent<HTMLElement>) => void;
  };
}

function Pedal(props: { id: PedalId; on: boolean; onToggle: () => void; handle: Handle; plate: ReactNode; foot?: ReactNode; extra?: ReactNode;
  children: ReactNode }) {
  const ui = PEDAL_UI[props.id];
  const label = `${ui.name}, ${t(ui.label)}`;
  return (
    <div className={`pedal pedal--${props.id}`} data-ui={`tone-${props.id}`} data-on={props.on || undefined} {...props.handle.node}>
      <i className="pedal__jack pedal__jack--in" data-jack="in" aria-hidden="true" />
      <i className="pedal__jack pedal__jack--out" data-jack="out" aria-hidden="true" />
      <i className="pedal__dc" aria-hidden="true" />
      <span className="pedal__led" aria-hidden="true" />
      {props.extra}
      <div className="pedal__knobs">{props.children}</div>
      <div className="pedal__grip" aria-label={`${t('Move the pedal')}: ${label}`} data-ui={`tone-${props.id}-grip`} {...props.handle.grip}>
        {props.plate}
      </div>
      <span className="pedal__nut">
        <button type="button" className="pedal__switch" role="switch" aria-checked={props.on} aria-label={label} onClick={props.onToggle}
          data-ui={`tone-${props.id}-switch`} />
      </span>
      {props.foot ?? <PupitreLogo finish="ink" className="pedal__brand" />}
    </div>
  );
}

/** Коробка петли эффектов: правый джек — на вход усилителя, левый — посыл петли. */
function LoopBox({ handle }: { handle: Handle }) {
  return (
    <div className="loop-box" data-ui="tone-loop" {...handle.node}>
      <i className="pedal__jack pedal__jack--in" data-jack="in" aria-hidden="true" />
      <i className="pedal__jack pedal__jack--out" data-jack="out" aria-hidden="true" />
      <div className="loop-box__face" aria-label={`${t('Move the effects loop')}: ${t('pedals to its left play after the amp')}`}
        data-ui="tone-loop-grip" {...handle.grip}>
        <span className="loop-box__jacks" aria-hidden="true">
          <span>FX<br />SEND</span>
          <span>AMP<br />IN</span>
        </span>
        <span className="loop-box__arrow" aria-hidden="true">◀</span>
        <span className="loop-box__label" aria-hidden="true">FX LOOP</span>
        {[0, 1, 2, 3].map((i) => <i key={i} className="loop-box__screw" aria-hidden="true" />)}
      </div>
    </div>
  );
}

interface Pt { x: number; y: number }
interface Cable { d: string; plugs: Pt[]; long?: boolean }
/** Подпись конца кабеля — вертикально вдоль торца рамы. */
interface Tag { x: number; y: number; text: string; turn: 90 | -90 }

/** Центр штекера у джека: правый (вход) — снаружи справа, левый (выход) — снаружи слева. */
const PLUG = 5;

/** Кабели по координатам джеков: соседи в ряду — короткая петля вниз, ряд за рядом — длинный кабель через щель борда;
 *  гитара входит справа, выход последней педали после петли уходит влево на возврат петли усилителя. */
function useCables(deck: HTMLElement | null, nodes: Map<Item, HTMLElement>, list: Item[]) {
  const [wires, setWires] = useState<{ cables: Cable[]; tags: Tag[] }>({ cables: [], tags: [] });
  const key = list.join();
  const latest = useRef(list);
  latest.current = list;
  const last = useRef('');
  useLayoutEffect(() => {
    if (!deck) return;
    const measure = () => {
      const chain = latest.current;
      const box = (item: Item) => {
        const el = nodes.get(item);
        if (!el) return null;
        const jack = (side: 'in' | 'out'): Pt | null => {
          const j = el.querySelector<HTMLElement>(`[data-jack=${side}]`);
          if (!j) return null;
          const x = el.offsetLeft + j.offsetLeft + (side === 'in' ? j.offsetWidth + PLUG : -PLUG);
          return { x, y: el.offsetTop + j.offsetTop + j.offsetHeight / 2 };
        };
        return { in: jack('in'), out: jack('out'), top: el.offsetTop, bottom: el.offsetTop + el.offsetHeight };
      };
      const boxes = chain.map(box);
      if (boxes.some((b) => !b?.in || !b.out)) return;
      const at = boxes as Array<{ in: Pt; out: Pt; top: number; bottom: number }>;
      // педали стоят по низу ряда: ряд — общий низ, его верх — самая высокая педаль
      const sameRow = (i: number, j: number) => Math.abs(at[i].bottom - at[j].bottom) < 4;
      const rowTop = (i: number) => Math.min(...at.filter((_, j) => sameRow(i, j)).map((b) => b.top));
      const cables: Cable[] = [];
      const tags: Tag[] = [];
      const width = deck.clientWidth;
      // гитара — справа, в первый вход
      const first = at[0].in;
      cables.push({ d: `M${width + 2} ${first.y + 26}C${first.x + 30} ${first.y + 26} ${first.x + 14} ${first.y} ${first.x} ${first.y}`, plugs: [first], long: true });
      tags.push({ x: width - 14, y: first.y + 40, text: 'GUITAR', turn: 90 });
      for (let i = 0; i + 1 < at.length; i++) {
        const [a, b] = [at[i].out, at[i + 1].in];
        if (sameRow(i, i + 1)) {
          const sag = Math.max(a.y, b.y) + 46;
          cables.push({ d: `M${a.x} ${a.y}C${a.x} ${sag} ${b.x} ${sag} ${b.x} ${b.y}`, plugs: [a, b] });
        } else {
          // отходит от корпуса в сторону, спускается в щель между рядами, идёт по ней и поднимается к входу
          const gy = (at[i].bottom + rowTop(i + 1)) / 2;
          const [ax, bx] = [a.x - 16, b.x + 16];
          cables.push({
            d: `M${a.x} ${a.y}C${ax} ${a.y} ${ax} ${a.y + 12} ${ax} ${a.y + 30}L${ax} ${gy - 22}Q${ax} ${gy} ${ax + 22} ${gy}`
              + `L${bx - 22} ${gy}Q${bx} ${gy} ${bx} ${gy + 22}L${bx} ${b.y - 30}C${bx} ${b.y - 12} ${bx} ${b.y} ${b.x} ${b.y}`,
            plugs: [a, b], long: true,
          });
        }
      }
      // выход последней педали петли — на возврат петли усилителя; коробка последней — посыл не подключён
      if (chain[chain.length - 1] !== 'loop') {
        const out = at[at.length - 1].out;
        cables.push({ d: `M${out.x} ${out.y}C${out.x - 14} ${out.y} ${out.x - 20} ${out.y + 26} ${-2} ${out.y + 26}`, plugs: [out], long: true });
        tags.push({ x: 14, y: out.y + 40, text: 'FX RETURN', turn: -90 });
      }
      const next = { cables, tags };
      const sig = JSON.stringify(next);
      if (sig !== last.current) {
        last.current = sig;
        setWires(next);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(deck);
    for (const el of nodes.values()) observer.observe(el);
    return () => observer.disconnect();
  }, [deck, nodes, key]);
  return wires;
}

function Cables({ cables, tags }: { cables: Cable[]; tags: Tag[] }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg className="pedalboard__cables" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-plug`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#2b2c2f" />
          <stop offset="0.45" stopColor="#6a6d72" />
          <stop offset="1" stopColor="#141517" />
        </linearGradient>
      </defs>
      {cables.map((c, i) => (
        <g key={i} className={c.long ? 'cable cable--long' : 'cable'}>
          <path d={c.d} className="cable__shadow" />
          <path d={c.d} className="cable__body" />
          <path d={c.d} className="cable__shine" />
        </g>
      ))}
      {/* штекеры поверх кабелей: плоская «таблетка» с бликом у самого джека */}
      {cables.flatMap((c, i) => c.plugs.map((p, k) => (
        <g key={`${i}-${k}`} transform={`translate(${p.x} ${p.y})`}>
          <rect x="-5" y="-9" width="10" height="18" rx="3.5" fill={`url(#${id}-plug)`} stroke="#050506" strokeWidth="0.8" />
          <rect x="-3.5" y="-6.5" width="7" height="1.5" rx="0.7" fill="#fff" opacity="0.18" />
        </g>
      )))}
      {tags.map((tag) => (
        <text key={tag.text} x={tag.x} y={tag.y} textAnchor={tag.turn > 0 ? 'start' : 'end'} transform={`rotate(${tag.turn} ${tag.x} ${tag.y})`}
          className="pedalboard__tag">{tag.text}</text>
      ))}
    </svg>
  );
}

const Skull = () => (
  <svg className="pedal__skull" viewBox="0 0 20 22" aria-hidden="true">
    <path d="M10 1C4.8 1 1.5 4.6 1.5 9.2c0 3 1.4 4.9 3.3 5.9V19h2.4v-2h1.6v2h2.4v-2h1.6v2h2.4v-3.9c1.9-1 3.3-2.9 3.3-5.9C18.5 4.6 15.2 1 10 1Z"
      fill="#f1efe6" />
    <circle cx="6.6" cy="9.6" r="2.3" fill="#1d2430" />
    <circle cx="13.4" cy="9.6" r="2.3" fill="#1d2430" />
    <path d="M10 12.2l-1.2 2.2h2.4Z" fill="#1d2430" />
  </svg>
);

const Wave = () => (
  <svg className="pedal__wave" viewBox="0 0 100 18" aria-hidden="true">
    <path d="M0 13C10 13 12 4 22 4s11 10 19 10S50 3 60 3s12 11 20 11 12-6 20-6" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

export function Pedalboard({ tone, update }: { tone: ToneShape; update: UpdateTone }) {
  const items = listOf(boardOf(tone));
  const [preview, setPreview] = useState<Item[] | null>(null);
  const [dragging, setDragging] = useState<Item | null>(null);
  // во время перетаскивания события приходят быстрее перерисовки — текущие значения держим в ref
  const live = useRef<{ dragging: Item | null; preview: Item[] | null }>({ dragging: null, preview: null });
  const refocus = useRef<Item | null>(null);
  const [deck, setDeck] = useState<HTMLElement | null>(null);
  const nodes = useRef(new Map<Item, HTMLElement>()).current;
  const shown = preview ?? items;
  const wires = useCables(deck, nodes, shown);

  // после перестановки стрелками фокус остаётся на шильдике той же педали
  useLayoutEffect(() => {
    const item = refocus.current;
    if (!item) return;
    refocus.current = null;
    nodes.get(item)?.querySelector<HTMLElement>('[data-grip]')?.focus();
  });

  const commit = (list: Item[]) => {
    if (list.join() !== items.join()) update(() => ({ board: boardFrom(list) }));
  };
  const end = () => {
    live.current = { dragging: null, preview: null };
    setPreview(null);
    setDragging(null);
  };
  const place = (list: Item[], item: Item, to: number) => {
    const next = list.filter((i) => i !== item);
    next.splice(Math.max(0, Math.min(next.length, to)), 0, item);
    return next;
  };
  const handle = (item: Item): Handle => ({
    grip: {
      draggable: true,
      tabIndex: 0,
      role: 'button',
      'data-grip': true,
      onDragStart: (e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', item);
        const node = nodes.get(item);
        if (node) {
          const r = node.getBoundingClientRect();
          e.dataTransfer.setDragImage(node, e.clientX - r.left, e.clientY - r.top);
        }
        live.current = { dragging: item, preview: items };
        // DOM в самом dragstart не трогаем — Chromium иначе отменяет перетаскивание
        setTimeout(() => {
          if (live.current.dragging !== item) return;
          setDragging(item);
          setPreview(items);
        });
      },
      onDragEnd: end,
      onKeyDown: (e) => {
        // сигнал справа налево: стрелка влево — дальше по цепочке, вправо — ближе к гитаре
        const step = e.key === 'ArrowLeft' ? 1 : e.key === 'ArrowRight' ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        refocus.current = item;
        update((now) => {
          const list = listOf(boardOf(now));
          return { board: boardFrom(place(list, item, list.indexOf(item) + step)) };
        });
      },
    },
    node: {
      ref: (el) => {
        if (el) nodes.set(item, el);
        else nodes.delete(item);
      },
      'data-dragging': dragging === item || undefined,
      onDragOver: (e) => {
        const moving = live.current.dragging;
        if (!moving) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (item === moving) return;
        // левая половина цели — встать после неё по сигналу, правая — перед ней
        const r = e.currentTarget.getBoundingClientRect();
        const list = live.current.preview ?? items;
        const without = list.filter((i) => i !== moving);
        const next = place(list, moving, without.indexOf(item) + (e.clientX < r.left + r.width / 2 ? 1 : 0));
        if (next.join() === list.join()) return;
        live.current.preview = next;
        setPreview(next);
      },
    },
  });
  const onDeckDragOver = (e: DragEvent<HTMLElement>) => {
    if (live.current.dragging) e.preventDefault();
  };
  const onDrop = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    if (live.current.preview) commit(live.current.preview);
    end();
  };

  const on = utilitiesOn(tone);
  const screamer = tone.screamer ?? DEFAULT_TONE.screamer;
  const fuzz = tone.fuzz ?? DEFAULT_TONE.fuzz;
  const boost = tone.boost ?? DEFAULT_TONE.boost;
  const setTone = (patch: Partial<ToneShape>) => update(() => patch);
  const setScreamer = (patch: Partial<ToneShape['screamer']>) => update((now) => ({ screamer: { ...(now.screamer ?? DEFAULT_TONE.screamer), ...patch } }));
  const setFuzz = (patch: Partial<ToneShape['fuzz']>) => update((now) => ({ fuzz: { ...(now.fuzz ?? DEFAULT_TONE.fuzz), ...patch } }));
  const setBoost = (patch: (b: ToneShape['boost']) => Partial<ToneShape['boost']>) => update((now) => {
    const b = now.boost ?? DEFAULT_TONE.boost;
    return { boost: { ...b, ...patch(b) } };
  });
  const setDelay = (patch: Partial<ToneShape['delay']>) => update((now) => ({ delay: { ...now.delay, ...patch } }));
  const knob = { size: 50, cap: 'black' as const };

  const pedal = (id: PedalId) => {
    const h = handle(id);
    switch (id) {
      case 'fuzz':
        return (
          <Pedal key={id} id={id} handle={h} on={fuzz.on} onToggle={() => update((now) => ({ fuzz: { ...(now.fuzz ?? DEFAULT_TONE.fuzz), on: !(now.fuzz ?? DEFAULT_TONE.fuzz).on } }))}
            plate={<><KiborgLogo className="pedal__logo" /><span className="pedal__kind">FUZZ</span></>}>
            <Knob ui="tone-fuzz-gain" label="Fuzz" name={t('Fuzz')} value={fuzz.gain} min={0} max={1} step={0.01} initial={DEFAULT_TONE.fuzz.gain}
              shown={dial(fuzz.gain)} {...knob} cap="yellow" onChange={(gain) => setFuzz({ gain })} />
            <Knob ui="tone-fuzz-tone" label="Tone" name={t('Tone')} value={fuzz.tone} min={0} max={1} step={0.01} initial={DEFAULT_TONE.fuzz.tone}
              shown={dial(fuzz.tone)} {...knob} cap="yellow" onChange={(tn) => setFuzz({ tone: tn })} />
            <Knob ui="tone-fuzz-level" label="Level" name={t('Level')} value={fuzz.level} min={0} max={1} step={0.01} initial={DEFAULT_TONE.fuzz.level}
              shown={db((fuzz.level - 1) * 30)} {...knob} cap="yellow" onChange={(level) => setFuzz({ level })} />
          </Pedal>
        );
      case 'screamer':
        return (
          <Pedal key={id} id={id} handle={h} on={screamer.on} onToggle={() => update((now) => ({ screamer: { ...(now.screamer ?? DEFAULT_TONE.screamer), on: !(now.screamer ?? DEFAULT_TONE.screamer).on } }))}
            plate={<><AutisticScreamerLogo className="pedal__logo" /><span className="pedal__kind">OVERDRIVE</span></>}>
            <Knob ui="tone-screamer-drive" label="Drive" name={t('Drive')} value={screamer.drive} min={0} max={1} step={0.01} initial={DEFAULT_TONE.screamer.drive}
              shown={dial(screamer.drive)} {...knob} onChange={(drive) => setScreamer({ drive })} />
            <Knob ui="tone-screamer-tone" label="Tone" name={t('Tone')} value={screamer.tone} min={0} max={1} step={0.01} initial={DEFAULT_TONE.screamer.tone}
              shown={dial(screamer.tone)} {...knob} onChange={(tn) => setScreamer({ tone: tn })} />
            <Knob ui="tone-screamer-level" label="Level" name={t('Level')} value={screamer.level} min={0} max={1} step={0.01} initial={DEFAULT_TONE.screamer.level}
              shown={db((screamer.level - 0.5) * 24)} {...knob} onChange={(level) => setScreamer({ level })} />
          </Pedal>
        );
      case 'boost':
        return (
          <Pedal key={id} id={id} handle={h} on={boost.on} onToggle={() => setBoost((b) => ({ on: !b.on }))}
            plate={<span className="pedal__yuhan">YUHAN</span>} foot={<HerachiloLogo className="pedal__logo pedal__logo--foot" />}
            extra={<>
              <span className="pedal__side pedal__side--out" aria-hidden="true">OUT</span>
              <span className="pedal__side pedal__side--in" aria-hidden="true">IN</span>
              <span className="pedal__bypass" aria-hidden="true">real shit bypass</span>
            </>}>
            {[0, 1, 2, 3].map((i) => {
              const level = boost.levels[i] ?? 0.5;
              // четыре одинаковые ручки: маркировка одна, диктору — с номером
              return (
                <Knob key={i} ui={`tone-boost-level-${i + 1}`} label="Level" name={`${t('Level')} ${i + 1}`} value={level} min={0} max={1}
                  step={0.01} initial={0.5} shown={db((level - 0.5) * 15)} size={42} cap="black"
                  onChange={(v) => setBoost((b) => ({ levels: [0, 1, 2, 3].map((k) => (k === i ? v : b.levels[k] ?? 0.5)) }))} />
              );
            })}
          </Pedal>
        );
      case 'gate':
        return (
          <Pedal key={id} id={id} handle={h} on={on.gate} onToggle={() => update((now) => toggleUtility(now, 'gate'))}
            plate={<span className="pedal__name pedal__name--gov"><small>GOV. CENSORSHIP</small>NOISEGATE</span>}>
            <Knob ui="tone-gate-threshold" label="Threshold" name={t('Threshold')} value={Math.max(GATE_MIN_DB, tone.gateDb)} min={GATE_MIN_DB} max={-30} step={1}
              initial={DEFAULT_TONE.gateDb} shown={tone.gateDb >= GATE_MIN_DB ? db(tone.gateDb) : t('off')} size={54} cap="yellow" onChange={(gateDb) => setTone({ gateDb })} />
          </Pedal>
        );
      case 'delay':
        return (
          <Pedal key={id} id={id} handle={h} on={on.delay} onToggle={() => update((now) => toggleUtility(now, 'delay'))}
            plate={<><span className="pedal__name pedal__name--forgor"><Skull />forgor?…</span><span className="pedal__kind">DELAY</span></>}>
            <Knob ui="tone-delay-mix" label="Mix" name={t('Mix')} value={tone.delay.mix} min={0} max={1} step={0.01} initial={DELAY_MIX_ON} shown={pct(tone.delay.mix)}
              {...knob} onChange={(mix) => setDelay({ mix })} />
            <Knob ui="tone-delay-ms" label="Time" name={t('Time')} value={tone.delay.ms} min={20} max={1500} step={10} initial={DEFAULT_TONE.delay.ms}
              shown={`${tone.delay.ms} ${t('ms')}`} {...knob} onChange={(ms) => setDelay({ ms })} />
            <Knob ui="tone-delay-feedback" label="Repeats" name={t('Repeats')} value={tone.delay.feedback} min={0} max={0.9} step={0.01}
              initial={DEFAULT_TONE.delay.feedback} shown={pct(tone.delay.feedback)} {...knob} onChange={(feedback) => setDelay({ feedback })} />
          </Pedal>
        );
      default:
        return (
          <Pedal key={id} id={id} handle={h} on={on.room} onToggle={() => update((now) => toggleUtility(now, 'room'))}
            plate={<><span className="pedal__name pedal__name--surf">Серфинг</span><Wave /><span className="pedal__kind">REVERB</span></>}>
            <Knob ui="tone-room-mix" label="Mix" name={t('Mix')} value={tone.room} min={0} max={1} step={0.01} initial={DEFAULT_TONE.room} shown={pct(tone.room)}
              size={54} cap="chrome" onChange={(room) => setTone({ room })} />
          </Pedal>
        );
    }
  };

  return (
    <section className="pedalboard" aria-label={t('Pedalboard')} data-ui="tone-fx" data-dragging={dragging ? true : undefined}>
      <div className="pedalboard__deck" ref={setDeck} onDragOver={onDeckDragOver} onDrop={onDrop}>
        {shown.map((item) => (item === 'loop' ? <LoopBox key="loop" handle={handle('loop')} /> : pedal(item)))}
        <Cables {...wires} />
      </div>
      <span className="pedalboard__plate" aria-hidden="true">
        <PupitreLogo finish="engraved" className="pedalboard__logo" />
        <span>PEDAL BOARD</span>
      </span>
      <p className="pedalboard__hint">
        {t('Pedals move by the nameplate, with the mouse or the arrow keys. The signal runs right to left; pedals past FX LOOP play after the amp.')}
      </p>
    </section>
  );
}
