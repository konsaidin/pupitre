# Сторонние компоненты

Pupitre распространяется под лицензией MIT (см. [LICENSE](LICENSE)). В него входят или им используются
следующие сторонние компоненты. Полные тексты лицензий шрифтов, иконок и саундфонтов лежат в
[`apps/web/public/licenses/`](apps/web/public/licenses/) и поставляются вместе с приложением; машинный
реестр — [`content/content-licenses.json`](content/content-licenses.json), его сверяет гейт
`tools/gates/check-licenses.mjs` (в сборку не допускаются GPL/LGPL/AGPL-зависимости).

## Встроено в приложение

| Компонент | Лицензия | Где используется |
|---|---|---|
| [alphaTab](https://github.com/CoderLine/alphaTab) 1.8.4 (с TinySoundFont, SFZero, NVorbis, libvorbis, SharpZipLib, Haxe Std) | MPL-2.0 (alphaTab), MIT / BSD-3-Clause (встроенные части) | разбор Guitar Pro / MusicXML, синтез минуса |
| [fretfall/player](https://github.com/fretfall/player) 0.5.0 | MIT | 3D-дорожка гитары (вендорено с патчами, см. `apps/web/src/guitar/vendor/fretfall/VENDOR.md`) |
| [MuseScore General](https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/) 0.2 (на основе FluidR3) | MIT | саундфонт синт-минуса (скачивается при сборке `tools/soundfont/fetch.mjs`) |
| [AVL Drumkits](https://www.bandshed.net/avldrumkits/) — Black Pearl 4 (Glen MacArthur; SF2 — x42) | CC-BY-SA-3.0 | ударные синт-минуса (скачивается при сборке `tools/soundfont/fetch.mjs`, без изменений) |
| SONiVOX EAS GM (из пакета alphaTab) | Apache-2.0 | запасной саундфонт, если MuseScore General недоступен |
| [Martian Grotesk](https://github.com/evilmartians/grotesk), [Martian Mono](https://github.com/evilmartians/mono) | OFL-1.1 | шрифты интерфейса «Рампа» |
| [Noto Music](https://github.com/notofonts/music) (только ♭ ♮ ♯) | OFL-1.1 | знаки альтерации |
| [Tabler Icons](https://github.com/tabler/tabler-icons) | MIT | иконки интерфейса |
| React, React Router, idb, fflate | MIT / ISC | веб-приложение |

## Rust-ядро (`packages/*`)

`cpal`, `jack`, `rtrb`, `napi`/`napi-derive` и их зависимости — MIT и/или Apache-2.0.
Политика лицензий проверяется `cargo deny` (`packages/*/deny.toml`).

## Песенный сервер (`services/api`, ставится на машине пользователя)

FastAPI, Uvicorn, NumPy, SciPy, librosa, soundfile, mutagen — MIT/BSD/ISC; PyTorch и torchaudio — BSD-3-Clause;
[Demucs](https://github.com/facebookresearch/demucs) — MIT (веса модели htdemucs скачиваются при первом
разделении). ffmpeg вызывается как отдельная программа и в приложение не встраивается.
