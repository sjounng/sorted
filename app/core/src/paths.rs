//! 앱과 중계 프로그램이 함께 쓰는 파일 위치.

use std::env;
use std::fs;
use std::io;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

/// 테스트나 개발 중에 데이터 폴더를 바꾸고 싶을 때 쓰는 환경 변수.
pub const DATA_DIR_ENV: &str = "SORTED_DATA_DIR";

/// 앱 데이터 폴더 안의 파일 위치 모음.
#[derive(Debug, Clone)]
pub struct Paths {
    data_dir: PathBuf,
}

impl Paths {
    pub fn new(data_dir: impl Into<PathBuf>) -> Self {
        Self {
            data_dir: data_dir.into(),
        }
    }

    /// 기본 위치. macOS: `~/Library/Application Support/Sorted`
    pub fn from_env() -> Self {
        if let Some(dir) = env::var_os(DATA_DIR_ENV) {
            return Self::new(dir);
        }
        let home = env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("/tmp"));
        if cfg!(target_os = "macos") {
            Self::new(home.join("Library/Application Support/Sorted"))
        } else {
            Self::new(home.join(".local/share/sorted"))
        }
    }

    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    /// 앱이 듣고 있는 유닉스 소켓.
    pub fn socket(&self) -> PathBuf {
        self.data_dir.join("sorted.sock")
    }

    /// 앱이 꺼져 있을 때 받은 메시지를 쌓아 두는 파일 (FR-16).
    pub fn queue(&self) -> PathBuf {
        self.data_dir.join("pending.jsonl")
    }

    /// 중계 프로그램 로그. 메시지 내용은 남기지 않는다.
    pub fn host_log(&self) -> PathBuf {
        self.data_dir.join("logs").join("native-host.log")
    }

    /// 데이터 폴더를 만들고 본인만 접근하게 권한을 잠근다.
    pub fn ensure_data_dir(&self) -> io::Result<()> {
        fs::create_dir_all(&self.data_dir)?;
        fs::set_permissions(&self.data_dir, fs::Permissions::from_mode(0o700))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn files_live_under_data_dir() {
        let p = Paths::new("/x/Sorted");
        assert_eq!(p.socket(), PathBuf::from("/x/Sorted/sorted.sock"));
        assert_eq!(p.queue(), PathBuf::from("/x/Sorted/pending.jsonl"));
        assert!(p.host_log().starts_with("/x/Sorted"));
    }

    #[test]
    fn data_dir_is_private() {
        let dir = std::env::temp_dir().join(format!("sorted-paths-{}", std::process::id()));
        let p = Paths::new(&dir);
        p.ensure_data_dir().unwrap();
        let mode = fs::metadata(&dir).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o700);
        fs::remove_dir_all(dir).unwrap();
    }
}
