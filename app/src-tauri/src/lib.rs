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
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::thread;

use serde_json::json;
use sorted_core::ipc::Server;
use sorted_core::paths::Paths;
use sorted_core::queue;
use tauri::menu::{Menu, MenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WindowEvent};

use inbox::{Inbox, Received, Source};
use organizer::Organizer;
use pipeline::Outcome;
use screen::{AssignChoice, AssignRequest, CourseDetail, Overview, Permission, SetupStatus};

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

// 메인 창 (FR-13)

#[tauri::command]
fn overview(organizer: State<'_, Organizer>) -> Overview {
    organizer.overview()
}

#[tauri::command]
fn course_detail(
    organizer: State<'_, Organizer>,
    course_id: String,
) -> Result<CourseDetail, String> {
    organizer
        .course_detail(&course_id)
        .ok_or_else(|| "없는 과목이에요.".into())
}

// 파일 열기

/// PDF를 기본 앱(미리보기 등)으로 연다. 정리 폴더 안의 것만.
#[tauri::command]
fn open_file(organizer: State<'_, Organizer>, path: PathBuf) -> Result<(), String> {
    let path = inside(organizer.root(), &path)?;
    open([path.as_os_str()])
}

/// Finder에서 그 파일·폴더를 선택해 보여 준다. 정리 폴더 안의 것만.
#[tauri::command]
fn reveal_in_finder(organizer: State<'_, Organizer>, path: PathBuf) -> Result<(), String> {
    let path = inside(organizer.root(), &path)?;
    open([OsStr::new("-R"), path.as_os_str()])
}

/// `path`가 정리 폴더 안(정리 폴더 자신 포함)에 있으면 실제 경로를 돌려준다.
/// 화면이 넘긴 경로로 아무 파일이나 열지 않게 막는다.
fn inside(root: &Path, path: &Path) -> Result<PathBuf, String> {
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let path = path
        .canonicalize()
        .map_err(|_| "파일을 찾을 수 없어요. 옮겼거나 지웠을 수 있어요.".to_string())?;
    if path.starts_with(&root) {
        Ok(path)
    } else {
        Err("정리 폴더 밖의 파일은 열지 않아요.".into())
    }
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
    open(["x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders"])
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
fn open<S: AsRef<OsStr>>(args: impl IntoIterator<Item = S>) -> Result<(), String> {
    std::process::Command::new("open")
        .args(args)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

pub fn run() {
    let app = tauri::Builder::default()
        .manage(Inbox::default())
        .invoke_handler(tauri::generate_handler![
            received_messages,
            overview,
            course_detail,
            setup_status,
            request_downloads_access,
            open_system_settings,
            assign_request,
            assign_course,
            skip_assign,
            open_file,
            reveal_in_finder
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn only_paths_inside_the_sorted_folder() {
        let dir = std::env::temp_dir().join(format!("sorted-inside-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("Sorted/OS/1주차")).unwrap();
        fs::write(dir.join("Sorted/OS/1주차/a.pdf"), "x").unwrap();
        fs::write(dir.join("outside.pdf"), "x").unwrap();
        let root = dir.join("Sorted");

        assert!(inside(&root, &root).is_ok());
        assert!(inside(&root, &root.join("OS/1주차/a.pdf")).is_ok());
        assert!(inside(&root, &root.join("OS/../../outside.pdf")).is_err());
        assert!(inside(&root, &dir.join("outside.pdf")).is_err());
        assert!(inside(&root, &root.join("OS/없음.pdf")).is_err());
    }
}
