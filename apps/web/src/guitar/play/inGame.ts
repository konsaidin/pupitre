// Экран открыт панелью поверх игры (тон, тюнер): переход на другой экран оборвал бы песню — ссылки на «Вход и звук» и
// подобные экраны в таком режиме не показываются (подсказка остаётся текстом).
import { createContext, useContext } from 'react';

export const InGameSheet = createContext(false);
export const useInGameSheet = (): boolean => useContext(InGameSheet);
