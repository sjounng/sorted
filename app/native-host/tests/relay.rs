//! 실제 바이너리를 띄워 Chrome처럼 stdin/stdout으로 대화해 본다.

use std::io::{Cursor, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::thread;

use sorted_core::framing;
use sorted_core::ipc::Server;
use sorted_core::paths::{Paths, DATA_DIR_ENV};
use sorted_core::queue;

fn data_dir(name: &str) -> PathBuf {
    let dir = PathBuf::from("/tmp").join(format!("srt-host-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// Chrome처럼 메시지들을 보내고 응답들을 받는다.
fn run_host(dir: &PathBuf, messages: &[&[u8]]) -> Vec<Vec<u8>> {
    let mut child = Command::new(env!("CARGO_BIN_EXE_sorted-native-host"))
        .arg("chrome-extension://testid/")
        .env(DATA_DIR_ENV, dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    {
        let mut stdin = child.stdin.take().unwrap();
        for m in messages {
            framing::write_message(&mut stdin, m).unwrap();
        }
        stdin.flush().unwrap();
    } // stdin을 닫으면 호스트가 끝난다
    let out = child.wait_with_output().unwrap();
    assert!(out.status.success());

    let mut cursor = Cursor::new(out.stdout);
    let mut replies = Vec::new();
    while let Some(r) = framing::read_message(&mut cursor).unwrap() {
        replies.push(r);
    }
    replies
}

#[test]
fn relays_to_running_app() {
    let dir = data_dir("live");
    let paths = Paths::new(&dir);
    let server = Server::bind(&paths.socket()).unwrap();
    thread::spawn(move || {
        server.serve(|line| {
            let mut r = br#"{"ok":true,"got":"#.to_vec();
            r.extend_from_slice(line);
            r.push(b'}');
            r
        })
    });

    let replies = run_host(&dir, &[br#"{"type":"hello"}"#, br#"{"type":"ping"}"#]);
    assert_eq!(
        replies,
        vec![
            br#"{"ok":true,"got":{"type":"hello"}}"#.to_vec(),
            br#"{"ok":true,"got":{"type":"ping"}}"#.to_vec(),
        ]
    );
    assert!(queue::drain(&paths.queue()).unwrap().is_empty());
}

#[test]
fn queues_when_app_is_not_running() {
    let dir = data_dir("queued");
    let paths = Paths::new(&dir);

    let replies = run_host(&dir, &[b"{\"type\":\"hello\",\n\"n\":1}"]);
    assert_eq!(replies, vec![br#"{"ok":true,"queued":true}"#.to_vec()]);
    assert_eq!(
        queue::drain(&paths.queue()).unwrap(),
        vec![br#"{"type":"hello", "n":1}"#.to_vec()]
    );
}

#[test]
fn log_does_not_contain_message_contents() {
    let dir = data_dir("log");
    let paths = Paths::new(&dir);
    run_host(
        &dir,
        &[br#"{"url":"https://lms.example/?user_id=2024000000"}"#],
    );
    let log = std::fs::read_to_string(paths.host_log()).unwrap();
    assert!(log.contains("queued"));
    assert!(!log.contains("user_id"));
}
