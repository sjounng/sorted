//! 스파이크 #3: 다운로드 하나로 남은 가정 다섯 개를 한꺼번에 확인한다.
//!
//! | 가정 | 무엇을 보나                                           |
//! | ---- | ----------------------------------------------------- |
//! | 1    | 확장이 보낸 과목 ID (referrer / 활성 탭 / 다운로드 URL) |
//! | 2    | 같은 이름의 파일을 전에 받았을 때와 content_id가 같은가 |
//! | 3    | 같은 이름의 파일을 전에 받았을 때와 SHA-256이 같은가    |
//! | 4    | 앱이 다운로드 폴더의 파일을 읽을 수 있는가              |
//! | 5    | LMS에서 알아낸 과목명·주차 (확장이 조회), PDF 첫 페이지 |
//!
//! 가정 2·3은 날을 바꿔 다시 받아야 비교되므로, 받을 때마다 기록(`probe-history.jsonl`)을 남긴다.
//! 기록에는 파일 이름, content_id, 해시, 과목 ID만 둔다. 전체 경로(사용자 이름 포함)와 URL은 남기지 않는다.

use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::os::unix::fs::OpenOptionsExt;
use std::panic;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sorted_core::fingerprint;

/// 화면에 보여 줄 첫 페이지 글자 수
const FIRST_PAGE_CHARS: usize = 300;

// ── 확장이 보내는 메시지 (extension/src/lms.js의 buildDownloadMessage) ──

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct DownloadMessage {
    filename: String,
    content_id: Option<String>,
    file_name_param: Option<String>,
    course_id: CourseIds,
    tab: Option<Tab>,
    module_item_id: Option<String>,
    /// 확장이 LMS에 물어본 과목명·주차 (extension/src/canvas.js)
    lms: Option<Value>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct CourseIds {
    pub referrer: Option<String>,
    pub tab: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct Tab {
    title: Option<String>,
}

// ── 결과 ──

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Probe {
    /// 비교에 쓰는 이름 (LMS의 file_name, 없으면 정규화한 파일명)
    pub name: String,
    pub content_id: Option<String>,
    pub course_id: CourseIds,
    pub tab_title: Option<String>,
    /// 다운로드 때 보던 자료 뷰어의 모듈 항목 번호
    pub module_item_id: Option<String>,
    /// LMS에서 알아낸 과목명·주차 (가정 5)
    pub lms: Option<Value>,
    pub file: FileCheck,
    pub first_page: FirstPage,
    /// 같은 이름으로 전에 받은 기록. 처음 받는 파일이면 None
    pub previous: Option<Previous>,
}

#[derive(Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileCheck {
    pub readable: bool,
    /// 읽지 못했을 때의 이유. 권한 문제면 "permission denied"가 들어간다
    pub error: Option<String>,
    pub size: Option<u64>,
    pub is_pdf: Option<bool>,
    pub sha256: Option<String>,
}

#[derive(Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FirstPage {
    pub text: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Previous {
    pub recorded_at_ms: u64,
    pub content_id: Option<String>,
    pub content_id_same: bool,
    /// 이번이나 지난번에 파일을 못 읽었으면 None
    pub sha256_same: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistoryRecord {
    recorded_at_ms: u64,
    name: String,
    content_id: Option<String>,
    sha256: Option<String>,
    course_id: Option<String>,
}

/// 다운로드 메시지 하나를 확인하고 기록을 남긴다.
pub fn run(message: &Value, history: &Path) -> Result<Probe, String> {
    let msg: DownloadMessage =
        serde_json::from_value(message.clone()).map_err(|e| format!("bad message: {e}"))?;
    let path = Path::new(&msg.filename);
    let name = msg
        .file_name_param
        .clone()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| normalize_name(path));

    // 가정 4: 파일 읽기 + 지문
    let file = match fingerprint::of_file(path) {
        Ok(fp) => FileCheck {
            readable: true,
            error: None,
            size: Some(fp.size),
            is_pdf: Some(fp.is_pdf),
            sha256: Some(fp.sha256),
        },
        Err(e) => FileCheck {
            readable: false,
            error: Some(format!("{:?}: {e}", e.kind())),
            ..Default::default()
        },
    };

    // 가정 5: 첫 페이지 글자
    let first_page = if file.is_pdf == Some(true) {
        match first_page_text(path) {
            Ok(text) => FirstPage {
                text: Some(text),
                error: None,
            },
            Err(e) => FirstPage {
                text: None,
                error: Some(e),
            },
        }
    } else {
        FirstPage {
            text: None,
            error: Some("PDF가 아니거나 읽지 못함".into()),
        }
    };

    // 가정 2·3: 같은 이름의 지난 기록과 비교
    let previous = last_record(history, &name).map(|prev| Previous {
        recorded_at_ms: prev.recorded_at_ms,
        content_id_same: prev.content_id == msg.content_id,
        content_id: prev.content_id,
        sha256_same: match (&prev.sha256, &file.sha256) {
            (Some(a), Some(b)) => Some(a == b),
            _ => None,
        },
    });

    append_record(
        history,
        &HistoryRecord {
            recorded_at_ms: now_ms(),
            name: name.clone(),
            content_id: msg.content_id.clone(),
            sha256: file.sha256.clone(),
            course_id: msg
                .course_id
                .tab
                .clone()
                .or_else(|| msg.course_id.referrer.clone()),
        },
    )
    .map_err(|e| format!("history: {e}"))?;

    Ok(Probe {
        name,
        content_id: msg.content_id,
        course_id: msg.course_id,
        tab_title: msg.tab.and_then(|t| t.title),
        module_item_id: msg.module_item_id,
        lms: msg.lms,
        file,
        first_page,
        previous,
    })
}

/// 파일 이름에서 Chrome이 붙이는 ` (1)` 같은 번호를 뗀다.
/// `/x/Lec03 (2).pdf` → `Lec03.pdf`
pub fn normalize_name(path: &Path) -> String {
    let file = path
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let (stem, ext) = match file.rfind('.') {
        Some(i) if i > 0 => (&file[..i], &file[i..]),
        _ => (file.as_str(), ""),
    };
    let stem = match stem.rfind(" (") {
        Some(i)
            if stem.ends_with(')')
                && stem[i + 2..stem.len() - 1]
                    .chars()
                    .all(|c| c.is_ascii_digit())
                && stem.len() > i + 3 =>
        {
            &stem[..i]
        }
        _ => stem,
    };
    format!("{stem}{ext}")
}

/// PDF 첫 페이지의 글자. 손상된 PDF에서 라이브러리가 패닉해도 앱은 죽지 않게 한다.
fn first_page_text(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let pages = panic::catch_unwind(|| pdf_extract::extract_text_from_mem_by_pages(&bytes))
        .map_err(|_| "PDF 해석 중 오류 (panic)".to_string())?
        .map_err(|e| e.to_string())?;
    let first = pages.into_iter().next().unwrap_or_default();
    let compact = first.split_whitespace().collect::<Vec<_>>().join(" ");
    Ok(compact.chars().take(FIRST_PAGE_CHARS).collect())
}

fn last_record(history: &Path, name: &str) -> Option<HistoryRecord> {
    let file = fs::File::open(history).ok()?;
    BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .filter_map(|line| serde_json::from_str::<HistoryRecord>(&line).ok())
        .filter(|r| r.name == name)
        .last()
}

fn append_record(history: &Path, record: &HistoryRecord) -> std::io::Result<()> {
    let mut line = serde_json::to_vec(record)?;
    line.push(b'\n');
    OpenOptions::new()
        .create(true)
        .append(true)
        .mode(0o600)
        .open(history)?
        .write_all(&line)
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
    use std::path::PathBuf;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("sorted-probe-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn message(file: &Path, content_id: &str) -> Value {
        json!({
            "type": "download",
            "filename": file.to_string_lossy(),
            "contentId": content_id,
            "fileNameParam": "Lec03.pdf",
            "courseId": { "referrer": null, "tab": "210208", "url": null },
            "tab": { "url": "https://learning.hanyang.ac.kr/courses/210208", "title": "소프트웨어공학" },
            "moduleItemId": "8582053",
            "lms": { "courseName": "소프트웨어공학", "courseCode": "HY11171",
                     "week": { "name": "1주차", "position": 1, "matchedBy": "item" }, "error": null }
        })
    }

    #[test]
    fn first_download_has_no_previous_record() {
        let dir = temp_dir("first");
        let file = dir.join("Lec03.pdf");
        fs::write(&file, b"not really a pdf").unwrap();

        let p = run(&message(&file, "c1"), &dir.join("h.jsonl")).unwrap();
        assert!(p.file.readable);
        assert_eq!(p.file.is_pdf, Some(false));
        assert_eq!(p.course_id.tab.as_deref(), Some("210208"));
        assert_eq!(p.tab_title.as_deref(), Some("소프트웨어공학"));
        assert_eq!(p.lms.unwrap()["week"]["name"], "1주차");
        assert_eq!(p.module_item_id.as_deref(), Some("8582053"));
        assert!(p.previous.is_none());
        assert!(p.first_page.text.is_none());
    }

    #[test]
    fn second_download_is_compared_with_the_first() {
        let dir = temp_dir("second");
        let history = dir.join("h.jsonl");
        let a = dir.join("Lec03.pdf");
        let b = dir.join("Lec03 (1).pdf");
        fs::write(&a, b"same bytes").unwrap();
        fs::write(&b, b"same bytes").unwrap();

        run(&message(&a, "c1"), &history).unwrap();
        let p = run(&message(&b, "c1"), &history).unwrap();
        let prev = p.previous.unwrap();
        assert!(prev.content_id_same);
        assert_eq!(prev.sha256_same, Some(true));

        fs::write(&b, b"changed bytes").unwrap();
        let p = run(&message(&b, "c2"), &history).unwrap();
        let prev = p.previous.unwrap();
        assert!(!prev.content_id_same);
        assert_eq!(prev.content_id.as_deref(), Some("c1"));
        assert_eq!(prev.sha256_same, Some(false));
    }

    #[test]
    fn unreadable_file_is_reported_not_fatal() {
        let dir = temp_dir("missing");
        let p = run(&message(&dir.join("gone.pdf"), "c1"), &dir.join("h.jsonl")).unwrap();
        assert!(!p.file.readable);
        assert!(p.file.error.unwrap().contains("NotFound"));
    }

    #[test]
    fn history_has_no_paths_or_urls() {
        let dir = temp_dir("privacy");
        let history = dir.join("h.jsonl");
        let file = dir.join("Lec03.pdf");
        fs::write(&file, b"x").unwrap();
        run(&message(&file, "c1"), &history).unwrap();
        let text = fs::read_to_string(&history).unwrap();
        assert!(!text.contains(&*dir.to_string_lossy()));
        assert!(!text.contains("http"));
    }

    #[test]
    fn normalizes_chrome_duplicate_suffix() {
        assert_eq!(normalize_name(Path::new("/d/Lec03 (2).pdf")), "Lec03.pdf");
        assert_eq!(normalize_name(Path::new("/d/Lec03 (12).pdf")), "Lec03.pdf");
        assert_eq!(normalize_name(Path::new("/d/Lec03.pdf")), "Lec03.pdf");
        assert_eq!(normalize_name(Path::new("/d/Ch (A).pdf")), "Ch (A).pdf");
        assert_eq!(normalize_name(Path::new("/d/notes")), "notes");
        assert_eq!(normalize_name(Path::new("/d/x ().pdf")), "x ().pdf");
    }
}
