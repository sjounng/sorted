//! 확장에서 받은 메시지 처리. Tauri에 의존하지 않아서 단위 테스트가 쉽다.
//!
//! 지금은 받은 것을 기록하고 "받았다"고 답하기만 한다.
//! 다운로드 정리(FR-1~)는 이후 여기서 `sorted_core`의 판정 로직을 부른다.

use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::{json, Value};

/// 화면에 보여 줄 최근 메시지 수.
const KEEP: usize = 200;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Received {
    pub received_at_ms: u64,
    /// "live": 확장에서 바로 옴, "queued": 앱이 꺼져 있던 동안 보관됐다가 옴
    pub source: Source,
    pub message: Value,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Live,
    Queued,
}

#[derive(Default)]
pub struct Inbox(Mutex<Vec<Received>>);

impl Inbox {
    /// 원본 메시지 한 줄을 처리한다. 확장에 돌려줄 응답과, 기록된 항목을 돌려준다.
    pub fn handle(&self, raw: &[u8], source: Source) -> (Value, Option<Received>) {
        let message: Value = match serde_json::from_slice(raw) {
            Ok(v @ Value::Object(_)) => v,
            _ => return (json!({ "ok": false, "error": "invalid_message" }), None),
        };
        let item = Received {
            received_at_ms: now_ms(),
            source,
            message,
        };
        {
            let mut items = self.0.lock().unwrap_or_else(|e| e.into_inner());
            items.push(item.clone());
            let overflow = items.len().saturating_sub(KEEP);
            items.drain(..overflow);
        }
        let reply = json!({
            "ok": true,
            "app": "Sorted",
            "version": env!("CARGO_PKG_VERSION"),
        });
        (reply, Some(item))
    }

    pub fn snapshot(&self) -> Vec<Received> {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }
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

    #[test]
    fn valid_message_is_recorded_and_acknowledged() {
        let inbox = Inbox::default();
        let (reply, item) = inbox.handle(br#"{"type":"hello"}"#, Source::Live);
        assert_eq!(reply["ok"], true);
        assert_eq!(item.unwrap().message["type"], "hello");
        assert_eq!(inbox.snapshot().len(), 1);
    }

    #[test]
    fn non_object_is_rejected_and_not_recorded() {
        let inbox = Inbox::default();
        for raw in [&b"not json"[..], b"[1,2]", b"\"hi\""] {
            let (reply, item) = inbox.handle(raw, Source::Live);
            assert_eq!(reply["ok"], false);
            assert!(item.is_none());
        }
        assert!(inbox.snapshot().is_empty());
    }

    #[test]
    fn keeps_only_recent_messages() {
        let inbox = Inbox::default();
        for i in 0..KEEP + 5 {
            inbox.handle(format!(r#"{{"n":{i}}}"#).as_bytes(), Source::Queued);
        }
        let items = inbox.snapshot();
        assert_eq!(items.len(), KEEP);
        assert_eq!(items[0].message["n"], 5);
    }

    #[test]
    fn serializes_for_the_frontend() {
        let item = Received {
            received_at_ms: 1,
            source: Source::Queued,
            message: json!({}),
        };
        assert_eq!(
            serde_json::to_value(item).unwrap(),
            json!({ "receivedAtMs": 1, "source": "queued", "message": {} })
        );
    }
}
