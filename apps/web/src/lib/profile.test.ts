import { describe, expect, it } from 'vitest';
import { loadProfile, practiceStreak, saveProfile, type ScoreRecord } from './profile';

const DAY = 86400000;
const rec = (playedAt: number): ScoreRecord => ({
  mapId: 'x',
  title: 'x',
  score: 1,
  accuracy: 1,
  stars: 3,
  difficulty: 'beginner',
  playedAt,
});

// фиксированный «сейчас»: полдень, чтобы не ловить границы суток
const NOW = new Date(2026, 6, 17, 12, 0, 0);

describe('practiceStreak', () => {
  it('без результатов — 0', () => {
    expect(practiceStreak([], NOW)).toBe(0);
  });

  it('занятия сегодня и вчера — серия 2', () => {
    expect(practiceStreak([rec(NOW.getTime()), rec(NOW.getTime() - DAY)], NOW)).toBe(2);
  });

  it('сегодня ещё не пел — вчерашняя серия жива', () => {
    expect(practiceStreak([rec(NOW.getTime() - DAY), rec(NOW.getTime() - 2 * DAY)], NOW)).toBe(2);
  });

  it('пропуск дня рвёт серию', () => {
    expect(practiceStreak([rec(NOW.getTime() - 2 * DAY)], NOW)).toBe(0);
    expect(practiceStreak([rec(NOW.getTime()), rec(NOW.getTime() - 2 * DAY)], NOW)).toBe(1);
  });

  it('несколько занятий в день считаются одним днём', () => {
    expect(practiceStreak([rec(NOW.getTime()), rec(NOW.getTime() - 3600e3)], NOW)).toBe(1);
  });
});

describe('настройка движения', () => {
  it('старый профиль получает неподвижные страницы без потери настроек', () => {
    localStorage.setItem('pupitre.profile.v1', JSON.stringify({difficulty: 'pro', latencyMs: 80, scores: [rec(123)]}));
    expect(loadProfile()).toMatchObject({reduceMotion: true, difficulty: 'pro', latencyMs: 80, scores: [rec(123)]});
    localStorage.clear();
  });

  it('ручной выбор прокрутки сохраняется между запусками', () => {
    saveProfile({...loadProfile(), reduceMotion: false});
    expect(loadProfile().reduceMotion).toBe(false);
    localStorage.clear();
  });
});
