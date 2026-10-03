//! Sorted 앱.
//!
//! 시작하면 유닉스 소켓을 열어 중계 프로그램(native-host)의 메시지를 기다린다.
//! 앱이 꺼져 있던 동안 보관된 메시지는 시작할 때 한꺼번에 받는다 (FR-16).
//! Dock에 아이콘이 있는 보통 앱이다. 메인 창을 닫아도 다운로드를 계속 받도록 앱은 뒤에서 돌고,
//! Dock 아이콘을 누르면 창이 다시 열린다. 종료는 ⌘Q.

mod inbox;
mod organizer;
mod pipeline;
mod probe;
mod screen;

use std::error::Error;
use std::path::PathBuf;
use std::thread;

use serde_json::json;
use sorted_core::ipc::Server;
use sorted_core::paths::Paths;
use sorted_core::queue;
use tauri::menu::{Menu, MenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WindowEvent};

use inbox::{Inbox, Received, Source};
use organizer::{Organizer, Pending};
use pipeline::Outcome;
use screen::{AssignChoice, AssignRequest, Permission, SetupStatus};

/// 메인 창. 과목·일정·최근 변경·처리 못한 파일·휴지통 화면이 여기 뜬다.
const MAIN: &str = "main";
/// 개발용 메시지 기록 창. 앱 메뉴의 "개발 → 메시지 기록"에서 연다.
const LOG: &str = "log";

/// 스파이크 #3의 다운로드 기록 위치
struct ProbeHistory(PathBuf);

/// 화면이 처음 열릴 때 지금까지 받은 메시지를 가져간다.
#[tauri::command]
fn received_messages(inbox: State<'_, Inbox>) -> Vec<Received> {
    inbox.snapshot()
}

// ── 화면용 명령 (docs/app-api.md) ──

/// 사용자의 조치를 기다리는 다운로드 (과목 고르기, 권한 허용)
#[tauri::command]
fn pending_downloads(organizer: State<'_, Organizer>) -> Vec<Pending> {
    organizer.pending()
}

// 첫 실행 설정 (FR-15)

#[tauri::command]
fn setup_status(app: AppHandle) -> SetupStatus {
    status(&app)
}

/// 다운로드 폴더를 한 번 읽어 권한 창을 띄우고, 허용되면 권한 때문에 보류된 파일을 다시 정리한다.
/// 사용자가 권한 창에 답할 때까지 기다릴 수 있어서 화면이 멈추지 않게 따로 돈다 (async).
#[tauri::command]
async fn request_downloads_access(app: AppHandle) -> SetupStatus {
    let organizer = app.state::<Organizer>();
    if organizer.check_access(&downloads_dir()) == Permission::Granted {
        for (id, outcome) in organizer.retry_permission() {
            report(&app, id, &outcome);
        }
    }
    status(&app)
}

/// 시스템 설정의 "파일 및 폴더" 화면을 연다
#[tauri::command]
fn open_system_settings() -> Result<(), String> {
    open(&["x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders"])
}

fn status(app: &AppHandle) -> SetupStatus {
    let organizer = app.state::<Organizer>();
    SetupStatus {
        downloads_access: organizer.downloads_access(),
        sorted_folder: organizer.root().to_owned(),
        sorted_folder_created: organizer.root().is_dir(),
        extension_connected: app.state::<Inbox>().has_received(),
    }
}

// 과목 지정 (FR-5)

#[tauri::command]
fn assign_request(
    organizer: State<'_, Organizer>,
    file_id: String,
) -> Result<AssignRequest, String> {
    organizer
        .assign_request(parse_id(&file_id)?)
        .ok_or_else(|| "과목을 기다리는 파일이 아니에요.".into())
}

/// 고른 과목으로 정리한다. 정리되거나 이미 있는 파일이면 성공, 그 밖에는 이유를 돌려준다.
#[tauri::command]
fn assign_course(app: AppHandle, file_id: String, choice: AssignChoice) -> Result<(), String> {
    let id = parse_id(&file_id)?;
    let outcome = app.state::<Organizer>().assign(id, &choice)?;
    report(&app, id, &outcome);
    match outcome {
        Outcome::Organized { .. } | Outcome::Duplicate { .. } => Ok(()),
        Outcome::Missing { .. } => Err("파일이 다운로드 폴더에서 사라졌어요.".into()),
        Outcome::NeedsPermission { .. } => Err("다운로드 폴더를 읽을 권한이 없어요.".into()),
        Outcome::Error { message } => Err(message),
        other => Err(format!("정리하지 못했어요: {other:?}")),
    }
}

#[tauri::command]
fn skip_assign(app: AppHandle, file_id: String) -> Result<(), String> {
    if app.state::<Organizer>().skip(parse_id(&file_id)?) {
        let _ = app.emit("overview-changed", ());
        Ok(())
    } else {
        Err("과목을 기다리는 파일이 아니에요.".into())
    }
}

/// 화면은 ID를 문자열로 다룬다 (docs/app-api.md). 보류 목록의 번호로 바꾼다.
fn parse_id(id: &str) -> Result<u64, String> {
    id.parse().map_err(|_| format!("잘못된 파일 ID: {id}"))
}

fn downloads_dir() -> PathBuf {
    home().join("Downloads")
}

fn home() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_default()
}

/// macOS `open`으로 연다 (시스템 설정, Finder 등)
fn open(args: &[&str]) -> Result<(), String> {
    std::process::Command::new("open")
        .args(args)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn library(organizer: State<'_, Organizer>) -> sorted_core::library::Library {
    organizer.library()
}

#[tauri::command]
fn sorted_root(organizer: State<'_, Organizer>) -> PathBuf {
    organizer.root().to_owned()
}

pub fn run() {
    let app = tauri::Builder::default()
        .manage(Inbox::default())
        .invoke_handler(tauri::generate_handler![
            received_messages,
            pending_downloads,
            setup_status,
            request_downloads_access,
            open_system_settings,
            assign_request,
            assign_course,
            skip_assign,
            library,
            sorted_root
        ])
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
    app.manage(ProbeHistory(paths.data_dir().join("probe-history.jsonl")));
    app.manage(Organizer::open(
        sorted_root_dir(),
        paths.data_dir().join("library.json"),
    )?);

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
        if item.is_download() {
            start_probe(app.clone(), item);
        }
    }
    reply
}

/// 정리 폴더. 테스트·개발 중에는 SORTED_ROOT로 바꿀 수 있다. 기본은 ~/Sorted
fn sorted_root_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("SORTED_ROOT") {
        return dir.into();
    }
    home().join("Sorted")
}

/// 다운로드 메시지는 따로 돌린다: 스파이크 확인(probe) → 정리(pipeline). 끝나면 화면에 알린다.
/// 확인이 먼저다. 정리가 파일을 옮기므로 순서가 바뀌면 확인할 파일이 없다.
fn start_probe(app: AppHandle, item: Received) {
    thread::spawn(move || {
        let history = app.state::<ProbeHistory>().0.clone();
        let result = match probe::run(&item.message, &history) {
            Ok(p) => serde_json::to_value(p).unwrap_or_else(|e| json!({ "error": e.to_string() })),
            Err(e) => json!({ "error": e }),
        };
        if let Some(updated) = app.state::<Inbox>().set_probe(item.id, result) {
            let _ = app.emit("native-message", &updated);
        }

        let outcome = app
            .state::<Organizer>()
            .handle(item.id, &item.message, None);
        report(&app, item.id, &outcome);
    });
}

/// 정리 결과를 기록하고 화면에 알린다.
fn report(app: &AppHandle, id: u64, outcome: &Outcome) {
    let value = serde_json::to_value(outcome)
        .unwrap_or_else(|e| json!({ "kind": "error", "message": e.to_string() }));
    if let Some(updated) = app.state::<Inbox>().set_outcome(id, value) {
        let _ = app.emit("native-message", &updated);
    }
    let _ = app.emit(
        "download-processed",
        json!({ "id": id, "outcome": outcome }),
    );
    let _ = app.emit("overview-changed", ());
}
