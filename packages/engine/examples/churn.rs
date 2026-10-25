// Нагрузка уведомлениями: клиент JACK открывается и закрывается по кругу — у остальных клиентов срабатывает
// client_registration (как при появлении и уходе потоков Firefox, EasyEffects). cargo run --example churn -- <секунды>
use std::time::{Duration, Instant};

fn main() {
    let secs: u64 = std::env::args().nth(1).and_then(|s| s.parse().ok()).unwrap_or(30);
    let until = Instant::now() + Duration::from_secs(secs);
    let mut n = 0u32;
    while Instant::now() < until {
        if let Ok((client, _)) = jack::Client::new("Churn", jack::ClientOptions::NO_START_SERVER) {
            let _port = client.register_port("x", jack::AudioIn::default());
            drop(client);
            n += 1;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    println!("CHURN {n}");
}
