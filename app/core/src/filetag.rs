//! 정리한 파일에 새기는 속성 (FR-14).
//!
//! 사용자가 `~/Sorted` 안에서 파일을 옮기거나 이름을 바꿔도 같은 문서로 알아보도록,
//! 앱이 정리한 파일에 확장 속성(xattr) `dev.sorted.doc`을 붙인다. 같은 디스크 안에서
//! 옮기거나 이름을 바꾸면 속성도 따라간다.
//!
//! 새기는 것: 과목 ID, 문서 ID(content_id 등에서 만든 것), 버전 번호.
//! 새기지 않는 것: URL, 학번 (기획안 "파일에 새기는 속성").
//! 이 속성이 없는 파일은 앱이 넣지 않은 파일이므로 건드리지 않는다.

use std::io;
use std::path::Path;

use serde::{Deserialize, Serialize};

pub const ATTR: &str = "dev.sorted.doc";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Tag {
    /// 과목 ID (`Course::id`)
    pub course: String,
    /// 문서 ID (`DocKey::id`)
    pub doc: String,
    /// 버전 번호
    pub v: u32,
    /// 원본을 열어 새로 필기한 사본이면 그 번호 (2부터). 받은 파일 자체면 없음
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub copy: Option<u32>,
}

pub fn write(path: &Path, tag: &Tag) -> io::Result<()> {
    xattr::set(path, ATTR, &serde_json::to_vec(tag)?)
}

/// 앱이 새긴 속성. 없거나 읽을 수 없으면 None.
pub fn read(path: &Path) -> Option<Tag> {
    let bytes = xattr::get(path, ATTR).ok()??;
    serde_json::from_slice(&bytes).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn tag_follows_rename() {
        let dir = std::env::temp_dir().join(format!("sorted-tag-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("moved")).unwrap();
        let file = dir.join("a.pdf");
        fs::write(&file, "%PDF-1.7").unwrap();
        assert_eq!(read(&file), None);

        let tag = Tag {
            course: "210208".into(),
            doc: "cid-6aa284ef1cf74".into(),
            v: 2,
            copy: None,
        };
        write(&file, &tag).unwrap();
        assert_eq!(read(&file), Some(tag.clone()));

        let moved = dir.join("moved/이름 바꿈.pdf");
        fs::rename(&file, &moved).unwrap();
        assert_eq!(read(&moved), Some(tag));
    }
}
