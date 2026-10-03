//! Sorted의 화면과 무관한 부분.
//!
//! 확장↔앱 통신과 파일 지문(PDF 여부, SHA-256)이 있다. 과목 판정, 중복·버전 판정도 이 크레이트에 들어온다.
//!
//! ```text
//! Chrome 확장 ──(stdin/stdout, framing)──▶ native-host ──(유닉스 소켓, ipc)──▶ Sorted 앱
//!                                              │ 앱이 꺼져 있으면
//!                                              ▼
//!                                         queue (pending.jsonl)
//! ```

pub mod fingerprint;
pub mod framing;
pub mod ipc;
pub mod paths;
pub mod queue;
