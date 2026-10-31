// Скачивание файла из памяти: ссылка с download на Blob URL (браузер — в загрузки, Electron — окно сохранения).

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  // ссылка нужна, пока браузер забирает файл
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Имя файла без знаков, запрещённых в Windows и Linux. */
export const safeFileName = (name: string): string => name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'pupitre';
