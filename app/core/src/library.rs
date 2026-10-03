//! Sorted가 정리한 강의자료 목록. 앱 데이터 폴더의 `library.json`에 저장한다.
//!
//! 과목(Course) → 문서(Document) → 버전(Version). 문서는 "같은 강의자료"이고,
//! 버전은 그 자료의 내용(SHA-256)이 바뀔 때마다 하나씩 늘어난다.
//!
//! 저장하는 것: 과목명·과목 ID·과목 코드, 문서 키, 해시·크기·경로·받은 시각.
//! 저장하지 않는 것: 학번, URL, LMS 응답 원문.

use std::fs;
use std::io;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Library {
    pub courses: Vec<Course>,
    pub documents: Vec<Document>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Course {
    /// LMS 과목 ID (예: "210208"). 사용자가 직접 지정한 과목이면 없을 수 있다.
    pub lms_id: Option<String>,
    /// 폴더 이름으로 쓰는 과목명 (예: "소프트웨어공학")
    pub name: String,
    /// 파일명·첫 페이지에서 본 과목 코드 (예: "CSE406"). 과목 ID를 모를 때 과목을 찾는 데 쓴다.
    #[serde(default)]
    pub codes: Vec<String>,
}

impl Course {
    /// 화면이 쓰는 과목 ID. LMS 과목이면 LMS 과목 ID, 직접 지정한 과목이면 `local-` + 과목명 해시.
    /// 화면이 창 이름에 쓰므로 영문·숫자·`-`만 들어간다 (docs/app-api.md).
    pub fn id(&self) -> String {
        match &self.lms_id {
            Some(id) => id.clone(),
            None => {
                let hash = Sha256::digest(self.name.as_bytes());
                let hex: String = hash.iter().take(6).map(|b| format!("{b:02x}")).collect();
                format!("local-{hex}")
            }
        }
    }
}

/// 같은 강의자료를 알아보는 기준. 위에 있는 것일수록 믿을 만하다 (FR-3).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DocKey {
    /// LMS 다운로드 URL의 content_id. 자료마다 다르고 다시 받아도 같다 (스파이크 #3)
    ContentId { value: String },
    /// LMS 모듈 항목 번호 (자료 뷰어 주소의 modules/items/<번호>)
    ModuleItem { value: String },
    /// 둘 다 없을 때: 과목 + 정규화한 파일 이름
    Name { course: String, name: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub key: DocKey,
    pub course: String,
    pub week: String,
    /// 원래 파일 이름 (확장자 포함)
    pub file_name: String,
    pub versions: Vec<Version>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Version {
    /// 1부터. 2 이상이면 파일 이름 끝에 (v2) 같은 표시가 붙는다
    pub number: u32,
    pub sha256: String,
    pub size: u64,
    pub path: PathBuf,
    pub added_at_ms: u64,
}

impl Library {
    /// 파일이 없으면 빈 목록. 파일이 깨져 있으면 오류 (덮어쓰지 않게).
    pub fn load(path: &Path) -> io::Result<Self> {
        match fs::read(path) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e)),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(Self::default()),
            Err(e) => Err(e),
        }
    }

    /// 임시 파일에 쓴 뒤 이름을 바꿔서, 쓰는 도중 앱이 꺼져도 목록이 깨지지 않게 한다.
    pub fn save(&self, path: &Path) -> io::Result<()> {
        let tmp = path.with_extension("json.tmp");
        let bytes = serde_json::to_vec_pretty(self)?;
        fs::write(&tmp, bytes)?;
        fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600))?;
        fs::rename(tmp, path)
    }

    pub fn document(&self, key: &DocKey) -> Option<&Document> {
        self.documents.iter().find(|d| &d.key == key)
    }

    pub fn document_mut(&mut self, key: &DocKey) -> Option<&mut Document> {
        self.documents.iter_mut().find(|d| &d.key == key)
    }

    pub fn course_by_lms_id(&self, id: &str) -> Option<&Course> {
        self.courses
            .iter()
            .find(|c| c.lms_id.as_deref() == Some(id))
    }

    /// 화면이 쓰는 과목 ID(`Course::id`)로 찾는다.
    pub fn course_by_id(&self, id: &str) -> Option<&Course> {
        self.courses.iter().find(|c| c.id() == id)
    }

    pub fn course_by_code(&self, code: &str) -> Option<&Course> {
        self.courses
            .iter()
            .find(|c| c.codes.iter().any(|k| k == code))
    }

    /// 과목을 기억한다. 같은 과목 ID나 이름이 있으면 합친다.
    pub fn remember_course(&mut self, lms_id: Option<&str>, name: &str, codes: &[String]) {
        let existing = self
            .courses
            .iter_mut()
            .find(|c| (lms_id.is_some() && c.lms_id.as_deref() == lms_id) || c.name == name);
        let course = match existing {
            Some(c) => {
                if c.lms_id.is_none() {
                    c.lms_id = lms_id.map(str::to_owned);
                }
                c.name = name.to_owned();
                c
            }
            None => {
                self.courses.push(Course {
                    lms_id: lms_id.map(str::to_owned),
                    name: name.to_owned(),
                    codes: Vec::new(),
                });
                self.courses.last_mut().expect("just pushed")
            }
        };
        for code in codes {
            if !course.codes.contains(code) {
                course.codes.push(code.clone());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("sorted-lib-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir.join("library.json")
    }

    fn sample() -> Library {
        let mut lib = Library::default();
        lib.remember_course(Some("210208"), "소프트웨어공학", &["CSE406".into()]);
        lib.documents.push(Document {
            key: DocKey::ContentId {
                value: "6a913a6546923".into(),
            },
            course: "소프트웨어공학".into(),
            week: "1주차".into(),
            file_name: "cse406-lec-00-v3.pdf".into(),
            versions: vec![Version {
                number: 1,
                sha256: "ab".repeat(32),
                size: 10,
                path: "/x/a.pdf".into(),
                added_at_ms: 1,
            }],
        });
        lib
    }

    #[test]
    fn missing_file_is_an_empty_library() {
        assert_eq!(Library::load(&temp("missing")).unwrap(), Library::default());
    }

    #[test]
    fn save_and_load_round_trip() {
        let path = temp("round");
        let lib = sample();
        lib.save(&path).unwrap();
        assert_eq!(Library::load(&path).unwrap(), lib);
        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }

    #[test]
    fn corrupt_file_is_an_error_not_an_empty_library() {
        let path = temp("corrupt");
        fs::write(&path, b"{not json").unwrap();
        assert_eq!(
            Library::load(&path).unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );
    }

    #[test]
    fn remember_course_merges_by_id_and_name() {
        let mut lib = sample();
        lib.remember_course(
            Some("210208"),
            "소프트웨어공학",
            &["CSE406".into(), "SE".into()],
        );
        lib.remember_course(None, "소프트웨어공학", &[]);
        assert_eq!(lib.courses.len(), 1);
        assert_eq!(lib.courses[0].codes, vec!["CSE406", "SE"]);

        lib.remember_course(None, "운영체제", &["CSE321".into()]);
        assert_eq!(lib.courses.len(), 2);
        assert_eq!(lib.course_by_code("CSE321").unwrap().name, "운영체제");
        assert_eq!(
            lib.course_by_lms_id("210208").unwrap().name,
            "소프트웨어공학"
        );
    }

    #[test]
    fn documents_are_found_by_key() {
        let lib = sample();
        let key = DocKey::ContentId {
            value: "6a913a6546923".into(),
        };
        assert_eq!(lib.document(&key).unwrap().week, "1주차");
        assert!(lib
            .document(&DocKey::ModuleItem {
                value: "6a913a6546923".into()
            })
            .is_none());
    }

    #[test]
    fn course_id_is_lms_id_or_ascii_local_id() {
        let mut lib = Library::default();
        lib.remember_course(Some("210208"), "소프트웨어공학", &[]);
        lib.remember_course(None, "운영체제", &[]);
        assert_eq!(lib.courses[0].id(), "210208");
        let local = lib.courses[1].id();
        assert!(local.starts_with("local-") && local.len() == "local-".len() + 12);
        assert!(local.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'));
        assert_eq!(lib.course_by_id(&local).unwrap().name, "운영체제");
        assert!(lib.course_by_id("nope").is_none());
    }
}
