//! Sorted 앱.
//!
//! 시작하면 유닉스 소켓을 열어 중계 프로그램(native-host)의 메시지를 기다린다.
//! 앱이 꺼져 있던 동안 보관된 메시지는 시작할 때 한꺼번에 받는다 (FR-16).
//! Dock에 아이콘이 있는 보통 앱이다. 메인 창을 닫아도 다운로드를 계속 받도록 앱은 뒤에서 돌고,
//! Dock 아이콘을 누르면 창이 다시 열린다. 종료는 ⌘Q.

mod inbox;

use std::error::Error;
use std::thread;

use sorted_core::ipc::Server;
use sorted_core::paths::Paths;
use sorted_core::queue;
use tauri::menu::{Menu, MenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WindowEvent};

use inbox::{Inbox, Received, Source};

/// 메인 창. 과목·최근 변경·처리 못한 파일·휴지통 화면이 여기 뜬다.
const MAIN: &str = "main";
/// 개발용 메시지 기록 창. 앱 메뉴의 "개발 → 메시지 기록"에서 연다.
const LOG: &str = "log";

/// 화면이 처음 열릴 때 지금까지 받은 메시지를 가져간다.
#[tauri::command]
fn received_messages(inbox: State<'_, Inbox>) -> Vec<Received> {
    inbox.snapshot()
}

pub fn run() {
    let app = tauri::Builder::default()
        .manage(Inbox::default())
        .invoke_handler(tauri::generate_handler![received_messages])
        .menu(|app| {
            // macOS 기본 앱 메뉴(종료, 편집, 창 등)에 "개발" 메뉴만 더한다.
            let menu = Menu::default(app)?;
            let log = MenuItem::with_id(app, LOG, "메시지 기록", true, None::<&str>)?;
            menu.append(&Submenu::with_items(app, "개발", true, &[&log])?)?;
            Ok(menu)
        })
        .on_menu_event(|app, event| {
            if event.id() == LOG {
                show_window(app, LOG);
            }
        })
        .setup(|app| {
            start_listening(app.handle().clone())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // 메인 창과 메시지 기록 창은 닫아도 숨기기만 한다. 대화 창은 그대로 닫힌다.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == MAIN || window.label() == LOG {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to build Sorted");

    app.run(|app, event| {
        // Dock 아이콘을 누르면 숨겨 둔 메인 창을 다시 연다.
        #[cfg(target_os = "macos")]
        if let RunEvent::Reopen { .. } = event {
            show_window(app, MAIN);
        }
        #[cfg(not(target_os = "macos"))]
        let _ = (app, event);
    });
}

fn show_window(app: &AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.show();
        let _ = window.unminimize();
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
