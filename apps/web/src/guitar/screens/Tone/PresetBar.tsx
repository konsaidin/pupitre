// Полоса над установкой: комплект (гитара · бас) и пресеты тона — встроенные и свои (guitar/store/tonePresets.ts).
// ◀ ▶ листают пресеты текущего комплекта; выбранный — settings.monitoring.toneId; крутишь ручки — пресет «изменён»:
// «Вернуть» откатывает к сохранённому, «Сохранить» перезаписывает свой, «Сохранить как…» — новый. В меню — переименовать,
// удалить, экспорт звука или всех своих в JSON и импорт такого файла. Питание пресет не трогает.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { RIGS, toneKey, type RigName, type ToneShape } from '../../../audio/guitar/tone';
import { t } from '../../../lib/i18n';
import { updateGuitarSettings } from '../../store/settings';
import {
  deleteTonePreset, FACTORY_PRESETS, parsePresetsFile, presetsFile, presetsOfRig, saveTonePreset, uniqueName, useTonePresets, type TonePreset,
} from '../../store/tonePresets';
import { downloadBlob, safeFileName } from '../../ui/download';
import { GuitarIcon } from '../../ui/GuitarIcon';

const RIG_UI: Record<RigName, { label: string }> = {
  guitar: { label: 'Guitar' },
  bass: { label: 'Bass' },
};

/** Имя пресета для показа: встроенные — переводом. */
export const presetName = (p: TonePreset) => (p.builtIn ? t(p.name) : p.name);

/** Выбрать пресет: его тон, питание — как было. */
export function applyPreset(preset: TonePreset) {
  updateGuitarSettings((s) => ({ ...s, tone: { ...preset.tone, on: s.tone.on }, monitoring: { ...s.monitoring, toneId: preset.id } }));
}

/** Форма имени и подтверждение удаления — с пресетом, к которому относятся (сменился выбранный — форма закрывается). */
type Mode = { kind: 'save-as' | 'rename'; name: string; id: string | undefined } | { kind: 'delete'; id: string } | null;

export function PresetBar({ tone, toneId }: { tone: ToneShape; toneId: string | undefined }) {
  const { user } = useTonePresets();
  const rig: RigName = tone.rig === 'bass' ? 'bass' : 'guitar';
  const all = [...FACTORY_PRESETS, ...user];
  const current = toneId ? all.find((p) => p.id === toneId) : undefined;
  const modified = !!current && toneKey(current.tone) !== toneKey(tone);
  const list = presetsOfRig(all, rig);
  const [mode, setMode] = useState<Mode>(null);
  const [note, setNote] = useState('');
  const [menu, setMenu] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // выбрали другой пресет — форма имени и удаление относились к прежнему
  useEffect(() => setMode(null), [toneId]);

  // меню закрывается кликом мимо и Esc (Esc — только меню: панель поверх игры остаётся)
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent) {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        setMenu(false);
      } else if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', close, true);
    return () => {
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', close, true);
    };
  }, [menu]);

  const say = (text: string) => setNote(text);
  const switchRig = (next: RigName) =>
    updateGuitarSettings((s) => {
      const keep = current && current.tone.rig === next;
      return { ...s, tone: { ...s.tone, rig: next }, monitoring: { ...s.monitoring, toneId: keep ? s.monitoring.toneId : undefined } };
    });
  const step = (dir: 1 | -1) => {
    if (!list.length) return;
    const i = list.findIndex((p) => p.id === current?.id);
    applyPreset(list[i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length]);
  };
  const choose = (id: string) => {
    const preset = all.find((p) => p.id === id);
    if (preset) applyPreset(preset);
  };
  const save = async () => {
    if (!current || current.builtIn) return;
    const saved = await saveTonePreset({ id: current.id, name: current.name, tone });
    applyPreset(saved);
    say(`${t('Saved')}: ${saved.name}`);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!mode || mode.kind === 'delete') return;
    const name = mode.name.trim();
    if (!name) return;
    if (mode.kind === 'rename') {
      const target = user.find((p) => p.id === mode.id);
      if (!target) return setMode(null);
      const saved = await saveTonePreset({ id: target.id, name: uniqueName(name, user.filter((p) => p.id !== target.id).map((p) => p.name)), tone: target.tone });
      if (!modified) applyPreset(saved);
      say(`${t('Renamed')}: ${saved.name}`);
    } else {
      const saved = await saveTonePreset({ name: uniqueName(name, user.map((p) => p.name)), tone });
      applyPreset(saved);
      say(`${t('Saved')}: ${saved.name}`);
    }
    setMode(null);
  };
  const remove = async () => {
    const target = mode?.kind === 'delete' ? user.find((p) => p.id === mode.id) : undefined;
    if (!target) return setMode(null);
    await deleteTonePreset(target.id);
    updateGuitarSettings((s) => ({ ...s, monitoring: { ...s.monitoring, toneId: s.monitoring.toneId === target.id ? undefined : s.monitoring.toneId } }));
    say(`${t('Deleted')}: ${target.name}`);
    setMode(null);
  };
  const exportSound = () => {
    const name = current ? presetName(current) : t('My sound');
    downloadBlob(new Blob([presetsFile([{ name, tone }])], { type: 'application/json' }), `${safeFileName(name)}.pupitre-tone.json`);
    setMenu(false);
  };
  const exportMine = () => {
    downloadBlob(new Blob([presetsFile(user)], { type: 'application/json' }), 'pupitre-tones.json');
    setMenu(false);
  };
  const importFile = async (picked: File | undefined) => {
    if (!picked) return;
    try {
      const presets = parsePresetsFile(await picked.text());
      const taken = user.map((p) => p.name);
      let last: TonePreset | null = null;
      for (const p of presets) {
        const name = uniqueName(p.name, taken);
        taken.push(name);
        last = await saveTonePreset({ name, tone: p.tone });
      }
      if (last && presets.length === 1) applyPreset(last);
      say(presets.length ? `${t('Imported presets')}: ${presets.length}` : t('No presets in the file.'));
    } catch {
      say(t('This is not a Pupitre presets file.'));
    }
  };
  const startName = (kind: 'save-as' | 'rename') => {
    setMenu(false);
    setMode({
      kind, id: current?.id,
      name: kind === 'rename' && current ? current.name : current ? `${presetName(current)}${modified ? ` ${t('(mine)')}` : ''}` : t('My sound'),
    });
  };

  return (
    <section className="rp-card tone-bar" aria-label={t('Presets')} data-ui="tone-bar">
      <div className="rp-seg" role="radiogroup" aria-label={t('Rig')} data-ui="tone-rig">
        {RIGS.map((r) => (
          <button key={r} type="button" className="rp-seg__item" role="radio" aria-checked={rig === r} onClick={() => switchRig(r)}>
            {t(RIG_UI[r].label)}
          </button>
        ))}
      </div>

      <div className="tone-presets" data-ui="tone-presets">
        <button type="button" className="rp-btn rp-btn--ghost rp-btn--icon" aria-label={t('Previous preset')} onClick={() => step(-1)} data-ui="tone-preset-prev">
          <GuitarIcon name="chevron-left" size="sm" />
        </button>
        <select className="rp-select tone-presets__select" aria-label={t('Preset')} value={current && current.tone.rig === rig ? current.id : ''}
          onChange={(e) => choose(e.target.value)} data-ui="tone-preset">
          <option value="" disabled>{t('Own sound')}</option>
          <optgroup label={t('Built-in')}>
            {presetsOfRig(FACTORY_PRESETS, rig).map((p) => <option key={p.id} value={p.id}>{presetName(p)}</option>)}
          </optgroup>
          {presetsOfRig(user, rig).length > 0 && (
            <optgroup label={t('Mine')}>
              {presetsOfRig(user, rig).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </optgroup>
          )}
        </select>
        <button type="button" className="rp-btn rp-btn--ghost rp-btn--icon" aria-label={t('Next preset')} onClick={() => step(1)} data-ui="tone-preset-next">
          <GuitarIcon name="chevron-right" size="sm" />
        </button>
        {modified && <span className="rp-chip rp-chip--warn" data-ui="tone-preset-modified">{t('changed')}</span>}
      </div>

      <div className="tone-presets__actions">
        {modified && current && (
          <button type="button" className="rp-btn rp-btn--ghost rp-btn--sm" onClick={() => applyPreset(current)} data-ui="tone-preset-revert">
            <GuitarIcon name="arrow-back-up" size="sm" />
            {t('Revert')}
          </button>
        )}
        {modified && current && !current.builtIn && (
          <button type="button" className="rp-btn rp-btn--sm" onClick={() => void save()} data-ui="tone-preset-save">
            <GuitarIcon name="device-floppy" size="sm" />
            {t('Save')}
          </button>
        )}
        <button type="button" className="rp-btn rp-btn--sm" onClick={() => startName('save-as')} data-ui="tone-preset-save-as">
          <GuitarIcon name="plus" size="sm" />
          {t('Save as…')}
        </button>
        <div className="tone-menu" ref={menuRef}>
          <button type="button" className="rp-btn rp-btn--ghost rp-btn--icon" aria-label={t('More')} aria-haspopup="menu" aria-expanded={menu}
            onClick={() => setMenu(!menu)} data-ui="tone-preset-menu">
            <GuitarIcon name="dots" size="sm" />
          </button>
          {menu && (
            <div className="tone-menu__list" role="menu">
              <button type="button" role="menuitem" disabled={!current || current.builtIn} onClick={() => startName('rename')}>
                <GuitarIcon name="wand" size="sm" />
                {t('Rename')}
              </button>
              <button type="button" role="menuitem" disabled={!current || current.builtIn}
                onClick={() => current && (setMenu(false), setMode({ kind: 'delete', id: current.id }))}>
                <GuitarIcon name="trash" size="sm" />
                {t('Delete')}
              </button>
              <button type="button" role="menuitem" onClick={exportSound}>
                <GuitarIcon name="download" size="sm" />
                {t('Export this sound')}
              </button>
              <button type="button" role="menuitem" disabled={!user.length} onClick={exportMine}>
                <GuitarIcon name="download" size="sm" />
                {t('Export my presets')}
              </button>
              <button type="button" role="menuitem" onClick={() => (setMenu(false), file.current?.click())}>
                <GuitarIcon name="upload" size="sm" />
                {t('Import presets')}
              </button>
            </div>
          )}
        </div>
        <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => {
          void importFile(e.target.files?.[0]);
          e.target.value = '';
        }} data-ui="tone-preset-file" />
      </div>

      {mode && mode.kind !== 'delete' && (
        <form className="tone-presets__name" onSubmit={(e) => void submit(e)} data-ui="tone-preset-name">
          <label className="rp-input">
            <input value={mode.name} maxLength={60} autoFocus aria-label={t('Preset name')} onChange={(e) => setMode({ ...mode, name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key !== 'Escape') return;
                e.preventDefault();
                setMode(null);
              }} />
          </label>
          <button type="submit" className="rp-btn rp-btn--light rp-btn--sm" disabled={!mode.name.trim()}>{t('Save')}</button>
          <button type="button" className="rp-btn rp-btn--ghost rp-btn--sm" onClick={() => setMode(null)}>{t('Cancel')}</button>
        </form>
      )}
      {mode?.kind === 'delete' && (
        <div className="tone-presets__name" role="alertdialog" aria-label={t('Delete the preset?')}>
          <span className="rp-sm">{t('Delete the preset?')} «{user.find((p) => p.id === mode.id)?.name ?? ''}»</span>
          <button type="button" className="rp-btn rp-btn--danger rp-btn--sm" onClick={() => void remove()} data-ui="tone-preset-delete">{t('Delete')}</button>
          <button type="button" className="rp-btn rp-btn--ghost rp-btn--sm" onClick={() => setMode(null)}>{t('Cancel')}</button>
        </div>
      )}
      {note && <p className="tone-presets__note rp-sm" role="status">{note}</p>}
    </section>
  );
}
