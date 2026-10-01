//! 중계 프로그램 ↔ 앱 통신.
//!
//! Chrome은 메시지를 보낼 때마다 중계 프로그램을 새 프로세스로 띄운다.
//! 메뉴 막대에 계속 떠 있는 앱과는 따로이므로, 둘은 유닉스 소켓으로 이어 준다.
//!
//! 규칙: 연결 하나에 요청 한 줄(JSON) → 응답 한 줄(JSON). 한 연결에 여러 번 주고받아도 된다.
//! 소켓은 본인만 접근 가능한 폴더(0700) 안에 두고, 소켓 파일도 0600으로 잠근다.
//! 네트워크 포트를 열지 않으므로 다른 기기나 웹 페이지에서 접근할 수 없다.

use std::fs;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

/// 한 줄의 최대 크기. 이보다 길면 연결을 끊는다.
pub const MAX_LINE_BYTES: usize = 1024 * 1024;

/// 앱에 한 줄을 보내고 응답 한 줄을 받는다.
pub fn request(socket: &Path, line: &[u8], timeout: Duration) -> io::Result<Vec<u8>> {
    if line.contains(&b'\n') {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "request must be a single line",
        ));
    }
    let mut stream = UnixStream::connect(socket)?;
    stream.set_read_timeout(Some(timeout))?;
    stream.set_write_timeout(Some(timeout))?;

    let mut buf = Vec::with_capacity(line.len() + 1);
    buf.extend_from_slice(line);
    buf.push(b'\n');
    stream.write_all(&buf)?;

    let mut reader = BufReader::new(stream);
    let mut reply = Vec::new();
    reader.read_until(b'\n', &mut reply)?;
    if reply.pop() != Some(b'\n') {
        return Err(io::Error::new(
            io::ErrorKind::UnexpectedEof,
            "app closed the connection without a full reply",
        ));
    }
    Ok(reply)
}

/// 앱 쪽 소켓 서버.
pub struct Server {
    listener: UnixListener,
    path: PathBuf,
}

impl Server {
    /// 소켓을 연다. 다른 Sorted 앱이 이미 듣고 있으면 `AddrInUse`.
    /// 앱이 비정상 종료해서 남은 소켓 파일은 지우고 다시 연다.
    pub fn bind(path: &Path) -> io::Result<Self> {
        if path.exists() {
            if UnixStream::connect(path).is_ok() {
                return Err(io::Error::new(
                    io::ErrorKind::AddrInUse,
                    "another Sorted app is already listening",
                ));
            }
            fs::remove_file(path)?;
        }
        let listener = UnixListener::bind(path)?;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
        Ok(Self {
            listener,
            path: path.to_owned(),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// 연결을 계속 받는다. 연결마다 스레드를 하나 쓰고, 줄마다 `handler`의 응답을 돌려준다.
    /// 돌아오지 않으므로 별도 스레드에서 부른다.
    pub fn serve<F>(self, handler: F)
    where
        F: Fn(&[u8]) -> Vec<u8> + Send + Sync + 'static,
    {
        let handler = Arc::new(handler);
        for stream in self.listener.incoming() {
            let Ok(stream) = stream else { continue };
            let handler = Arc::clone(&handler);
            thread::spawn(move || {
                let _ = handle_connection(stream, handler.as_ref());
            });
        }
    }
}

fn handle_connection<F>(stream: UnixStream, handler: &F) -> io::Result<()>
where
    F: Fn(&[u8]) -> Vec<u8>,
{
    stream.set_read_timeout(Some(Duration::from_secs(30)))?;
    let mut writer = stream.try_clone()?;
    let mut reader = Read::take(BufReader::new(stream), MAX_LINE_BYTES as u64 + 1);
    loop {
        let mut line = Vec::new();
        let n = reader.read_until(b'\n', &mut line)?;
        if n == 0 {
            return Ok(()); // 상대가 연결을 닫음
        }
        if line.pop() != Some(b'\n') {
            return Ok(()); // 너무 길거나 중간에 끊긴 줄
        }
        let mut reply = handler(&line);
        // 응답도 한 줄이어야 한다.
        reply.retain(|&b| b != b'\n');
        reply.push(b'\n');
        writer.write_all(&reply)?;
        // 다음 줄을 위해 읽기 한도를 다시 채운다.
        reader.set_limit(MAX_LINE_BYTES as u64 + 1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_socket(name: &str) -> PathBuf {
        // macOS 소켓 경로 길이 제한(104바이트) 때문에 짧은 경로를 쓴다.
        let dir = PathBuf::from("/tmp").join(format!("srt-{}-{name}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir.join("s.sock")
    }

    fn start_echo(path: &Path) {
        let server = Server::bind(path).unwrap();
        thread::spawn(move || {
            server.serve(|line| {
                let mut out = b"echo:".to_vec();
                out.extend_from_slice(line);
                out
            })
        });
    }

    #[test]
    fn request_gets_reply() {
        let sock = temp_socket("reply");
        start_echo(&sock);
        let reply = request(&sock, b"hello", Duration::from_secs(2)).unwrap();
        assert_eq!(reply, b"echo:hello");
    }

    #[test]
    fn socket_file_is_private() {
        let sock = temp_socket("perm");
        start_echo(&sock);
        let mode = fs::metadata(&sock).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }

    #[test]
    fn second_server_is_refused_while_first_is_running() {
        let sock = temp_socket("twice");
        start_echo(&sock);
        let err = Server::bind(&sock).err().unwrap();
        assert_eq!(err.kind(), io::ErrorKind::AddrInUse);
    }

    #[test]
    fn stale_socket_file_is_replaced() {
        let sock = temp_socket("stale");
        drop(UnixListener::bind(&sock).unwrap()); // 파일만 남고 아무도 듣지 않음
        assert!(sock.exists());
        start_echo(&sock);
        assert_eq!(
            request(&sock, b"x", Duration::from_secs(2)).unwrap(),
            b"echo:x"
        );
    }

    #[test]
    fn request_fails_when_app_is_not_running() {
        let sock = temp_socket("absent");
        let err = request(&sock, b"x", Duration::from_secs(1)).unwrap_err();
        assert!(matches!(
            err.kind(),
            io::ErrorKind::NotFound | io::ErrorKind::ConnectionRefused
        ));
    }

    #[test]
    fn handler_newlines_do_not_break_framing() {
        let sock = temp_socket("nl");
        let server = Server::bind(&sock).unwrap();
        thread::spawn(move || server.serve(|_| b"a\nb".to_vec()));
        assert_eq!(request(&sock, b"x", Duration::from_secs(2)).unwrap(), b"ab");
    }
}
