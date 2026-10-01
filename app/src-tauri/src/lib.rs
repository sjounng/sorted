//! Sorted 메뉴 막대 앱.
//!
//! 시작하면 유닉스 소켓을 열어 중계 프로그램(native-host)의 메시지를 기다린다.
//! 앱이 꺼져 있던 동안 보관된 메시지는 시작할 때 한꺼번에 받는다 (FR-16).
//! 창을 닫아도 앱은 메뉴 막대에 남는다. 종료는 메뉴 막대 아이콘의 "종료"로 한다.

mod inbox;

use std::error::Error;
use std::thread;

use sorted_core::ipc::Server;
use sorted_core::paths::Paths;
use sorted_core::queue;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};

use inbox::{Inbox, Received, Source};

/// 화면이 처음 열릴 때 지금까지 받은 메시지를 가져간다.
#[tauri::command]
fn received_messages(inbox: State<'_, Inbox>) -> Vec<Received> {
    inbox.snapshot()
}

pub fn run() {
    tauri::Builder::default()
        .manage(Inbox::default())
        .invoke_handler(tauri::generate_handler![received_messages])
        .setup(|app| {
            // Dock에 아이콘을 띄우지 않고 메뉴 막대에만 둔다.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            setup_tray(app.handle())?;
            start_listening(app.handle().clone())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // 창을 닫으면 숨기기만 한다.
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run Sorted");
}

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Sorted 열기", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Sorted")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// 소켓을 열고, 보관된 메시지를 처리한 뒤, 새 메시지를 계속 받는다.
fn start_listening(app: AppHandle) -> Result<(), Box<dyn Error>> {
    let paths = Paths::from_env();
    paths.ensure_data_dir()?;

    // 소켓을 먼저 연다. 그래야 보관함을 비우는 사이에 온 메시지가 다시 보관함에 남지 않는다.
    let server = Server::bind(&paths.socket())?;

    for line in queue::drain(&paths.queue())? {
        receive(&app, &line, Source::Queued);
    }

    thread::spawn(move || {
        server.serve(move |line| {
            let reply = receive(&app, line, Source::Live);
            serde_json::to_vec(&reply).unwrap_or_else(|_| br#"{"ok":false}"#.to_vec())
        })
    });
    Ok(())
}

fn receive(app: &AppHandle, line: &[u8], source: Source) -> serde_json::Value {
    let (reply, item) = app.state::<Inbox>().handle(line, source);
    if let Some(item) = item {
        let _ = app.emit("native-message", &item);
    }
    reply
}
