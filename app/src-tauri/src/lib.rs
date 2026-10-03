//! Sorted 메뉴 막대 앱.
//!
//! 시작하면 유닉스 소켓을 열어 중계 프로그램(native-host)의 메시지를 기다린다.
//! 앱이 꺼져 있던 동안 보관된 메시지는 시작할 때 한꺼번에 받는다 (FR-16).
//! 메뉴 막대 아이콘을 왼쪽 클릭하면 팝오버(FR-13)가 열리고, 오른쪽 클릭하면 메뉴가 열린다.
//! 창을 닫아도 앱은 메뉴 막대에 남는다. 종료는 메뉴의 "종료"로 한다.

mod inbox;

use std::error::Error;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use sorted_core::ipc::Server;
use sorted_core::paths::Paths;
use sorted_core::queue;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tauri_plugin_positioner::{Position, WindowExt};

use inbox::{Inbox, Received, Source};

const POPOVER: &str = "popover";

/// 팝오버가 포커스를 잃어 닫힌 시각.
/// 팝오버가 열린 채로 아이콘을 누르면 "포커스 잃음 → 닫힘 → 클릭 → 다시 열림"이 되므로,
/// 막 닫힌 직후의 클릭은 닫는 클릭으로 본다.
#[derive(Default)]
struct PopoverHiddenAt(Mutex<Option<Instant>>);

/// 화면이 처음 열릴 때 지금까지 받은 메시지를 가져간다.
#[tauri::command]
fn received_messages(inbox: State<'_, Inbox>) -> Vec<Received> {
    inbox.snapshot()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_positioner::init())
        .manage(Inbox::default())
        .manage(PopoverHiddenAt::default())
        .invoke_handler(tauri::generate_handler![received_messages])
        .setup(|app| {
            // Dock에 아이콘을 띄우지 않고 메뉴 막대에만 둔다.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            setup_tray(app.handle())?;
            start_listening(app.handle().clone())?;
            Ok(())
        })
        .on_window_event(|window, event| match event {
            // 창을 닫으면 숨기기만 한다.
            WindowEvent::CloseRequested { api, .. } => {
                let _ = window.hide();
                api.prevent_close();
            }
            // 팝오버는 다른 곳을 누르면 닫힌다.
            WindowEvent::Focused(false) if window.label() == POPOVER => {
                let _ = window.hide();
                *window.state::<PopoverHiddenAt>().0.lock().unwrap() = Some(Instant::now());
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("failed to run Sorted");
}

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "메시지 기록 (개발용)", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Sorted")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            // 팝오버를 아이콘 아래에 놓으려면 positioner가 아이콘 위치를 알아야 한다.
            tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_popover(tray.app_handle());
            }
        })
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

fn toggle_popover(app: &AppHandle) {
    let Some(window) = app.get_webview_window(POPOVER) else {
        return;
    };
    let hidden_at = app.state::<PopoverHiddenAt>().0.lock().unwrap().take();
    let just_hidden = hidden_at.is_some_and(|t| t.elapsed() < Duration::from_millis(300));
    if just_hidden || window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        return;
    }
    let _ = window.move_window(Position::TrayBottomCenter);
    let _ = window.show();
    let _ = window.set_focus();
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
