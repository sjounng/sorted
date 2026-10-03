//! 정리 흐름(pipeline)에 상태를 붙인다: 강의자료 목록 저장, 사용자 조치를 기다리는 보류 목록,
//! 다운로드 폴더 권한 상태.
//! Tauri에 의존하지 않는다. 화면과 주고받는 명령은 lib.rs에 있다 (docs/app-api.md).

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;
use sorted_core::library::Library;

use crate::pipeline::{self, Download, Outcome, Settings};
use crate::screen::{self, AssignChoice, AssignRequest, Permission};

/// 사용자의 조치를 기다리는 다운로드 (과목 고르기, 권한 허용)
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Pending {
    /// 받은 메시지 번호 (inbox의 id)
    pub id: u64,
    pub outcome: Outcome,
    /// 보류 목록에 들어간 시각
    pub at_ms: u64,
    #[serde(skip)]
    message: Value,
}

pub struct Organizer {
    settings: Settings,
    library_file: PathBuf,
    library: Mutex<Library>,
    pending: Mutex<Vec<Pending>>,
    /// 마지막으로 다운로드 폴더의 파일을 읽어 봤을 때의 결과.
    /// macOS는 권한 창을 띄우지 않고 상태만 물어볼 방법이 없어서, 실제로 읽어 본 결과를 기억한다.
    downloads_access: Mutex<Permission>,
}

impl Organizer {
    /// 정리 폴더를 만들고(FR-15) 강의자료 목록을 읽는다.
    /// 목록 파일이 깨져 있으면 옆에 백업해 두고 빈 목록으로 시작한다 (덮어써서 잃지 않게).
    pub fn open(root: PathBuf, library_file: PathBuf) -> io::Result<Self> {
        fs::create_dir_all(&root)?;
        let library = match Library::load(&library_file) {
            Ok(lib) => lib,
            Err(e) if e.kind() == io::ErrorKind::InvalidData => {
                let backup = library_file.with_extension(format!("broken-{}.json", now_ms()));
                fs::rename(&library_file, &backup)?;
                eprintln!(
                    "library.json이 깨져 {} 로 옮기고 새로 시작합니다",
                    backup.display()
                );
                Library::default()
            }
            Err(e) => return Err(e),
        };
        Ok(Self {
            settings: Settings { root },
            library_file,
            library: Mutex::new(library),
            pending: Mutex::new(Vec::new()),
            downloads_access: Mutex::new(Permission::Unknown),
        })
    }

    pub fn root(&self) -> &Path {
        &self.settings.root
    }

    /// 다운로드 메시지 하나를 처리한다. 결과가 보류면 보류 목록에 두고, 아니면 목록에서 뺀다.
    pub fn handle(&self, id: u64, message: &Value, course_override: Option<&str>) -> Outcome {
        let outcome = match serde_json::from_value::<Download>(message.clone()) {
            Ok(dl) => {
                let mut lib = self.library.lock().unwrap_or_else(|e| e.into_inner());
                let outcome = pipeline::process(
                    &dl,
                    &self.settings,
                    &mut lib,
                    course_override,
                    &crate::probe::first_page_text_opt,
                );
                if let Err(e) = lib.save(&self.library_file) {
                    eprintln!("library.json 저장 실패: {e}");
                }
                outcome
            }
            Err(e) => Outcome::Error {
                message: format!("다운로드 메시지를 읽지 못함: {e}"),
            },
        };

        // 정리 흐름은 파일부터 읽는다. 읽기에 실패한 경우가 아니면 권한이 있다는 뜻이다.
        match outcome {
            Outcome::NeedsPermission { .. } => self.set_downloads_access(Permission::Denied),
            Outcome::Missing { .. } | Outcome::Error { .. } => {}
            _ => self.set_downloads_access(Permission::Granted),
        }

        let mut pending = self.pending.lock().unwrap_or_else(|e| e.into_inner());
        let at_ms = pending
            .iter()
            .find(|p| p.id == id)
            .map_or_else(now_ms, |p| p.at_ms);
        pending.retain(|p| p.id != id);
        if outcome.is_pending() {
            pending.push(Pending {
                id,
                outcome: outcome.clone(),
                at_ms,
                message: message.clone(),
            });
        }
        outcome
    }

    pub fn downloads_access(&self) -> Permission {
        *self
            .downloads_access
            .lock()
            .unwrap_or_else(|e| e.into_inner())
    }

    fn set_downloads_access(&self, permission: Permission) {
        *self
            .downloads_access
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = permission;
    }

    /// 다운로드 폴더를 한 번 읽어 본다. 처음이면 macOS가 권한 창을 띄우고, 답할 때까지 기다린다 (FR-15).
    pub fn check_access(&self, downloads: &Path) -> Permission {
        let permission = match fs::read_dir(downloads) {
            Ok(_) => Permission::Granted,
            Err(e) if e.kind() == io::ErrorKind::PermissionDenied => Permission::Denied,
            Err(_) => return self.downloads_access(),
        };
        self.set_downloads_access(permission);
        permission
    }

    pub fn pending(&self) -> Vec<Pending> {
        self.pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// 과목 지정 창에 보여 줄 것 (FR-5). 과목을 기다리는 파일이 아니면 None.
    pub fn assign_request(&self, id: u64) -> Option<AssignRequest> {
        let p = self.waiting_for_course(id)?;
        let file_name = match &p.outcome {
            Outcome::NeedsCourse { path } => path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
            _ => return None,
        };
        let tab_title = p.message["tab"]["title"].as_str().map(str::to_owned);
        Some(AssignRequest {
            file_id: id.to_string(),
            file_name,
            tab_title,
            at_ms: p.at_ms,
            courses: screen::courses(&self.library()),
        })
    }

    /// 사용자가 과목을 골랐다 (FR-5). 고른 과목으로 다시 정리하고, 이후 같은 과목은 기억한다.
    pub fn assign(&self, id: u64, choice: &AssignChoice) -> Result<Outcome, String> {
        let p = self
            .waiting_for_course(id)
            .ok_or("과목을 기다리는 파일이 아니에요.")?;
        let course_name = {
            let lib = self.library.lock().unwrap_or_else(|e| e.into_inner());
            match choice {
                AssignChoice::Existing { course_id } => lib
                    .course_by_id(course_id)
                    .map(|c| c.name.clone())
                    .ok_or("없는 과목이에요.")?,
                AssignChoice::New { new_course_name } => {
                    if let Some(problem) = screen::course_name_problem(new_course_name, &lib) {
                        return Err(problem.into());
                    }
                    new_course_name.trim().to_owned()
                }
            }
        };
        Ok(self.handle(id, &p.message, Some(&course_name)))
    }

    /// 과목을 정하지 않고 다운로드 폴더에 그대로 둔다 (FR-5). 보류 목록에서만 뺀다.
    pub fn skip(&self, id: u64) -> bool {
        let mut pending = self.pending.lock().unwrap_or_else(|e| e.into_inner());
        let before = pending.len();
        pending.retain(|p| !(p.id == id && matches!(p.outcome, Outcome::NeedsCourse { .. })));
        pending.len() != before
    }

    /// 권한을 허용한 뒤 다시 시도한다 (FR-15). 권한 때문에 보류된 것만.
    pub fn retry_permission(&self) -> Vec<(u64, Outcome)> {
        let waiting: Vec<(u64, Value)> = self
            .pending()
            .into_iter()
            .filter(|p| matches!(p.outcome, Outcome::NeedsPermission { .. }))
            .map(|p| (p.id, p.message))
            .collect();
        waiting
            .into_iter()
            .map(|(id, msg)| (id, self.handle(id, &msg, None)))
            .collect()
    }

    pub fn library(&self) -> Library {
        self.library
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    fn waiting_for_course(&self, id: u64) -> Option<Pending> {
        self.pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .find(|p| p.id == id && matches!(p.outcome, Outcome::NeedsCourse { .. }))
            .cloned()
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn setup(name: &str) -> (PathBuf, Organizer) {
        let dir = std::env::temp_dir().join(format!("sorted-orgz-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("Downloads")).unwrap();
        let org = Organizer::open(dir.join("Sorted"), dir.join("library.json")).unwrap();
        (dir, org)
    }

    #[test]
    fn creates_root_and_persists_library() {
        let (dir, org) = setup("persist");
        assert!(dir.join("Sorted").is_dir());
        let file = dir.join("Downloads/a.pdf");
        fs::write(&file, "%PDF-1.7 x").unwrap();
        let msg = json!({
            "filename": file, "contentId": "c1",
            "lms": { "courseName": "운영체제", "week": { "name": "1주차" } }
        });
        assert!(matches!(
            org.handle(1, &msg, None),
            Outcome::Organized { .. }
        ));

        let reopened = Organizer::open(dir.join("Sorted"), dir.join("library.json")).unwrap();
        assert_eq!(reopened.library().documents.len(), 1);
    }

    #[test]
    fn pending_course_is_resolved_by_the_user() {
        let (dir, org) = setup("pending");
        let file = dir.join("Downloads/notes.pdf");
        fs::write(&file, "%PDF-1.7 x").unwrap();
        let msg = json!({ "filename": file });
        assert!(matches!(
            org.handle(7, &msg, None),
            Outcome::NeedsCourse { .. }
        ));
        assert_eq!(org.pending().len(), 1);

        let new = |name: &str| AssignChoice::New {
            new_course_name: name.into(),
        };
        assert!(org.assign(99, &new("운영체제")).is_err());
        assert!(org.assign(7, &new("a/b")).is_err());
        let out = org.assign(7, &new(" 운영체제 ")).unwrap();
        assert!(matches!(out, Outcome::Organized { ref course, .. } if course == "운영체제"));
        assert!(org.pending().is_empty());
        assert!(dir.join("Sorted/운영체제/미분류/notes.pdf").exists());
    }

    #[test]
    fn broken_library_is_backed_up_not_overwritten() {
        let dir = std::env::temp_dir().join(format!("sorted-orgz-{}-broken", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("library.json"), "{oops").unwrap();
        let org = Organizer::open(dir.join("Sorted"), dir.join("library.json")).unwrap();
        assert!(org.library().documents.is_empty());
        let backups = fs::read_dir(&dir)
            .unwrap()
            .filter(|e| {
                e.as_ref()
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .contains("broken")
            })
            .count();
        assert_eq!(backups, 1);
    }

    #[test]
    fn bad_message_is_an_error() {
        let (_, org) = setup("bad");
        assert!(matches!(
            org.handle(1, &json!({ "filename": 3 }), None),
            Outcome::Error { .. }
        ));
    }

    #[test]
    fn assign_request_shows_file_tab_title_and_courses() {
        let (dir, org) = setup("request");
        let known = dir.join("Downloads/k.pdf");
        fs::write(&known, "%PDF-1.7 k").unwrap();
        org.handle(
            1,
            &json!({ "filename": known, "contentId": "k",
                     "lms": { "courseName": "운영체제", "week": { "name": "1주차" } } }),
            None,
        );
        let file = dir.join("Downloads/notes.pdf");
        fs::write(&file, "%PDF-1.7 x").unwrap();
        org.handle(
            2,
            &json!({ "filename": file, "tab": { "title": "강의 노트" } }),
            None,
        );

        let req = org.assign_request(2).unwrap();
        assert_eq!(req.file_id, "2");
        assert_eq!(req.file_name, "notes.pdf");
        assert_eq!(req.tab_title.as_deref(), Some("강의 노트"));
        assert_eq!(req.courses.len(), 1);
        assert!(org.assign_request(1).is_none());

        // 있는 과목을 ID로 고른다
        let id = req.courses[0].id.clone();
        let out = org
            .assign(2, &AssignChoice::Existing { course_id: id })
            .unwrap();
        assert!(matches!(out, Outcome::Organized { ref course, .. } if course == "운영체제"));
        assert!(org
            .assign(
                2,
                &AssignChoice::Existing {
                    course_id: "x".into()
                }
            )
            .is_err());
    }

    #[test]
    fn skip_leaves_the_file_and_clears_the_entry() {
        let (dir, org) = setup("skip");
        let file = dir.join("Downloads/notes.pdf");
        fs::write(&file, "%PDF-1.7 x").unwrap();
        org.handle(3, &json!({ "filename": file }), None);
        assert!(org.skip(3));
        assert!(!org.skip(3));
        assert!(org.pending().is_empty());
        assert!(file.exists());
    }

    #[test]
    fn downloads_access_follows_what_reading_showed() {
        use std::os::unix::fs::PermissionsExt;
        let (dir, org) = setup("access");
        assert_eq!(org.downloads_access(), Permission::Unknown);

        let locked = dir.join("Downloads/locked.pdf");
        fs::write(&locked, "%PDF-1.7 x").unwrap();
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).unwrap();
        assert!(matches!(
            org.handle(1, &json!({ "filename": locked }), None),
            Outcome::NeedsPermission { .. }
        ));
        assert_eq!(org.downloads_access(), Permission::Denied);

        fs::set_permissions(&locked, fs::Permissions::from_mode(0o600)).unwrap();
        assert_eq!(
            org.check_access(&dir.join("Downloads")),
            Permission::Granted
        );
        let retried = org.retry_permission();
        assert_eq!(retried.len(), 1);
        assert!(!matches!(retried[0].1, Outcome::NeedsPermission { .. }));

        // 없는 폴더는 상태를 바꾸지 않는다
        assert_eq!(org.check_access(&dir.join("nope")), Permission::Granted);
    }
}
