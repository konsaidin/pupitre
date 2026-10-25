// Dev-стенд хранилища (#/guitar/_dev/store, только DEV): импорт фикстуры через настоящий воркер разбора, список песен
// после перезагрузки, запись и чтение Blob 20 МБ. Его гоняет e2e guitar-store.mjs и ELECTRON-смоук.
import { useEffect, useState } from 'react';
import type { GuitarSong } from '../model/types';
import { guitarLibrary } from '../store/library';
import { importErrorText } from '../import/workerClient';

// Своя фраза (MIT): два такта, аккорд и бенд.
const FIXTURE = '\\title "Store probe"\n\\artist "Pupitre"\n\\tempo 110\n\\track "Guitar"\n\\staff {tabs}\n\\tuning (E4 B3 G3 D3 A2 E2)\n3.6.4 5.5.4 (0.4 2.3 3.2).4 7.3{b (0 4)}.4 | 5.6.2 r.2';

export function StoreDev() {
  const [songs, setSongs] = useState<GuitarSong[] | null>(null);
  const [status, setStatus] = useState('');
  const refresh = () => guitarLibrary().then((lib) => lib.allSongs()).then(setSongs, (e) => setStatus(`list: ${String(e)}`));
  useEffect(() => {
    refresh();
  }, []);

  const importFixture = async () => {
    setStatus('…');
    try {
      const lib = await guitarLibrary();
      const r = await lib.importAlphaTex(FIXTURE, 'store-probe.alphatex');
      setStatus(`imported ${r.song.id} ${r.arrangements.length} ${r.arrangements[0]?.events.length} ${r.duplicate ? 'duplicate' : 'new'}`);
      await refresh();
    } catch (e) {
      setStatus(`error ${importErrorText(e)} ${String(e)}`);
    }
  };

  // Blob 20 МБ: запись в files и чтение обратно, сверка размера и контрольной суммы.
  const blobTest = async () => {
    const size = 20 * 1024 * 1024;
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i += 4096) bytes[i] = (i / 4096) & 255;
    const { openGuitarDB } = await import('../store/db');
    const db = await openGuitarDB();
    await db.put('files', { id: 'dev:blob', songId: 'dev', kind: 'recording', name: 'blob.bin', type: 'application/octet-stream', bytes: size, blob: new Blob([bytes]) });
    const back = new Uint8Array(await (await db.get('files', 'dev:blob'))!.blob.arrayBuffer());
    let sum = 0;
    for (let i = 0; i < back.length; i += 4096) sum = (sum + back[i]) % 65521;
    await db.delete('files', 'dev:blob');
    db.close();
    setStatus(`blob ${back.length} ${sum}`);
  };

  return (
    <div className="rp-page" data-ui="dev-store">
      <h1 className="rp-h2">Хранилище (dev)</h1>
      <p>
        <button type="button" className="rp-btn" data-ui="dev-store-import" onClick={importFixture}>
          Импорт фикстуры
        </button>{' '}
        <button type="button" className="rp-btn" data-ui="dev-store-blob" onClick={blobTest}>
          Blob 20 МБ
        </button>
      </p>
      <p data-ui="dev-store-status">{status}</p>
      <ul data-ui="dev-store-songs">
        {songs?.map((s) => (
          <li key={s.id} data-song={s.id}>
            {s.title} — {s.artist} · {s.arrangementIds.length}
          </li>
        ))}
      </ul>
    </div>
  );
}
