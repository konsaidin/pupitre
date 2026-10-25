// RT-гигиена (01-architecture §8.3): process() не выделяет память — ни в обычном периоде, ни с командами, ни во время
// замера задержки, ни при переполненной очереди событий (её никто не читает). Аллокатор теста паникует на аллокации
// внутри assert_no_alloc (только debug-сборка тестов).
use assert_no_alloc::{assert_no_alloc, AllocDisabler};
use pupitre_engine::graph::{graph, Command};

#[cfg(debug_assertions)]
#[global_allocator]
static ALLOC: AllocDisabler = AllocDisabler;

#[test]
fn process_does_not_allocate() {
    let (mut g, mut commands, _events, _tap) = graph(48000.0);
    let a: Vec<f32> = (0..256).map(|i| (i as f32 * 0.07).sin() * 0.5).collect();
    let b = vec![1.0f32; 256];
    let (mut l, mut r) = (vec![0.0f32; 256], vec![0.0f32; 256]);
    commands.push(Command::MonitorGain(0.8)).unwrap();
    commands.push(Command::Channel(-1)).unwrap();
    assert_no_alloc(|| {
        for i in 0..4000u32 {
            if i == 100 {
                let _ = commands.push(Command::StartRtl { clicks: 8, interval: 2400, timeout: 2000 });
            }
            if i == 2000 {
                let _ = commands.push(Command::Mute(true));
            }
            // очередь событий переполняется: пакеты метров теряются, звук идёт
            g.process(&a, &b, &mut l, &mut r);
        }
    });
    assert!(g.frames() == 4000 * 256);
}
