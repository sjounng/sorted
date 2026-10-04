//! Sorted의 화면과 무관한 부분.
//!
//! 확장↔앱 통신, 파일 지문(PDF 여부, SHA-256), 과목 판정(course), 문서·버전 판정(judge),
//! 강의자료 목록(library), 정리 폴더로 옮기기(organize), 정리한 파일에 새기는 속성(filetag).
//!
//! ```text
//! Chrome 확장 ──(stdin/stdout, framing)──▶ native-host ──(유닉스 소켓, ipc)──▶ Sorted 앱
//!                                              │ 앱이 꺼져 있으면
//!                                              ▼
//!                                         queue (pending.jsonl)
//! ```

pub mod course;
pub mod filetag;
pub mod fingerprint;
pub mod framing;
pub mod ipc;
pub mod judge;
pub mod library;
pub mod organize;
pub mod paths;
pub mod queue;
