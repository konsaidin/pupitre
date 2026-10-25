// Замер задержки туда-обратно (01-architecture §8.3, этап 41b): щелчок (один сэмпл) на выход, первый сэмпл входа выше
// порога — его кадр минус кадр щелчка. Порог — над фоном (средний модуль входа до щелчка), не ниже RTL_FLOOR. Щелчки
// через interval кадров; щелчок без ответа за timeout кадров — промах. Всё в аудиопотоке, без аллокаций.

pub const MAX_CLICKS: usize = 32;
/// Амплитуда щелчка (−6 dBFS).
pub const CLICK: f32 = 0.5;
const RTL_FLOOR: f32 = 0.005;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RtlReport {
    /// Задержки щелчков, кадры; первые `count` значимы.
    pub delays: [u32; MAX_CLICKS],
    pub count: u8,
    pub misses: u8,
}

impl RtlReport {
    pub fn delays(&self) -> &[u32] {
        &self.delays[..self.count as usize]
    }

    /// Медиана задержек, кадры; None — ни одного ответа.
    pub fn median(&self) -> Option<u32> {
        let mut sorted = self.delays;
        let n = self.count as usize;
        if n == 0 {
            return None;
        }
        sorted[..n].sort_unstable();
        Some(sorted[n / 2])
    }
}

#[derive(Default)]
pub struct Rtl {
    active: bool,
    clicks: u16,
    emitted: u16,
    interval: u32,
    timeout: u32,
    next_at: u64,
    /// Кадр последнего щелчка без ответа.
    waiting: Option<u64>,
    /// Средний модуль входа до щелчка (фон).
    noise: f32,
    threshold: f32,
    delays: [u32; MAX_CLICKS],
    count: u8,
    misses: u8,
}

impl Rtl {
    pub fn active(&self) -> bool {
        self.active
    }

    pub fn start(&mut self, clicks: u16, interval: u32, timeout: u32, now: u64) {
        *self = Rtl {
            active: true,
            clicks: clicks.clamp(1, MAX_CLICKS as u16),
            interval: interval.max(1),
            timeout: timeout.max(1),
            next_at: now + u64::from(interval.max(1)) / 2,
            ..Rtl::default()
        };
    }

    /// Один кадр: x — вход, frame — номер кадра. Вернёт сэмпл выхода и отчёт, когда замер окончен.
    pub fn tick(&mut self, x: f32, frame: u64) -> (f32, Option<RtlReport>) {
        let a = x.abs();
        if let Some(at) = self.waiting {
            if a > self.threshold {
                if (self.count as usize) < MAX_CLICKS {
                    self.delays[self.count as usize] = (frame - at) as u32;
                    self.count += 1;
                }
                self.waiting = None;
            } else if frame - at > u64::from(self.timeout) {
                self.misses = self.misses.saturating_add(1);
                self.waiting = None;
            }
        } else {
            self.noise += (a - self.noise) * 0.001;
        }
        let mut out = 0.0;
        if self.waiting.is_none() && frame >= self.next_at {
            if self.emitted < self.clicks {
                out = CLICK;
                self.threshold = (self.noise * 10.0).max(RTL_FLOOR);
                self.waiting = Some(frame);
                self.emitted += 1;
                self.next_at = frame + u64::from(self.interval);
            } else {
                self.active = false;
                return (0.0, Some(RtlReport { delays: self.delays, count: self.count, misses: self.misses }));
            }
        }
        (out, None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Петля с задержкой d кадров: вход кадра t — выход кадра t − d.
    fn run(d: usize, clicks: u16, noise: f32) -> RtlReport {
        let mut rtl = Rtl::default();
        rtl.start(clicks, 4800, 2400, 0);
        let mut line = vec![0.0f32; d];
        for frame in 0..10_000_000u64 {
            let i = frame as usize % d;
            let jitter = if frame % 2 == 0 { noise } else { -noise };
            let (out, report) = rtl.tick(line[i] + jitter, frame);
            line[i] = out;
            if let Some(r) = report {
                return r;
            }
        }
        panic!("замер не закончился");
    }

    #[test]
    fn delay_of_the_loop_exactly() {
        for d in [128, 256, 300, 911] {
            let r = run(d, 8, 0.0);
            assert_eq!((r.count, r.misses), (8, 0));
            assert!(r.delays().iter().all(|&v| v as usize == d), "{d}: {:?}", r.delays());
            assert_eq!(r.median(), Some(d as u32));
        }
    }

    #[test]
    fn threshold_above_background() {
        // фон 0.02 > пола: порог 10 × фон = 0.2, щелчок 0.5 проходит, фон — нет
        let r = run(300, 6, 0.02);
        assert_eq!((r.count, r.misses, r.median()), (6, 0, Some(300)));
    }

    #[test]
    fn silence_is_a_miss() {
        let mut rtl = Rtl::default();
        rtl.start(3, 1000, 500, 0);
        let mut report = None;
        for frame in 0..10_000u64 {
            if let (_, Some(r)) = rtl.tick(0.0, frame) {
                report = Some(r);
                break;
            }
        }
        let r = report.expect("отчёт");
        assert_eq!((r.count, r.misses, r.median()), (0, 3, None));
    }
}
