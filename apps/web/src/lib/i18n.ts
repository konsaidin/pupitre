// Локализация. Ключ — английская строка (она же текст для en),
// словарь ниже даёт русский перевод. Язык выбирается при первом старте
// и хранится в localStorage; смена языка в настройках перезагружает страницу,
// поэтому t() не обязан быть реактивным.

export type Lang = 'en' | 'ru';

const KEY = 'pupitre.lang.v1';

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
  // — voice studio —
  'New song': 'Новая песня',
  'Drop an audio file here': 'Перетащи сюда аудиофайл',
  'Piano': 'Пианино',
  'Press a key': 'Нажми клавишу',
  'Range measurement': 'Замер диапазона',
  'Three steps, about a minute.': 'Три шага, около минуты.',
  'Voice type unknown': 'Тип голоса пока неизвестен',
  'Touch the keys and find a comfortable sound. No microphone needed.': 'Нажимай на клавиши и найди комфортное звучание. Микрофон не нужен.',
  'Lower octave': 'Октавой ниже',
  'Higher octave': 'Октавой выше',
  'Playable piano keyboard': 'Клавиатура со звуком',
  'Play {note}': 'Послушать {note}',
  'Tap a key. Your next note is right here.': 'Нажми на клавишу. Твоя следующая нота — здесь.',
  'Stop preview': 'Остановить прослушивание',
  'Listen to the pattern': 'Послушать мелодию',
  'Listening': 'Звучит мелодия',
  'Melody preview': 'Послушай перед началом',
  'Could not play the preview. Try again.': 'Не удалось включить звук. Попробуй ещё раз.',

  'Turn your phone sideways': 'Поверни телефон',
  'Your studio is made for landscape. Rotate your phone to continue.': 'Студия работает в горизонтальном формате. Поверни телефон на бок, чтобы продолжить.',
  'Guide notes': 'Ноты-подсказки',
  'Stop': 'Стоп',
  'Test microphone': 'Проверить микрофон',
  'Overview': 'Обзор',
  // — оболочка «Рампы» (общая для голоса и гитары) —
  Guitar: 'Гитара',
  Sections: 'Разделы',
  'The song server needs its token.': 'Серверу песен нужен токен.',
  'Enter the server token in Settings → Song processing server, then try again.': 'Введи токен в «Настройки» → «Сервер обработки песен» и попробуй снова.',
  'Open settings': 'Открыть настройки',
  Cancel: 'Отмена',
  'Edit notes': 'Редактировать ноты',
  Extraction: 'Извлечение',
  'Days in a row': 'Дней подряд',
  'Pupitre mode': 'Режим Пюпитра',
  Profile: 'Профиль',
  'Player statistics will appear later': 'Статистика игрока появится позже',
  Notifications: 'Уведомления',
  'Practice': 'Практика',
  'Your space': 'Твоя студия',
  'Main navigation': 'Основная навигация',
  'A little practice.': 'Немного практики.',
  'A voice that feels like you.': 'Больше твоего голоса.',
  'in a row': 'подряд',
  'Discover your range': 'Узнать свой диапазон',
  'Voice mode': 'Вокальный режим',
  'Continue practicing': 'Продолжить занятия',
  'Measure your range': 'Измерь диапазон',
  'Start with a warm-up, then exercises or a song.': 'Начни с распевки, потом — упражнения или песня.',
  'Exercises and songs are moved into your range.': 'Упражнения и песни переносятся в твой диапазон.',
  'Takes about a minute.': 'Займёт около минуты.',
  'Long tones and sirens before singing.': 'Длинные ноты и сирены перед пением.',
  'Scales, intervals and vibrato.': 'Гаммы, интервалы и вибрато.',
  'Upload a song: the app extracts the vocal melody from it.': 'Загрузи песню — приложение вытащит из неё мелодию голоса.',
  'This week': 'Эта неделя',
  'Sound setup': 'Настройка звука',
  'Melody': 'Мелодия',
  'The line is the melody; your voice is drawn on top of it.': 'Линия — это мелодия, поверх неё рисуется твой голос.',
  'Sing in headphones': 'Пой в наушниках',
  'Scales up and down.': 'Гаммы вверх и вниз.',
  'Hear a note and sing it back.': 'Услышь ноту и повтори её голосом.',
  'Vibrato.': 'Вибрато.',
  'Exercises are moved into your range — measure it first.': 'Упражнения переносятся в твой диапазон — сначала измерь его.',
  'Range not measured yet': 'Диапазон ещё не измерен',
  'Start a warm-up': 'Начать распевку',
  'What shall we sing?': 'Что сегодня споём?',
  '{n} songs ready': 'Готово песен: {n}',
  'Practiced': 'Занятие состоялось',
  'No practice yet': 'Пока без занятий',
  'sessions completed': 'занятий пройдено',
  'average accuracy': 'средняя точность',
  'Your first session starts a story.': 'Всё начинается с первой ноты.',
  'Sing a little. Your progress will appear here.': 'Спой что-нибудь — здесь появятся твои результаты.',
  'ms': 'мс',
  'This is your vocal range': 'Это твой вокальный диапазон',
  'Explore my range': 'Посмотреть диапазон',
  'A little better, every day': 'Увереннее с каждым днём',
  'Exercise categories': 'Категории упражнений',
  'Before the first note': 'Прежде чем начать',
  'An instrument like no other.': 'Уникальный инструмент — ты.',
  'Best result': 'Лучший результат',
  'Customize': 'Настроить',
  'Lower the key to fit this pattern into your range.': 'Понизь тональность, чтобы ноты поместились в твой диапазон.',
  'Your soundtrack.': 'Твой саундтрек.',
  'The songs you make your own': 'Музыка в твоём исполнении',
  'The music you love. The voice only you have. Put them together.': 'Любимые песни. Твой неповторимый голос. Самое время их соединить.',
  'ready': 'готово',
  'We’ll find the vocal melody and turn it into notes you can sing along with.':
    'Найдём вокальную мелодию и превратим её в ноты, по которым удобно петь.',
  'Uploading…': 'Загружаем…',
  'Choose a file': 'Выбрать файл',
  'The library needs a moment.': 'Не удалось открыть библиотеку.',
  'Check your connection or the song server in settings, then try again.':
    'Проверь подключение или сервер песен в настройках и попробуй ещё раз.',
  'Details': 'Подробности',
  'All tracks': 'Все треки',
  'Processing': 'В обработке',
  'Find a song…': 'Найти песню…',
  'Opening your library…': 'Открываем библиотеку…',
  'Your next favorite session is on its way.': 'Готовим всё к следующему занятию.',
  'Every repertoire starts with one song.': 'Большой репертуар начинается с одной песни.',
  'Add a track above. We’ll get the notes ready for your first take.': 'Добавь трек выше — подготовим ноты к твоему первому исполнению.',
  'No tracks found': 'Треки не найдены',
  'Try another title or show all tracks.': 'Попробуй другое название или посмотри все треки.',
  'Show all tracks': 'Показать все треки',
  'Track': 'Композиция',
  'Status': 'Статус',
  'Your collection': 'Твоя коллекция',
  'Full mix playback': 'Оригинал с вокалом',
  'What happened?': 'Что случилось?',
  'Ready to sing': 'Можно петь',
  'Needs attention': 'Нужна помощь',
  'Opening…': 'Открываем…',
  'Something went wrong': 'Что-то пошло не так',
  'Make yourself comfortable.': 'Всё по-твоему.',
  'Studio settings': 'Настройки студии',
  'A good session starts with a setup that feels right.': 'Хорошее занятие начинается с комфортных настроек.',
  'Settings sections': 'Разделы настроек',
  'Your studio, your rules.': 'Твоя студия — твои правила.',
  'Your voice and practice preferences are saved automatically.': 'Настройки голоса и занятий сохраняются автоматически.',
  'Use headphones': 'Надень наушники',
  'Find a quiet spot': 'Найди тихое место',
  'Allow microphone access': 'Разреши доступ к микрофону',
  'Find my range': 'Найти свой диапазон',
  'Step {n} of 3': 'Шаг {n} из 3',
  'Session complete': 'Занятие завершено',
  'Every note takes you further.': 'С каждой нотой — на шаг вперёд.',
  '{n} of 3 stars': '{n} из 3 звёзд',
  'notes on target': 'точных нот',
  'Your voice, on the map': 'Твой голос на карте нот',
  'Your voice': 'Твой голос',
  'Your sung pitch compared with the target notes': 'Сравнение спетой мелодии с целевыми нотами',
  'Your next take': 'Твоё следующее исполнение',
  'Play / pause': 'Старт / пауза',
  'Seek': 'Перемотка',
  'Loop': 'Повтор',

  // — общее —
  'Back': 'Назад',
  'Save': 'Сохранить',
  'Reset': 'Сбросить',
  'Close': 'Закрыть',
  'To menu': 'В меню',
  'Try again': 'Ещё раз',

  // — шапка и главный экран —
  'Home': 'Главная',
  'Library': 'Библиотека',
  'Exercises': 'Упражнения',
  'Practice streak': 'Серия занятий',
  '{n} d.': '{n} дн.',
  'My voice': 'Мой голос',
  '5 min · daily': '5 мин · ежедневно',
  'Long tones, sirens, five-note runs — built for your range.':
    'Длинные ноты, сирены, пятиступенные ходы под твой диапазон.',
  '{n} exercises': '{n} упражнений',
  'Pitch accuracy': 'Точность интонации',
  'Scales, arpeggios, intervals. Tune tempo and key.':
    'Гаммы, арпеджио, интервалы. Настраивай темп и тональность.',
  '{n} in the library': '{n} в библиотеке',
  'Your repertoire': 'Твой репертуар',
  'My songs': 'Мои песни',
  'Upload mp3/wav — vocals are extracted locally, the melody lands in your octave.':
    'Загрузи mp3/wav — вокал извлечём локально, мелодия ляжет в твою октаву.',
  '{n} processed': '{n} обработано',
  'Open the library': 'Открыть библиотеку',
  'Voice profile': 'Голосовой профиль',
  'Range': 'Диапазон',
  'Type': 'Тип',
  'Upload a song': 'Загрузить песню',
  'mp3, wav or flac. Demucs separates vocals, pYIN traces the melody — locally.':
    'mp3, wav или flac. Вокал выделит Demucs, мелодию снимет pYIN — локально.',
  'Calibration': 'Калибровка',
  'Compensates audio-path latency. Set it once — scoring gets fairer.':
    'Поправка на задержку аудиотракта. Сделай один раз — попадания станут честнее.',
  'ms latency': 'мс задержки',
  'Adjust': 'Настроить',
  'All': 'Все',
  'Measure your vocal range': 'Измерить диапазон голоса',
  'takes a minute — everything adapts to you': 'займёт минуту — всё подстроится под тебя',
  'Warm-ups & exercises': 'Распевки и упражнения',
  'Songs': 'Песни',
  'Settings': 'Настройки',
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
  'Techniques': 'Техники',
  'Vibrato hold': 'Удержание вибрато',
  'Hold a long note with vibrato. The first 1.2 seconds are preparation; then active vibrato counts.':
    'Держи длинную ноту с вибрато. Первые 1.2 секунды — подготовка, затем засчитывается активное вибрато.',
  's': 'с',
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
  'Delete': 'Удалить',
  'Delete “{title}”?': 'Удалить «{title}»?',

  // — A/B-луп фразы —
  'Phrase loop (L): press at the start, again at the end, third press clears':
    'Луп фразы (L): нажми в начале, ещё раз в конце, третье нажатие снимает',
  'Loop A': 'Луп: А',
  'Loop B': 'Луп: Б',
  'Loop ✕': 'Луп ✕',

  // — транспонирование в редакторе —
  'Octave down: selection (Shift+drag) or the selected note':
    'Октава вниз: выделение (Shift+drag) или выбранная нота',
  'Octave up: selection (Shift+drag) or the selected note':
    'Октава вверх: выделение (Shift+drag) или выбранная нота',
  'Shift+drag selects a phrase; ±12 (or Shift+↑/↓) fixes a wrong octave.':
    'Shift+drag выделяет фразу; ±12 (или Shift+↑/↓) чинит съехавшую октаву.',
  'Shift would leave the roll window — nothing changed.':
    'Сдвиг вышел бы за окно ролла — ничего не изменено.',
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
  'Motion': 'Движение на экране',
  'Stationary notes': 'Без прокрутки',
  'Scrolling notes': 'С прокруткой',
  'Notes stay in place; the playhead moves. Pages change without sliding.':
    'Ноты стоят на месте, движется маркер времени. Страницы сменяются без скольжения.',
  'External server token (optional)': 'Токен внешнего сервера (если задан)',
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
