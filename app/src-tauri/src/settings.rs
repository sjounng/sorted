//! 앱 설정 (이슈 #46). 앱 데이터 폴더의 settings.json에 저장한다.
//! 지금은 언어 하나. 처음 켜면 macOS 언어를 따른다 (한국어면 한국어, 아니면 영어).

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::text::{self, Language};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub language: Language,
}

pub struct SettingsStore {
    file: PathBuf,
    current: Mutex<Settings>,
}

impl SettingsStore {
    /// 저장된 설정을 읽는다. 없거나 깨져 있으면 macOS 언어로 시작한다. 읽은 언어를 앱 전체에 적용한다.
    pub fn open(file: PathBuf) -> Self {
        let current = fs::read(&file)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_else(|| Settings {
                language: system_language(),
            });
        text::set_language(current.language);
        Self {
            file,
            current: Mutex::new(current),
        }
    }

    pub fn get(&self) -> Settings {
        self.current
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    pub fn set_language(&self, language: Language) -> Settings {
        let mut current = self.current.lock().unwrap_or_else(|e| e.into_inner());
        current.language = language;
        text::set_language(language);
        match serde_json::to_vec_pretty(&*current) {
            Ok(bytes) => {
                if let Err(e) = fs::write(&self.file, bytes) {
                    eprintln!("settings.json 저장 실패: {e}");
                }
            }
            Err(e) => eprintln!("settings.json 저장 실패: {e}"),
        }
        current.clone()
    }
}

/// macOS 언어 목록(AppleLanguages)의 첫 항목이 한국어면 한국어, 아니면 영어
fn system_language() -> Language {
    let output = std::process::Command::new("defaults")
        .args(["read", "-g", "AppleLanguages"])
        .output();
    match output {
        Ok(out) => language_from_list(&String::from_utf8_lossy(&out.stdout)),
        Err(_) => Language::En,
    }
}

/// `defaults read -g AppleLanguages`의 출력: `(\n    "ko-KR",\n    "en-US"\n)`
fn language_from_list(list: &str) -> Language {
    let first = list
        .split('"')
        .nth(1)
        .unwrap_or_default()
        .to_ascii_lowercase();
    if first.starts_with("ko") {
        Language::Ko
    } else {
        Language::En
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_mac_language_decides() {
        assert_eq!(
            language_from_list("(\n    \"ko-KR\",\n    \"en-US\"\n)"),
            Language::Ko
        );
        assert_eq!(
            language_from_list("(\n    \"en-US\",\n    \"ko-KR\"\n)"),
            Language::En
        );
        assert_eq!(language_from_list(""), Language::En);
    }

    #[test]
    fn language_is_saved_and_read_back() {
        let dir = std::env::temp_dir().join(format!("sorted-settings-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("settings.json");
        let store = SettingsStore::open(file.clone());
        store.set_language(Language::Ko);
        assert_eq!(SettingsStore::open(file).get().language, Language::Ko);
        text::set_language(Language::En);
    }
}
