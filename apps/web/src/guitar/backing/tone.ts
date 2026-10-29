// Тон синт-минуса (чистый DSP, работает в воркере): перегруженные гитары партитуры (GM 29/30) не играются сэмплами GM —
// их рендер чистым тоном (DI) идёт через модель усилителя: гейт → пред-EQ → два каскада клиппинга с двукратным
// оверсемплингом → тонстек → кабинет; затем панорама. Поверх минуса и гайда — комната (FDN-реверберация). Всё офлайн по
// готовому PCM: уровни нормируются по всей дорожке, а не на лету.
import type { StereoPcm } from './render';

export type AmpModel = 'crunch' | 'high-gain';

// Сложение и вычитание этой константы обнуляет числа меньше ≈ 1e-34: в паузах (гейт закрыт) состояния фильтров иначе
// уходят в субнормальные числа, а с ними арифметика медленнее в разы.
const FLUSH = 1e-18;

// Биквад RBJ (Audio EQ Cookbook), транспонированная прямая форма II.
type Kind = 'lowpass' | 'highpass' | 'peaking';
class Biquad {
  private b0: number;
  private b1: number;
  private b2: number;
  private a1: number;
  private a2: number;
  private z1 = 0;
  private z2 = 0;
  constructor(kind: Kind, f: number, fs: number, q: number, db = 0) {
    const w = (2 * Math.PI * Math.min(f, fs * 0.49)) / fs, cos = Math.cos(w), alpha = Math.sin(w) / (2 * q), A = 10 ** (db / 40);
    let b0: number, b1: number, b2: number, a0: number, a2: number;
    if (kind === 'peaking') [b0, b1, b2, a0, a2] = [1 + alpha * A, -2 * cos, 1 - alpha * A, 1 + alpha / A, 1 - alpha / A];
    else if (kind === 'lowpass') [b0, b1, b2, a0, a2] = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2, 1 + alpha, 1 - alpha];
    else [b0, b1, b2, a0, a2] = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alpha, 1 - alpha];
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = a2 / a0;
  }
  step(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2 + FLUSH - FLUSH;
    this.z2 = this.b2 * x - this.a2 * y + FLUSH - FLUSH;
    return y;
  }
  run(buf: Float32Array): void {
    for (let i = 0; i < buf.length; i++) buf[i] = this.step(buf[i]);
  }
}

// Баттерворт 4-го порядка — два звена с этими добротностями.
const BUTTER4 = [0.5412, 1.3066];
const lowpass4 = (f: number, fs: number) => BUTTER4.map((q) => new Biquad('lowpass', f, fs, q));

/** Мягкое насыщение: рациональное приближение tanh (точное на ±3, дальше ±1) — в разы дешевле Math.tanh. */
const soft = (x: number) => (x <= -3 ? -1 : x >= 3 ? 1 : (x * (27 + x * x)) / (27 + 9 * x * x));

/** Мощность по «громким» блокам (тишина и хвосты не тянут уровень вниз): блоки не тише самого громкого на 30 дБ. */
export function gatedRms(buf: Float32Array, block = 2048): number {
  const powers: number[] = [];
  for (let i = 0; i < buf.length; i += block) {
    let sum = 0;
    const end = Math.min(buf.length, i + block);
    for (let j = i; j < end; j++) sum += buf[j] * buf[j];
    powers.push(sum / Math.max(1, end - i));
  }
  const floor = Math.max(1e-10, Math.max(0, ...powers) * 1e-3);
  const loud = powers.filter((p) => p >= floor);
  return loud.length ? Math.sqrt(loud.reduce((s, p) => s + p, 0) / loud.length) : 0;
}

/** Шумовой гейт перед усилителем: хвосты сэмплов под гейном иначе тянутся гулом. Пороги — от нормированного DI. */
function gate(buf: Float32Array, fs: number): void {
  const k = (sec: number) => Math.exp(-1 / (sec * fs));
  const envAtk = k(0.0005), envRel = k(0.03), gAtk = k(0.001), gRel = k(0.04);
  const open = 10 ** (-46 / 20), close = 10 ** (-54 / 20), hold = Math.round(0.03 * fs);
  let env = 0, g = 0, held = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]);
    env = a > env ? envAtk * (env - a) + a : envRel * (env - a) + a;
    if (env > open) held = hold;
    else if (env < close && held > 0) held--;
    const target = held > 0 ? 1 : 0;
    g = target > g ? gAtk * (g - target) + target : gRel * (g - target) + target + FLUSH - FLUSH;
    buf[i] *= g;
  }
}

interface AmpVoice {
  /** Срез низа до клиппинга, Гц: плотнее палм-мьют. */
  tight: number;
  /** Подъём середины до клиппинга (как у овердрайв-педали): [Гц, дБ]. */
  push: [number, number];
  /** Срез верха до клиппинга, Гц: меньше «песка». */
  fizz: number;
  /** Два каскада: усиление и смещение входа (асимметрия даёт чётные гармоники, как у лампы). */
  stages: [{ gain: number; bias: number }, { gain: number; bias: number }];
  /** Вырез середины в тонстеке, дБ. */
  scoop: number;
}

const AMPS: Record<AmpModel, AmpVoice> = {
  'high-gain': { tight: 110, push: [800, 6], fizz: 6500, stages: [{ gain: 14, bias: 0.04 }, { gain: 6, bias: 0.02 }], scoop: -5 },
  crunch: { tight: 70, push: [700, 3], fizz: 8000, stages: [{ gain: 4, bias: 0.06 }, { gain: 1.6, bias: 0.05 }], scoop: -2 },
};

/** Уровень нормированного DI на входе усилителя (по громким блокам) — от него считаются гейны каскадов. */
const DI_RMS = 0.1;

/**
 * Модель усилителя с кабинетом: моно DI → моно сигнал с уровнем `level` (RMS по громким блокам). Пустой (тихий) вход —
 * тишина той же длины.
 */
export function ampSim(di: Float32Array, fs: number, model: AmpModel, level: number): Float32Array<ArrayBuffer> {
  const voice = AMPS[model];
  const x = new Float32Array(di.length);
  const inRms = gatedRms(di);
  if (inRms < 1e-6) return x;
  const norm = DI_RMS / inRms;
  for (let i = 0; i < di.length; i++) x[i] = di[i] * norm;
  gate(x, fs);
  for (const f of [new Biquad('highpass', voice.tight, fs, 0.707), new Biquad('peaking', voice.push[0], fs, 0.8, voice.push[1]), new Biquad('lowpass', voice.fizz, fs, 0.707)]) f.run(x);

  // Нелинейная часть на удвоенной частоте: линейная интерполяция → антиимиджинг → каскады → антиалиасинг → прореживание.
  // Смещение — до усиления: сдвигает точку клиппинга, и меандр перегруза несимметричен по скважности (чётные гармоники
  // остаются и на полном насыщении). Постоянную составляющую между каскадами снимает однополюсный ФВЧ на 20 Гц.
  const fs2 = fs * 2;
  const up = lowpass4(0.45 * fs, fs2), down = lowpass4(0.45 * fs, fs2);
  const [s1, s2] = voice.stages;
  const o1 = soft(s1.gain * s1.bias), o2 = soft(s2.gain * s2.bias);
  const R = 1 - (2 * Math.PI * 20) / fs2;
  let dcIn = 0, dcOut = 0;
  const nonlinear = (s: number) => {
    const y = soft(s1.gain * (up[1].step(up[0].step(s)) + s1.bias)) - o1;
    dcOut = y - dcIn + R * dcOut + FLUSH - FLUSH;
    dcIn = y;
    return down[1].step(down[0].step(soft(s2.gain * (dcOut + s2.bias)) - o2));
  };
  let prev = 0;
  for (let i = 0; i < x.length; i++) {
    const cur = x[i];
    nonlinear((prev + cur) * 0.5);
    x[i] = nonlinear(cur);
    prev = cur;
  }

  // Тонстек и кабинет 4×12: срез низа, низ с резонансом короба, вырез середины, пик присутствия, крутой спад выше 5 кГц.
  for (const f of [
    new Biquad('highpass', 75, fs, 0.707),
    new Biquad('peaking', 110, fs, 1, 4),
    new Biquad('peaking', 500, fs, 0.8, voice.scoop),
    new Biquad('peaking', 2800, fs, 1.6, 4),
    new Biquad('lowpass', 5200, fs, 0.8),
    new Biquad('lowpass', 6500, fs, 0.6),
  ])
    f.run(x);

  const outRms = gatedRms(x);
  if (outRms > 0) {
    const g = level / outRms;
    for (let i = 0; i < x.length; i++) x[i] *= g;
  }
  return x;
}

/** Моно в стерео-сумму: панорама −1…1 по закону alphaSynth (равная мощность, центр — √½ на канал), gain — множитель. */
export function panInto(out: StereoPcm, mono: Float32Array, pan: number, gain: number): void {
  const p = Math.max(-1, Math.min(1, pan)) / 2;
  const l = Math.sqrt(0.5 - p) * gain, r = Math.sqrt(0.5 + p) * gain;
  const n = Math.min(mono.length, out.left.length);
  for (let i = 0; i < n; i++) {
    out.left[i] += mono[i] * l;
    out.right[i] += mono[i] * r;
  }
}

// Комната: FDN из 8 линий с матрицей Адамара; длины — взаимно простые 23–65 мс (на 44.1 кГц). Посыл без низа и верха:
// бас и бочка остаются сухими, тарелки не шипят.
const FDN_LENGTHS = [1031, 1327, 1523, 1801, 2063, 2333, 2593, 2879];
const RT60 = 1.3;
const DAMP = 0.3;
const PREDELAY_SEC = 0.012;
/** Уровень комнаты: хвост на реальном миксе тише сухого сигнала на ≈ 17 дБ по RMS (при wet = 1 — на 0,5 дБ). */
export const ROOM_WET = 0.14;

/** Реверберация в месте: к сухому стерео добавляется хвост с уровнем wet. */
export function room(pcm: StereoPcm, fs: number, wet = ROOM_WET): void {
  const n = pcm.left.length;
  const lines = FDN_LENGTHS.map((len) => new Float32Array(Math.round((len * fs) / 44100)));
  const gains = lines.map((l) => 10 ** ((-3 * l.length) / (RT60 * fs)));
  const pos = new Int32Array(8);
  const lp = new Float64Array(8);
  const o = new Float64Array(8);
  const pre = new Float32Array(Math.max(1, Math.round(PREDELAY_SEC * fs)));
  let prePos = 0;
  const sendHp = new Biquad('highpass', 250, fs, 0.707), sendLp = new Biquad('lowpass', 7000, fs, 0.707);
  const norm = 1 / Math.sqrt(8);
  for (let i = 0; i < n; i++) {
    const send = sendLp.step(sendHp.step((pcm.left[i] + pcm.right[i]) * 0.5));
    const input = pre[prePos];
    pre[prePos] = send;
    prePos = (prePos + 1) % pre.length;
    for (let k = 0; k < 8; k++) {
      const v = lines[k][pos[k]];
      lp[k] = v + DAMP * (lp[k] - v) + FLUSH - FLUSH; // однополюсный НЧ в петле: верх затухает быстрее
      o[k] = lp[k];
    }
    // Быстрое преобразование Адамара 8×8 (три ступени бабочек).
    for (let h = 1; h < 8; h <<= 1)
      for (let a = 0; a < 8; a += h << 1)
        for (let b = a; b < a + h; b++) {
          const u = o[b], w = o[b + h];
          o[b] = u + w;
          o[b + h] = u - w;
        }
    for (let k = 0; k < 8; k++) {
      lines[k][pos[k]] = input + gains[k] * norm * o[k];
      pos[k] = pos[k] + 1 === lines[k].length ? 0 : pos[k] + 1;
    }
    // Выходы — разные знаковые комбинации линий: декоррелированные левый и правый.
    pcm.left[i] += wet * (lp[0] - lp[1] + lp[2] - lp[3] + lp[4] - lp[5] + lp[6] - lp[7]) * norm;
    pcm.right[i] += wet * (lp[0] + lp[1] - lp[2] - lp[3] + lp[4] + lp[5] - lp[6] - lp[7]) * norm;
  }
}
