//! 일정 (FR-19). 확장이 LMS에서 읽어 보낸 일정을 출처별로 덮어써 앱 데이터 폴더의
//! schedule.json에 저장한다. 한쪽 출처를 다시 받아도 다른 쪽은 남는다.
//! 출처: `planner`(과제·퀴즈·화상 강의, 모든 과목), `weekly:<과목 ID>`(주차학습 영상, 과목 하나씩).
//! Tauri에 의존하지 않는다. 명령은 lib.rs에 있다 (docs/app-api.md).

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 받는 출처인가: `planner`, 또는 `weekly:<과목 ID(숫자)>`
fn known_source(source: &str) -> bool {
    match source.strip_prefix("weekly:") {
        Some(course) => !course.is_empty() && course.chars().all(|c| c.is_ascii_digit()),
        None => source == "planner",
    }
}
/// 출처 하나에서 받는 최대 항목 수
const MAX_ITEMS: usize = 1000;
/// 일정 링크로 허락하는 주소
const LMS_ORIGIN: &str = "https://learning.hanyang.ac.kr/";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ScheduleKind {
    Assignment,
    Quiz,
    Video,
    Event,
}

/// 일정 하나 (docs/app-api.md의 ScheduleItem)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleItem {
    pub id: String,
    pub kind: ScheduleKind,
    pub course_id: String,
    pub course_name: String,
    pub title: String,
    pub due_at_ms: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_at_ms: Option<i64>,
    /// 마감 뒤에도 늦게 해서 인정받을 수 있는 마지막 시각 (영상의 late_at)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub late_until_ms: Option<i64>,
    pub done: bool,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Schedule {
    /// 마감 순
    pub items: Vec<ScheduleItem>,
    /// 마지막으로 받은 시각. 아직 받은 적이 없으면 null
    pub fetched_at_ms: Option<u64>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FromSource {
    items: Vec<ScheduleItem>,
    fetched_at_ms: u64,
}

pub struct ScheduleStore {
    file: PathBuf,
    sources: Mutex<BTreeMap<String, FromSource>>,
}

impl ScheduleStore {
    /// 저장된 일정을 읽는다. 없거나 깨져 있으면 빈 일정 (다음에 받으면 다시 채워진다).
    pub fn open(file: PathBuf) -> Self {
        let sources = fs::read(&file)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        Self {
            file,
            sources: Mutex::new(sources),
        }
    }

    /// 확장의 `schedule` 메시지로 그 출처의 일정을 덮어쓴다.
    pub fn update(&self, message: &Value) -> Result<usize, String> {
        let source = message["source"].as_str().unwrap_or_default();
        if !known_source(source) {
            return Err(format!("모르는 일정 출처: {source}"));
        }
        let mut items: Vec<ScheduleItem> = serde_json::from_value(message["items"].clone())
            .map_err(|e| format!("일정을 읽지 못함: {e}"))?;
        items.truncate(MAX_ITEMS);
        for item in &mut items {
            item.url = lms_link(&item.url);
        }
        let count = items.len();

        let mut sources = self.sources.lock().unwrap_or_else(|e| e.into_inner());
        sources.insert(
            source.to_owned(),
            FromSource {
                items,
                fetched_at_ms: now_ms(),
            },
        );
        if let Err(e) = save_json(&self.file, &*sources) {
            eprintln!("schedule.json 저장 실패: {e}");
        }
        Ok(count)
    }

    pub fn schedule(&self) -> Schedule {
        let sources = self.sources.lock().unwrap_or_else(|e| e.into_inner());
        let mut items: Vec<ScheduleItem> = sources
            .values()
            .flat_map(|s| s.items.iter().cloned())
            .collect();
        items.sort_by_key(|i| i.due_at_ms);
        Schedule {
            items,
            fetched_at_ms: sources.values().map(|s| s.fetched_at_ms).max(),
        }
    }
}

/// 한양대 LMS 주소면 쿼리·해시를 지워 돌려주고, 아니면 빈 문자열 (확장에서 한 번 거른 것을 한 번 더)
fn lms_link(url: &str) -> String {
    if !url.starts_with(LMS_ORIGIN) {
        return String::new();
    }
    url.split(['?', '#']).next().unwrap_or_default().to_owned()
}

/// 브라우저로 열어도 되는 주소인가: https이고 한양대 도메인(hanyang.ac.kr, *.hanyang.ac.kr)
pub fn is_lms_url(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else {
        return false;
    };
    let host = rest
        .split(['/', '?', '#'])
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    !host.contains(['@', ':']) && (host == "hanyang.ac.kr" || host.ends_with(".hanyang.ac.kr"))
}

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

    fn store(name: &str) -> (PathBuf, ScheduleStore) {
        let dir = std::env::temp_dir().join(format!("sorted-sched-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("schedule.json");
        (file.clone(), ScheduleStore::open(file))
    }

    fn item(id: &str, kind: &str, due: i64) -> Value {
        json!({ "id": id, "kind": kind, "courseId": "210208", "courseName": "소프트웨어공학",
                "title": id, "dueAtMs": due, "done": false,
                "url": "https://learning.hanyang.ac.kr/courses/210208/assignments/1?x=1" })
    }

    #[test]
    fn sources_are_replaced_separately_and_merged_by_due_time() {
        let (file, s) = store("merge");
        assert_eq!(s.schedule().fetched_at_ms, None);

        let planner = json!({ "type": "schedule", "source": "planner",
                              "items": [item("assignment-1", "assignment", 30), item("quiz-2", "quiz", 10)] });
        assert_eq!(s.update(&planner).unwrap(), 2);
        let weekly = json!({ "source": "weekly:211742", "items": [item("video-3", "video", 20)] });
        s.update(&weekly).unwrap();

        let ids: Vec<String> = s.schedule().items.into_iter().map(|i| i.id).collect();
        assert_eq!(ids, ["quiz-2", "video-3", "assignment-1"]);
        assert!(s.schedule().fetched_at_ms.is_some());

        // 플래너를 다시 받으면 플래너 것만 바뀐다
        s.update(&json!({ "source": "planner", "items": [] }))
            .unwrap();
        let ids: Vec<String> = s.schedule().items.into_iter().map(|i| i.id).collect();
        assert_eq!(ids, ["video-3"]);

        // 다시 열어도 남는다
        assert_eq!(ScheduleStore::open(file).schedule().items.len(), 1);
    }

    #[test]
    fn links_are_cleaned_and_bad_messages_rejected() {
        let (_, s) = store("clean");
        let mut outside = item("assignment-9", "assignment", 1);
        outside["url"] = json!("https://evil.example/x");
        s.update(&json!({ "source": "planner", "items": [item("assignment-1", "assignment", 0), outside] }))
            .unwrap();
        let items = s.schedule().items;
        assert_eq!(
            items[0].url,
            "https://learning.hanyang.ac.kr/courses/210208/assignments/1"
        );
        assert_eq!(items[1].url, "");

        assert!(s
            .update(&json!({ "source": "other", "items": [] }))
            .is_err());
        assert!(s
            .update(&json!({ "source": "planner", "items": [{ "id": 1 }] }))
            .is_err());
        assert_eq!(
            s.schedule().items.len(),
            2,
            "거절한 메시지는 일정을 바꾸지 않는다"
        );
    }

    #[test]
    fn only_hanyang_https_urls_open_in_the_browser() {
        assert!(is_lms_url("https://learning.hanyang.ac.kr/courses/1"));
        assert!(is_lms_url("https://hanyang.ac.kr"));
        assert!(!is_lms_url("http://learning.hanyang.ac.kr/"));
        assert!(!is_lms_url("https://evil.example/learning.hanyang.ac.kr"));
        assert!(!is_lms_url("https://learning.hanyang.ac.kr.evil.example/"));
        assert!(!is_lms_url("https://user@evil.example/"));
        assert!(!is_lms_url("file:///etc/passwd"));
    }

    #[test]
    fn weekly_videos_are_kept_per_course_with_late_deadline() {
        let (_, s) = store("weekly");
        let mut a = item("video-1", "video", 10);
        a["lateUntilMs"] = json!(99);
        s.update(&json!({ "source": "weekly:1", "items": [a] }))
            .unwrap();
        s.update(&json!({ "source": "weekly:2", "items": [item("video-2", "video", 20)] }))
            .unwrap();
        // 과목 2를 다시 받아도 과목 1의 영상은 남는다
        s.update(&json!({ "source": "weekly:2", "items": [] }))
            .unwrap();
        let items = s.schedule().items;
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].late_until_ms, Some(99));
        assert_eq!(serde_json::to_value(&items[0]).unwrap()["lateUntilMs"], 99);

        for bad in ["weekly", "weekly:", "weekly:abc", "weekly:1/2"] {
            assert!(
                s.update(&json!({ "source": bad, "items": [] })).is_err(),
                "{bad}"
            );
        }
    }
}
