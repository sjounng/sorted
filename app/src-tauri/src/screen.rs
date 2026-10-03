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
            let docs = lib.documents.iter().filter(|d| d.course == c.name);
            let file_count = docs.clone().map(|d| d.versions.len()).sum();
            let latest_week = docs
                .filter_map(|d| {
                    d.versions
                        .iter()
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
}
