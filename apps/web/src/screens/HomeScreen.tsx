// Главный экран: сетка карточек — разделы тренировок, голосовой профиль,
// загрузка песни, калибровка задержки, последние результаты. Все цифры
// настоящие: счётчики из EXERCISES, статус сервера — живой listSongs().

import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { EXERCISES } from '../game/exercises';
import { listSongs } from '../lib/api';
import { t } from '../lib/i18n';
import { classifyRange, midiToName } from '../lib/music';
import { useProfile } from '../state/ProfileContext';
import { Icon, type IconName } from '../components/Icon';

/** Границы шкалы диапазона в карточке профиля: C2..C6. */
const AXIS_LOW = 36;
const AXIS_HIGH = 84;

export function HomeScreen() {
  const { profile } = useProfile();
  const navigate = useNavigate();
  const r = profile.range;

  // тихий пинг бэкенда: количество готовых песен для карточки «Мои песни»
  const [songCount, setSongCount] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    listSongs()
      .then((songs) => {
        if (alive) setSongCount(songs.filter((s) => s.status === 'done').length);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const warmups = EXERCISES.filter((e) => e.category === 'Warm-ups').length;
  const others = EXERCISES.length - warmups;

  return (
    <div className="screen home">
      <div className="home-grid">
        <FeatureCard
          icon="waves"
          overline={t('5 min · daily')}
          title={t('Warm-ups')}
          desc={t('Long tones, sirens, five-note runs — built for your range.')}
          foot={t('{n} exercises', { n: warmups })}
          onClick={() => navigate(r ? '/exercises?cat=Warm-ups' : '/range')}
        />
        <FeatureCard
          icon="sparkle"
          overline={t('Pitch accuracy')}
          title={t('Exercises')}
          desc={t('Scales, arpeggios, intervals. Tune tempo and key.')}
          foot={t('{n} in the library', { n: others })}
          onClick={() => navigate(r ? '/exercises' : '/range')}
        />
        <FeatureCard
          icon="note"
          overline={t('Your repertoire')}
          title={t('My songs')}
          desc={t('Upload mp3/wav — vocals are extracted locally, the melody lands in your octave.')}
          foot={songCount !== null ? t('{n} processed', { n: songCount }) : t('Open the library')}
          onClick={() => navigate(r ? '/songs' : '/range')}
        />
      </div>

      <div className="home-grid">
        <VoiceCard />
        <button className="upload-card" onClick={() => navigate(r ? '/songs' : '/range')}>
          <span className="upload-orb"><Icon name="upload" size={22} /></span>
          <span className="upload-title">{t('Upload a song')}</span>
          <span className="upload-desc">{t('mp3, wav or flac. Demucs separates vocals, pYIN traces the melody — locally.')}</span>
        </button>
        <div className="info-card">
          <div className="info-head">
            <Icon name="sliders" size={17} />
            {t('Calibration')}
          </div>
          <p className="info-desc">{t('Compensates audio-path latency. Set it once — scoring gets fairer.')}</p>
          <div>
            <span className="calib-num mono">{profile.latencyMs}</span>
            <span className="calib-unit">{t('ms latency')}</span>
          </div>
          <button className="btn block" onClick={() => navigate('/settings')}>{t('Adjust')}</button>
        </div>
      </div>

      {profile.scores.length > 0 && (
        <section className="recent">
          <h2 className="cat">{t('Recent results')}</h2>
          <ul className="score-list">
            {profile.scores.slice(0, 8).map((s, i) => (
              <li key={i}>
                <span className="score-stars">{'★'.repeat(s.stars) || '·'}</span>
                <span className="score-title">{t(s.title)}</span>
                <span className="dim">{Math.round(s.accuracy * 100)}%</span>
                <b>{s.score}</b>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function FeatureCard(props: {
  icon: IconName;
  overline: string;
  title: string;
  desc: string;
  foot: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="feat-card" onClick={props.onClick}>
      <span className="tile-icon"><Icon name={props.icon} size={24} /></span>
      <span className="overline">{props.overline}</span>
      <span className="feat-title">{props.title}</span>
      <span className="feat-desc">{props.desc}</span>
      <span className="feat-foot">
        {props.foot}
        <span className="chev"><Icon name="chevron" size={17} /></span>
      </span>
    </button>
  );
}

function VoiceCard() {
  const { profile } = useProfile();
  const navigate = useNavigate();
  const r = profile.range;

  if (!r) {
    return (
      <div className="info-card">
        <div className="info-head">
          <Icon name="user" size={17} />
          {t('Voice profile')}
        </div>
        <p className="info-desc">{t('takes a minute — everything adapts to you')}</p>
        <button className="btn primary block" onClick={() => navigate('/range')} style={{ marginTop: 'auto' }}>
          {t('Measure your vocal range')}
        </button>
      </div>
    );
  }

  const span = AXIS_HIGH - AXIS_LOW;
  const left = Math.max(0, Math.min(100, ((r.lowMidi - AXIS_LOW) / span) * 100));
  const right = Math.max(0, Math.min(100, ((r.highMidi - AXIS_LOW) / span) * 100));

  return (
    <div className="info-card">
      <div className="info-head">
        <Icon name="user" size={17} />
        {t('Voice profile')}
        <button className="info-link" onClick={() => navigate('/range')}>{t('Remeasure')}</button>
      </div>
      <div className="voice-row">
        <div className="voice-col">
          <span className="overline">{t('Range')}</span>
          <span className="voice-notes">{midiToName(r.lowMidi)} – {midiToName(r.highMidi)}</span>
        </div>
        <div className="voice-col right">
          <span className="overline">{t('Type')}</span>
          <span className="voice-type">{t(classifyRange(r.lowMidi, r.highMidi))}</span>
        </div>
      </div>
      <div>
        <div className="range-axis">
          <div className="range-axis-fill" style={{ left: `${left}%`, width: `${Math.max(2, right - left)}%` }} />
        </div>
        <div className="range-axis-labels">
          <span>{midiToName(AXIS_LOW)}</span>
          <span>{midiToName((AXIS_LOW + AXIS_HIGH) / 2)}</span>
          <span>{midiToName(AXIS_HIGH)}</span>
        </div>
      </div>
    </div>
  );
}
