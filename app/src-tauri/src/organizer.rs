//! 정리 흐름(pipeline)에 상태를 붙인다: 강의자료 목록 저장, 사용자 조치를 기다리는 보류 목록,
//! 다운로드 폴더 권한 상태, 최근 변경 기록(history.json), 처리하지 못한 파일.
//! Tauri에 의존하지 않는다. 화면과 주고받는 명령은 lib.rs에 있다 (docs/app-api.md).

use crate::text::tr;
use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sorted_core::filetag::{self, Tag};
use sorted_core::library::{AnnotatedCopy, DocKey, Document, Library, Version};

use crate::pipeline::{self, Download, Outcome, Settings};
use crate::screen::{
    self, AssignChoice, AssignRequest, Change, ChangeKind, CourseDetail, DuplicateChoice,
    DuplicateNotice, Overview, Permission, TrashedCourse, Unprocessed, UnprocessedReason,
};
use sorted_core::fingerprint;

/// 중복으로 판정된 다운로드 하나 (FR-7). 사용자가 고를 때까지 기억한다 (앱이 켜져 있는 동안).
#[derive(Debug, Clone)]
struct Duplicate {
    id: u64,
    /// 방금 받은 파일 (다운로드 폴더)
    downloaded: PathBuf,
    /// 같은 내용을 가진 기존 버전. 경로가 아니라 문서·버전으로 기억해 옮겨도 찾는다 (FR-14)
    doc_id: String,
    version: u32,
}

/// history.json에 남기는 최근 변경 수
const KEEP_CHANGES: usize = 200;
/// 사라진 파일(missing)이 있을 때 정리 폴더를 다시 훑는 간격. 사용자가 다시 넣으면 이만큼 안에 보인다
const RESCAN_MISSING: Duration = Duration::from_secs(10);
/// 기억하는 "처리하지 못한 파일" 수
const KEEP_FAILURES: usize = 50;

/// history.json 내용
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct History {
    next_id: u64,
    /// 오래된 것부터
    changes: Vec<Change>,
}

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
    history_file: PathBuf,
    /// 받은 그대로의 PDF 사본: originals/<sha256>.pdf (필기와 상관없이 원본끼리 비교·보기용)
    originals_dir: PathBuf,
    /// "원본 열기"로 연 임시 사본: <정리 폴더>/.sorted-opened/<sha256>/<파일 이름>.
    /// 필기하면 주차 폴더로 옮겨 필기본이 된다. 앱 데이터 폴더(~/Library) 안에 두면 미리보기가
    /// 제자리에 저장하지 못하고 "복사본"을 만들게 해서, 정리 폴더 안의 숨김 폴더에 둔다
    /// (숨김 폴더는 파일 추적·과목 목록에서 건너뛴다)
    opened_dir: PathBuf,
    history: Mutex<History>,
    /// PDF가 아님·로그인 만료·옮기기 실패. 과목을 기다리는 파일은 보류 목록에 있다
    failures: Mutex<Vec<Unprocessed>>,
    /// 마지막으로 정리 폴더를 훑은 때. 앱을 켠 뒤 처음이면 None
    last_scan: Mutex<Option<Instant>>,
    duplicates: Mutex<Vec<Duplicate>>,
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
        let history_file = library_file.with_file_name("history.json");
        let originals_dir = library_file.with_file_name("originals");
        let opened_dir = root.join(".sorted-opened");
        let history = load_history(&history_file);
        let organizer = Self {
            settings: Settings { root },
            library_file,
            library: Mutex::new(library),
            pending: Mutex::new(Vec::new()),
            downloads_access: Mutex::new(Permission::Unknown),
            history_file,
            originals_dir,
            opened_dir,
            history: Mutex::new(history),
            failures: Mutex::new(Vec::new()),
            last_scan: Mutex::new(None),
            duplicates: Mutex::new(Vec::new()),
        };
        // 이 기능(FR-14) 전에 정리된 파일에도 속성을 붙인다
        organizer.tag_untagged();
        // 이 기능 전에 정리된 파일도 아직 필기 전이면 원본을 남긴다
        organizer.keep_missing_originals();
        Ok(organizer)
    }

    /// 정리 폴더에 있는 파일 중 속성이 없거나 다른 것에 속성을 붙인다. 붙인 수를 돌려준다.
    pub fn tag_untagged(&self) -> usize {
        let lib = self.library.lock().unwrap_or_else(|e| e.into_inner());
        let mut count = 0;
        for doc in &lib.documents {
            for version in &doc.versions {
                let files = std::iter::once((&version.path, None))
                    .chain(version.copies.iter().map(|c| (&c.path, Some(c.number))));
                for (path, copy) in files {
                    let tag = tag_of(&lib, doc, version, copy);
                    if path.is_file() && filetag::read(path).as_ref() != Some(&tag) {
                        match filetag::write(path, &tag) {
                            Ok(()) => count += 1,
                            Err(e) => eprintln!("속성을 붙이지 못함 {}: {e}", path.display()),
                        }
                    }
                }
            }
        }
        count
    }

    /// 목록의 경로에 없는 파일을 정리 폴더에서 속성으로 찾아 경로를 고친다 (FR-14).
    /// 찾은 파일이 문서의 최신 버전이고 `<과목>/<주차>/` 안에 있으면 목록의 과목·주차도 그 폴더를 따른다.
    /// 못 찾으면 `missing`으로 표시해 화면에서 숨기고(해시는 남김), 나중에 다시 넣으면 찾아 되살린다.
    ///
    /// 훑는 때: 있어야 할 파일이 없을 때, 또는 missing이 있고 마지막으로 훑은 지 10초가 지났을 때.
    /// 그 밖에는 훑지 않는다. 무엇이든 고쳤으면 true.
    pub fn locate(&self) -> bool {
        let mut lib = self.library.lock().unwrap_or_else(|e| e.into_inner());
        let versions = || lib.documents.iter().flat_map(|d| &d.versions);
        let copies = || versions().flat_map(|v| &v.copies);
        let lost = versions().any(|v| !v.missing && !v.path.is_file())
            || copies().any(|c| !c.missing && !c.path.is_file());
        let has_missing = versions().any(|v| v.missing) || copies().any(|c| c.missing);
        let mut last_scan = self.last_scan.lock().unwrap_or_else(|e| e.into_inner());
        let due = has_missing && last_scan.is_none_or(|t| t.elapsed() >= RESCAN_MISSING);
        if !lost && !due {
            return false;
        }
        *last_scan = Some(Instant::now());
        drop(last_scan);

        let found = scan_tags(self.root());
        let mut changed = false;
        let mut new_courses = Vec::new();
        for doc in &mut lib.documents {
            let doc_id = doc.key.id();
            let latest = doc.versions.iter().map(|v| v.number).max();
            for version in &mut doc.versions {
                // 필기본은 경로만 따라간다 (과목·주차는 받은 파일을 따른다)
                for copy in &mut version.copies {
                    let now_missing = if copy.path.is_file() {
                        false
                    } else if let Some(path) =
                        found.get(&(doc_id.clone(), version.number, Some(copy.number)))
                    {
                        copy.path = path.clone();
                        changed = true;
                        false
                    } else {
                        true
                    };
                    if copy.missing != now_missing {
                        copy.missing = now_missing;
                        changed = true;
                    }
                }
                if version.path.is_file() {
                    // 사라졌던 자리에 그대로 다시 넣은 경우
                    if version.missing {
                        version.missing = false;
                        changed = true;
                    }
                    continue;
                }
                let Some(path) = found.get(&(doc_id.clone(), version.number, None)) else {
                    if !version.missing {
                        version.missing = true;
                        changed = true;
                    }
                    continue;
                };
                version.path = path.clone();
                version.missing = false;
                changed = true;
                if Some(version.number) != latest {
                    continue;
                }
                // 사용자가 옮긴 폴더가 정답: <과목>/<주차>/파일 이면 그 과목·주차로
                if let Some((course, week)) = folder_of(self.root(), path) {
                    if let Some(week) = week {
                        doc.week = week;
                    }
                    if doc.course != course {
                        doc.course = course.clone();
                        new_courses.push(course);
                    }
                }
            }
        }
        for course in new_courses {
            lib.remember_course(None, &course, &[]);
        }
        if changed {
            if let Err(e) = lib.save(&self.library_file) {
                eprintln!("library.json 저장 실패: {e}");
            }
        }
        changed
    }

    /// 방금 정리한 파일에 속성을 붙인다 (FR-14). 실패해도 정리는 그대로 둔다.
    fn tag_file(&self, path: &Path) {
        let lib = self.library.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((doc, version)) = lib.version_at(path) {
            if let Err(e) = filetag::write(path, &tag_of(&lib, doc, version, None)) {
                eprintln!("속성을 붙이지 못함 {}: {e}", path.display());
            }
        }
    }

    pub fn root(&self) -> &Path {
        &self.settings.root
    }

    /// 다운로드 메시지 하나를 처리한다. 결과가 보류면 보류 목록에 두고, 아니면 목록에서 뺀다.
    pub fn handle(&self, id: u64, message: &Value, course_override: Option<&str>) -> Outcome {
        // 중복 판정이 옮긴 파일의 새 경로를 가리키도록 먼저 따라간다
        self.locate();
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
                message: format!(
                    "{}: {e}",
                    tr(
                        "다운로드 메시지를 읽지 못함",
                        "Couldn't read the download message"
                    )
                ),
            },
        };

        // 정리 흐름은 파일부터 읽는다. 읽기에 실패한 경우가 아니면 권한이 있다는 뜻이다.
        match outcome {
            Outcome::NeedsPermission { .. } => self.set_downloads_access(Permission::Denied),
            Outcome::Missing { .. } | Outcome::Error { .. } => {}
            _ => self.set_downloads_access(Permission::Granted),
        }

        self.record(id, message, &outcome);

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

    /// 정리 결과를 최근 변경이나 처리하지 못한 파일로 남긴다.
    fn record(&self, id: u64, message: &Value, outcome: &Outcome) {
        let failure = |reason| Unprocessed {
            id: id.to_string(),
            file_name: file_name_of(message),
            reason,
            at_ms: now_ms(),
        };
        let mut failures = self.failures.lock().unwrap_or_else(|e| e.into_inner());
        failures.retain(|f| f.id != id.to_string());
        match outcome {
            Outcome::Organized {
                path,
                version,
                restored,
                ..
            } => {
                self.tag_file(path);
                self.keep_original(path);
                // 사라졌던 버전을 다시 정리한 것은 새 버전이 아니다
                let kind = if *version > 1 && !restored {
                    ChangeKind::NewVersion
                } else {
                    ChangeKind::Organized
                };
                self.add_change(kind, path);
            }
            Outcome::Duplicate {
                existing,
                downloaded,
            } => {
                self.remember_duplicate(id, existing, downloaded);
                self.add_change(ChangeKind::Duplicate, existing);
            }
            Outcome::NotPdf { .. } => failures.push(failure(UnprocessedReason::NotPdf)),
            Outcome::LoginExpired { .. } => failures.push(failure(UnprocessedReason::LoginExpired)),
            Outcome::Error { .. } => failures.push(failure(UnprocessedReason::MoveFailed)),
            _ => {}
        }
        let overflow = failures.len().saturating_sub(KEEP_FAILURES);
        failures.drain(..overflow);
    }

    /// 정리 폴더의 `path`에 있는 문서로 최근 변경 한 줄을 더하고 history.json에 저장한다.
    fn add_change(&self, kind: ChangeKind, path: &Path) {
        let change = {
            let lib = self.library.lock().unwrap_or_else(|e| e.into_inner());
            let Some((doc, version)) = lib.version_at(path) else {
                return;
            };
            Change {
                id: String::new(),
                kind,
                document_id: doc.key.id(),
                course_id: lib
                    .courses
                    .iter()
                    .find(|c| c.name == doc.course)
                    .map(|c| c.id())
                    .unwrap_or_default(),
                course_name: doc.course.clone(),
                file_name: version
                    .path
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_else(|| doc.file_name.clone()),
                changed_pages: None,
                at_ms: now_ms(),
            }
        };
        let mut history = self.history.lock().unwrap_or_else(|e| e.into_inner());
        history.next_id += 1;
        let id = format!("c{}", history.next_id);
        history.changes.push(Change { id, ..change });
        let overflow = history.changes.len().saturating_sub(KEEP_CHANGES);
        history.changes.drain(..overflow);
        if let Err(e) = save_json(&self.history_file, &*history) {
            eprintln!("history.json 저장 실패: {e}");
        }
    }

    fn remember_duplicate(&self, id: u64, existing: &Path, downloaded: &Path) {
        let found = {
            let lib = self.library.lock().unwrap_or_else(|e| e.into_inner());
            lib.version_at(existing)
                .map(|(doc, version)| (doc.key.id(), version.number))
        };
        let Some((doc_id, version)) = found else {
            return;
        };
        let mut duplicates = self.duplicates.lock().unwrap_or_else(|e| e.into_inner());
        duplicates.retain(|d| d.id != id);
        duplicates.push(Duplicate {
            id,
            downloaded: downloaded.to_owned(),
            doc_id,
            version,
        });
    }

    fn duplicate(&self, id: u64) -> Option<Duplicate> {
        self.duplicates
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .find(|d| d.id == id)
            .cloned()
    }

    /// 중복 안내 창에 보여 줄 것 (FR-7). 기억하는 중복이 아니면 None.
    pub fn duplicate_notice(&self, id: u64) -> Option<DuplicateNotice> {
        let dup = self.duplicate(id)?;
        self.locate();
        let lib = self.library.lock().unwrap_or_else(|e| e.into_inner());
        let (doc, version) = lib.version_of(&dup.doc_id, dup.version)?;
        Some(DuplicateNotice {
            id: id.to_string(),
            file_name: dup
                .downloaded
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
            course_name: doc.course.clone(),
            week: doc.week.clone(),
            existing_path: version.path.clone(),
            existing_saved_at_ms: version.added_at_ms,
        })
    }

    /// 사용자가 중복 안내 창에서 골랐다 (FR-7).
    /// `OpenExisting`: 기존 파일 경로를 돌려주고(부른 쪽이 연다), 받은 복사본은 `trash`로 휴지통에 보낸다.
    /// 지우기 전에 받은 파일이 정리 폴더 밖에 있고 내용이 기존 버전과 같은지 다시 확인한다.
    /// `KeepBoth`: 아무것도 지우지 않는다. 어느 쪽이든 기억에서 뺀다.
    pub fn resolve_duplicate(
        &self,
        id: u64,
        choice: DuplicateChoice,
        trash: &dyn Fn(&Path) -> io::Result<()>,
    ) -> Result<Option<PathBuf>, String> {
        let dup = self.duplicate(id).ok_or_else(|| {
            tr(
                "이미 처리했거나 모르는 중복이에요.",
                "This duplicate was already handled or is unknown.",
            )
        })?;
        let forget = || {
            self.duplicates
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .retain(|d| d.id != id);
        };
        if choice == DuplicateChoice::KeepBoth {
            forget();
            return Ok(None);
        }

        self.locate();
        let (existing, sha256) = {
            let lib = self.library.lock().unwrap_or_else(|e| e.into_inner());
            let (_, version) = lib.version_of(&dup.doc_id, dup.version).ok_or_else(|| {
                tr(
                    "기존 파일 기록을 찾을 수 없어요.",
                    "Can't find the record of the existing file.",
                )
            })?;
            if version.missing {
                return Err(tr(
                    "기존 파일을 찾을 수 없어요. 옮겼거나 지웠을 수 있어요.",
                    "Can't find the existing file. It may have been moved or deleted.",
                ));
            }
            (version.path.clone(), version.sha256.clone())
        };
        // 받은 복사본을 지워도 되는지: 정리 폴더 밖이고, 지금도 기존 파일과 내용이 같아야 한다
        if dup.downloaded.starts_with(self.root()) {
            return Err(tr(
                "정리 폴더 안의 파일은 지우지 않아요.",
                "Files inside the Sorted folder are never deleted.",
            ));
        }
        match fingerprint::of_file(&dup.downloaded) {
            Ok(fp) if fp.sha256 == sha256 => {
                trash(&dup.downloaded).map_err(|e| {
                    format!(
                        "{}: {e}",
                        tr(
                            "휴지통으로 보내지 못했어요",
                            "Couldn't move it to the Trash"
                        )
                    )
                })?;
            }
            Ok(_) => {
                return Err(tr(
                    "받은 파일 내용이 바뀌어 지우지 않았어요.",
                    "The downloaded file has changed, so it wasn't deleted.",
                ))
            }
            // 이미 사용자가 치웠으면 지울 것이 없다
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}
            Err(e) => {
                return Err(format!(
                    "{}: {e}",
                    tr(
                        "받은 파일을 읽지 못했어요",
                        "Couldn't read the downloaded file"
                    )
                ))
            }
        }
        forget();
        Ok(Some(existing))
    }

    // ── 원본 보관·필기 감지 (#12, #13) ──

    /// 원본 사본 경로
    pub fn original_path(&self, sha256: &str) -> PathBuf {
        self.originals_dir.join(format!("{sha256}.pdf"))
    }

    /// 방금 정리한 파일의 원본 사본을 남긴다. 같은 내용의 사본이 이미 있으면 그대로.
    /// macOS(APFS)에서 fs::copy는 복제(clonefile)라, 필기로 바뀌기 전까지 디스크를 거의 쓰지 않는다.
    fn keep_original(&self, path: &Path) {
        let sha = {
            let lib = self.library.lock().unwrap_or_else(|e| e.into_inner());
            match lib.version_at(path) {
                Some((_, version)) => version.sha256.clone(),
                None => return,
            }
        };
        self.copy_original(path, &sha);
    }

    fn copy_original(&self, path: &Path, sha256: &str) {
        let dest = self.original_path(sha256);
        if dest.exists() {
            return;
        }
        let copied = fs::create_dir_all(&self.originals_dir).and_then(|()| fs::copy(path, &dest));
        if let Err(e) = copied {
            eprintln!("원본 사본을 남기지 못함 {}: {e}", path.display());
        }
    }

    /// 원본 사본이 없는 버전 중, 지금 파일이 받을 때와 같은(필기 전) 것만 원본을 남긴다.
    /// 이미 필기된 파일은 원본을 되찾을 수 없어 건너뛴다. 남긴 수를 돌려준다.
    pub fn keep_missing_originals(&self) -> usize {
        let todo: Vec<(PathBuf, String)> = {
            let lib = self.library.lock().unwrap_or_else(|e| e.into_inner());
            lib.documents
                .iter()
                .flat_map(|d| &d.versions)
                .filter(|v| !v.missing && !self.original_path(&v.sha256).exists())
                .map(|v| (v.path.clone(), v.sha256.clone()))
                .collect()
        };
        let mut kept = 0;
        for (path, sha) in todo {
            if matches!(fingerprint::of_file(&path), Ok(fp) if fp.sha256 == sha) {
                self.copy_original(&path, &sha);
                kept += 1;
            }
        }
        kept
    }

    /// 필기 여부를 확인한다: 파일의 수정 시각·크기가 마지막 확인 때와 다르면 해시를 다시 계산하고,
    /// 받을 때와 다르면 annotated. 바뀐 게 없으면 해시를 계산하지 않는다. 무엇이든 바뀌었으면 true.
    pub fn check_annotations(&self) -> bool {
        let mut lib = self.library.lock().unwrap_or_else(|e| e.into_inner());
        let mut changed = false;
        for version in lib.documents.iter_mut().flat_map(|d| &mut d.versions) {
            // 필기본을 또 고치면 그 필기본이 바뀐 것: 수정 시각만 따라간다
            for copy in version.copies.iter_mut().filter(|c| !c.missing) {
                let mtime = fs::metadata(&copy.path).ok().and_then(|m| mtime_ms(&m));
                if mtime.is_some() && copy.modified_at_ms != mtime {
                    copy.modified_at_ms = mtime;
                    changed = true;
                }
            }
            if version.missing {
                continue;
            }
            let Ok(meta) = fs::metadata(&version.path) else {
                continue;
            };
            let mtime = mtime_ms(&meta);
            if mtime.is_some()
                && version.checked_mtime_ms == mtime
                && version.checked_size == Some(meta.len())
            {
                continue;
            }
            let Ok(fp) = fingerprint::of_file(&version.path) else {
                continue;
            };
            version.annotated = fp.sha256 != version.sha256;
            version.checked_mtime_ms = mtime;
            version.checked_size = Some(meta.len());
            changed = true;
        }
        if changed {
            if let Err(e) = lib.save(&self.library_file) {
                eprintln!("library.json 저장 실패: {e}");
            }
        }
        changed
    }

    /// 화면을 보여 주기 전에: 옮긴 파일을 따라가고(FR-14), 원본에 한 필기를 필기본으로 옮기고,
    /// 필기 여부를 확인한다
    fn refresh_files(&self) {
        if self.locate() {
            self.tag_untagged();
        }
        self.adopt_opened();
        self.check_annotations();
    }

    /// "원본 열기": 받은 그대로의 내용을 열 파일 경로를 돌려준다.
    /// 받은 파일에 아직 필기하지 않았으면 그 파일을 그대로 연다. 필기했으면 원본 사본을
    /// .sorted-opened/<sha256>/<파일 이름>으로 복사해 그걸 연다 (원본 사본 자체는 열지 않아 망가지지 않는다).
    /// 그 임시 사본에 필기하면 다음 확인 때 주차 폴더로 옮겨 새 필기본이 된다 (`adopt_opened`).
    pub fn open_original(&self, document_id: &str, number: u32) -> Result<PathBuf, String> {
        self.refresh_files();
        let (sha, path, annotated) = {
            let lib = self.library.lock().unwrap_or_else(|e| e.into_inner());
            let (_, v) = lib
                .version_of(document_id, number)
                .filter(|(_, v)| !v.missing)
                .ok_or_else(|| tr("파일을 찾을 수 없어요.", "Can't find the file."))?;
            (v.sha256.clone(), v.path.clone(), v.annotated)
        };
        if !annotated && path.is_file() {
            return Ok(path);
        }
        let original = self.original_path(&sha);
        if !original.is_file() {
            return Err(tr(
                "이 파일은 원본을 보관하기 전에 필기돼서 원본이 없어요.",
                "This file was annotated before Sorted kept an original, so there's none.",
            ));
        }
        let name = path
            .file_name()
            .map(PathBuf::from)
            .unwrap_or_else(|| "original.pdf".into());
        let dir = self.opened_dir.join(&sha);
        let dest = dir.join(name);
        // 전에 열어 둔 사본이 아직 그대로면 다시 쓴다 (미리보기가 열고 있을 수 있다)
        if matches!(fingerprint::of_file(&dest), Ok(fp) if fp.sha256 == sha) {
            return Ok(dest);
        }
        fs::create_dir_all(&dir)
            .and_then(|()| fs::copy(&original, &dest))
            .map_err(|e| {
                format!(
                    "{}: {e}",
                    tr("원본을 열지 못했어요", "Couldn't open the original")
                )
            })?;
        Ok(dest)
    }

    /// 필기본에 이름을 붙인다. 빈 이름이면 기본("필기 N")으로 되돌린다. 파일 이름은 바꾸지 않는다.
    pub fn rename_annotation(
        &self,
        document_id: &str,
        version: u32,
        number: u32,
        name: &str,
    ) -> Result<(), String> {
        let name = name.trim();
        if name.chars().count() > 60 || name.contains(['\n', '\r']) {
            return Err(tr(
                "이름은 한 줄, 60자까지 쓸 수 있어요.",
                "Names can be one line of up to 60 characters.",
            ));
        }
        let label = (!name.is_empty()).then(|| name.to_string());
        let mut lib = self.library.lock().unwrap_or_else(|e| e.into_inner());
        let not_found = || {
            tr(
                "필기본을 찾을 수 없어요.",
                "Can't find this annotated copy.",
            )
        };
        let v = lib
            .documents
            .iter_mut()
            .filter(|d| d.key.id() == document_id)
            .flat_map(|d| &mut d.versions)
            .find(|v| v.number == version)
            .ok_or_else(not_found)?;
        match number {
            1 if v.annotated => v.annotation_label = label,
            _ => {
                v.copies
                    .iter_mut()
                    .find(|c| c.number == number)
                    .ok_or_else(not_found)?
                    .label = label
            }
        }
        self.save_library(&lib);
        Ok(())
    }

    /// "원본 열기"로 연 임시 사본 중 필기된 것을 받은 파일 옆으로 옮겨 필기본으로 기록한다.
    /// 그대로인 사본은 두고(다음에 다시 쓴다), 옮긴 게 있으면 true.
    pub fn adopt_opened(&self) -> bool {
        let Ok(dirs) = fs::read_dir(&self.opened_dir) else {
            return false;
        };
        let mut lib = self.library.lock().unwrap_or_else(|e| e.into_inner());
        let mut adopted = false;
        for dir in dirs.flatten() {
            let sha = dir.file_name().to_string_lossy().into_owned();
            let Ok(files) = fs::read_dir(dir.path()) else {
                continue;
            };
            for file in files.flatten().map(|f| f.path()) {
                if file
                    .extension()
                    .is_none_or(|e| !e.eq_ignore_ascii_case("pdf"))
                {
                    continue;
                }
                if matches!(fingerprint::of_file(&file), Ok(fp) if fp.sha256 == sha) {
                    continue;
                }
                let Some((doc_index, version_index)) =
                    lib.documents.iter().enumerate().find_map(|(di, d)| {
                        d.versions
                            .iter()
                            .position(|v| v.sha256 == sha && !v.missing)
                            .map(|vi| (di, vi))
                    })
                else {
                    continue;
                };
                let version = &lib.documents[doc_index].versions[version_index];
                let number = version.copies.iter().map(|c| c.number).max().unwrap_or(1) + 1;
                let Some(dest) = copy_path(&version.path, number) else {
                    continue;
                };
                if let Err(e) = fs::rename(&file, &dest) {
                    eprintln!("필기본을 옮기지 못함 {}: {e}", dest.display());
                    continue;
                }
                let number = copy_number(&dest).unwrap_or(number);
                let tag = tag_of(&lib, &lib.documents[doc_index], version, Some(number));
                if let Err(e) = filetag::write(&dest, &tag) {
                    eprintln!("속성을 붙이지 못함 {}: {e}", dest.display());
                }
                let modified_at_ms = fs::metadata(&dest).ok().and_then(|m| mtime_ms(&m));
                lib.documents[doc_index].versions[version_index]
                    .copies
                    .push(AnnotatedCopy {
                        number,
                        path: dest,
                        added_at_ms: now_ms(),
                        modified_at_ms,
                        ..Default::default()
                    });
                adopted = true;
            }
        }
        if adopted {
            if let Err(e) = lib.save(&self.library_file) {
                eprintln!("library.json 저장 실패: {e}");
            }
        }
        adopted
    }

    /// 메인 창 전체 (FR-13)
    pub fn overview(&self) -> Overview {
        self.refresh_files();
        let lib = self.library();
        // Sorted 휴지통에 든 과목의 최근 변경은 숨긴다 (되살리면 다시 보인다)
        let removed: Vec<String> = lib
            .courses
            .iter()
            .filter(|c| c.is_removed())
            .map(|c| c.id())
            .collect();
        let changes = {
            let history = self.history.lock().unwrap_or_else(|e| e.into_inner());
            history
                .changes
                .iter()
                .rev()
                .filter(|c| !removed.contains(&c.course_id))
                .cloned()
                .collect()
        };
        let mut unprocessed: Vec<Unprocessed> = self
            .pending()
            .into_iter()
            .filter_map(|p| match &p.outcome {
                Outcome::NeedsCourse { .. } => Some(Unprocessed {
                    id: p.id.to_string(),
                    file_name: file_name_of(&p.message),
                    reason: UnprocessedReason::UnknownCourse,
                    at_ms: p.at_ms,
                }),
                _ => None,
            })
            .chain(
                self.failures
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .iter()
                    .cloned(),
            )
            .collect();
        unprocessed.sort_by_key(|u| std::cmp::Reverse(u.at_ms));
        Overview {
            sorted_folder: self.root().to_owned(),
            courses: screen::courses(&lib),
            trash_count: removed.len(),
            changes,
            unprocessed,
        }
    }

    // ── 과목 추가·이름 바꾸기·Sorted 휴지통 ──

    /// 과목을 직접 추가한다. 정리 폴더에 같은 이름의 폴더를 만든다.
    pub fn add_course(&self, name: &str) -> Result<screen::Course, String> {
        let mut lib = self.library.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(problem) = screen::course_name_problem(name, &lib) {
            return Err(problem);
        }
        let name = name.trim();
        fs::create_dir_all(self.course_folder(name)?).map_err(|e| {
            format!(
                "{}: {e}",
                tr(
                    "과목 폴더를 만들지 못했어요",
                    "Couldn't create the class folder"
                )
            )
        })?;
        lib.remember_course(None, name, &[]);
        if let Some(c) = lib.courses.iter_mut().find(|c| c.name == name) {
            c.pin_id();
        }
        self.save_library(&lib);
        let course = screen::courses(&lib)
            .into_iter()
            .find(|c| c.name == name)
            .ok_or_else(|| tr("과목을 추가하지 못했어요.", "Couldn't add the class."))?;
        Ok(course)
    }

    /// 과목명(= 폴더 이름)을 바꾼다. 과목 ID와 자료는 그대로이고, 폴더 안의 파일은 함께 옮겨진다.
    pub fn rename_course(&self, course_id: &str, name: &str) -> Result<(), String> {
        self.locate();
        let mut lib = self.library.lock().unwrap_or_else(|e| e.into_inner());
        let index = lib
            .courses
            .iter()
            .position(|c| c.id() == course_id)
            .ok_or_else(|| tr("없는 과목이에요.", "This class doesn't exist."))?;
        let old = lib.courses[index].name.clone();
        let new = name.trim();
        if new == old {
            return Ok(());
        }
        if let Some(problem) = screen::course_name_problem(new, &lib) {
            return Err(problem);
        }
        let (from, to) = (self.course_folder(&old)?, self.course_folder(new)?);
        if to.exists() {
            return Err(tr(
                "같은 이름의 폴더가 정리 폴더에 이미 있어요.",
                "A folder with this name already exists in the Sorted folder.",
            ));
        }
        if from.is_dir() {
            fs::rename(&from, &to).map_err(|e| {
                format!(
                    "{}: {e}",
                    tr(
                        "과목 폴더 이름을 바꾸지 못했어요",
                        "Couldn't rename the class folder"
                    )
                )
            })?;
        }

        lib.courses[index].pin_id();
        lib.courses[index].name = new.to_owned();
        for doc in lib.documents.iter_mut().filter(|d| d.course == old) {
            doc.course = new.to_owned();
            if let DocKey::Name { course, .. } = &mut doc.key {
                *course = new.to_owned();
            }
            for v in &mut doc.versions {
                if let Ok(rest) = v.path.strip_prefix(&from) {
                    v.path = to.join(rest);
                }
            }
        }
        self.save_library(&lib);
        drop(lib);

        let mut history = self.history.lock().unwrap_or_else(|e| e.into_inner());
        for c in history
            .changes
            .iter_mut()
            .filter(|c| c.course_id == course_id)
        {
            c.course_name = new.to_owned();
        }
        if let Err(e) = save_json(&self.history_file, &*history) {
            eprintln!("history.json 저장 실패: {e}");
        }
        drop(history);
        // 파일명으로 식별하는 문서는 ID가 바뀌므로 속성을 다시 새긴다
        self.tag_untagged();
        Ok(())
    }

    /// Sorted 휴지통으로 옮긴다. 화면에서만 숨기고 파일·폴더는 그대로 둔다.
    pub fn remove_course(&self, course_id: &str) -> Result<(), String> {
        self.set_removed(course_id, Some(now_ms()))
    }

    /// Sorted 휴지통에서 되살린다.
    pub fn restore_course(&self, course_id: &str) -> Result<(), String> {
        self.set_removed(course_id, None)
    }

    fn set_removed(&self, course_id: &str, removed_at_ms: Option<u64>) -> Result<(), String> {
        let mut lib = self.library.lock().unwrap_or_else(|e| e.into_inner());
        let course = lib
            .courses
            .iter_mut()
            .find(|c| c.id() == course_id)
            .ok_or_else(|| tr("없는 과목이에요.", "This class doesn't exist."))?;
        course.pin_id();
        course.removed_at_ms = removed_at_ms;
        self.save_library(&lib);
        Ok(())
    }

    pub fn trash(&self) -> Vec<TrashedCourse> {
        screen::trashed(&self.library())
    }

    /// Sorted 휴지통에서 지운다: 과목 폴더는 `trash`로 macOS 휴지통에 보내고(Finder에서 꺼낼 수 있음),
    /// 과목·자료 기록과 최근 변경을 지운다. 휴지통에 든 과목만.
    pub fn purge_course(
        &self,
        course_id: &str,
        trash: &dyn Fn(&Path) -> io::Result<()>,
    ) -> Result<(), String> {
        let mut lib = self.library.lock().unwrap_or_else(|e| e.into_inner());
        let index = lib
            .courses
            .iter()
            .position(|c| c.id() == course_id)
            .ok_or_else(|| tr("없는 과목이에요.", "This class doesn't exist."))?;
        if !lib.courses[index].is_removed() {
            return Err(tr(
                "휴지통에 있는 과목만 완전히 지울 수 있어요.",
                "Only classes in the Trash can be deleted permanently.",
            ));
        }
        let name = lib.courses[index].name.clone();
        let folder = self.course_folder(&name)?;
        if folder.exists() {
            trash(&folder).map_err(|e| {
                format!(
                    "{}: {e}",
                    tr(
                        "과목 폴더를 휴지통으로 보내지 못했어요",
                        "Couldn't move the class folder to the Trash"
                    )
                )
            })?;
        }
        lib.courses.remove(index);
        // 그 과목의 원본 사본도 지운다 (앱 내부 데이터. 같은 내용을 다른 과목이 쓰면 남긴다)
        let shas: Vec<String> = lib
            .documents
            .iter()
            .filter(|d| d.course == name)
            .flat_map(|d| d.versions.iter().map(|v| v.sha256.clone()))
            .collect();
        lib.documents.retain(|d| d.course != name);
        for sha in shas {
            let shared = lib
                .documents
                .iter()
                .any(|d| d.versions.iter().any(|v| v.sha256 == sha));
            if !shared {
                let _ = fs::remove_file(self.original_path(&sha));
                let _ = fs::remove_dir_all(self.opened_dir.join(&sha));
            }
        }
        self.save_library(&lib);
        drop(lib);

        let mut history = self.history.lock().unwrap_or_else(|e| e.into_inner());
        history.changes.retain(|c| c.course_id != course_id);
        if let Err(e) = save_json(&self.history_file, &*history) {
            eprintln!("history.json 저장 실패: {e}");
        }
        Ok(())
    }

    /// 휴지통의 과목을 모두 지운다. 하나라도 실패하면 거기서 멈추고 이유를 돌려준다.
    pub fn empty_trash(&self, trash: &dyn Fn(&Path) -> io::Result<()>) -> Result<(), String> {
        for t in self.trash() {
            self.purge_course(&t.course.id, trash)?;
        }
        Ok(())
    }

    /// 정리 폴더 바로 아래의 과목 폴더. 정리 폴더 자신이나 그 밖을 가리키는 이름은 거절한다.
    fn course_folder(&self, name: &str) -> Result<PathBuf, String> {
        let name = name.trim();
        if name.is_empty() || name.starts_with('.') || name.contains(['/', ':']) {
            return Err(tr(
                "과목 폴더로 쓸 수 없는 이름이에요.",
                "This name can't be used for a class folder.",
            ));
        }
        Ok(self.root().join(name))
    }

    fn save_library(&self, lib: &Library) {
        if let Err(e) = lib.save(&self.library_file) {
            eprintln!("library.json 저장 실패: {e}");
        }
    }

    pub fn course_detail(&self, course_id: &str) -> Option<CourseDetail> {
        self.refresh_files();
        screen::course_detail(&self.library(), course_id)
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
        let file_name = file_name_of(&p.message);
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
        let p = self.waiting_for_course(id).ok_or_else(|| {
            tr(
                "과목을 기다리는 파일이 아니에요.",
                "This file isn't waiting for a class.",
            )
        })?;
        let course_name = {
            let lib = self.library.lock().unwrap_or_else(|e| e.into_inner());
            match choice {
                AssignChoice::Existing { course_id } => lib
                    .course_by_id(course_id)
                    .map(|c| c.name.clone())
                    .ok_or_else(|| tr("없는 과목이에요.", "This class doesn't exist."))?,
                AssignChoice::New { new_course_name } => {
                    if let Some(problem) = screen::course_name_problem(new_course_name, &lib) {
                        return Err(problem);
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

/// 정리 폴더 아래에서 앱이 새긴 속성이 있는 파일: (문서 ID, 버전, 필기본 번호) → 경로.
/// 숨김 파일·폴더와 심볼릭 링크는 건너뛰고, 속성이 없는 파일은 무시한다 (읽기만 한다).
fn scan_tags(root: &Path) -> HashMap<(String, u32, Option<u32>), PathBuf> {
    let mut found = HashMap::new();
    let mut dirs = vec![root.to_path_buf()];
    while let Some(dir) = dirs.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            if entry.file_name().to_string_lossy().starts_with('.') {
                continue;
            }
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            let path = entry.path();
            if kind.is_dir() {
                dirs.push(path);
            } else if kind.is_file() {
                if let Some(tag) = filetag::read(&path) {
                    found.insert((tag.doc, tag.v, tag.copy), path);
                }
            }
        }
    }
    found
}

/// 정리 폴더 기준 `<과목>/<주차>/…/파일`이면 (과목, Some(주차)), `<과목>/파일`이면 (과목, None).
/// 정리 폴더 바로 아래 파일이면 None.
fn folder_of(root: &Path, path: &Path) -> Option<(String, Option<String>)> {
    let rel = path.strip_prefix(root).ok()?;
    let parts: Vec<String> = rel
        .parent()?
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect();
    match parts.as_slice() {
        [] => None,
        [course] => Some((course.clone(), None)),
        [course, week, ..] => Some((course.clone(), Some(week.clone()))),
    }
}

/// 목록의 문서·버전으로 파일에 새길 속성을 만든다
fn tag_of(lib: &Library, doc: &Document, version: &Version, copy: Option<u32>) -> Tag {
    Tag {
        course: lib
            .courses
            .iter()
            .find(|c| c.name == doc.course)
            .map(|c| c.id())
            .unwrap_or_default(),
        doc: doc.key.id(),
        v: version.number,
        copy,
    }
}

/// 받은 파일 옆에 둘 필기본 경로: `<이름> (필기 N).pdf`. 같은 이름이 있으면 N을 늘린다
fn copy_path(main: &Path, number: u32) -> Option<PathBuf> {
    let dir = main.parent()?;
    let stem = main.file_stem()?.to_string_lossy();
    (number..number + 100)
        .map(|n| dir.join(format!("{stem} ({} {n}).pdf", tr("필기", "Notes"))))
        .find(|p| !p.exists())
}

/// `copy_path`가 만든 이름에서 번호를 읽는다
fn copy_number(path: &Path) -> Option<u32> {
    let stem = path.file_stem()?.to_string_lossy();
    stem.strip_suffix(')')?.rsplit(' ').next()?.parse().ok()
}

fn mtime_ms(meta: &fs::Metadata) -> Option<u64> {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
}

/// 다운로드 메시지의 파일 이름 (경로 빼고)
fn file_name_of(message: &Value) -> String {
    message["filename"]
        .as_str()
        .and_then(|f| Path::new(f).file_name())
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// 없으면 빈 기록. 깨져 있으면 옆에 백업해 두고 빈 기록으로 시작한다.
fn load_history(path: &Path) -> History {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|e| {
            let backup = path.with_extension(format!("broken-{}.json", now_ms()));
            let _ = fs::rename(path, &backup);
            eprintln!(
                "history.json을 읽지 못해({e}) {} 로 옮기고 새로 시작합니다",
                backup.display()
            );
            History::default()
        }),
        Err(_) => History::default(),
    }
}

/// 임시 파일에 쓴 뒤 이름을 바꿔서, 쓰는 도중 앱이 꺼져도 깨지지 않게 한다.
fn save_json(path: &Path, value: &impl Serialize) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_vec_pretty(value)?)?;
    fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600))?;
    fs::rename(tmp, path)
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

    #[test]
    fn overview_lists_changes_and_unprocessed_and_survives_restart() {
        let (dir, org) = setup("overview");
        let lms = json!({ "courseName": "운영체제", "week": { "name": "1주차" } });
        let a = dir.join("Downloads/a.pdf");
        fs::write(&a, "%PDF-1.7 a").unwrap();
        org.handle(
            1,
            &json!({ "filename": a, "contentId": "abc", "lms": lms }),
            None,
        );
        // 같은 문서의 새 내용 → 새 버전
        fs::write(&a, "%PDF-1.7 a2").unwrap();
        org.handle(
            2,
            &json!({ "filename": a, "contentId": "abc", "lms": lms }),
            None,
        );
        // 같은 내용을 다시 받음 → 중복
        fs::write(&a, "%PDF-1.7 a2").unwrap();
        org.handle(
            3,
            &json!({ "filename": a, "contentId": "abc", "lms": lms }),
            None,
        );
        // PDF 아님, 과목 모름
        let txt = dir.join("Downloads/b.txt");
        fs::write(&txt, "hello").unwrap();
        org.handle(4, &json!({ "filename": txt }), None);
        let c = dir.join("Downloads/c.pdf");
        fs::write(&c, "%PDF-1.7 c").unwrap();
        org.handle(5, &json!({ "filename": c }), None);

        let o = org.overview();
        let kinds: Vec<ChangeKind> = o.changes.iter().map(|c| c.kind).collect();
        assert_eq!(
            kinds,
            [
                ChangeKind::Duplicate,
                ChangeKind::NewVersion,
                ChangeKind::Organized
            ]
        );
        assert_eq!(o.changes[2].document_id, "cid-abc");
        assert_eq!(o.changes[2].course_name, "운영체제");
        assert_eq!(o.changes[1].file_name, "a (v2).pdf");
        assert_eq!(o.courses.len(), 1);
        assert_eq!(o.courses[0].file_count, 2);
        let reasons: Vec<(String, UnprocessedReason)> = o
            .unprocessed
            .iter()
            .map(|u| (u.file_name.clone(), u.reason))
            .collect();
        assert!(reasons.contains(&("b.txt".into(), UnprocessedReason::NotPdf)));
        assert!(reasons.contains(&("c.pdf".into(), UnprocessedReason::UnknownCourse)));

        // 다시 열어도 최근 변경은 남고, 번호는 이어진다
        let reopened = Organizer::open(dir.join("Sorted"), dir.join("library.json")).unwrap();
        assert_eq!(reopened.overview().changes.len(), 3);
        let d = dir.join("Downloads/d.pdf");
        fs::write(&d, "%PDF-1.7 d").unwrap();
        reopened.handle(
            6,
            &json!({ "filename": d, "contentId": "d", "lms": lms }),
            None,
        );
        assert_eq!(reopened.overview().changes[0].id, "c4");

        let detail = reopened.course_detail(&o.courses[0].id).unwrap();
        assert_eq!(detail.weeks[0].week, "1주차");
        assert_eq!(detail.weeks[0].files.len(), 3);
    }

    #[test]
    fn organized_files_get_a_tag_and_old_files_are_backfilled() {
        let (dir, org) = setup("tag");
        let a = dir.join("Downloads/a.pdf");
        fs::write(&a, "%PDF-1.7 a").unwrap();
        let lms = json!({ "courseName": "운영체제", "week": { "name": "1주차" } });
        let out = org.handle(
            1,
            &json!({ "filename": a, "contentId": "abc", "lms": lms }),
            None,
        );
        let Outcome::Organized { path, .. } = out else {
            panic!("{out:?}")
        };
        let tag = filetag::read(&path).unwrap();
        assert_eq!(tag.doc, "cid-abc");
        assert_eq!(tag.v, 1);
        assert!(tag.course.starts_with("local-"));

        // 속성이 없는 예전 파일: 다시 열면 붙는다
        xattr::remove(&path, filetag::ATTR).unwrap();
        assert!(filetag::read(&path).is_none());
        let reopened = Organizer::open(dir.join("Sorted"), dir.join("library.json")).unwrap();
        assert_eq!(filetag::read(&path), Some(tag));
        assert_eq!(reopened.tag_untagged(), 0);
    }

    /// 운영체제/1주차/a.pdf 하나를 정리해 두고 (dir, org, 정리된 경로)
    fn organized(name: &str) -> (PathBuf, Organizer, PathBuf) {
        let (dir, org) = setup(name);
        let a = dir.join("Downloads/a.pdf");
        fs::write(&a, "%PDF-1.7 a").unwrap();
        let lms = json!({ "courseName": "운영체제", "week": { "name": "1주차" } });
        let out = org.handle(
            1,
            &json!({ "filename": a, "contentId": "abc", "lms": lms }),
            None,
        );
        let Outcome::Organized { path, .. } = out else {
            panic!("{out:?}")
        };
        (dir, org, path)
    }

    fn the_doc(org: &Organizer) -> Document {
        org.library().documents[0].clone()
    }

    #[test]
    fn renamed_file_is_followed() {
        let (dir, org, path) = organized("follow-rename");
        let renamed = dir.join("Sorted/운영체제/1주차/내 필기본.pdf");
        fs::rename(&path, &renamed).unwrap();
        assert!(org.locate());
        let doc = the_doc(&org);
        assert_eq!(doc.versions[0].path, renamed);
        assert_eq!(
            (doc.course.as_str(), doc.week.as_str()),
            ("운영체제", "1주차")
        );
        assert!(!org.locate(), "경로가 맞으면 다시 훑지 않는다");
    }

    #[test]
    fn moved_to_another_week_or_course_folder_is_followed() {
        let (dir, org, path) = organized("follow-move");
        fs::create_dir_all(dir.join("Sorted/운영체제/3주차")).unwrap();
        let to_week = dir.join("Sorted/운영체제/3주차/a.pdf");
        fs::rename(&path, &to_week).unwrap();
        org.locate();
        assert_eq!(the_doc(&org).week, "3주차");

        fs::create_dir_all(dir.join("Sorted/알고리즘/2주차")).unwrap();
        let to_course = dir.join("Sorted/알고리즘/2주차/a.pdf");
        fs::rename(&to_week, &to_course).unwrap();
        org.locate();
        let doc = the_doc(&org);
        assert_eq!(
            (doc.course.as_str(), doc.week.as_str()),
            ("알고리즘", "2주차")
        );
        assert!(org.library().courses.iter().any(|c| c.name == "알고리즘"));
        // 옮긴 뒤에도 같은 문서로 알아본다: 같은 내용을 다시 받으면 중복
        let again = dir.join("Downloads/a.pdf");
        fs::write(&again, "%PDF-1.7 a").unwrap();
        let out = org.handle(
            2,
            &json!({ "filename": again, "contentId": "abc",
                     "lms": { "courseName": "운영체제", "week": { "name": "1주차" } } }),
            None,
        );
        assert!(matches!(out, Outcome::Duplicate { ref existing, .. } if existing == &to_course));
    }

    #[test]
    fn files_the_app_did_not_put_are_left_alone() {
        let (dir, org, path) = organized("not-ours");
        let mine = dir.join("Sorted/운영체제/1주차/내 메모.pdf");
        fs::write(&mine, "%PDF-1.7 mine").unwrap();
        fs::remove_file(&path).unwrap();
        assert!(org.locate(), "지운 파일은 missing이 된다");
        assert!(
            the_doc(&org).versions[0].missing,
            "속성이 없는 파일은 우리 문서로 보지 않는다"
        );
        assert!(mine.exists());
        assert!(filetag::read(&mine).is_none());
    }

    #[test]
    fn moved_outside_is_hidden_then_found_again_when_put_back() {
        let (dir, org, path) = organized("missing");
        let outside = dir.join("밖.pdf");
        fs::rename(&path, &outside).unwrap();

        assert!(org.locate());
        assert!(the_doc(&org).versions[0].missing);
        let o = org.overview();
        assert_eq!(o.courses[0].file_count, 0);
        assert!(org
            .course_detail(&o.courses[0].id)
            .unwrap()
            .weeks
            .is_empty());
        assert!(!org.locate(), "10초 안에는 다시 훑지 않는다");

        // 정리 폴더 안 다른 곳에 다시 넣으면 다음 훑기에서 찾는다
        fs::create_dir_all(dir.join("Sorted/운영체제/5주차")).unwrap();
        let back = dir.join("Sorted/운영체제/5주차/돌아옴.pdf");
        fs::rename(&outside, &back).unwrap();
        *org.last_scan.lock().unwrap() = None;
        assert!(org.locate());
        let doc = the_doc(&org);
        assert!(!doc.versions[0].missing);
        assert_eq!(
            (doc.versions[0].path.clone(), doc.week.as_str()),
            (back, "5주차")
        );
    }

    #[test]
    fn downloading_a_missing_file_again_puts_it_back() {
        let (dir, org, path) = organized("restore");
        fs::remove_file(&path).unwrap();
        org.locate();

        let again = dir.join("Downloads/a.pdf");
        fs::write(&again, "%PDF-1.7 a").unwrap();
        let lms = json!({ "courseName": "운영체제", "week": { "name": "9주차" } });
        let out = org.handle(
            2,
            &json!({ "filename": again, "contentId": "abc", "lms": lms }),
            None,
        );
        let Outcome::Organized {
            path: placed,
            version,
            restored,
            week,
            ..
        } = out
        else {
            panic!("{out:?}")
        };
        assert!(restored);
        assert_eq!(
            (version, week.as_str()),
            (1, "1주차"),
            "문서가 있던 주차로, 같은 버전 번호로"
        );
        assert_eq!(placed, path);
        let doc = the_doc(&org);
        assert_eq!(doc.versions.len(), 1);
        assert!(!doc.versions[0].missing);
        assert_eq!(filetag::read(&placed).unwrap().v, 1);
        assert_eq!(org.overview().changes[0].kind, ChangeKind::Organized);
    }

    /// 운영체제/1주차/a.pdf를 정리해 두고, 같은 내용을 다시 받아 중복을 만든다
    fn duplicated(name: &str) -> (PathBuf, Organizer, PathBuf, PathBuf) {
        let (dir, org, existing) = organized(name);
        let again = dir.join("Downloads/a (1).pdf");
        fs::write(&again, "%PDF-1.7 a").unwrap();
        let lms = json!({ "courseName": "운영체제", "week": { "name": "1주차" } });
        let out = org.handle(
            2,
            &json!({ "filename": again, "contentId": "abc", "lms": lms }),
            None,
        );
        assert!(matches!(out, Outcome::Duplicate { .. }), "{out:?}");
        (dir, org, existing, again)
    }

    /// 테스트용 휴지통: 지우지 않고 dir/Trash로 옮긴다
    fn fake_trash(dir: &Path) -> impl Fn(&Path) -> io::Result<()> + '_ {
        move |p: &Path| {
            fs::create_dir_all(dir.join("Trash"))?;
            fs::rename(p, dir.join("Trash").join(p.file_name().unwrap()))
        }
    }

    #[test]
    fn duplicate_notice_shows_the_existing_file() {
        let (_, org, existing, _) = duplicated("dup-notice");
        let n = org.duplicate_notice(2).unwrap();
        assert_eq!(n.file_name, "a (1).pdf");
        assert_eq!(
            (n.course_name.as_str(), n.week.as_str()),
            ("운영체제", "1주차")
        );
        assert_eq!(n.existing_path, existing);
        assert!(org.duplicate_notice(99).is_none());
    }

    #[test]
    fn open_existing_trashes_only_the_downloaded_copy() {
        let (dir, org, existing, again) = duplicated("dup-open");
        let opened = org
            .resolve_duplicate(2, DuplicateChoice::OpenExisting, &fake_trash(&dir))
            .unwrap();
        assert_eq!(opened, Some(existing.clone()));
        assert!(!again.exists() && dir.join("Trash/a (1).pdf").exists());
        assert!(existing.exists(), "기존 파일은 그대로");
        assert!(org.duplicate_notice(2).is_none(), "한 번 처리하면 잊는다");
    }

    #[test]
    fn keep_both_deletes_nothing() {
        let (dir, org, existing, again) = duplicated("dup-keep");
        let opened = org
            .resolve_duplicate(2, DuplicateChoice::KeepBoth, &fake_trash(&dir))
            .unwrap();
        assert_eq!(opened, None);
        assert!(again.exists() && existing.exists());
    }

    #[test]
    fn a_changed_download_is_never_trashed() {
        let (dir, org, _, again) = duplicated("dup-changed");
        fs::write(&again, "%PDF-1.7 바뀐 내용").unwrap();
        assert!(org
            .resolve_duplicate(2, DuplicateChoice::OpenExisting, &fake_trash(&dir))
            .is_err());
        assert!(again.exists());
    }

    #[test]
    fn existing_file_moved_by_the_user_is_still_found() {
        let (dir, org, existing, _) = duplicated("dup-moved");
        let moved = dir.join("Sorted/운영체제/1주차/내 필기.pdf");
        fs::rename(&existing, &moved).unwrap();
        assert_eq!(org.duplicate_notice(2).unwrap().existing_path, moved);
    }

    #[test]
    fn add_course_makes_a_folder_and_rejects_bad_names() {
        let (dir, org) = setup("add-course");
        let c = org.add_course(" 데이터베이스 ").unwrap();
        assert_eq!(c.name, "데이터베이스");
        assert!(c.id.starts_with("local-"));
        assert!(dir.join("Sorted/데이터베이스").is_dir());
        assert!(org.add_course("데이터베이스").is_err(), "같은 이름");
        assert!(org.add_course("../밖").is_err());
        assert!(org.add_course(".숨김").is_err());
        assert_eq!(org.overview().courses.len(), 1);
    }

    #[test]
    fn rename_moves_the_folder_and_keeps_the_id() {
        let (dir, org, path) = organized("rename-course");
        let id = org.overview().courses[0].id.clone();
        org.rename_course(&id, "OS").unwrap();

        assert!(!dir.join("Sorted/운영체제").exists());
        let moved = dir.join("Sorted/OS/1주차").join(path.file_name().unwrap());
        assert!(moved.is_file());
        let o = org.overview();
        assert_eq!(
            (o.courses[0].id.as_str(), o.courses[0].name.as_str()),
            (id.as_str(), "OS")
        );
        assert_eq!(o.changes[0].course_name, "OS");
        assert_eq!(the_doc(&org).versions[0].path, moved);
        assert_eq!(filetag::read(&moved).unwrap().course, id);

        fs::create_dir_all(dir.join("Sorted/알고리즘")).unwrap();
        assert!(
            org.rename_course(&id, "알고리즘").is_err(),
            "폴더가 이미 있으면 거절"
        );
        assert!(org.rename_course("nope", "X").is_err());
    }

    #[test]
    fn remove_hides_without_touching_files_and_restore_brings_it_back() {
        let (_, org, path) = organized("remove-course");
        let id = org.overview().courses[0].id.clone();
        org.remove_course(&id).unwrap();

        let o = org.overview();
        assert!(o.courses.is_empty() && o.changes.is_empty());
        assert_eq!(o.trash_count, 1);
        assert_eq!(org.trash()[0].course.id, id);
        assert!(path.is_file(), "파일은 그대로");

        org.restore_course(&id).unwrap();
        let o = org.overview();
        assert_eq!((o.courses.len(), o.changes.len(), o.trash_count), (1, 1, 0));
    }

    #[test]
    fn purge_sends_the_folder_to_the_trash_only_for_trashed_courses() {
        let (dir, org, _) = organized("purge-course");
        let id = org.overview().courses[0].id.clone();
        assert!(
            org.purge_course(&id, &fake_trash(&dir)).is_err(),
            "휴지통에 없는 과목"
        );
        assert!(dir.join("Sorted/운영체제").is_dir());

        org.remove_course(&id).unwrap();
        org.purge_course(&id, &fake_trash(&dir)).unwrap();
        assert!(!dir.join("Sorted/운영체제").exists());
        assert!(
            dir.join("Trash/운영체제/1주차").is_dir(),
            "macOS 휴지통으로"
        );
        assert!(dir.join("Sorted").is_dir(), "정리 폴더는 그대로");
        assert!(org.trash().is_empty() && org.library().documents.is_empty());
        assert!(org.overview().changes.is_empty());
    }

    #[test]
    fn empty_trash_purges_every_trashed_course() {
        let (dir, org) = setup("empty-trash");
        for name in ["가", "나"] {
            let c = org.add_course(name).unwrap();
            org.remove_course(&c.id).unwrap();
        }
        org.add_course("다").unwrap();
        org.empty_trash(&fake_trash(&dir)).unwrap();
        assert!(org.trash().is_empty());
        assert_eq!(org.overview().courses.len(), 1);
        assert!(dir.join("Sorted/다").is_dir());
    }

    #[test]
    fn organizing_keeps_a_pristine_original() {
        let (dir, org, path) = organized("original");
        let sha = the_doc(&org).versions[0].sha256.clone();
        let original = org.original_path(&sha);
        assert_eq!(fs::read(&original).unwrap(), fs::read(&path).unwrap());
        assert!(original.starts_with(dir.join("originals")));
    }

    #[test]
    fn annotating_is_detected_and_the_original_stays() {
        let (_, org, path) = organized("annotate");
        assert!(org.check_annotations(), "처음 확인");
        assert!(!the_doc(&org).versions[0].annotated);
        assert!(
            !org.check_annotations(),
            "바뀐 게 없으면 다시 계산하지 않는다"
        );

        fs::write(&path, "%PDF-1.7 a + 필기").unwrap();
        org.check_annotations();
        let version = the_doc(&org).versions[0].clone();
        assert!(version.annotated);
        let original = fs::read(org.original_path(&version.sha256)).unwrap();
        assert_eq!(original, b"%PDF-1.7 a");

        let detail = org.course_detail(&org.overview().courses[0].id).unwrap();
        assert!(detail.weeks[0].files[0].annotated);
    }

    #[test]
    fn missing_originals_are_backfilled_only_for_pristine_files() {
        let (dir, org, path) = organized("backfill");
        let sha = the_doc(&org).versions[0].sha256.clone();
        fs::remove_file(org.original_path(&sha)).unwrap();
        let reopened = Organizer::open(dir.join("Sorted"), dir.join("library.json")).unwrap();
        assert!(
            reopened.original_path(&sha).exists(),
            "필기 전이면 다시 남긴다"
        );

        fs::remove_file(reopened.original_path(&sha)).unwrap();
        fs::write(&path, "%PDF-1.7 필기됨").unwrap();
        assert_eq!(
            reopened.keep_missing_originals(),
            0,
            "필기된 파일은 원본이 아니다"
        );
        assert!(!reopened.original_path(&sha).exists());
    }

    #[test]
    fn purging_a_course_removes_its_originals() {
        let (dir, org, _) = organized("purge-original");
        let sha = the_doc(&org).versions[0].sha256.clone();
        let id = org.overview().courses[0].id.clone();
        org.remove_course(&id).unwrap();
        org.purge_course(&id, &fake_trash(&dir)).unwrap();
        assert!(!org.original_path(&sha).exists());
    }

    #[test]
    fn opening_the_original_before_annotating_opens_the_file_itself() {
        let (_, org, path) = organized("open-pristine");
        let id = the_doc(&org).key.id();
        assert_eq!(org.open_original(&id, 1).unwrap(), path);
    }

    #[test]
    fn annotating_the_original_again_makes_new_copies() {
        let (_, org, path) = organized("copies");
        let id = the_doc(&org).key.id();
        fs::write(&path, "%PDF-1.7 a + 필기 1").unwrap();

        // 원본을 열면 임시 사본. 보기만 하면 아무것도 생기지 않는다
        let opened = org.open_original(&id, 1).unwrap();
        assert_ne!(opened, path);
        assert_eq!(fs::read(&opened).unwrap(), b"%PDF-1.7 a");
        assert!(!org.adopt_opened());
        assert_eq!(
            org.open_original(&id, 1).unwrap(),
            opened,
            "그대로면 다시 쓴다"
        );

        // 거기에 필기하면 받은 파일 옆의 필기본 2가 된다
        fs::write(&opened, "%PDF-1.7 a + 필기 2").unwrap();
        let course = org.overview().courses[0].id.clone();
        let file = &org.course_detail(&course).unwrap().weeks[0].files[0];
        assert!(!opened.exists());
        let numbers: Vec<u32> = file.annotations.iter().map(|a| a.number).collect();
        assert_eq!(numbers, [1, 2]);
        let copy2 = file.annotations[1].path.clone();
        assert_eq!(copy2.parent(), path.parent());
        assert_eq!(fs::read(&copy2).unwrap(), "%PDF-1.7 a + 필기 2".as_bytes());
        assert_eq!(filetag::read(&copy2).unwrap().copy, Some(2));

        // 원본을 또 열어 필기하면 필기본 3
        let opened = org.open_original(&id, 1).unwrap();
        assert_eq!(fs::read(&opened).unwrap(), b"%PDF-1.7 a");
        fs::write(&opened, "%PDF-1.7 a + 필기 3").unwrap();
        // 필기본 2를 또 고치면 그 필기본이 바뀐 것 (새로 생기지 않는다)
        fs::write(&copy2, "%PDF-1.7 a + 필기 2 더").unwrap();
        let file = &org.course_detail(&course).unwrap().weeks[0].files[0];
        let numbers: Vec<u32> = file.annotations.iter().map(|a| a.number).collect();
        assert_eq!(numbers, [1, 2, 3]);
        assert_eq!(file.annotations[1].path, copy2);

        // 필기본을 옮겨도 따라간다 (FR-14)
        let moved = path.parent().unwrap().join("내 필기.pdf");
        fs::rename(&copy2, &moved).unwrap();
        let file = &org.course_detail(&course).unwrap().weeks[0].files[0];
        assert_eq!(file.annotations[1].path, moved);
        assert_eq!(file.version, 1, "받은 파일은 그대로");
    }

    #[test]
    fn no_original_means_it_cannot_be_opened() {
        let (_, org, path) = organized("no-original");
        let doc = the_doc(&org);
        fs::remove_file(org.original_path(&doc.versions[0].sha256)).unwrap();
        fs::write(&path, "%PDF-1.7 필기").unwrap();
        assert!(org.open_original(&doc.key.id(), 1).is_err());
    }

    #[test]
    fn annotated_copies_can_be_named_and_reset() {
        let (_, org, path) = organized("label");
        let id = the_doc(&org).key.id();
        fs::write(&path, "%PDF-1.7 a + 필기").unwrap();
        let course = org.overview().courses[0].id.clone();
        org.rename_annotation(&id, 1, 1, "  중간고사 정리 ")
            .unwrap();
        let label = |org: &Organizer| {
            org.course_detail(&course).unwrap().weeks[0].files[0].annotations[0]
                .label
                .clone()
        };
        assert_eq!(label(&org).as_deref(), Some("중간고사 정리"));
        assert_eq!(path.file_name().unwrap(), "a.pdf", "파일 이름은 그대로");
        org.rename_annotation(&id, 1, 1, "").unwrap();
        assert_eq!(label(&org), None);
        assert!(org.rename_annotation(&id, 1, 7, "x").is_err());
        assert!(org.rename_annotation(&id, 1, 1, "두\n줄").is_err());
    }
}
