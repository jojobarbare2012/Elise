#[cfg_attr(mobile, tauri::mobile_entry_point)]


use tauri::{Emitter, Manager};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use std::sync::{
    Mutex,
    Arc,
    atomic::{AtomicBool, Ordering},
};




struct LauncherProcess(Mutex<Option<CommandChild>>);



pub fn run() {
    let fermeture_lancee = Arc::new(AtomicBool::new(false));
    let nettoyage_termine = Arc::new(AtomicBool::new(false));

    let fermeture_setup = fermeture_lancee.clone();
    let nettoyage_setup = nettoyage_termine.clone();
    let nettoyage_stdout = nettoyage_termine.clone();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())

        .setup(move |app| {

            let shell = app.shell();

            let (mut rx, child) = shell
                .command(
                    r"C:\Users\Jonathan\Desktop\EliseV0\.venv_tts\Scripts\python.exe"
                )
                .args([
                    "-u",
                    r"C:\Users\Jonathan\Desktop\EliseV0\launcher.py"
                ])
                .spawn()
                .expect("Impossible de lancer launcher.py");


            // On garde le processus Python pour pouvoir lui parler plus tard
            app.manage(
                LauncherProcess(
                    Mutex::new(Some(child))
                )
            );
            let window = app
    .get_webview_window("main")
    .expect("Fenêtre principale introuvable");

let fermeture_close = fermeture_setup.clone();
let nettoyage_close = nettoyage_setup.clone();

window.on_window_event(move |event| {
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {

        // Tant que Python n'a pas confirmé son nettoyage,
        // on interdit à Tauri de mourir.
        if !nettoyage_close.load(Ordering::SeqCst) {
            api.prevent_close();

            // Une seule demande de shutdown.
            if !fermeture_close.swap(true, Ordering::SeqCst) {

                println!("Demande d'arrêt du launcher Python...");

                match std::fs::write(
                    r"C:\Users\Jonathan\Desktop\EliseV0\data\shutdown.flag",
                    "STOP"
                ) {
                    Ok(_) => {
                        println!("Signal shutdown créé.");
                    }

                    Err(erreur) => {
                        println!(
                            "Impossible de créer shutdown.flag : {}",
                            erreur
                        );
                    }
                }
            }
        }
    }
});
            let window = app
    .get_webview_window("main")
    .expect("Fenêtre principale introuvable");

let fermeture_close = fermeture_setup.clone();
let nettoyage_close = nettoyage_setup.clone();


            // Lecture du stdout du launcher
            let app_handle = app.handle().clone();

            tauri::async_runtime::spawn(async move {

                while let Some(event) = rx.recv().await {

                    if let CommandEvent::Stdout(line) = event {

                        let texte = String::from_utf8_lossy(&line);

                        println!("PYTHON STDOUT: {}", texte);
                        if texte.trim() == "[SHUTDOWN] READY" {
    println!("Launcher Python nettoyé.");

    nettoyage_stdout.store(true, Ordering::SeqCst);

    if let Some(window) =
        app_handle.get_webview_window("main")
    {
        let _ = window.destroy();
    }

    app_handle.exit(0);

    continue;
}

                        if let Some(message) = texte.strip_prefix("[SETUP] ") {

                            let _ = app_handle.emit(
                                "setup-status",
                                message.trim().to_string()
                            );
                        }
                    }
                }
            });


            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }


            Ok(())
        })

        // On construit l'application sans encore la lancer
        .build(tauri::generate_context!())
        .expect("error while building tauri application");


app.run(|_, _| {});
}