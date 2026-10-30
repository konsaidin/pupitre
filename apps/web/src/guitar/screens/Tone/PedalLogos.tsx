// Логотип овердрайва AutisticScreamer: две строки журнальных вырезок на зелёной эмали, рваная бумага, скотч и
// английская булавка — маленький панк-зин прямо на педали. Крупные контрастные буквы читаются при ширине 130 px;
// фон прозрачный, свет сверху-слева, тени бумаги уходят вниз-вправо. Идентификаторы независимы для каждого экземпляра.
import { useId } from 'react';

const SCRAPS = [
  'M1 2L9 0L15 2L25 1L27 12L26 25L28 41L19 43L12 41L2 44L0 31L2 20Z',
  'M0 1L8 2L18 0L27 3L26 15L28 28L26 43L17 42L8 44L1 41L2 29L0 17Z',
  'M2 0L12 2L20 1L28 3L26 13L27 24L25 33L27 43L15 42L6 44L0 42L1 30L0 9Z',
];
const FONTS = ['sans-serif', 'serif', 'monospace', 'sans-serif', 'serif', 'sans-serif', 'monospace', 'serif'];
const TURNS = [-5, 4, -3, 5, -4, 2, -5, 4];
const LIFTS = [1, -2, 2, 0, -1, 2, 0, -2];

export function AutisticScreamerLogo({ className }: { className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg className={className} viewBox="0 0 260 144" role="img" aria-labelledby={`${id}-title`}>
      <title id={`${id}-title`}>AutisticScreamer</title>
      <defs>
        <filter id={`${id}-paper-shadow`} x="-25%" y="-20%" width="160%" height="155%" colorInterpolationFilters="sRGB">
          <feDropShadow dx="1.8" dy="2.6" stdDeviation="0.7" floodColor="#000" floodOpacity="0.55" />
        </filter>
      </defs>
      <g aria-hidden="true">
        {/* Каждая буква на собственном клочке; чёрные вклейки и красная «S» ломают аккуратность набора. */}
        {['AUTISTIC', 'SCREAMER'].map((word, row) => (
          <g key={word}>
            {Array.from(word).map((letter, i) => {
              const dark = (row === 0 && (i === 1 || i === 5)) || (row === 1 && i === 6);
              const red = row === 1 && i === 0;
              const paper = red ? '#c92924' : dark ? '#111' : i % 3 === 0 ? '#fff' : '#f5e8c9';
              const ink = dark || red ? '#fff' : '#111';
              return (
                <g key={i} transform={`translate(${10 + i * 30}, ${20 + row * 54 + LIFTS[(i + row) % 8]})`}
                  filter={`url(#${id}-paper-shadow)`}>
                  <g transform={`rotate(${TURNS[(i + row * 3) % 8]} 14 22)`}>
                    <path d={SCRAPS[(i + row) % SCRAPS.length]} fill={paper} />
                    <path d="M3 4L9 3M2 9L2 17" fill="none" stroke="#fff" strokeOpacity="0.4" strokeWidth="0.8" />
                    <text x="14" y="34" textAnchor="middle" fill={ink} fontFamily={FONTS[(i + row) % 8]}
                      fontSize={letter === 'M' ? 30 : 35} fontWeight={i % 3 === 0 ? 900 : 700}
                      fontStyle={i === 3 || i === 7 ? 'italic' : 'normal'}>{letter}</text>
                    {/* Следы газетной печати остаются на полях и не съедают силуэт буквы. */}
                    <path d={i % 2 ? 'M5 38H12M15 39H23' : 'M5 6H13M18 5H23'}
                      stroke={ink} strokeOpacity="0.3" strokeWidth="0.8" />
                  </g>
                </g>
              );
            })}
          </g>
        ))}
        {/* Полупрозрачный скотч прихватывает верхние углы, край оторван зубцами. */}
        <g fill="#f5e8c9" fillOpacity="0.65" stroke="#fff" strokeOpacity="0.25" strokeWidth="0.7">
          <path d="M5 19L9 15L10 17L13 13L41 9L40 12L44 14L41 17L43 20L10 27L11 24L6 25Z" />
          <path d="M222 9L251 18L249 21L252 24L248 25L248 29L218 19L221 17L219 14L223 13Z" />
        </g>
        {/* Красная черта баллончиком: два подтёка и брызги; булавка держит весь этот самиздат. */}
        <path d="M19 125L94 123L90 127L62 128V135Q60 139 58 135V128L37 129V132Q35 135 34 132V129L17 130Z" fill="#c92924" />
        <g fill="#c92924">
          <circle cx="12" cy="130" r="1.5" /><circle cx="98" cy="127" r="1" /><circle cx="26" cy="136" r="1" />
        </g>
        <g transform="rotate(-8 202 130)" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M178 126H229L233 132L228 135H178C169 135 169 126 178 126ZM180 129L226 132M228 126L225 132"
            stroke="#000" strokeWidth="4" transform="translate(1 2)" opacity="0.5" />
          <path d="M178 126H229L233 132L228 135H178C169 135 169 126 178 126ZM180 129L226 132M228 126L225 132"
            stroke="#111" strokeWidth="3.5" />
          <path d="M178 126H229L233 132L228 135H178C169 135 169 126 178 126ZM180 129L226 132M228 126L225 132"
            stroke="#fff" strokeWidth="1.4" />
        </g>
      </g>
    </svg>
  );
}

// «Кіборг»: рубленые стальные буквы, швы трафарета и лёгкий износ синей печати на жёлтой эмали.
export function KiborgLogo({ className }: { className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg className={className} viewBox="0 0 260 90" role="img" aria-labelledby={`${id}-title`}>
      <title id={`${id}-title`}>Кіборг</title>
      <defs>
        <mask id={`${id}-ink`} x="0" y="0" width="260" height="90" maskUnits="userSpaceOnUse">
          <rect width="260" height="90" fill="#fff" />
          <g fill="none" stroke="#000">
            <path d="M12 46H28M83 49H97M150 30V45M195 59V74" strokeWidth="2" />
            <path d="M32 24L37 23M101 17H108M139 65L143 64M231 37H236" strokeWidth="1.2" />
          </g>
          <path d="M18 61L21 60L20 64H18ZM113 56H116L114 58ZM205 39H208V41Z" fill="#000" />
        </mask>
      </defs>
      <g aria-hidden="true" fill="#13306b">
        <g mask={`url(#${id}-ink)`} fillRule="evenodd">
          {/* К, украинская і и строчные борг: силуэты нарисованы без зависимости от шрифта. */}
          <path d="M13 18H27V39H31L42 18H57L42 44L58 72H42L31 51H27V72H13Z" />
          <path d="M61 18H74V29H61ZM61 35H74V72H61Z" />
          <path d="M83 25L93 15L125 11V24L99 27L96 33H117L127 43V62L117 72H93L83 62ZM97 45V59L100 62H110L113 59V47L110 45Z" />
          <path d="M144 32H163L173 42V62L163 72H144L134 62V42ZM148 44V60H159V44Z" />
          <path d="M181 32H208L218 42V61L208 71H195V83H181ZM195 44V59H202L205 56V47L202 44Z" />
          <path d="M226 32H251V44H240V72H226Z" />
        </g>
        <g fill="none" stroke="#13306b" strokeWidth="1.8">
          <path d="M18 81H107L114 77H160" />
          <circle cx="163" cy="77" r="2.5" />
          <circle cx="236" cy="20" r="3" />
          <path d="M234 20H238" strokeWidth="1" />
        </g>
      </g>
    </svg>
  );
}

// Herachilo Booster: плотный винтажный курсив и большая общая «B», чёрная печать без фона и шильдика.
export function HerachiloLogo({ className }: { className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg className={className} viewBox="0 0 260 110" role="img" aria-labelledby={`${id}-title`}>
      <title id={`${id}-title`}>chtobi Herachilo Booster</title>
      <g aria-hidden="true" fill="#000" fontFamily="sans-serif" fontWeight="900" fontStyle="italic">
        <text x="26" y="19" fontSize="19" letterSpacing="-0.8" textLength="55" lengthAdjust="spacingAndGlyphs">chtobi</text>
        <text x="78" y="54" fontSize="43" letterSpacing="-2" textLength="169" lengthAdjust="spacingAndGlyphs">Herachilo</text>
        {/* Наклонная B объединяет строки; широкие просветы сохраняются в маленьком размере. */}
        <path fillRule="evenodd"
          d="M28 28H57C76 28 84 36 81 50C79 59 73 64 65 66C76 69 80 76 77 85C74 96 64 101 46 101H12ZM41 42L37 59H49C58 59 63 56 64 50C65 45 62 42 55 42ZM34 72L30 87H46C54 87 58 85 60 80C61 75 57 72 51 72Z" />
        <text x="78" y="101" fontSize="55" letterSpacing="-2.8" textLength="162" lengthAdjust="spacingAndGlyphs">ooster</text>
      </g>
    </svg>
  );
}
