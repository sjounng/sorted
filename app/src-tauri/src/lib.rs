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
mod schedule;
mod screen;
mod settings;
mod text;

use crate::text::tr;
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
use schedule::{Schedule, ScheduleStore};
use screen::{
    AssignChoice, AssignRequest, CourseDetail, DuplicateChoice, DuplicateNotice, Overview,
    Permission, SetupStatus, TrashedCourse,
};
use settings::{Settings, SettingsStore};
use text::Language;

/// 메인 창. 과목·일정·최근 변경·처리 못한 파일·휴지통 화면이 여기 뜬다.
const MAIN: &str = "main";
/// 개발용 메시지 기록 창. 앱 메뉴의 "개발 → 메시지 기록"에서 연다.
const LOG: &str = "log";

/// 스파이크 #3의 다운로드 기록 위치
struct ProbeHistory(PathBuf);

/// 첫 실행 설정을 끝냈다는 표시 파일 (FR-15). 없으면 앱을 켤 때 설정 창을 띄운다.
struct SetupMarker(PathBuf);

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
        .ok_or_else(|| tr("없는 과목이에요.", "This class doesn't exist."))
}

// 과목 추가·이름 바꾸기·Sorted 휴지통

#[tauri::command]
fn add_course(app: AppHandle, name: String) -> Result<screen::Course, String> {
    let course = app.state::<Organizer>().add_course(&name)?;
    changed(&app);
    Ok(course)
}

#[tauri::command]
fn rename_course(app: AppHandle, course_id: String, name: String) -> Result<(), String> {
    app.state::<Organizer>().rename_course(&course_id, &name)?;
    changed(&app);
    Ok(())
}

/// Sorted 휴지통으로. 파일·폴더는 그대로 둔다.
#[tauri::command]
fn remove_course(app: AppHandle, course_id: String) -> Result<(), String> {
    app.state::<Organizer>().remove_course(&course_id)?;
    changed(&app);
    Ok(())
}

#[tauri::command]
fn trash(organizer: State<'_, Organizer>) -> Vec<TrashedCourse> {
    organizer.trash()
}

#[tauri::command]
fn restore_course(app: AppHandle, course_id: String) -> Result<(), String> {
    app.state::<Organizer>().restore_course(&course_id)?;
    changed(&app);
    Ok(())
}

/// Sorted 휴지통에서 지운다. 과목 폴더는 macOS 휴지통으로 간다.
#[tauri::command]
fn purge_course(app: AppHandle, course_id: String) -> Result<(), String> {
    app.state::<Organizer>()
        .purge_course(&course_id, &move_to_trash)?;
    changed(&app);
    Ok(())
}

#[tauri::command]
fn empty_trash(app: AppHandle) -> Result<(), String> {
    let result = app.state::<Organizer>().empty_trash(&move_to_trash);
    changed(&app);
    result
}

/// 메인 창 데이터가 바뀌었다고 화면에 알린다
fn changed(app: &AppHandle) {
    let _ = app.emit("overview-changed", ());
}

// 설정 (이슈 #46)

#[tauri::command]
fn settings(store: State<'_, SettingsStore>) -> Settings {
    store.get()
}

/// 언어를 바꾼다. 앱 내부 문구와 열린 대화 창 제목이 바로 바뀌고, 화면에는 `settings-changed`로 알린다.
#[tauri::command]
fn set_language(app: AppHandle, language: Language) -> Settings {
    let settings = app.state::<SettingsStore>().set_language(language);
    for (label, window) in app.webview_windows() {
        if label == "setup" {
            let _ = window.set_title(&setup_title());
        } else if label.starts_with("duplicate-") {
            let _ = window.set_title(&duplicate_title());
        }
    }
    let _ = app.emit("settings-changed", &settings);
    settings
}

fn setup_title() -> String {
    tr("Sorted 시작하기", "Welcome to Sorted")
}

fn duplicate_title() -> String {
    tr("이미 받은 파일", "Already Downloaded")
}

// 일정 (FR-19)

#[tauri::command]
fn schedule(store: State<'_, ScheduleStore>) -> Schedule {
    store.schedule()
}

/// LMS 페이지를 기본 브라우저로 연다. 한양대 LMS 주소(https)만.
#[tauri::command]
fn open_in_browser(url: String) -> Result<(), String> {
    if !schedule::is_lms_url(&url) {
        return Err(tr(
            "LMS 주소만 열 수 있어요.",
            "Only LMS links can be opened.",
        ));
    }
    open([url])
}

// 중복 (FR-7)

#[tauri::command]
fn duplicate_notice(
    organizer: State<'_, Organizer>,
    id: String,
) -> Result<DuplicateNotice, String> {
    organizer.duplicate_notice(parse_id(&id)?).ok_or_else(|| {
        tr(
            "이미 처리했거나 모르는 중복이에요.",
            "This duplicate was already handled or is unknown.",
        )
    })
}

/// [기존 파일 열기]: 기존 파일을 열고 받은 복사본은 휴지통으로. [둘 다 보관]: 아무것도 지우지 않는다.
#[tauri::command]
fn resolve_duplicate(app: AppHandle, id: String, choice: DuplicateChoice) -> Result<(), String> {
    let organizer = app.state::<Organizer>();
    if let Some(existing) = organizer.resolve_duplicate(parse_id(&id)?, choice, &move_to_trash)? {
        open([existing.as_os_str()])?;
    }
    let _ = app.emit("overview-changed", ());
    Ok(())
}

/// macOS 휴지통으로 보낸다. Finder 자동화 대신 파일 API를 써서 자동화 권한 창이 뜨지 않는다.
fn move_to_trash(path: &Path) -> std::io::Result<()> {
    use ::trash::macos::{DeleteMethod, TrashContextExtMacos};
    let mut context = ::trash::TrashContext::default();
    context.set_delete_method(DeleteMethod::NsFileManager);
    context.delete(path).map_err(std::io::Error::other)
}

/// 중복 안내 창을 띄운다 (FR-7: 받은 직후 묻는다).
fn show_duplicate_window(app: &AppHandle, id: u64) {
    let query = format!("view=duplicate&id={id}");
    show_dialog(
        app,
        &format!("duplicate-{id}"),
        &query,
        &duplicate_title(),
        (420.0, 260.0),
    );
}

/// 첫 실행 설정 창을 띄운다 (FR-15).
fn show_setup_window(app: &AppHandle) {
    show_dialog(app, "setup", "view=setup", &setup_title(), (460.0, 640.0));
}

/// 설정 창이 열려 있으면 새로 고쳐 상태를 다시 불러오게 한다.
/// 설정 화면은 열 때와 권한 버튼을 누를 때만 상태를 불러오므로, 확장 연결·권한이 바뀌면 앱이 알려 준다.
fn refresh_setup_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("setup") {
        let _ = window.eval("location.reload()");
    }
}

/// 화면의 대화 창(`index.html?view=…`)을 띄운다. 같은 이름의 창이 이미 있으면 앞으로 가져온다.
/// 창 이름은 화면이 쓰는 규칙(`<화면>-<id>`)을 따른다 (src/windows.ts, capabilities).
fn show_dialog(app: &AppHandle, label: &str, query: &str, title: &str, size: (f64, f64)) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    let url = tauri::WebviewUrl::App(format!("index.html?{query}").into());
    let built = tauri::WebviewWindowBuilder::new(app, label, url)
        .title(title)
        .inner_size(size.0, size.1)
        .center()
        .focused(true)
        .build();
    if let Err(e) = built {
        eprintln!("{label} 창을 열지 못함: {e}");
    }
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
    let path = path.canonicalize().map_err(|_| {
        tr(
            "파일을 찾을 수 없어요. 옮겼거나 지웠을 수 있어요.",
            "Can't find the file. It may have been moved or deleted.",
        )
    })?;
    if path.starts_with(&root) {
        Ok(path)
    } else {
        Err(tr(
            "정리 폴더 밖의 파일은 열지 않아요.",
            "Files outside the Sorted folder can't be opened.",
        ))
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
    let status = SetupStatus {
        downloads_access: organizer.downloads_access(),
        sorted_folder: organizer.root().to_owned(),
        sorted_folder_created: organizer.root().is_dir(),
        extension_connected: app.state::<Inbox>().has_received(),
    };
    // 세 가지가 모두 되면 설정을 끝낸 것으로 본다. 다음부터는 앱을 켤 때 설정 창을 띄우지 않는다
    if status.downloads_access == Permission::Granted
        && status.sorted_folder_created
        && status.extension_connected
    {
        let marker = &app.state::<SetupMarker>().0;
        if !marker.exists() {
            if let Err(e) = std::fs::write(marker, b"") {
                eprintln!("설정 완료 표시를 남기지 못함: {e}");
            }
        }
    }
    status
}

// 과목 지정 (FR-5)

#[tauri::command]
fn assign_request(
    organizer: State<'_, Organizer>,
    file_id: String,
) -> Result<AssignRequest, String> {
    organizer
        .assign_request(parse_id(&file_id)?)
        .ok_or_else(|| {
            tr(
                "과목을 기다리는 파일이 아니에요.",
                "This file isn't waiting for a class.",
            )
        })
}

/// 고른 과목으로 정리한다. 정리되거나 이미 있는 파일이면 성공, 그 밖에는 이유를 돌려준다.
#[tauri::command]
fn assign_course(app: AppHandle, file_id: String, choice: AssignChoice) -> Result<(), String> {
    let id = parse_id(&file_id)?;
    let outcome = app.state::<Organizer>().assign(id, &choice)?;
    report(&app, id, &outcome);
    match outcome {
        Outcome::Organized { .. } | Outcome::Duplicate { .. } => Ok(()),
        Outcome::Missing { .. } => Err(tr(
            "파일이 다운로드 폴더에서 사라졌어요.",
            "The file is no longer in the Downloads folder.",
        )),
        Outcome::NeedsPermission { .. } => Err(tr(
            "다운로드 폴더를 읽을 권한이 없어요.",
            "Sorted can't read the Downloads folder.",
        )),
        Outcome::Error { message } => Err(message),
        other => Err(format!(
            "{}: {other:?}",
            tr("정리하지 못했어요", "Couldn't sort the file")
        )),
    }
}

#[tauri::command]
fn skip_assign(app: AppHandle, file_id: String) -> Result<(), String> {
    if app.state::<Organizer>().skip(parse_id(&file_id)?) {
        let _ = app.emit("overview-changed", ());
        Ok(())
    } else {
        Err(tr(
            "과목을 기다리는 파일이 아니에요.",
            "This file isn't waiting for a class.",
        ))
    }
}

/// 화면은 ID를 문자열로 다룬다 (docs/app-api.md). 보류 목록의 번호로 바꾼다.
fn parse_id(id: &str) -> Result<u64, String> {
    id.parse()
        .map_err(|_| format!("{}: {id}", tr("잘못된 파일 ID", "Invalid file ID")))
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
            reveal_in_finder,
            schedule,
            open_in_browser,
            duplicate_notice,
            resolve_duplicate,
            settings,
            set_language,
            add_course,
            rename_course,
            remove_course,
            trash,
            restore_course,
            purge_course,
            empty_trash
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
    // 언어부터 정한다: 이 뒤에 띄우는 창 제목과 문구가 이 언어를 따른다
    app.manage(SettingsStore::open(paths.data_dir().join("settings.json")));
    app.manage(ProbeHistory(paths.data_dir().join("probe-history.jsonl")));
    app.manage(ScheduleStore::open(paths.data_dir().join("schedule.json")));
    let marker = paths.data_dir().join("setup-done");
    let first_run = !marker.exists();
    app.manage(SetupMarker(marker));
    app.manage(Organizer::open(
        sorted_root_dir(),
        paths.data_dir().join("library.json"),
    )?);

    // 소켓을 먼저 연다. 그래야 보관함을 비우는 사이에 온 메시지가 다시 보관함에 남지 않는다.
    let server = Server::bind(&paths.socket())?;

    for line in queue::drain(&paths.queue())? {
        receive(&app, &line, Source::Queued);
    }

    if first_run {
        show_setup_window(&app);
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
        if item.message["type"] == "hello" {
            // 확장이 연결됐다: 열려 있는 설정 창의 "Chrome 확장 연결"을 갱신한다
            refresh_setup_window(app);
        }
        if item.is_download() {
            start_probe(app.clone(), item);
        } else if item.message["type"] == "schedule" {
            if let Err(e) = app.state::<ScheduleStore>().update(&item.message) {
                eprintln!("일정 메시지를 처리하지 못함: {e}");
            }
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
    match outcome {
        Outcome::Duplicate { .. } => show_duplicate_window(app, id),
        // 다운로드 폴더를 읽지 못했다: 설정 창에서 권한을 다시 묻는다 (FR-15)
        Outcome::NeedsPermission { .. } => show_setup_window(app),
        // 파일을 읽었다면 권한이 생긴 것일 수 있다
        _ => refresh_setup_window(app),
    }
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
