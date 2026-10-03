//! 파일 지문: 진짜 PDF인지(FR-2), 내용이 같은지(FR-4) 판단하는 데 쓴다.

use std::fs::File;
use std::io::{self, Read};
use std::path::Path;

use sha2::{Digest, Sha256};

/// PDF 파일은 항상 이 5바이트로 시작한다.
pub const PDF_MAGIC: &[u8; 5] = b"%PDF-";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fingerprint {
    /// 파일 크기 (바이트)
    pub size: u64,
    /// 앞 5바이트가 `%PDF-`인가
    pub is_pdf: bool,
    /// 내용 전체의 SHA-256 (소문자 16진수)
    pub sha256: String,
}

/// 파일을 한 번 끝까지 읽어 지문을 만든다. 큰 파일도 메모리에 다 올리지 않는다.
pub fn of_file(path: &Path) -> io::Result<Fingerprint> {
    of_reader(File::open(path)?)
}

pub fn of_reader<R: Read>(mut reader: R) -> io::Result<Fingerprint> {
    let mut hasher = Sha256::new();
    let mut head = Vec::with_capacity(PDF_MAGIC.len());
    let mut size = 0u64;
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        };
        if head.len() < PDF_MAGIC.len() {
            let take = (PDF_MAGIC.len() - head.len()).min(n);
            head.extend_from_slice(&buf[..take]);
        }
        hasher.update(&buf[..n]);
        size += n as u64;
    }
    Ok(Fingerprint {
        size,
        is_pdf: head == PDF_MAGIC,
        sha256: hex(&hasher.finalize()),
    })
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    /// 한 번에 1바이트씩만 돌려주는 reader. 앞 5바이트가 여러 번에 나눠 와도 맞는지 본다.
    struct Trickle<'a>(&'a [u8]);
    impl Read for Trickle<'_> {
        fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
            if self.0.is_empty() || buf.is_empty() {
                return Ok(0);
            }
            buf[0] = self.0[0];
            self.0 = &self.0[1..];
            Ok(1)
        }
    }

    #[test]
    fn sha256_matches_known_value() {
        let fp = of_reader(Cursor::new(b"abc")).unwrap();
        assert_eq!(
            fp.sha256,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(fp.size, 3);
    }

    #[test]
    fn detects_pdf_magic() {
        assert!(of_reader(Cursor::new(b"%PDF-1.7\n...")).unwrap().is_pdf);
        assert!(!of_reader(Cursor::new(b"<!DOCTYPE html>")).unwrap().is_pdf);
        assert!(!of_reader(Cursor::new(b"%PD")).unwrap().is_pdf);
        assert!(!of_reader(Cursor::new(b"")).unwrap().is_pdf);
    }

    #[test]
    fn magic_split_across_reads() {
        let fp = of_reader(Trickle(b"%PDF-1.4")).unwrap();
        assert!(fp.is_pdf);
        assert_eq!(
            fp.sha256,
            of_reader(Cursor::new(b"%PDF-1.4")).unwrap().sha256
        );
    }

    #[test]
    fn one_byte_change_changes_hash() {
        let a = of_reader(Cursor::new(b"%PDF-1.7 slide 1")).unwrap();
        let b = of_reader(Cursor::new(b"%PDF-1.7 slide 2")).unwrap();
        assert_ne!(a.sha256, b.sha256);
    }

    #[test]
    fn missing_file_is_an_error() {
        let err = of_file(Path::new("/nonexistent/sorted/x.pdf")).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::NotFound);
    }
}
