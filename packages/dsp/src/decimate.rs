// Высокочастотные устройства приводим к <=48 кГц перед YIN. ФНЧ перед
// прореживанием подавляет aliasing; память выделяется только при создании.
pub struct Decimator {
    pub factor: usize,
    coeffs: Vec<f32>,
    ring: Vec<f32>,
    pos: usize,
    phase: usize,
}

impl Decimator {
    pub fn new(sample_rate: f32) -> Self {
        let factor = (sample_rate / 48000.0).ceil().max(1.0) as usize;
        let len = if factor > 1 { 16 * factor + 1 } else { 0 };
        let cutoff = 0.45 / factor as f32;
        let mut coeffs = Vec::with_capacity(len);
        for i in 0..len {
            let x = i as f32 - (len / 2) as f32;
            let sinc = if x == 0.0 { 2.0 * cutoff } else {
                (2.0 * std::f32::consts::PI * cutoff * x).sin() / (std::f32::consts::PI * x)
            };
            let window = 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / (len - 1) as f32).cos();
            coeffs.push(sinc * window);
        }
        let sum: f32 = coeffs.iter().sum();
        for c in &mut coeffs { *c /= sum; }
        Self { factor, coeffs, ring: vec![0.0; len], pos: 0, phase: 0 }
    }

    pub fn delay_samples(&self) -> usize { self.coeffs.len() / 2 }

    pub fn push(&mut self, sample: f32) -> Option<f32> {
        self.ring[self.pos] = sample;
        self.pos = (self.pos + 1) % self.ring.len();
        self.phase += 1;
        if self.phase < self.factor { return None; }
        self.phase = 0;
        let mut value = 0.0;
        let mut idx = self.pos;
        for &coeff in &self.coeffs {
            idx = if idx == 0 { self.ring.len() - 1 } else { idx - 1 };
            value += self.ring[idx] * coeff;
        }
        Some(value)
    }
}
