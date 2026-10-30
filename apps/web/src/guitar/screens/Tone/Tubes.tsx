// Лампы за стальной перфорацией: три короткие 12AX7 с двойными анодами и четыре высокие EL34 с бакелитовым цоколем.
// Маска шасси в tone.css пропускает силуэты и собственный накал только через отверстия. Один переход на весь ряд
// меняет цвет и яркость; при открытии экрана состояние сразу соответствует питанию, без стартовой анимации.
import { useId } from 'react';

function Tube({ kind }: { kind: 'pre' | 'power' }) {
  const id = useId().replace(/:/g, '');
  const power = kind === 'power';
  const height = power ? 100 : 49;
  const width = power ? 33 : 22;
  const foot = height - (power ? 15 : 4);
  const top = power ? 23 : 15;
  const bottom = foot - 9;
  const glass = `M1 ${foot}V12Q1 4 ${width / 2} 3Q${width - 1} 4 ${width - 1} 12V${foot}Z`;
  const plates = power ? [{ x: 7, w: 19 }] : [{ x: 4, w: 6 }, { x: 12, w: 6 }];
  return (
    <svg className={`tube tube--${kind}`} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {/* Холодная колба почти сливается с глубиной; серебряных бликов здесь нет. */}
      <path d={glass} fill="#101112" stroke="#1b1b1b" strokeWidth="0.6" />
      <rect x="1" y={foot} width={width - 2} height={height - foot} rx="2" fill={power ? '#100d0b' : '#141414'} />
      <g className="tube__glow">
        <defs>
          <radialGradient id={`${id}-halo`}>
            <stop offset="0" stopColor="currentColor" stopOpacity="0.55" />
            <stop offset="0.3" stopColor="currentColor" stopOpacity="0.22" />
            <stop offset="0.65" stopColor="currentColor" stopOpacity="0.06" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* Широкий ореол у каждой лампы плавно затухает ещё до соседней; металл его полностью перекрывает. */}
        <ellipse cx={width / 2} cy={foot - 12} rx={power ? 48 : 32} ry={power ? 65 : 37} fill={`url(#${id}-halo)`} />
        <path d={glass} fill="none" stroke="currentColor" strokeOpacity="0.13" strokeWidth="0.7" />
        {plates.map(({ x, w }) => (
          <g key={x} fill="currentColor">
            <rect x={x + w / 2 - 0.6} y={top - 3} width="1.2" height={bottom - top + 6} rx="0.6" />
            {[top - 2, bottom + 2].map((y) => (
              <ellipse key={y} cx={x + w / 2} cy={y} rx={w * 0.65} ry="4" fill={`url(#${id}-halo)`} />
            ))}
          </g>
        ))}
      </g>
      {/* Аноды остаются тёмными: виден накал над ними и под ними, а не раскалённая вся колба. */}
      {plates.map(({ x, w }) => (
        <rect key={x} x={x} y={top} width={w} height={bottom - top} rx="1" fill="#0c0d0d" />
      ))}
      {!power && <path d="M10 3V1H12V3" fill="#151515" />}
    </svg>
  );
}

const ROW: Array<'pre' | 'power'> = ['pre', 'pre', 'pre', 'power', 'power', 'power', 'power'];

/** Утопленная решётка с неперфорированным кантом и четырьмя креплениями. */
export function Tubes({ hot }: { hot: boolean }) {
  return (
    <div className="amp-tubes" data-hot={hot || undefined} aria-hidden="true">
      <div className="amp-tubes__grille">
        <div className="amp-tubes__chassis">
          {ROW.map((kind, i) => <Tube key={i} kind={kind} />)}
        </div>
      </div>
      {['tl', 'tr', 'bl', 'br'].map((at) => <i key={at} className={`amp-tubes__fastener amp-tubes__fastener--${at}`} />)}
    </div>
  );
}
