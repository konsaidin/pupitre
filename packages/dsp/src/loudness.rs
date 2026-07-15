// Громкость для толщины ленты: dBFS с быстрой атакой и медленным спадом —
// толщина реагирует на форте мгновенно, но не мерцает на амплитудной ряби.

/// атака/спад как постоянные времени, мс
const ATTACK_MS: f32 = 15.0;
const RELEASE_MS: f32 = 180.0;
const FLOOR_DB: f32 = -80.0;

pub struct Loudness {
    attack: f32,
    release: f32,
    db: f32,
}

impl Loudness {
    pub fn new(frame_rate: f32) -> Self {
        let frame_ms = 1000.0 / frame_rate;
        Self {
            attack: 1.0 - (-frame_ms / ATTACK_MS).exp(),
            release: 1.0 - (-frame_ms / RELEASE_MS).exp(),
            db: FLOOR_DB,
        }
    }

    pub fn process(&mut self, rms: f32) -> f32 {
        let target = (20.0 * rms.max(1e-5).log10()).max(FLOOR_DB);
        let alpha = if target > self.db { self.attack } else { self.release };
        self.db += alpha * (target - self.db);
        self.db
    }
}
