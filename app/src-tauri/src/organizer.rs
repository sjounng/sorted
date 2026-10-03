//! 정리 흐름(pipeline)에 상태를 붙인다: 강의자료 목록 저장, 사용자 조치를 기다리는 보류 목록.
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

/// 사용자의 조치를 기다리는 다운로드 (과목 고르기, 권한 허용)
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Pending {
    /// 받은 메시지 번호 (inbox의 id)
    pub id: u64,
    pub outcome: Outcome,
    #[serde(skip)]
    message: Value,
}

pub struct Organizer {
    settings: Settings,
    library_file: PathBuf,
    library: Mutex<Library>,
    pending: Mutex<Vec<Pending>>,
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

        let mut pending = self.pending.lock().unwrap_or_else(|e| e.into_inner());
        pending.retain(|p| p.id != id);
        if outcome.is_pending() {
            pending.push(Pending {
                id,
                outcome: outcome.clone(),
                message: message.clone(),
            });
        }
        outcome
    }

    pub fn pending(&self) -> Vec<Pending> {
        self.pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// 사용자가 과목을 골랐다 (FR-5). 보류 목록에 없는 id면 None.
    pub fn assign_course(&self, id: u64, course_name: &str) -> Option<Outcome> {
        let message = self.pending_message(id)?;
        Some(self.handle(id, &message, Some(course_name)))
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

    fn pending_message(&self, id: u64) -> Option<Value> {
        self.pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .find(|p| p.id == id)
            .map(|p| p.message.clone())
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

        assert!(org.assign_course(99, "운영체제").is_none());
        let out = org.assign_course(7, "운영체제").unwrap();
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
}
