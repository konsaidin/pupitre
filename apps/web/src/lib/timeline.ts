/** Координаты временного окна, общие для пиано-ролла и ленты. */
export function timelineView(
  songMs: number,
  leftPx: number,
  rightPx: number,
  lookaheadMs: number,
  reduceMotion: boolean,
): { leftMs: number; rightMs: number; pxPerMs: number; nowX: number } {
  const width = Math.max(1, rightPx - leftPx);
  const lookahead = Math.max(1, lookaheadMs);
  const spanMs = reduceMotion ? lookahead * 2 : lookahead / 0.7;
  // Во время отсчёта остаёмся на первой странице. Смена страницы — сразу,
  // без панорамирования или интерполяции положения нот.
  const leftMs = reduceMotion
    ? Math.floor(Math.max(0, songMs) / spanMs) * spanMs
    : songMs - spanMs * 0.3;
  const pxPerMs = width / spanMs;
  const nowX = leftPx + Math.max(0, songMs - leftMs) * pxPerMs;
  return { leftMs, rightMs: leftMs + spanMs, pxPerMs, nowX };
}
