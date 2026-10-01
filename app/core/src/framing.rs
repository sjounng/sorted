//! Chrome 네이티브 메시징의 메시지 경계.
//!
//! 메시지마다 4바이트 길이(시스템 바이트 순서) + UTF-8 JSON 본문이 온다.
//! <https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging#native-messaging-host-protocol>

use std::io::{self, Read, Write};

/// 호스트 → Chrome 메시지의 최대 크기 (Chrome 제한).
pub const MAX_TO_CHROME: usize = 1024 * 1024;
/// Chrome → 호스트 메시지의 최대 크기 (Chrome 제한).
pub const MAX_FROM_CHROME: usize = 64 * 1024 * 1024;

/// 메시지 하나를 읽는다. Chrome이 입력을 닫았으면 `Ok(None)`.
pub fn read_message<R: Read>(reader: &mut R) -> io::Result<Option<Vec<u8>>> {
    let mut len = [0u8; 4];
    match reader.read_exact(&mut len) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }
    let len = u32::from_ne_bytes(len) as usize;
    if len > MAX_FROM_CHROME {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("message too large: {len} bytes"),
        ));
    }
    let mut body = vec![0u8; len];
    reader.read_exact(&mut body)?;
    Ok(Some(body))
}

/// 메시지 하나를 쓴다.
pub fn write_message<W: Write>(writer: &mut W, body: &[u8]) -> io::Result<()> {
    if body.len() > MAX_TO_CHROME {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("reply too large for Chrome: {} bytes", body.len()),
        ));
    }
    writer.write_all(&(body.len() as u32).to_ne_bytes())?;
    writer.write_all(body)?;
    writer.flush()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn round_trip() {
        let mut buf = Vec::new();
        write_message(&mut buf, br#"{"type":"hello"}"#).unwrap();
        write_message(&mut buf, b"{}").unwrap();

        let mut r = Cursor::new(buf);
        assert_eq!(
            read_message(&mut r).unwrap().unwrap(),
            br#"{"type":"hello"}"#
        );
        assert_eq!(read_message(&mut r).unwrap().unwrap(), b"{}");
        assert_eq!(read_message(&mut r).unwrap(), None);
    }

    #[test]
    fn length_prefix_is_native_endian() {
        let mut buf = Vec::new();
        write_message(&mut buf, b"abc").unwrap();
        assert_eq!(&buf[..4], &3u32.to_ne_bytes());
    }

    #[test]
    fn truncated_body_is_an_error() {
        let mut buf = 10u32.to_ne_bytes().to_vec();
        buf.extend_from_slice(b"short");
        assert!(read_message(&mut Cursor::new(buf)).is_err());
    }

    #[test]
    fn oversized_length_is_rejected_before_allocating() {
        let buf = u32::MAX.to_ne_bytes().to_vec();
        let err = read_message(&mut Cursor::new(buf)).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::InvalidData);
    }

    #[test]
    fn oversized_reply_is_rejected() {
        let big = vec![b'x'; MAX_TO_CHROME + 1];
        assert!(write_message(&mut Vec::new(), &big).is_err());
    }
}
