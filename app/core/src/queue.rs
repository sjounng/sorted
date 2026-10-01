//! 앱이 꺼져 있을 때 받은 메시지를 보관했다가, 앱이 켜지면 넘겨준다 (FR-16).
//!
//! 한 줄에 JSON 메시지 하나 (JSON Lines).

use std::fs::{self, OpenOptions};
use std::io::{self, BufRead, BufReader, Write};
use std::os::unix::fs::OpenOptionsExt;
use std::path::Path;

/// 보관 파일이 이보다 커지면 더 받지 않는다. 앱이 오래 꺼져 있어도 디스크를 채우지 않게.
pub const MAX_QUEUE_BYTES: u64 = 5 * 1024 * 1024;

/// 메시지 한 줄을 뒤에 붙인다.
pub fn push(path: &Path, line: &[u8]) -> io::Result<()> {
    if line.contains(&b'\n') {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "a queued message must be a single line",
        ));
    }
    let size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    if size + line.len() as u64 + 1 > MAX_QUEUE_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::StorageFull,
            "pending queue is full",
        ));
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .mode(0o600)
        .open(path)?;
    // 한 번의 write로 줄 전체를 써서, 중계 프로그램 여러 개가 동시에 붙여도 줄이 섞이지 않게 한다.
    let mut buf = Vec::with_capacity(line.len() + 1);
    buf.extend_from_slice(line);
    buf.push(b'\n');
    file.write_all(&buf)
}

/// 보관된 메시지를 모두 꺼내고 파일을 비운다. 보관된 게 없으면 빈 목록.
pub fn drain(path: &Path) -> io::Result<Vec<Vec<u8>>> {
    // 먼저 이름을 바꿔서, 읽는 동안 새로 들어오는 메시지는 새 파일에 쌓이게 한다.
    let draining = path.with_extension(format!("draining-{}", std::process::id()));
    match fs::rename(path, &draining) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e),
    }
    let mut lines = Vec::new();
    for line in BufReader::new(fs::File::open(&draining)?).split(b'\n') {
        let line = line?;
        if !line.is_empty() {
            lines.push(line);
        }
    }
    fs::remove_file(&draining)?;
    Ok(lines)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_queue(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("sorted-queue-{}-{name}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir.join("pending.jsonl")
    }

    #[test]
    fn drain_returns_messages_in_order_and_empties_queue() {
        let q = temp_queue("order");
        push(&q, br#"{"n":1}"#).unwrap();
        push(&q, br#"{"n":2}"#).unwrap();
        assert_eq!(
            drain(&q).unwrap(),
            vec![br#"{"n":1}"#.to_vec(), br#"{"n":2}"#.to_vec()]
        );
        assert!(drain(&q).unwrap().is_empty());
        assert!(!q.exists());
    }

    #[test]
    fn drain_without_file_is_empty() {
        let q = temp_queue("missing");
        assert!(drain(&q).unwrap().is_empty());
    }

    #[test]
    fn multi_line_message_is_rejected() {
        let q = temp_queue("newline");
        assert!(push(&q, b"{\n}").is_err());
    }

    #[test]
    fn queue_file_is_private() {
        use std::os::unix::fs::PermissionsExt;
        let q = temp_queue("perm");
        push(&q, b"{}").unwrap();
        let mode = fs::metadata(&q).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        drain(&q).unwrap();
    }

    #[test]
    fn full_queue_refuses_more() {
        let q = temp_queue("full");
        let big = vec![b'x'; (MAX_QUEUE_BYTES - 10) as usize];
        push(&q, &big).unwrap();
        let err = push(&q, b"0123456789").unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::StorageFull);
        drain(&q).unwrap();
    }
}
