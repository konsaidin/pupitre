// Тесты ядра на синтетических сигналах: тон, тон+вибрато, тон+субгармоника
// (расщепление), тишина, атака/спад громкости.

use slopsician_dsp::{Analyzer, AnalysisFrame};

const SR: f32 = 48000.0;

fn run(samples: &[f32]) -> Vec<AnalysisFrame> {
    let mut a = Analyzer::new(SR);
    a.set_gate(0.006, 0.6);
    let mut frames = Vec::new();
    // порциями по 128, как из AudioWorklet
    for chunk in samples.chunks(128) {
        a.process(chunk, |f| frames.push(f));
    }
    frames
}

/// Тон с частотной модуляцией: midi(t) = base + depth_semis * sin(2π·rate·t).
/// Фаза — интеграл мгновенной частоты, чтобы не было скачков.
fn fm_tone(secs: f32, base_hz: f32, depth_cents: f32, rate_hz: f32, amp: f32) -> Vec<f32> {
    let n = (secs * SR) as usize;
    let mut out = Vec::with_capacity(n);
    let mut phase = 0.0f64;
    for i in 0..n {
        let t = i as f32 / SR;
        let semis = depth_cents / 100.0 * (2.0 * std::f32::consts::PI * rate_hz * t).sin();
        let hz = base_hz * 2.0f32.powf(semis / 12.0);
        phase += hz as f64 / SR as f64;
        out.push(amp * (2.0 * std::f64::consts::PI * phase).sin() as f32);
    }
    out
}

fn tone(secs: f32, hz: f32, amp: f32) -> Vec<f32> {
    fm_tone(secs, hz, 0.0, 0.0, amp)
}

/// Хвост кадров после прогрева (детекторам нужно окно ~1 с).
fn tail(frames: &[AnalysisFrame], skip_secs: f32) -> Vec<&AnalysisFrame> {
    frames.iter().filter(|f| f.t > skip_secs).collect()
}

#[test]
fn pure_tone_pitch_and_no_techniques() {
    let frames = run(&tone(2.0, 220.0, 0.3));
    let t = tail(&frames, 0.5);
    assert!(!t.is_empty());
    for f in &t {
        assert!(f.voiced, "тон должен быть voiced на t={}", f.t);
        assert!((f.f0 - 220.0).abs() < 2.0, "f0={} вместо 220", f.f0);
        assert!((f.midi - 57.0).abs() < 0.15, "midi={} вместо 57", f.midi);
        assert!(!f.vib_active, "чистый тон принят за вибрато на t={}", f.t);
        assert!(f.dist_score < 0.3, "чистый тон: dist_score={} на t={}", f.dist_score, f.t);
    }
}

#[test]
fn vibrato_detected_with_rate_and_depth() {
    let frames = run(&fm_tone(3.0, 220.0, 50.0, 5.5, 0.3));
    let t = tail(&frames, 1.8);
    assert!(!t.is_empty());
    let active: Vec<_> = t.iter().filter(|f| f.vib_active).collect();
    assert!(
        active.len() as f32 > 0.8 * t.len() as f32,
        "вибрато активно лишь в {}/{} кадров",
        active.len(),
        t.len()
    );
    let mean_rate: f32 = active.iter().map(|f| f.vib_rate_hz).sum::<f32>() / active.len() as f32;
    let mean_depth: f32 =
        active.iter().map(|f| f.vib_depth_cents).sum::<f32>() / active.len() as f32;
    assert!((mean_rate - 5.5).abs() < 0.6, "rate={} вместо 5.5", mean_rate);
    assert!((mean_depth - 50.0).abs() < 14.0, "depth={} вместо 50", mean_depth);
    // вибрато — не расщепление
    for f in &t {
        assert!(f.dist_score < 0.4, "вибрато принято за расщепление: {}", f.dist_score);
    }
}

#[test]
fn vibrato_not_detected_on_slow_drift() {
    // медленный дрейф 1 Гц — не вибрато
    let frames = run(&fm_tone(3.0, 220.0, 80.0, 1.0, 0.3));
    let t = tail(&frames, 1.8);
    let active = t.iter().filter(|f| f.vib_active).count();
    assert!(active as f32 <= 0.1 * t.len() as f32, "дрейф принят за вибрато: {}/{}", active, t.len());
}

#[test]
fn subharmonic_reads_as_distortion_keeping_melodic_pitch() {
    // расщепление: удвоение периода — к 220 Гц добавлена сильная субгармоника 110 Гц
    let base = fm_tone(2.5, 220.0, 0.0, 0.0, 0.3);
    let sub = fm_tone(2.5, 110.0, 0.0, 0.0, 0.11);
    let mixed: Vec<f32> = base.iter().zip(&sub).map(|(a, b)| a + b).collect();
    let frames = run(&mixed);
    let t = tail(&frames, 1.0);
    assert!(!t.is_empty());
    let melodic = t.iter().filter(|f| f.voiced && (f.f0 - 220.0).abs() < 6.0).count();
    assert!(
        melodic as f32 > 0.8 * t.len() as f32,
        "мелодическая высота потеряна: 220 Гц в {}/{} кадров",
        melodic,
        t.len()
    );
    let hot = t.iter().filter(|f| f.dist_score > 0.4).count();
    assert!(
        hot as f32 > 0.6 * t.len() as f32,
        "субгармоника не читается как расщепление: {}/{} кадров, max score {:?}",
        hot,
        t.len(),
        t.iter().map(|f| f.dist_score).fold(0.0f32, f32::max)
    );
}

#[test]
fn silence_is_unvoiced() {
    let frames = run(&vec![0.0f32; SR as usize]);
    assert!(!frames.is_empty());
    for f in &frames {
        assert!(!f.voiced);
        assert!(f.midi.is_nan());
    }
}

#[test]
fn loudness_attacks_fast_releases_slow() {
    // 0.8 c тихо → 0.8 c громко → 0.8 c тихо
    let mut sig = tone(0.8, 220.0, 0.03);
    sig.extend(tone(0.8, 220.0, 0.5));
    sig.extend(tone(0.8, 220.0, 0.03));
    let frames = run(&sig);
    let db_at = |t_want: f32| {
        frames
            .iter()
            .min_by(|a, b| {
                (a.t - t_want).abs().partial_cmp(&(b.t - t_want).abs()).unwrap()
            })
            .unwrap()
            .loud_db
    };
    let quiet = db_at(0.75);
    // атака: через 60 мс после скачка громкость почти догнала цель
    let after_attack = db_at(0.86);
    assert!(after_attack > quiet + 15.0, "атака вялая: {} → {}", quiet, after_attack);
    // спад: через 60 мс после падения громкость ещё далека от тихой
    let loud = db_at(1.55);
    let after_release = db_at(1.66);
    assert!(
        after_release > loud - 0.6 * (loud - quiet),
        "спад слишком резкий: {} → {} (тихо {})",
        loud,
        after_release,
        quiet
    );
}

#[test]
fn frame_rate_matches_hop() {
    let frames = run(&tone(1.0, 220.0, 0.3));
    let dt = frames[1].t - frames[0].t;
    assert!((dt - 256.0 / SR).abs() < 1e-6, "шаг кадров {} сек", dt);
}
