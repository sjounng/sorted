//! 사용자에게 보이는 문구의 언어 (이슈 #46). 앱 전체가 언어 하나를 쓴다.
//! 문구는 쓰는 자리에서 `tr("한국어", "English")`처럼 두 언어를 나란히 적는다.
//! 로그(eprintln)는 개발자용이라 한국어로 둔다.

use std::sync::atomic::{AtomicU8, Ordering};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    Ko,
    #[default]
    En,
}

static CURRENT: AtomicU8 = AtomicU8::new(0);

pub fn set_language(language: Language) {
    CURRENT.store(
        match language {
            Language::En => 0,
            Language::Ko => 1,
        },
        Ordering::Relaxed,
    );
}

pub fn language() -> Language {
    match CURRENT.load(Ordering::Relaxed) {
        1 => Language::Ko,
        _ => Language::En,
    }
}

/// 지금 언어의 문구
pub fn tr(ko: &str, en: &str) -> String {
    match language() {
        Language::Ko => ko.to_owned(),
        Language::En => en.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_the_current_language() {
        set_language(Language::Ko);
        assert_eq!(tr("과목", "class"), "과목");
        set_language(Language::En);
        assert_eq!(tr("과목", "class"), "class");
        assert_eq!(serde_json::to_value(Language::Ko).unwrap(), "ko");
    }
}
