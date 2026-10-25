// Устройства JACK, как их видит движок: cargo run --example ports (с PKG_CONFIG_PATH на .jack-shim — см. build.mjs).
fn main() {
    match pupitre_engine::io::jack::list_devices() {
        Ok((capture, playback)) => {
            println!("захват:");
            for d in capture {
                println!("  {} — {:?}", d.id, d.ports);
            }
            println!("воспроизведение:");
            for d in playback {
                println!("  {} — {:?}", d.id, d.ports);
            }
        }
        Err(e) => println!("{e}"),
    }
}
