// Эталоны вокального тракта: генераторы считают в f64, вход квантуется в int16.
use pupitre_dsp::Analyzer;
use std::{f64::consts::TAU, fs, path::PathBuf};

const FIELDS: [&str; 15] = [
    "t",
    "f0",
    "midi",
    "midi_raw",
    "clarity",
    "rms",
    "voiced",
    "loud_db",
    "vib_active",
    "vib_rate_hz",
    "vib_depth_cents",
    "vib_regularity",
    "dist_active",
    "dist_score",
    "breathiness",
];

fn generate(sr: u32, seconds: f64, mut sample: impl FnMut(f64) -> f64) -> Vec<f32> {
    (0..(seconds * sr as f64).round() as usize)
        .map(|i| ((sample(i as f64 / sr as f64) * 32767.0).round() / 32767.0) as f32)
        .collect()
}

fn signals(sr: u32) -> Vec<Vec<f32>> {
    let tone = |t: f64| 0.3 * (TAU * 220.0 * t).sin();
    let mut phase = 0.0;
    let vibrato = generate(sr, 2.5, |t| {
        let hz = 220.0 * 2.0f64.powf(50.0 * (TAU * 5.5 * t).sin() / 1200.0);
        phase += hz / sr as f64;
        0.3 * (TAU * phase).sin()
    });
    let mut phase = 0.0;
    let sweep = generate(sr, 3.0, |t| {
        let hz = 80.0 * (1000.0f64 / 80.0).powf(t / 3.0);
        phase += hz / sr as f64;
        0.3 * (TAU * phase).sin()
    });
    let mut seed = 0x9E3779B9u32;
    let burst = generate(sr, 1.0, |t| {
        if !(0.3..0.5).contains(&t) {
            return 0.0;
        }
        seed ^= seed << 13;
        seed ^= seed >> 17;
        seed ^= seed << 5;
        0.2 * (2.0 * seed as f64 / u32::MAX as f64 - 1.0)
    });
    vec![
        generate(sr, 1.5, tone),
        vibrato,
        generate(sr, 2.5, |t| tone(t) + 0.11 * (TAU * 110.0 * t).sin()),
        generate(sr, 2.0, |t| {
            [0.4, 1.0, 0.5, 0.3, 0.2]
                .iter()
                .enumerate()
                .map(|(k, amp)| 0.15 * amp * (TAU * 130.8 * (k + 1) as f64 * t).sin())
                .sum()
        }),
        generate(sr, 1.5, |t| if t < 0.5 { 0.0 } else { tone(t - 0.5) }),
        sweep,
        burst,
    ]
}

// Монотонная шкала битов: отрицательные числа идут перед нулём.
fn ordered_bits(value: f32) -> u32 {
    let bits = value.to_bits();
    if bits & 0x8000_0000 != 0 {
        0x8000_0000 - (bits & 0x7fff_ffff)
    } else {
        0x8000_0000 + bits
    }
}

fn ulp_distance(expected: f32, actual: f32) -> u32 {
    ordered_bits(expected).abs_diff(ordered_bits(actual))
}

fn matches(field: usize, expected: f32, actual: f32) -> bool {
    if matches!(field, 0 | 6 | 8 | 12) {
        return expected.to_bits() == actual.to_bits();
    }
    if expected.is_nan() || actual.is_nan() {
        return expected.is_nan() && actual.is_nan();
    }
    if expected == actual {
        return true;
    }
    if expected.is_infinite() || actual.is_infinite() {
        return false;
    }
    ulp_distance(expected, actual) <= 4
}

#[test]
fn comparator_policy() {
    assert!(matches(1, 1.0, f32::from_bits(1.0f32.to_bits() + 1)));
    assert!(matches(1, 1.0, f32::from_bits(1.0f32.to_bits() + 4)));
    assert!(!matches(1, 1.0, f32::from_bits(1.0f32.to_bits() + 5)));
    assert!(!matches(1, 1.0, 1.0 * (1.0 + 1e-3)));
    assert!(matches(1, f32::NAN, f32::NAN));
    assert!(!matches(1, f32::NAN, 1.0));
    assert!(matches(1, 0.0, -0.0));
    assert!(matches(1, -1.0, f32::from_bits((-1.0f32).to_bits() + 1)));
    assert!(matches(1, f32::INFINITY, f32::INFINITY));
    assert!(!matches(1, f32::INFINITY, f32::MAX));
    assert!(!matches(1, f32::INFINITY, f32::NEG_INFINITY));
    for field in [0, 6, 8, 12] {
        assert!(!matches(field, 0.0, -0.0));
        assert!(!matches(field, 1.0, f32::from_bits(1.0f32.to_bits() + 1)));
    }
}

#[test]
fn voice_golden_matches() {
    let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/golden");
    let write = std::env::var("GOLDEN_WRITE").as_deref() == Ok("1");
    for sr in [44100, 48000, 96000] {
        let frames: Vec<Vec<[f32; 15]>> = signals(sr)
            .iter()
            .map(|samples| {
                let mut analyzer = Analyzer::new(sr as f32);
                let mut frames = Vec::new();
                for chunk in samples.chunks(128) {
                    analyzer.process(chunk, |frame| {
                        let mut values = [0.0; 15];
                        frame.write(&mut values);
                        frames.push(values);
                    });
                }
                frames
            })
            .collect();
        let header: Vec<u32> = [0x564F4344, 1, sr, 15, 7]
            .into_iter()
            .chain(frames.iter().map(|signal| signal.len() as u32))
            .collect();
        let mut bytes: Vec<u8> = header.iter().flat_map(|word| word.to_le_bytes()).collect();
        for signal in &frames {
            for frame in signal {
                for value in frame {
                    bytes.extend_from_slice(&value.to_le_bytes());
                }
            }
        }
        let path = directory.join(format!("voice-{sr}.bin"));
        if write {
            fs::create_dir_all(&directory).expect("создать каталог эталонов");
            fs::write(&path, &bytes).expect("записать эталон");
            continue;
        }
        let expected = fs::read(&path).unwrap_or_else(|error| {
            panic!("{}: {error}; создайте эталоны: GOLDEN_WRITE=1 cargo test --manifest-path packages/dsp/Cargo.toml --test voice_golden", path.display())
        });
        assert_eq!(expected.len(), bytes.len(), "{sr} Гц: длина эталона");
        for (index, word) in header.iter().enumerate() {
            let offset = index * 4;
            let saved = u32::from_le_bytes(expected[offset..offset + 4].try_into().unwrap());
            assert_eq!(saved, *word, "{sr} Гц: слово заголовка {index}");
        }
        let mut offset = 12 * 4;
        for (signal_index, signal) in frames.iter().enumerate() {
            for (frame_index, frame) in signal.iter().enumerate() {
                for (field, &actual) in frame.iter().enumerate() {
                    let saved =
                        f32::from_le_bytes(expected[offset..offset + 4].try_into().unwrap());
                    assert!(matches(field, saved, actual),
                        "{sr} Гц, сигнал {}, кадр {frame_index}, поле {} ({field}): ожидаемое={saved:?}, полученное={actual:?}, ULP={}",
                        signal_index + 1, FIELDS[field], ulp_distance(saved, actual));
                    offset += 4;
                }
            }
        }
    }
}
