//! 다운로드 하나를 정리하는 흐름. Tauri에 의존하지 않아서 단위 테스트가 쉽다.
//!
//! 1. 파일 읽기 (권한이 없으면 FR-15 안내)
//! 2. 진짜 PDF인지 (FR-2). 웹 페이지가 받아졌으면 LMS 로그인 만료로 본다
//! 3. 과목 정하기 (FR-5). 모르면 손대지 않고 사용자에게 묻는다
//! 4. 같은 문서·같은 버전인지 (FR-3, FR-4)
//! 5. `~/Sorted/<과목>/<주차>/`로 옮기기 (FR-6). 새 버전은 ` (v2)` (FR-8)
//!
//! 같은 파일을 또 받은 경우(FR-7)는 아무것도 옮기지 않고 결과만 알린다. 무엇을 할지는 화면에서 묻는다.

use std::fs::File;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sorted_core::course::{self, Hints, Resolution};
use sorted_core::fingerprint;
use sorted_core::judge::{self, Decision};
use sorted_core::library::{DocKey, Document, Library, Version};
use sorted_core::organize;

// ── 확장이 보내는 다운로드 메시지 (extension/src/lms.js의 buildDownloadMessage) ──

#[derive(Debug, Default, Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Download {
    pub filename: String,
    pub content_id: Option<String>,
    pub module_item_id: Option<String>,
    pub course_id: CourseIds,
    pub lms: Option<Lms>,
}

#[derive(Debug, Default, Clone, Deserialize)]
#[serde(default)]
pub struct CourseIds {
    pub referrer: Option<String>,
    pub tab: Option<String>,
}

#[derive(Debug, Default, Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Lms {
    pub course_name: Option<String>,
    pub week: Option<Week>,
}

#[derive(Debug, Default, Clone, Deserialize)]
#[serde(default)]
pub struct Week {
    pub name: String,
}

/// 정리 결과. 화면은 `kind`를 보고 무엇을 보여 줄지 정한다 (docs/app-api.md).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Outcome {
    /// 정리 폴더로 옮김
    #[serde(rename_all = "camelCase")]
    Organized {
        path: PathBuf,
        course: String,
        week: String,
        /// 1이면 처음, 2 이상이면 새 버전
        version: u32,
        /// 정리 폴더에서 사라졌던 버전과 같은 내용이라 그 자리에 다시 정리함 (FR-14)
        #[serde(skip_serializing_if = "is_false")]
        restored: bool,
    },
    /// 같은 내용을 이미 가지고 있음. 받은 파일은 다운로드 폴더에 그대로 둠 (FR-7)
    #[serde(rename_all = "camelCase")]
    Duplicate {
        existing: PathBuf,
        downloaded: PathBuf,
    },
    /// PDF가 아님. 손대지 않음
    NotPdf {
        path: PathBuf,
    },
    /// PDF 대신 웹 페이지가 받아짐: LMS 로그인이 만료됐을 가능성 (FR-2)
    LoginExpired {
        path: PathBuf,
    },
    /// 과목을 정하지 못함. 사용자가 고르면 다시 처리한다 (FR-5)
    NeedsCourse {
        path: PathBuf,
    },
    /// 다운로드 폴더를 읽을 권한이 없음 (FR-15)
    NeedsPermission {
        path: PathBuf,
    },
    /// 파일이 이미 없음 (사용자가 옮겼거나 지움)
    Missing {
        path: PathBuf,
    },
    Error {
        message: String,
    },
}

impl Outcome {
    /// 사용자의 조치를 기다리는 결과인가 (보류 목록에 둔다)
    pub fn is_pending(&self) -> bool {
        matches!(
            self,
            Outcome::NeedsCourse { .. } | Outcome::NeedsPermission { .. }
        )
    }
}

pub struct Settings {
    /// 정리 폴더 (기본 ~/Sorted)
    pub root: PathBuf,
}

/// 다운로드 하나를 정리한다. `library`는 바뀔 수 있고, 저장은 부른 쪽이 한다.
/// `course_override`: 사용자가 화면에서 고른 과목명 (FR-5의 마지막 단계)
/// `first_page`: PDF 첫 페이지 글자를 읽는 함수. 과목을 다른 방법으로 못 정할 때만 부른다.
pub fn process(
    dl: &Download,
    settings: &Settings,
    library: &mut Library,
    course_override: Option<&str>,
    first_page: &dyn Fn(&Path) -> Option<String>,
) -> Outcome {
    let path = PathBuf::from(&dl.filename);

    // 1. 파일 읽기
    let fp = match fingerprint::of_file(&path) {
        Ok(fp) => fp,
        Err(e) => {
            return match e.kind() {
                io::ErrorKind::PermissionDenied => Outcome::NeedsPermission { path },
                io::ErrorKind::NotFound => Outcome::Missing { path },
                _ => Outcome::Error {
                    message: format!("파일을 읽지 못함: {e}"),
                },
            }
        }
    };

    // 2. PDF인가
    if !fp.is_pdf {
        return if looks_like_web_page(&path) {
            Outcome::LoginExpired { path }
        } else {
            Outcome::NotPdf { path }
        };
    }

    // 3. 과목
    let file_name = organize::original_name(&path);
    let lms_name = dl.lms.as_ref().and_then(|l| l.course_name.as_deref());
    let page_text: Option<String>;
    let mut hints = Hints {
        tab_course_id: dl.course_id.tab.as_deref(),
        referrer_course_id: dl.course_id.referrer.as_deref(),
        lms_course_name: course_override.or(lms_name),
        file_name: &file_name,
        first_page: None,
    };
    let mut resolution = course::resolve(library, &hints);
    if matches!(resolution, Resolution::Unknown { .. }) {
        page_text = first_page(&path);
        hints.first_page = page_text.as_deref();
        resolution = course::resolve(library, &hints);
    }
    let (lms_id, course_name) = match resolution {
        Resolution::Known { lms_id, name, .. } => (lms_id, name),
        Resolution::Unknown { .. } => return Outcome::NeedsCourse { path },
    };
    library.remember_course(lms_id.as_deref(), &course_name, &hints.codes());

    // 4. 같은 문서·같은 버전인가
    let key = judge::doc_key(
        dl.content_id.as_deref(),
        dl.module_item_id.as_deref(),
        &course_name,
        &file_name,
    );
    let decision = judge::decide(library, &key, &fp.sha256);
    let (version, restored) = match decision {
        Decision::Duplicate { existing } => {
            return Outcome::Duplicate {
                existing,
                downloaded: path,
            }
        }
        Decision::New => (1, false),
        Decision::NewVersion { number } => (number, false),
        Decision::Restore { number } => (number, true),
    };

    // 5. 옮기기. 다시 정리하는 버전은 그 문서가 있던 과목·주차로 (사용자가 옮겼던 곳일 수 있다).
    //    그 밖에는 주차를 LMS → 같은 문서의 이전 주차 → 미분류 순서로 정한다.
    let (course_name, week) = match library.document(&key).filter(|_| restored) {
        Some(doc) => (doc.course.clone(), doc.week.clone()),
        None => (course_name, choose_week(dl, library, &key)),
    };
    let dest = organize::destination(
        &settings.root,
        &course_name,
        Some(&week),
        &organize::versioned_name(&file_name, version),
    );
    let placed = match organize::move_into(&path, &dest) {
        Ok(p) => p,
        Err(e) => {
            return Outcome::Error {
                message: format!("옮기지 못함: {e}"),
            }
        }
    };

    let record = Version {
        number: version,
        sha256: fp.sha256,
        size: fp.size,
        path: placed.clone(),
        added_at_ms: now_ms(),
        missing: false,
        ..Default::default()
    };
    match library.document_mut(&key) {
        Some(doc) if restored => {
            if let Some(v) = doc.versions.iter_mut().find(|v| v.number == version) {
                v.path = placed.clone();
                v.missing = false;
            }
        }
        Some(doc) => doc.versions.push(record),
        None => library.documents.push(Document {
            key,
            course: course_name.clone(),
            week: week.clone(),
            file_name,
            versions: vec![record],
        }),
    }

    Outcome::Organized {
        path: placed,
        course: course_name,
        week,
        version,
        restored,
    }
}

/// 주차: LMS → 같은 문서의 이전 주차 → 미분류
fn choose_week(dl: &Download, library: &Library, key: &DocKey) -> String {
    dl.lms
        .as_ref()
        .and_then(|l| l.week.as_ref())
        .map(|w| w.name.clone())
        .filter(|w| !w.trim().is_empty())
        .or_else(|| library.document(key).map(|d| d.week.clone()))
        .unwrap_or_else(|| organize::UNSORTED_WEEK.to_owned())
}

fn is_false(b: &bool) -> bool {
    !*b
}

/// 앞부분이 HTML처럼 보이는가. LMS 세션이 끝나면 PDF 대신 로그인 페이지가 받아진다.
fn looks_like_web_page(path: &Path) -> bool {
    let mut head = [0u8; 1024];
    let n = File::open(path)
        .and_then(|mut f| f.read(&mut head))
        .unwrap_or(0);
    let text = String::from_utf8_lossy(&head[..n]).to_ascii_lowercase();
    let text = text.trim_start_matches('\u{feff}').trim_start();
    text.starts_with('<') && (text.contains("<html") || text.contains("<!doctype"))
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
    use std::fs;

    struct Env {
        downloads: PathBuf,
        settings: Settings,
        library: Library,
    }

    fn env(name: &str) -> Env {
        let dir = std::env::temp_dir().join(format!("sorted-pipe-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("Downloads")).unwrap();
        Env {
            downloads: dir.join("Downloads"),
            settings: Settings {
                root: dir.join("Sorted"),
            },
            library: Library::default(),
        }
    }

    fn pdf(env: &Env, name: &str, body: &str) -> PathBuf {
        let p = env.downloads.join(name);
        fs::write(&p, format!("%PDF-1.7\n{body}")).unwrap();
        p
    }

    fn download(path: &Path, content_id: &str, week: Option<&str>) -> Download {
        serde_json::from_value(json!({
            "type": "download",
            "filename": path,
            "contentId": content_id,
            "moduleItemId": "8582053",
            "courseId": { "referrer": "210208", "tab": "210208" },
            "lms": {
                "courseName": "소프트웨어공학",
                "courseCode": "HY11171",
                "week": week.map(|w| json!({ "name": w, "position": 1, "matchedBy": "item" })),
                "error": null
            }
        }))
        .unwrap()
    }

    fn no_page(_: &Path) -> Option<String> {
        None
    }

    fn run(env: &mut Env, dl: &Download) -> Outcome {
        process(dl, &env.settings, &mut env.library, None, &no_page)
    }

    #[test]
    fn organizes_into_course_and_week() {
        let mut e = env("organize");
        let file = pdf(&e, "cse406-lec-00-v3.pdf", "a");
        let out = run(&mut e, &download(&file, "c1", Some("1주차")));
        let expected = e
            .settings
            .root
            .join("소프트웨어공학/1주차/cse406-lec-00-v3.pdf");
        assert_eq!(
            out,
            Outcome::Organized {
                path: expected.clone(),
                course: "소프트웨어공학".into(),
                week: "1주차".into(),
                version: 1,
                restored: false
            }
        );
        assert!(expected.exists() && !file.exists());
        assert_eq!(e.library.documents.len(), 1);
        assert_eq!(e.library.courses[0].lms_id.as_deref(), Some("210208"));
        assert_eq!(e.library.courses[0].codes, vec!["CSE406"]);
    }

    #[test]
    fn same_content_again_is_a_duplicate_and_stays_put() {
        let mut e = env("dup");
        let first = pdf(&e, "a.pdf", "same");
        run(&mut e, &download(&first, "c1", Some("1주차")));
        let again = pdf(&e, "a (1).pdf", "same");
        let out = run(&mut e, &download(&again, "c1", Some("1주차")));
        assert!(matches!(out, Outcome::Duplicate { .. }));
        assert!(
            again.exists(),
            "중복 파일은 묻기 전까지 지우지도 옮기지도 않는다"
        );
        assert_eq!(e.library.documents[0].versions.len(), 1);
    }

    #[test]
    fn changed_content_is_saved_as_a_new_version() {
        let mut e = env("version");
        let first = pdf(&e, "a.pdf", "old");
        run(&mut e, &download(&first, "c1", Some("1주차")));
        let newer = pdf(&e, "a.pdf", "new");
        let out = run(&mut e, &download(&newer, "c1", None));
        let expected = e.settings.root.join("소프트웨어공학/1주차/a (v2).pdf");
        assert_eq!(
            out,
            Outcome::Organized {
                path: expected.clone(),
                course: "소프트웨어공학".into(),
                week: "1주차".into(),
                version: 2,
                restored: false
            }
        );
        // 기존 파일은 그대로
        assert_eq!(
            fs::read_to_string(e.settings.root.join("소프트웨어공학/1주차/a.pdf")).unwrap(),
            "%PDF-1.7\nold"
        );
        assert_eq!(e.library.documents[0].versions.len(), 2);
    }

    #[test]
    fn unknown_week_goes_to_unsorted() {
        let mut e = env("unsorted");
        let file = pdf(&e, "a.pdf", "x");
        let out = run(&mut e, &download(&file, "c1", None));
        assert!(matches!(out, Outcome::Organized { ref week, .. } if week == "미분류"));
    }

    #[test]
    fn web_page_means_login_expired_and_is_left_alone() {
        let mut e = env("login");
        let file = e.downloads.join("a.pdf");
        fs::write(&file, "\n<!DOCTYPE html><html><body>로그인</body></html>").unwrap();
        let out = run(&mut e, &download(&file, "c1", Some("1주차")));
        assert_eq!(out, Outcome::LoginExpired { path: file.clone() });
        assert!(file.exists());

        let other = e.downloads.join("b.pdf");
        fs::write(&other, "PK\x03\x04zip").unwrap();
        assert_eq!(
            run(&mut e, &download(&other, "c2", None)),
            Outcome::NotPdf { path: other }
        );
    }

    #[test]
    fn unknown_course_waits_for_the_user_then_uses_their_choice() {
        let mut e = env("ask");
        let file = pdf(&e, "notes.pdf", "x");
        let dl: Download = serde_json::from_value(json!({ "filename": file })).unwrap();
        let asked = std::cell::Cell::new(false);
        let page = |_: &Path| {
            asked.set(true);
            Some("Welcome".to_owned())
        };
        let out = process(&dl, &e.settings, &mut e.library, None, &page);
        assert_eq!(out, Outcome::NeedsCourse { path: file.clone() });
        assert!(asked.get(), "다른 단서가 없으면 첫 페이지까지 본다");
        assert!(out.is_pending() && file.exists());

        let out = process(&dl, &e.settings, &mut e.library, Some("운영체제"), &no_page);
        assert!(matches!(out, Outcome::Organized { ref course, .. } if course == "운영체제"));
    }

    #[test]
    fn remembered_codes_place_later_files_without_lms() {
        let mut e = env("codes");
        let first = pdf(&e, "cse406-lec-00.pdf", "a");
        run(&mut e, &download(&first, "c1", Some("1주차")));

        let later = pdf(&e, "cse406-lab-02.pdf", "b");
        let dl: Download = serde_json::from_value(json!({ "filename": later })).unwrap();
        let out = run(&mut e, &dl);
        assert!(
            matches!(out, Outcome::Organized { ref course, ref week, .. } if course == "소프트웨어공학" && week == "미분류")
        );
    }

    #[test]
    fn missing_file_is_reported() {
        let mut e = env("missing");
        let gone = e.downloads.join("gone.pdf");
        assert_eq!(
            run(&mut e, &download(&gone, "c1", None)),
            Outcome::Missing { path: gone }
        );
    }

    #[test]
    fn outcome_json_shape() {
        let out = Outcome::Duplicate {
            existing: "/S/a.pdf".into(),
            downloaded: "/D/a.pdf".into(),
        };
        assert_eq!(
            serde_json::to_value(out).unwrap(),
            json!({ "kind": "duplicate", "existing": "/S/a.pdf", "downloaded": "/D/a.pdf" })
        );
        assert_eq!(
            serde_json::to_value(Outcome::NeedsCourse {
                path: "/D/a.pdf".into()
            })
            .unwrap(),
            json!({ "kind": "needsCourse", "path": "/D/a.pdf" })
        );
    }
}
