import { describe, expect, it } from 'vitest';
import { timelineView } from './timeline';

function view(ms: number, stationary = true) {
  return timelineView(ms, 56, 956, 4000, stationary);
}

function noteX(window: ReturnType<typeof view>, noteMs: number) {
  return 56 + (noteMs - window.leftMs) * window.pxPerMs;
}

describe('неподвижные страницы', () => {
  it('ноты и история голоса остаются на месте, пока движется маркер', () => {
    const first = view(1000);
    const later = view(3000);
    expect(noteX(first, 4000)).toBe(noteX(later, 4000));
    expect(noteX(first, 500)).toBe(noteX(later, 500));
    expect(later.nowX).toBeGreaterThan(first.nowX);
  });

  it('следующая страница сменяется сразу и остаётся неподвижной', () => {
    const end = view(7999);
    const next = view(8000);
    const later = view(9500);
    expect(end.rightMs).toBe(next.leftMs);
    expect(next.nowX).toBe(56);
    expect(next.leftMs).toBe(later.leftMs);
    expect(noteX(next, 10000)).toBe(noteX(later, 10000));
  });

  it('отсчёт не листает пустые страницы назад', () => {
    expect(view(-3000).leftMs).toBe(0);
    expect(view(-3000).nowX).toBe(56);
    expect(view(-1000).leftMs).toBe(0);
  });

  it('при явном включении прокрутки сохраняется движущийся поток', () => {
    const first = view(1000, false);
    const later = view(3000, false);
    expect(later.nowX).toBeCloseTo(first.nowX);
    expect(noteX(later, 4000)).toBeLessThan(noteX(first, 4000));
  });
});
