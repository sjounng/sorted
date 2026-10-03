//! 받은 파일을 `~/Sorted/<과목명>/<주차>/<원래 파일명>`으로 옮긴다 (FR-6).
//!
//! - 원래 파일 이름은 바꾸지 않는다. 새 버전만 끝에 ` (v2)`를 붙인다 (FR-8).
//! - 같은 이름의 파일이 이미 있으면 덮어쓰지 않고 ` (2)`, ` (3)`…을 붙인다.
//! - 주차를 모르면 `미분류` 폴더에 둔다 (FR-12).

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

pub const UNSORTED_WEEK: &str = "미분류";

/// 폴더·파일 이름으로 쓸 수 없는 글자를 바꾼다. 비면 `미분류`.
pub fn safe_component(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '/' | ':' | '\\' => '-',
            c if c.is_control() => ' ',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_start_matches('.').trim();
    if trimmed.is_empty() {
        UNSORTED_WEEK.to_owned()
    } else {
        trimmed.to_owned()
    }
}

/// `name.pdf` → `name (v2).pdf` (version이 2 이상일 때만)
pub fn versioned_name(file_name: &str, version: u32) -> String {
    if version < 2 {
        return file_name.to_owned();
    }
    let (stem, ext) = split_ext(file_name);
    format!("{stem} (v{version}){ext}")
}

/// 정리 폴더 안에서 이 파일이 갈 자리 (아직 이름 겹침은 보지 않음)
pub fn destination(root: &Path, course: &str, week: Option<&str>, file_name: &str) -> PathBuf {
    root.join(safe_component(course))
        .join(safe_component(week.unwrap_or(UNSORTED_WEEK)))
        .join(safe_component(file_name))
}

/// 이미 있는 이름이면 ` (2)`, ` (3)`…을 붙여 빈 자리를 찾는다.
pub fn free_path(path: &Path) -> PathBuf {
    if !path.exists() {
        return path.to_owned();
    }
    let file_name = path
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let (stem, ext) = split_ext(&file_name);
    let dir = path.parent().unwrap_or(Path::new("."));
    (2..)
        .map(|n| dir.join(format!("{stem} ({n}){ext}")))
        .find(|p| !p.exists())
        .expect("some number is free")
}

/// 파일을 옮기고 실제로 놓인 경로를 돌려준다. 폴더가 없으면 만든다.
/// 다른 디스크로 옮길 때는 복사한 뒤 원본을 지운다.
pub fn move_into(src: &Path, dest: &Path) -> io::Result<PathBuf> {
    if let Some(dir) = dest.parent() {
        fs::create_dir_all(dir)?;
    }
    let target = free_path(dest);
    match fs::rename(src, &target) {
        Ok(()) => Ok(target),
        Err(e) if e.raw_os_error() == Some(18) => {
            // EXDEV: 다른 파일 시스템
            fs::copy(src, &target)?;
            fs::remove_file(src)?;
            Ok(target)
        }
        Err(e) => Err(e),
    }
}

/// 다운로드 경로에서 원래 파일 이름을 꺼낸다. Chrome이 붙인 ` (1)` 같은 번호는 뗀다.
/// `/Users/me/Downloads/Lec03 (2).pdf` → `Lec03.pdf`
pub fn original_name(path: &Path) -> String {
    let file = path
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let (stem, ext) = split_ext(&file);
    let stem = match stem.rfind(" (") {
        Some(i)
            if stem.ends_with(')')
                && stem.len() > i + 3
                && stem[i + 2..stem.len() - 1]
                    .chars()
                    .all(|c| c.is_ascii_digit()) =>
        {
            &stem[..i]
        }
        _ => stem,
    };
    format!("{stem}{ext}")
}

fn split_ext(file_name: &str) -> (&str, &str) {
    match file_name.rfind('.') {
        Some(i) if i > 0 => (&file_name[..i], &file_name[i..]),
        _ => (file_name, ""),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("sorted-org-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn safe_components() {
        assert_eq!(safe_component("소프트웨어공학"), "소프트웨어공학");
        assert_eq!(safe_component("A/B: C"), "A-B- C");
        assert_eq!(safe_component("  .hidden "), "hidden");
        assert_eq!(safe_component(".."), UNSORTED_WEEK);
        assert_eq!(safe_component(""), UNSORTED_WEEK);
    }

    #[test]
    fn original_names() {
        assert_eq!(original_name(Path::new("/d/Lec03 (2).pdf")), "Lec03.pdf");
        assert_eq!(original_name(Path::new("/d/Lec03.pdf")), "Lec03.pdf");
        assert_eq!(original_name(Path::new("/d/Ch (A).pdf")), "Ch (A).pdf");
        assert_eq!(original_name(Path::new("/d/x ().pdf")), "x ().pdf");
    }

    #[test]
    fn version_suffix() {
        assert_eq!(versioned_name("lec.pdf", 1), "lec.pdf");
        assert_eq!(versioned_name("lec.pdf", 2), "lec (v2).pdf");
        assert_eq!(versioned_name("notes", 3), "notes (v3)");
    }

    #[test]
    fn destination_layout() {
        let d = destination(Path::new("/S"), "소프트웨어공학", Some("2주차"), "a.pdf");
        assert_eq!(d, PathBuf::from("/S/소프트웨어공학/2주차/a.pdf"));
        let d = destination(Path::new("/S"), "OS", None, "a.pdf");
        assert_eq!(d, PathBuf::from("/S/OS/미분류/a.pdf"));
    }

    #[test]
    fn moves_without_overwriting() {
        let dir = temp("move");
        let dest = dir.join("Sorted/과목/1주차/a.pdf");
        for (i, body) in ["one", "two", "three"].iter().enumerate() {
            let src = dir.join(format!("dl{i}.pdf"));
            fs::write(&src, body).unwrap();
            let placed = move_into(&src, &dest).unwrap();
            assert!(!src.exists());
            assert_eq!(fs::read_to_string(&placed).unwrap(), *body);
        }
        let names: Vec<_> = {
            let mut v: Vec<_> = fs::read_dir(dest.parent().unwrap())
                .unwrap()
                .map(|e| e.unwrap().file_name().into_string().unwrap())
                .collect();
            v.sort();
            v
        };
        assert_eq!(names, vec!["a (2).pdf", "a (3).pdf", "a.pdf"]);
        assert_eq!(fs::read_to_string(&dest).unwrap(), "one");
    }

    #[test]
    fn missing_source_is_an_error() {
        let dir = temp("missing");
        assert!(move_into(&dir.join("nope.pdf"), &dir.join("out/a.pdf")).is_err());
    }
}
