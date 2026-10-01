//! Sorted의 화면과 무관한 부분.
//!
//! 지금은 확장↔앱 통신만 있다. 과목 판정, 중복·버전 판정은 이후 이 크레이트에 들어온다.
//!
//! ```text
//! Chrome 확장 ──(stdin/stdout, framing)──▶ native-host ──(유닉스 소켓, ipc)──▶ Sorted 앱
//!                                              │ 앱이 꺼져 있으면
//!                                              ▼
//!                                         queue (pending.jsonl)
//! ```

pub mod framing;
pub mod ipc;
pub mod paths;
pub mod queue;
