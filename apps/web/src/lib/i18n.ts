// Локализация. Ключ — английская строка (она же текст для en),
// словарь ниже даёт русский перевод. Язык выбирается при первом старте
// и хранится в localStorage; смена языка в настройках перезагружает страницу,
// поэтому t() не обязан быть реактивным.

export type Lang = 'en' | 'ru';

const KEY = 'slopsician.lang.v1';

export function getSavedLang(): Lang | null {
  const v = localStorage.getItem(KEY);
  return v === 'en' || v === 'ru' ? v : null;
}

export function setLang(lang: Lang): void {
  localStorage.setItem(KEY, lang);
  current = lang;
}

let current: Lang = getSavedLang() ?? 'en';

export function currentLang(): Lang {
  return current;
}

/** Перевод: en — как есть, ru — из словаря (нет в словаре — оставляем en). */
export function t(text: string, params?: Record<string, string | number>): string {
  let out = current === 'ru' ? (RU[text] ?? text) : text;
  if (params) {
    for (const [k, v] of Object.entries(params)) out = out.replaceAll(`{${k}}`, String(v));
  }
  return out;
}

export const RU: Record<string, string> = {
  // — общее —
  'Back': 'Назад',
  'Save': 'Сохранить',
  'Reset': 'Сбросить',
  'Close': 'Закрыть',
  'To menu': 'В меню',
  'Try again': 'Ещё раз',

  // — главный экран —
  'Sing the notes — the app hears your voice and shows where to hit':
    'Пой в ноты — приложение слышит голос и показывает, куда попадать',
  'Measure your vocal range': 'Измерить диапазон голоса',
  'takes a minute — everything adapts to you': 'займёт минуту — всё подстроится под тебя',
  '{cls} · tap to remeasure': '{cls} · нажми, чтобы перемерить',
  'Warm-ups & exercises': 'Распевки и упражнения',
  'warm-up, scales, intervals — built for your range': 'разогрев, гаммы, интервалы — под твой диапазон',
  'Songs': 'Песни',
  'upload a track and sing it note by note': 'загрузи трек — споёшь его по нотам',
  'Settings': 'Настройки',
  'microphone, latency calibration, difficulty': 'микрофон, калибровка задержки, сложность',
  'Recent results': 'Последние результаты',

  // — классификация голоса —
  'bass': 'бас',
  'baritone': 'баритон',
  'tenor': 'тенор',
  'alto': 'альт',
  'mezzo-soprano': 'меццо-сопрано',
  'soprano': 'сопрано',

  // — сложность —
  'Beginner': 'Новичок',
  'Medium': 'Средний',
  'Pro': 'Про',

  // — упражнения —
  'First, let’s measure your range — exercises are generated from it.':
    'Сначала измерим твой диапазон — упражнения генерируются под него.',
  'Measure my range': 'Определить диапазон',
  'All exercises are built for your range ({low}–{high}).':
    'Все упражнения построены под твой диапазон ({low}–{high}).',
  'Warm-ups': 'Распевки',
  'Scales': 'Гаммы',
  'Ear training': 'Слух',
  'Long tones': 'Длинные ноты',
  'Hold a note for 4 beats, steady and clean. The base of breath support.':
    'Удерживай ноту 4 счёта ровно, без съезда. База контроля дыхания и опоры.',
  'Siren': 'Сирена',
  'Smooth glissando from the bottom of your range to the top and back. Warms up the cords.':
    'Плавное глиссандо от низа диапазона до верха и обратно. Разогрев связок.',
  'Five-note pattern': 'Пятиступенная распевка',
  'Do-re-mi-fa-sol-fa-mi-re-do, each repeat a semitone higher.':
    'До-ре-ми-фа-соль-фа-ми-ре-до, каждый повтор на полтона выше.',
  'Major scale': 'Мажорная гамма',
  'Full scale up and down. Accuracy on every degree.':
    'Полная гамма вверх и вниз. Точность каждой ступени.',
  'Minor scale': 'Минорная гамма',
  'Natural minor up and down.': 'Натуральный минор вверх и вниз.',
  'Arpeggio': 'Арпеджио',
  'Triad with the octave: 1-3-5-8-5-3-1. Clean jumps, no sliding.':
    'Трезвучие с октавой: 1-3-5-8-5-3-1. Скачки без подъезда.',
  'Intervals': 'Интервалы',
  'Hear the reference note, then sing the interval: thirds, fourths, fifths, octaves.':
    'Слышишь опорную ноту — спой интервал от неё: терции, кварты, квинты, октавы.',
  'root': 'опора',
  'm3': 'м3',
  'M3': 'б3',
  'P4': 'ч4',
  'P5': 'ч5',
  'octave': 'октава',
  'Tempo': 'Темп',
  'Key (root note)': 'Тональность (нижняя нота)',
  'Repeats': 'Повторы',
  'Start': 'Начать',

  // — библиотека —
  'Drop mp3/wav/flac/m4a here or click to pick a file':
    'Перетащи сюда mp3/wav/flac/m4a или нажми, чтобы выбрать файл',
  'The track is processed on the server: vocals get separated, the melody becomes notes':
    'Трек обработается на сервере: вокал отделится, мелодия станет нотами',
  'Check that the backend is running:': 'Проверь, что бэкенд запущен:',
  'Nothing here yet — upload your first track.': 'Пока пусто — загрузи первый трек.',
  'Queued…': 'В очереди…',
  'Decoding…': 'Декодирую…',
  'Separating vocals…': 'Отделяю вокал…',
  'Extracting melody…': 'Снимаю мелодию…',
  'Done': 'Готово',
  'Error': 'Ошибка',
  'Sing': 'Петь',
  'Retry': 'Повторить',
  'Delete “{title}”?': 'Удалить «{title}»?',
  '{n} notes': '{n} нот',
  'vocals not separated (full mix plays)': 'вокал не отделён (играет полный микс)',
  'Map is not ready yet': 'Карта нот ещё не готова',
  'Could not open the song': 'Не удалось открыть песню',
  'Upload failed': 'Ошибка загрузки',
  'Backend unavailable': 'Бэкенд недоступен',

  // — игра —
  'Difficulty': 'Сложность',
  '±{cents} cents tolerance{octave}': 'допуск ±{cents} центов{octave}',
  ', octave matters': ', октава важна',
  ', octave ignored': ', октава не важна',
  'Playback': 'Исполнение',
  'No vocals': 'Без вокала',
  'With vocals': 'С вокалом',
  'Vocals only': 'Только вокал',
  'Vocals': 'Вокал',
  'instrumental — you sing the vocals': 'инструментал — вокал поёшь ты',
  'the full original — sing along (headphones recommended)':
    'оригинал целиком — пой вместе с исполнителем (лучше в наушниках)',
  'extracted vocals only — as a guide (headphones recommended)':
    'только извлечённый вокал — как ориентир (лучше в наушниках)',
  'vocals not separated for this track': 'вокал не отделён для этого трека',
  'Target': 'Цель',
  'Notes': 'Ноты',
  'Line 🧪': 'Линия 🧪',
  'experimental: sing along the contour line, points for staying close':
    'экспериментально: пой по контуру-дорожке, очки — за близость к линии',
  'classic: hit the note bars with your voice': 'классика: попадай голосом в плашки-ноты',
  'Play guide notes': 'Играть подсказки (опорные ноты)',
  'Metronome': 'Метроном',
  'Octave: {mode}. Use the ± buttons up top to change.':
    'Октава: {mode}. Изменить можно кнопками ± сверху.',
  'as in the original': 'как в оригинале',
  'shift {shift} — melody moved into your range': 'сдвиг {shift} — мелодия перенесена в твой диапазон',
  '🎧 Put on headphones — otherwise the mic hears the backing track and your line jumps around.':
    '🎧 Надень наушники — иначе микрофон услышит аккомпанемент и линия голоса будет прыгать.',
  'Let’s go': 'Поехали',
  '✎ Edit notes': '✎ Редактировать ноты',
  '⚙ Extraction': '⚙ Извлечение',
  'Getting mic and audio ready…': 'Готовим микрофон и аудио…',
  'Pause': 'Пауза',
  'Resume': 'Продолжить',
  'Restart': 'Заново',
  'Exit': 'Выйти',
  '← Exit': '← Выйти',
  '⏸ Pause': '⏸ Пауза',
  'original': 'оригинал',
  '{n} oct.': '{n} окт.',
  // — лента вокала (курс 2) —
  'Ribbon': 'Лента',
  'Roll': 'Ролл',
  'View: vocal ribbon or piano roll': 'Вид: лента вокала или пиано-ролл',
  'vibrato': 'вибрато',
  'Hz': 'Гц',
  'rasp': 'расщепление',
  'mic path ~{ms} ms': 'тракт микрофона ~{ms} мс',
  'Melody shifted into your octave': 'Мелодия сдвинута в твою октаву',
  'Define your vocal range first.': 'Сначала определи диапазон голоса.',
  'Nothing to play.': 'Нет данных для игры.',
  'To the wizard': 'К визарду',
  'Could not load the backing track ({status})': 'Не удалось загрузить аккомпанемент ({status})',
  'Failed to start': 'Ошибка запуска',

  // — результаты —
  'No result.': 'Нет результата.',
  'points': 'очки',
  'accuracy': 'точность',
  'max combo': 'макс. комбо',
  'To the list': 'К списку',

  // — визард диапазона —
  'Let’s find your range': 'Определим твой диапазон',
  'The app adapts exercises and songs to your voice: it shows only your band of notes and moves melodies into your octave. Measure your range once — it takes a minute.':
    'Приложение подстраивает упражнения и песни под твой голос: показывает только твою полосу нот и переносит мелодии в твою октаву. Для этого нужно один раз измерить диапазон — займёт минуту.',
  '🎧 Put on headphones if music is playing nearby': '🎧 Надень наушники, если рядом играет музыка',
  '🤫 Find a quiet spot': '🤫 Найди тихое место',
  '🎤 Allow microphone access': '🎤 Разреши доступ к микрофону',
  'Your range': 'Твой диапазон',
  '{n} semitones': '{n} полутонов',
  'Exercises and songs are now tuned to this zone. You can remeasure anytime.':
    'Все упражнения и песни теперь будут подстроены под эту зону. Перемерить можно в любой момент.',
  'Remeasure': 'Перемерить',
  'Step 1 · A comfortable note': 'Шаг 1 · Удобная нота',
  'Sing any note that feels comfortable (“aaah”) and hold it until the ring closes.':
    'Спой любую ноту, на которой тебе комфортно («а-а-а»), и удержи её, пока кольцо не замкнётся.',
  'Step 2 · Down to the limit': 'Шаг 2 · Вниз до предела',
  'Walk your voice down in steps. Pause on each low note — the yellow line will move. Creaks don’t count :)':
    'Веди голос ступеньками вниз. На каждой нижней ноте задержись — жёлтая линия сдвинется. Хрип и скрип не считаются :)',
  'Step 3 · Up to the limit': 'Шаг 3 · Вверх до предела',
  'Now up. Hold the top notes — the green line will move. No shouting: clean sound only.':
    'Теперь вверх. Задерживайся на верхних нотах — зелёная линия сдвинется. Без крика: только чистый звук.',
  'Comfort note: {note} ✓': 'Удобная нота: {note} ✓',
  'Low bound: {note}': 'Нижняя граница: {note}',
  'High bound: {note}': 'Верхняя граница: {note}',
  'Next': 'Дальше',
  'Ready': 'Готово',
  'Microphone access failed': 'Не удалось получить доступ к микрофону',

  // — настройки —
  'Microphone': 'Микрофон',
  'Default': 'По умолчанию',
  'Microphone {id}': 'Микрофон {id}',
  'If the names are empty — grant mic access (the “Test” button below) and come back.':
    'Если названия пустые — дай доступ к микрофону (кнопка «Проверить» ниже) и вернись сюда.',
  'Noise suppression': 'Шумоподавление',
  'mutes background (fans, street), but can cut quiet vocals':
    'глушит фон (вентилятор, улицу), но может резать тихий вокал',
  'Echo cancellation': 'Эхоподавление',
  'cuts speaker/headphone sound leaking into the mic':
    'режет звук из колонок/наушников, попадающий в микрофон',
  'Auto gain': 'Автоусиление',
  'the system rides the volume — usually fights the noise gate':
    'система сама крутит громкость — обычно мешает нойзгейту',
  'Noise gate — volume threshold': 'Нойзгейт — порог громкости',
  'anything below counts as silence; raise it if the dot twitches from noise':
    'всё тише порога считается тишиной; подними, если кружок дёргается от шума',
  'Pitch clarity threshold': 'Порог чистоты тона',
  'higher — fewer false notes from noise, but whispers/rasp won’t register':
    'выше — меньше ложных нот от шума, но шёпот/хрип не ловится',
  'press “Test” to see the live level': 'нажми «Проверить», чтобы увидеть уровень вживую',
  '■ Stop': '■ Остановить',
  '🎤 Test microphone': '🎤 Проверить микрофон',
  'Could not open the microphone': 'Не удалось открыть микрофон',
  'How to tune: stay silent — the bar should sit left of the threshold mark; say “aaah” — the bar turns green and moves right. If headphone noise “sings” on its own, raise the gate or enable noise suppression.':
    'Как настроить: помолчи — полоска должна быть левее метки порога; скажи «а-а-а» — полоска зеленеет и уходит правее. Если шум наушников «поёт» сам — подними гейт или включи шумоподавление.',
  'voice: {note} · clarity {pct}%': 'голос: {note} · чистота {pct}%',
  'sound detected, but it’s not a clear note (below clarity threshold)':
    'звук есть, но не похож на ноту (чистота ниже порога)',
  'silence (below the gate)': 'тишина (ниже гейта)',
  'Latency calibration': 'Калибровка задержки',
  'Current correction: {ms} ms. You’ll hear {n} clicks — sing a short “ta” exactly on each one. This compensates for audio latency when scoring.':
    'Текущая поправка: {ms} мс. Прозвучит {n} кликов — пой короткое «та» точно на каждый. Это компенсирует задержку наушников и звукового тракта при подсчёте очков.',
  'Calibrate': 'Калибровать',
  'Listening…': 'Слушаю…',
  'Listen to the clicks and sing a short “ta” on each…':
    'Слушай клики и пой короткое «та» на каждый…',
  'Too few hits ({n}/{total}). Sing clearer and louder, try again.':
    'Мало попаданий ({n}/{total}). Пой чётче и громче, попробуй ещё раз.',
  'Done: {ms} ms latency (from {n} hits). Saved.':
    'Готово: задержка {ms} мс (по {n} попаданиям). Сохранено.',
  'Calibration failed': 'Ошибка калибровки',
  'Default difficulty': 'Сложность по умолчанию',
  'Voice': 'Голос',
  'Remeasure range': 'Перемерить диапазон',
  'Language': 'Язык',
  'Song processing server': 'Сервер обработки песен',
  'The backend that separates vocals and extracts the melody. Warm-ups and exercises work without it.':
    'Бэкенд, который отделяет вокал и снимает мелодию. Распевки и упражнения работают без него.',
  'Data': 'Данные',
  'Reset profile, range and all history?': 'Сбросить профиль, диапазон и всю историю результатов?',
  'Reset everything': 'Сбросить всё',

  // — редактор нот —
  'Note editor': 'Редактор нот',
  'drag a note — move; drag its right edge — length; double-click — add; Delete — remove. Timeline on top seeks.':
    'тяни ноту — перенос; за правый край — длительность; двойной клик — добавить; Delete — удалить. Линейка сверху — перемотка.',
  'Vocals unavailable — edit along the contour.': 'Вокал недоступен — правь по контуру.',
  'Delete note': 'Удалить ноту',
  'Saving…': 'Сохраняю…',
  'Save failed': 'Не удалось сохранить',

  // — панель извлечения —
  'Extraction settings': 'Настройки извлечения',
  'The melody will be re-extracted from the saved vocals — fast, no re-separation. Current notes (including manual edits) will be replaced.':
    'Мелодия переснимется с сохранённого вокала — быстро, без повторного разделения. Текущие ноты в карте (включая ручные правки) будут заменены.',
  'Search range, low': 'Нижняя граница поиска',
  'Search range, high': 'Верхняя граница поиска',
  'Quiet cutoff': 'Отсечка тихого',
  'lower — catches whispers and tails, but noise too': 'ниже — ловит шёпот и хвосты, но и шум',
  'Min note length': 'Мин. длина ноты',
  'Merge across gaps up to': 'Склейка через паузу до',
  'Note splitting': 'Дробление нот',
  'smaller — more short notes': 'меньше — больше коротких нот',
  'Smoothing': 'Сглаживание',
  '{n} frames': '{n} кадров',
  '{n} ms': '{n} мс',
  '{n} st': '{n} пт',
  'Extracting the melody… {pct} — usually under a minute.':
    'Снимаю мелодию… {pct} — обычно до минуты.',
  'Re-extract melody': 'Переснять мелодию',
  'Re-extraction failed': 'Не удалось переснять',

  // — плашка развёртывания бэкенда —
  'Starting the song processing server…': 'Запускаю сервер обработки песен…',
  'Downloading the environment manager…': 'Скачиваю менеджер окружения…',
  'Installing Python…': 'Устанавливаю Python…',
  'Installing dependencies (~2.5 GB, one time)…': 'Устанавливаю зависимости (около 2.5 ГБ, один раз)…',
  'Downloading ffmpeg…': 'Скачиваю ffmpeg…',
  'Could not set up the processing server': 'Не удалось развернуть сервер обработки',
  'Warm-ups and exercises already work': 'Распевки и упражнения уже работают',
};
