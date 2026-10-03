//! 같은 문서인지(FR-3), 같은 버전인지(FR-4) 판정한다.

use crate::library::{DocKey, Library};
use std::path::PathBuf;

/// 문서를 알아볼 기준을 고른다: content_id → 모듈 항목 번호 → 과목 + 정규화한 파일 이름
pub fn doc_key(
    content_id: Option<&str>,
    module_item_id: Option<&str>,
    course: &str,
    file_name: &str,
) -> DocKey {
    let nonempty = |s: Option<&str>| {
        s.map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
    };
    if let Some(value) = nonempty(content_id) {
        DocKey::ContentId { value }
    } else if let Some(value) = nonempty(module_item_id) {
        DocKey::ModuleItem { value }
    } else {
        DocKey::Name {
            course: course.to_owned(),
            name: normalize_name(file_name),
        }
    }
}

/// 비교용 이름: 확장자, Chrome이 붙인 ` (1)`, 버전 표시(`v2`, `final`, `수정`), 대소문자를 무시한다.
/// `Lec03_v2 (1).PDF` → `lec03`
pub fn normalize_name(file_name: &str) -> String {
    let mut s = file_name.trim().to_lowercase();
    if let Some(stripped) = s.strip_suffix(".pdf") {
        s = stripped.to_owned();
    }
    // Chrome 중복 번호 " (12)"
    if let Some(i) = s.rfind(" (") {
        let inner = &s[i + 2..];
        if inner.ends_with(')')
            && inner.len() > 1
            && inner[..inner.len() - 1].chars().all(|c| c.is_ascii_digit())
        {
            s.truncate(i);
        }
    }
    // 끝의 버전 표시
    loop {
        let before = s.clone();
        for suffix in ["final", "수정", "최종"] {
            if let Some(t) = s.strip_suffix(suffix) {
                s = t.to_owned();
            }
        }
        if let Some(i) = s.rfind('v') {
            let tail = &s[i + 1..];
            if !tail.is_empty() && tail.chars().all(|c| c.is_ascii_digit()) {
                s.truncate(i);
            }
        }
        s = s.trim_end_matches(['_', '-', ' ', '.']).to_owned();
        if s == before {
            break;
        }
    }
    s
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    /// 처음 보는 문서
    New,
    /// 같은 문서의 같은 내용을 이미 가지고 있음 (FR-7: 사용자에게 묻는다)
    Duplicate { existing: PathBuf },
    /// 같은 문서의 새 내용 (FR-8: 번호를 붙여 따로 저장)
    NewVersion { number: u32 },
}

pub fn decide(lib: &Library, key: &DocKey, sha256: &str) -> Decision {
    let Some(doc) = lib.document(key) else {
        return Decision::New;
    };
    if let Some(v) = doc.versions.iter().find(|v| v.sha256 == sha256) {
        return Decision::Duplicate {
            existing: v.path.clone(),
        };
    }
    let last = doc.versions.iter().map(|v| v.number).max().unwrap_or(0);
    Decision::NewVersion { number: last + 1 }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::{Document, Version};

    #[test]
    fn key_preference() {
        assert_eq!(
            doc_key(Some("c1"), Some("m1"), "OS", "a.pdf"),
            DocKey::ContentId { value: "c1".into() }
        );
        assert_eq!(
            doc_key(Some(" "), Some("m1"), "OS", "a.pdf"),
            DocKey::ModuleItem { value: "m1".into() }
        );
        assert_eq!(
            doc_key(None, None, "OS", "Lec03_v2 (1).PDF"),
            DocKey::Name {
                course: "OS".into(),
                name: "lec03".into()
            }
        );
    }

    #[test]
    fn normalizes_names() {
        assert_eq!(normalize_name("cse406-lec-00-v3.pdf"), "cse406-lec-00");
        assert_eq!(normalize_name("Lec03 (2).pdf"), "lec03");
        assert_eq!(normalize_name("과제안내_수정.pdf"), "과제안내");
        assert_eq!(normalize_name("report-final-v2.pdf"), "report");
        assert_eq!(normalize_name("Chapter (A).pdf"), "chapter (a)");
        assert_eq!(normalize_name("dev.pdf"), "dev"); // v 뒤에 숫자가 없으면 그대로
    }

    fn lib_with(sha: &str) -> (Library, DocKey) {
        let key = DocKey::ContentId { value: "c1".into() };
        let mut lib = Library::default();
        lib.documents.push(Document {
            key: key.clone(),
            course: "OS".into(),
            week: "1주차".into(),
            file_name: "a.pdf".into(),
            versions: vec![Version {
                number: 1,
                sha256: sha.into(),
                size: 1,
                path: "/S/OS/1주차/a.pdf".into(),
                added_at_ms: 0,
            }],
        });
        (lib, key)
    }

    #[test]
    fn decisions() {
        let (lib, key) = lib_with("h1");
        assert_eq!(
            decide(
                &lib,
                &DocKey::ContentId {
                    value: "other".into()
                },
                "h1"
            ),
            Decision::New
        );
        assert_eq!(
            decide(&lib, &key, "h1"),
            Decision::Duplicate {
                existing: "/S/OS/1주차/a.pdf".into()
            }
        );
        assert_eq!(decide(&lib, &key, "h2"), Decision::NewVersion { number: 2 });
    }
}
