//! Chrome 네이티브 메시징 호스트.
//!
//! Chrome이 확장의 요청마다 이 프로그램을 띄우고 stdin/stdout으로 메시지를 주고받는다.
//! 받은 메시지는 메뉴 막대의 Sorted 앱에 그대로 넘기고, 앱의 응답을 Chrome에 돌려준다.
//! 앱이 꺼져 있으면 메시지를 보관 파일에 쌓아 두고 `{"ok":true,"queued":true}`로 답한다 (FR-16).
//!
//! stdout은 Chrome과의 통로라서 다른 것을 절대 출력하지 않는다. 기록은 로그 파일에만 남기고,
//! 메시지 내용(다운로드 URL, 학번이 들어갈 수 있음)은 로그에 남기지 않는다.

use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::os::unix::fs::OpenOptionsExt;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use sorted_core::paths::Paths;
use sorted_core::{framing, ipc, queue};

const APP_TIMEOUT: Duration = Duration::from_secs(5);

fn main() {
    // Chrome은 첫 번째 인자로 호출한 확장의 origin(chrome-extension://<id>/)을 넘긴다.
    let origin = std::env::args().nth(1).unwrap_or_default();
    let paths = Paths::from_env();
    let _ = paths.ensure_data_dir();
    let mut log = Log::open(&paths);
    log.write(&format!("start origin={origin}"));

    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut input = stdin.lock();
    let mut output = stdout.lock();

    loop {
        let message = match framing::read_message(&mut input) {
            Ok(Some(m)) => m,
            Ok(None) => break,
            Err(e) => {
                log.write(&format!("read error: {e}"));
                break;
            }
        };
        let reply = relay(&paths, &message, &mut log);
        if let Err(e) = framing::write_message(&mut output, &reply) {
            log.write(&format!("write error: {e}"));
            break;
        }
    }
    log.write("exit");
}

/// 메시지 하나를 앱에 넘기고, 넘기지 못하면 보관한다. Chrome에 돌려줄 응답을 만든다.
fn relay(paths: &Paths, message: &[u8], log: &mut Log) -> Vec<u8> {
    let line = to_single_line(message);
    match ipc::request(&paths.socket(), &line, APP_TIMEOUT) {
        Ok(reply) => {
            log.write(&format!("relayed {} bytes", line.len()));
            reply
        }
        Err(app_err) => match queue::push(&paths.queue(), &line) {
            Ok(()) => {
                log.write(&format!(
                    "app unreachable ({app_err}); queued {} bytes",
                    line.len()
                ));
                br#"{"ok":true,"queued":true}"#.to_vec()
            }
            Err(queue_err) => {
                log.write(&format!(
                    "app unreachable ({app_err}); queue failed ({queue_err})"
                ));
                br#"{"ok":false,"error":"app_unreachable"}"#.to_vec()
            }
        },
    }
}

/// Chrome이 보내는 JSON은 보통 한 줄이지만, 혹시 줄바꿈이 있어도 한 줄로 만든다.
/// JSON 문자열 안의 줄바꿈은 항상 `\n`으로 이스케이프되므로, 날것의 줄바꿈은 공백으로 바꿔도 의미가 같다.
fn to_single_line(message: &[u8]) -> Vec<u8> {
    message
        .iter()
        .map(|&b| if b == b'\n' || b == b'\r' { b' ' } else { b })
        .collect()
}

/// 실패해도 동작에 영향을 주지 않는 로그.
struct Log(Option<fs::File>);

impl Log {
    fn open(paths: &Paths) -> Self {
        let path = paths.host_log();
        if let Some(dir) = path.parent() {
            let _ = fs::create_dir_all(dir);
        }
        // 로그가 1MB를 넘으면 비우고 새로 쓴다.
        let too_big = fs::metadata(&path)
            .map(|m| m.len() > 1024 * 1024)
            .unwrap_or(false);
        let file = OpenOptions::new()
            .create(true)
            .append(!too_big)
            .write(true)
            .truncate(too_big)
            .mode(0o600)
            .open(path)
            .ok();
        Self(file)
    }

    fn write(&mut self, text: &str) {
        if let Some(f) = self.0.as_mut() {
            let secs = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let _ = writeln!(f, "{secs} pid={} {text}", std::process::id());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raw_newlines_become_spaces() {
        assert_eq!(to_single_line(b"{\n\"a\": 1\r\n}"), b"{ \"a\": 1  }");
    }

    #[test]
    fn escaped_newlines_are_kept() {
        assert_eq!(to_single_line(br#"{"a":"x\ny"}"#), br#"{"a":"x\ny"}"#);
    }
}
