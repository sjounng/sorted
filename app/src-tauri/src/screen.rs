//! 화면에 보내는 데이터 모양 (docs/app-api.md). 화면의 `app/src/api/types.ts`와 같은 모양이다.
//! Tauri에 의존하지 않는다. 명령은 lib.rs에 있다.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use sorted_core::library::Library;

/// 과목 카드 하나
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Course {
    pub id: String,
    pub name: String,
    /// LMS의 원래 과목 이름. 아직 확장이 보내지 않아 비어 있다
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lms_title: Option<String>,
    /// 학기. 아직 확장이 보내지 않아 빈 문자열이다
    pub term: String,
    /// 과목 폴더 안의 PDF 수 (버전마다 파일 하나)
    pub file_count: usize,
    /// 가장 최근에 받은 자료의 주차. 자료가 없으면 ""
    pub latest_week: String,
}

/// 목록에 있는 과목들을 화면 모양으로
pub fn courses(lib: &Library) -> Vec<Course> {
    lib.courses
        .iter()
        .map(|c| {
            // 정리 폴더에서 사라진 버전(missing)은 세지 않는다 (FR-14)
            let docs = lib.documents.iter().filter(|d| d.course == c.name);
            let file_count = docs
                .clone()
                .map(|d| d.versions.iter().filter(|v| !v.missing).count())
                .sum();
            let latest_week = docs
                .filter_map(|d| {
                    d.versions
                        .iter()
                        .filter(|v| !v.missing)
                        .map(|v| v.added_at_ms)
                        .max()
                        .map(|t| (t, d))
                })
                .max_by_key(|(t, _)| *t)
                .map(|(_, d)| d.week.clone())
                .unwrap_or_default();
            Course {
                id: c.id(),
                name: c.name.clone(),
                lms_title: None,
                term: String::new(),
                file_count,
                latest_week,
            }
        })
        .collect()
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Permission {
    Granted,
    Denied,
    /// 아직 다운로드 폴더를 읽어 본 적이 없다
    Unknown,
}

/// 첫 실행 설정 (FR-15)
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SetupStatus {
    pub downloads_access: Permission,
    pub sorted_folder: PathBuf,
    pub sorted_folder_created: bool,
    /// 확장에서 메시지를 받은 적이 있다
    pub extension_connected: bool,
}

/// 과목을 알아내지 못한 파일 (FR-5)
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssignRequest {
    pub file_id: String,
    pub file_name: String,
    /// 다운로드할 때 보던 탭 제목. 과목을 고르는 단서
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tab_title: Option<String>,
    pub at_ms: u64,
    pub courses: Vec<Course>,
}

/// 과목 지정 창에서 고른 것: 있는 과목 또는 새 과목
#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum AssignChoice {
    Existing {
        #[serde(rename = "courseId")]
        course_id: String,
    },
    New {
        #[serde(rename = "newCourseName")]
        new_course_name: String,
    },
}

const MAX_COURSE_NAME: usize = 40;

/// 과목명을 폴더 이름으로 쓸 수 있는지 본다. 문제가 없으면 None.
/// 화면(`app/src/api/validate.ts`)과 같은 규칙으로 한 번 더 막는다.
pub fn course_name_problem(name: &str, lib: &Library) -> Option<&'static str> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Some("과목명을 입력해 주세요.");
    }
    if trimmed.chars().count() > MAX_COURSE_NAME {
        return Some("과목명은 40자까지 쓸 수 있어요.");
    }
    if trimmed.contains(['/', ':']) {
        return Some("과목명에 / 나 : 는 쓸 수 없어요.");
    }
    if trimmed.starts_with('.') {
        return Some("과목명은 . 으로 시작할 수 없어요.");
    }
    if lib.courses.iter().any(|c| c.name == trimmed) {
        return Some("같은 이름의 과목이 이미 있어요.");
    }
    None
}

// ── 메인 창 (FR-13) ──

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    pub sorted_folder: PathBuf,
    pub courses: Vec<Course>,
    /// Sorted 휴지통에 있는 과목 수 (휴지통은 아직 없음)
    pub trash_count: usize,
    /// 최근 변경. 새것부터
    pub changes: Vec<Change>,
    /// 판정하지 못해 다운로드 폴더에 그대로 둔 파일. 새것부터
    pub unprocessed: Vec<Unprocessed>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ChangeKind {
    Organized,
    NewVersion,
    Duplicate,
}

/// 최근 변경 한 줄. 앱 데이터 폴더의 history.json에 남는다.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub id: String,
    pub kind: ChangeKind,
    pub document_id: String,
    pub course_id: String,
    pub course_name: String,
    pub file_name: String,
    /// 새 버전에서 바뀐 장 수 (변경 비교는 4단계)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub changed_pages: Option<u32>,
    pub at_ms: u64,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum UnprocessedReason {
    UnknownCourse,
    NotPdf,
    LoginExpired,
    MoveFailed,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Unprocessed {
    /// 받은 메시지 번호. `unknownCourse`면 assign_request·skip_assign의 fileId
    pub id: String,
    pub file_name: String,
    pub reason: UnprocessedReason,
    pub at_ms: u64,
}

// ── 중복 (FR-7) ──

/// 같은 문서·같은 내용을 다시 받았을 때 중복 안내 창에 보여 줄 것
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateNotice {
    pub id: String,
    /// 방금 받은 파일 이름
    pub file_name: String,
    pub course_name: String,
    pub week: String,
    pub existing_path: PathBuf,
    pub existing_saved_at_ms: u64,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DuplicateChoice {
    /// 기존 파일을 열고 방금 받은 복사본은 휴지통으로
    OpenExisting,
    /// 아무것도 지우지 않는다
    KeepBoth,
}

// ── 과목 화면 ──

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CourseDetail {
    pub course: Course,
    pub weeks: Vec<WeekGroup>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WeekGroup {
    pub week: String,
    pub files: Vec<CourseFile>,
}

/// 정리 폴더에 있는 PDF 하나 (문서의 버전 하나)
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CourseFile {
    pub id: String,
    pub document_id: String,
    pub file_name: String,
    pub path: PathBuf,
    pub version: u32,
    pub size_bytes: u64,
    pub saved_at_ms: u64,
    /// 새 버전을 아직 비교해 보지 않았다 (변경 비교는 4단계라 지금은 항상 false)
    pub unseen_change: bool,
}

/// 과목 하나의 자료 전체. 과목 ID가 없으면 None.
pub fn course_detail(lib: &Library, course_id: &str) -> Option<CourseDetail> {
    let course = courses(lib).into_iter().find(|c| c.id == course_id)?;
    let mut weeks: Vec<WeekGroup> = Vec::new();
    for doc in lib.documents.iter().filter(|d| d.course == course.name) {
        let files = doc
            .versions
            .iter()
            .filter(|v| !v.missing)
            .map(|v| CourseFile {
                id: format!("{}-v{}", doc.key.id(), v.number),
                document_id: doc.key.id(),
                file_name: v
                    .path
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_else(|| doc.file_name.clone()),
                path: v.path.clone(),
                version: v.number,
                size_bytes: v.size,
                saved_at_ms: v.added_at_ms,
                unseen_change: false,
            });
        match weeks.iter_mut().find(|w| w.week == doc.week) {
            Some(w) => w.files.extend(files),
            None => weeks.push(WeekGroup {
                week: doc.week.clone(),
                files: files.collect(),
            }),
        }
    }
    // 파일이 모두 사라진 주차는 보이지 않는다
    weeks.retain(|w| !w.files.is_empty());
    weeks.sort_by_key(|w| week_order(&w.week));
    for w in &mut weeks {
        w.files
            .sort_by(|a, b| (a.saved_at_ms, &a.file_name).cmp(&(b.saved_at_ms, &b.file_name)));
    }
    Some(CourseDetail { course, weeks })
}

/// 주차 정렬: "N주차"는 숫자 순서로 먼저, 숫자 없는 이름은 그 뒤 가나다순, 미분류는 맨 끝
fn week_order(week: &str) -> (u8, u32, String) {
    if week == sorted_core::organize::UNSORTED_WEEK {
        return (2, 0, String::new());
    }
    let digits: String = week.chars().take_while(char::is_ascii_digit).collect();
    match (
        digits.parse::<u32>(),
        week[digits.len()..].starts_with("주차"),
    ) {
        (Ok(n), true) => (0, n, String::new()),
        _ => (1, 0, week.to_owned()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use sorted_core::library::{DocKey, Document, Version};

    fn doc(course: &str, week: &str, added: &[u64]) -> Document {
        Document {
            key: DocKey::ContentId {
                value: format!("{course}{week}"),
            },
            course: course.into(),
            week: week.into(),
            file_name: "a.pdf".into(),
            versions: added
                .iter()
                .enumerate()
                .map(|(i, t)| Version {
                    number: i as u32 + 1,
                    sha256: String::new(),
                    size: 1,
                    path: PathBuf::from("/x"),
                    added_at_ms: *t,
                    missing: false,
                })
                .collect(),
        }
    }

    #[test]
    fn courses_count_files_and_find_latest_week() {
        let mut lib = Library::default();
        lib.remember_course(Some("210208"), "소프트웨어공학", &[]);
        lib.remember_course(None, "운영체제", &[]);
        lib.documents
            .push(doc("소프트웨어공학", "2주차", &[10, 50]));
        lib.documents.push(doc("소프트웨어공학", "3주차", &[30]));

        let cs = courses(&lib);
        assert_eq!(cs[0].id, "210208");
        assert_eq!(cs[0].file_count, 3);
        assert_eq!(cs[0].latest_week, "2주차");
        assert_eq!(cs[1].file_count, 0);
        assert_eq!(cs[1].latest_week, "");

        let v = serde_json::to_value(&cs[0]).unwrap();
        assert_eq!(v["fileCount"], 3);
        assert!(v.get("lmsTitle").is_none());
    }

    #[test]
    fn assign_choice_reads_both_shapes() {
        let a: AssignChoice = serde_json::from_value(json!({ "courseId": "210208" })).unwrap();
        assert_eq!(
            a,
            AssignChoice::Existing {
                course_id: "210208".into()
            }
        );
        let b: AssignChoice =
            serde_json::from_value(json!({ "newCourseName": "운영체제" })).unwrap();
        assert_eq!(
            b,
            AssignChoice::New {
                new_course_name: "운영체제".into()
            }
        );
    }

    #[test]
    fn course_names_follow_the_screen_rules() {
        let mut lib = Library::default();
        lib.remember_course(None, "운영체제", &[]);
        assert!(course_name_problem("  ", &lib).is_some());
        assert!(course_name_problem(&"가".repeat(41), &lib).is_some());
        assert!(course_name_problem("a/b", &lib).is_some());
        assert!(course_name_problem(".hidden", &lib).is_some());
        assert!(course_name_problem(" 운영체제 ", &lib).is_some());
        assert!(course_name_problem(&"가".repeat(40), &lib).is_none());
        assert!(course_name_problem("데이터베이스", &lib).is_none());
    }

    #[test]
    fn permission_is_lowercase() {
        assert_eq!(
            serde_json::to_value(Permission::Granted).unwrap(),
            "granted"
        );
    }

    #[test]
    fn course_detail_groups_by_week_in_order() {
        let mut lib = Library::default();
        lib.remember_course(Some("210208"), "소프트웨어공학", &[]);
        lib.documents.push(doc("소프트웨어공학", "10주차", &[5]));
        lib.documents.push(doc("소프트웨어공학", "미분류", &[1]));
        lib.documents.push(doc("소프트웨어공학", "Unit-1", &[2]));
        lib.documents.push(doc("소프트웨어공학", "2주차", &[3, 9]));

        let d = course_detail(&lib, "210208").unwrap();
        let weeks: Vec<&str> = d.weeks.iter().map(|w| w.week.as_str()).collect();
        assert_eq!(weeks, ["2주차", "10주차", "Unit-1", "미분류"]);
        let two = &d.weeks[0].files;
        assert_eq!(two.len(), 2);
        assert_eq!(two[0].version, 1);
        assert_eq!(two[1].id, format!("{}-v2", two[1].document_id));
        assert!(course_detail(&lib, "nope").is_none());
    }

    #[test]
    fn missing_versions_are_hidden() {
        let mut lib = Library::default();
        lib.remember_course(Some("210208"), "소프트웨어공학", &[]);
        lib.documents.push(doc("소프트웨어공학", "2주차", &[3, 9]));
        lib.documents.push(doc("소프트웨어공학", "3주차", &[5]));
        lib.documents[0].versions[1].missing = true;
        lib.documents[1].versions[0].missing = true;

        let c = &courses(&lib)[0];
        assert_eq!((c.file_count, c.latest_week.as_str()), (1, "2주차"));
        let d = course_detail(&lib, "210208").unwrap();
        assert_eq!(d.weeks.len(), 1, "파일이 모두 사라진 주차는 보이지 않는다");
        assert_eq!(d.weeks[0].files.len(), 1);
    }
}
