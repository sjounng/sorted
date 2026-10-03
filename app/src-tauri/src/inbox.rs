//! 확장에서 받은 메시지 처리. Tauri에 의존하지 않아서 단위 테스트가 쉽다.
//!
//! 받은 것을 기록하고 바로 "받았다"고 답한다. 다운로드 메시지는 파일 확인(probe)이
//! 끝나면 그 결과를 같은 항목에 붙인다. 중계 프로그램은 5초 안에 답을 받아야 하므로
//! 오래 걸리는 확인은 답한 뒤에 따로 한다.

use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::{json, Value};

/// 화면에 보여 줄 최근 메시지 수.
const KEEP: usize = 200;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Received {
    pub id: u64,
    pub received_at_ms: u64,
    /// "live": 확장에서 바로 옴, "queued": 앱이 꺼져 있던 동안 보관됐다가 옴
    pub source: Source,
    pub message: Value,
    /// 다운로드 메시지의 파일 확인 결과. 아직 확인 중이거나 다운로드가 아니면 null
    pub probe: Option<Value>,
}

impl Received {
    pub fn is_download(&self) -> bool {
        self.message["type"] == "download"
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Live,
    Queued,
}

#[derive(Default)]
struct State {
    next_id: u64,
    items: Vec<Received>,
}

#[derive(Default)]
pub struct Inbox(Mutex<State>);

impl Inbox {
    /// 원본 메시지 한 줄을 처리한다. 확장에 돌려줄 응답과, 기록된 항목을 돌려준다.
    pub fn handle(&self, raw: &[u8], source: Source) -> (Value, Option<Received>) {
        let message: Value = match serde_json::from_slice(raw) {
            Ok(v @ Value::Object(_)) => v,
            _ => return (json!({ "ok": false, "error": "invalid_message" }), None),
        };
        let item = {
            let mut state = self.0.lock().unwrap_or_else(|e| e.into_inner());
            state.next_id += 1;
            let item = Received {
                id: state.next_id,
                received_at_ms: now_ms(),
                source,
                message,
                probe: None,
            };
            state.items.push(item.clone());
            let overflow = state.items.len().saturating_sub(KEEP);
            state.items.drain(..overflow);
            item
        };
        let reply = json!({
            "ok": true,
            "app": "Sorted",
            "version": env!("CARGO_PKG_VERSION"),
        });
        (reply, Some(item))
    }

    /// 확인 결과를 항목에 붙인다. 항목이 이미 밀려났으면 None.
    pub fn set_probe(&self, id: u64, probe: Value) -> Option<Received> {
        let mut state = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let item = state.items.iter_mut().find(|i| i.id == id)?;
        item.probe = Some(probe);
        Some(item.clone())
    }

    pub fn snapshot(&self) -> Vec<Received> {
        self.0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .items
            .clone()
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
        let item = item.unwrap();
        assert_eq!(item.message["type"], "hello");
        assert!(!item.is_download());
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
    fn ids_are_unique_and_probe_attaches_later() {
        let inbox = Inbox::default();
        let (_, a) = inbox.handle(br#"{"type":"download"}"#, Source::Live);
        let (_, b) = inbox.handle(br#"{"type":"download"}"#, Source::Live);
        let (a, b) = (a.unwrap(), b.unwrap());
        assert_ne!(a.id, b.id);
        assert!(a.is_download());
        assert!(a.probe.is_none());

        let updated = inbox.set_probe(a.id, json!({ "name": "x" })).unwrap();
        assert_eq!(updated.probe.unwrap()["name"], "x");
        assert!(inbox.snapshot()[1].probe.is_none());
        assert!(inbox.set_probe(999, json!({})).is_none());
    }

    #[test]
    fn serializes_for_the_frontend() {
        let item = Received {
            id: 7,
            received_at_ms: 1,
            source: Source::Queued,
            message: json!({}),
            probe: None,
        };
        assert_eq!(
            serde_json::to_value(item).unwrap(),
            json!({ "id": 7, "receivedAtMs": 1, "source": "queued", "message": {}, "probe": null })
        );
    }
}
