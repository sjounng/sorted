//! 받은 파일이 어느 과목인지 정한다 (FR-5).
//!
//! 앞에서부터 순서대로 시도하고, 처음 맞는 것을 쓴다.
//! 1. 확장이 LMS에서 받아 온 과목명 (과목 ID는 활성 탭 → referrer 순)
//! 2. 과목 ID만 있고 이름 조회가 실패했으면, 전에 기억해 둔 같은 ID의 과목
//! 3. 파일 이름의 과목 코드 (예: `cse406-lec-00-v3` → CSE406)를 전에 본 과목과 맞춰 봄
//! 4. PDF 첫 페이지의 과목 코드 (예: "CSE 406 Software Engineering")
//!
//! 모두 실패하면 [`Resolution::Unknown`]: 확실하지 않으면 손대지 않고 사용자에게 묻는다.

use crate::library::Library;

/// 과목을 정하는 데 쓰는 단서
#[derive(Debug, Default, Clone)]
pub struct Hints<'a> {
    pub tab_course_id: Option<&'a str>,
    pub referrer_course_id: Option<&'a str>,
    /// 확장이 LMS에 물어본 과목명 (접두어를 뗀 것)
    pub lms_course_name: Option<&'a str>,
    pub file_name: &'a str,
    /// 필요할 때만 읽는다 (PDF 해석은 느리다)
    pub first_page: Option<&'a str>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Resolution {
    Known {
        lms_id: Option<String>,
        name: String,
        /// 어떤 단서로 정했는지 (화면·로그용)
        by: By,
    },
    Unknown {
        lms_id: Option<String>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum By {
    Lms,
    RememberedId,
    FileNameCode,
    FirstPageCode,
}

impl Hints<'_> {
    pub fn lms_id(&self) -> Option<&str> {
        self.tab_course_id.or(self.referrer_course_id)
    }

    /// 이 다운로드에서 보이는 과목 코드들. 과목을 기억할 때 함께 적어 둔다.
    pub fn codes(&self) -> Vec<String> {
        let mut codes = course_codes(self.file_name);
        if let Some(page) = self.first_page {
            for c in course_codes(page) {
                if !codes.contains(&c) {
                    codes.push(c);
                }
            }
        }
        codes
    }
}

pub fn resolve(lib: &Library, hints: &Hints) -> Resolution {
    let lms_id = hints.lms_id().map(str::to_owned);
    let known = |name: &str, by| Resolution::Known {
        lms_id: lms_id.clone(),
        name: name.to_owned(),
        by,
    };

    if let Some(name) = hints.lms_course_name.filter(|n| !n.trim().is_empty()) {
        return known(name.trim(), By::Lms);
    }
    if let Some(c) = hints.lms_id().and_then(|id| lib.course_by_lms_id(id)) {
        return known(&c.name, By::RememberedId);
    }
    for code in course_codes(hints.file_name) {
        if let Some(c) = lib.course_by_code(&code) {
            return known(&c.name, By::FileNameCode);
        }
    }
    if let Some(page) = hints.first_page {
        for code in course_codes(page) {
            if let Some(c) = lib.course_by_code(&code) {
                return known(&c.name, By::FirstPageCode);
            }
        }
    }
    Resolution::Unknown { lms_id }
}

/// 글에서 과목 코드처럼 보이는 것을 모두 찾는다: 영문 2~4자 + (공백·하이픈) + 숫자 3~4자.
/// 대문자로, 공백 없이 돌려준다. `cse406-lec`, `CSE 406`, `ITE-2037` → CSE406, CSE406, ITE2037
pub fn course_codes(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut out: Vec<String> = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        // 단어 시작에서만 본다 (앞 글자가 영문자가 아님)
        if !chars[i].is_ascii_alphabetic() || (i > 0 && chars[i - 1].is_ascii_alphabetic()) {
            i += 1;
            continue;
        }
        let start = i;
        while i < chars.len() && chars[i].is_ascii_alphabetic() {
            i += 1;
        }
        let letters = i - start;
        let mut j = i;
        if j < chars.len() && (chars[j] == ' ' || chars[j] == '-') {
            j += 1;
        }
        let digits_start = j;
        while j < chars.len() && chars[j].is_ascii_digit() {
            j += 1;
        }
        let digits = j - digits_start;
        let digit_boundary = j >= chars.len() || !chars[j].is_ascii_digit();
        if (2..=4).contains(&letters) && (3..=4).contains(&digits) && digit_boundary {
            let code: String = chars[start..i]
                .iter()
                .chain(&chars[digits_start..j])
                .map(|c| c.to_ascii_uppercase())
                .collect();
            if !out.contains(&code) {
                out.push(code);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lib() -> Library {
        let mut lib = Library::default();
        lib.remember_course(Some("210208"), "소프트웨어공학", &["CSE406".into()]);
        lib
    }

    #[test]
    fn finds_course_codes() {
        assert_eq!(course_codes("cse406-lec-00-v3"), vec!["CSE406"]);
        assert_eq!(
            course_codes("CSE 406 Software Engineering Lecture 1.2"),
            vec!["CSE406"]
        );
        assert_eq!(course_codes("ITE-2037 과제"), vec!["ITE2037"]);
        assert_eq!(course_codes("a cse406 and CSE406"), vec!["CSE406"]);
    }

    #[test]
    fn ignores_things_that_are_not_codes() {
        assert!(course_codes("lab-01-minikube").is_empty()); // 숫자 2자리
        assert!(course_codes("version 2026").is_empty()); // 영문 7자
        assert!(course_codes("abc12345").is_empty()); // 숫자 5자리
        assert!(course_codes("se-01-2023-git").is_empty());
        assert!(course_codes("").is_empty());
    }

    #[test]
    fn lms_name_wins() {
        let h = Hints {
            tab_course_id: Some("999"),
            lms_course_name: Some("운영체제"),
            file_name: "cse406-lec.pdf",
            ..Default::default()
        };
        assert_eq!(
            resolve(&lib(), &h),
            Resolution::Known {
                lms_id: Some("999".into()),
                name: "운영체제".into(),
                by: By::Lms
            }
        );
    }

    #[test]
    fn falls_back_to_remembered_id_then_codes() {
        let by_id = Hints {
            referrer_course_id: Some("210208"),
            file_name: "x.pdf",
            ..Default::default()
        };
        assert!(matches!(
            resolve(&lib(), &by_id),
            Resolution::Known {
                by: By::RememberedId,
                ..
            }
        ));

        let by_name = Hints {
            file_name: "cse406-lec-02.pdf",
            ..Default::default()
        };
        assert!(matches!(
            resolve(&lib(), &by_name),
            Resolution::Known {
                by: By::FileNameCode,
                ..
            }
        ));

        let by_page = Hints {
            file_name: "slides.pdf",
            first_page: Some("CSE 406 Software Engineering"),
            ..Default::default()
        };
        assert!(matches!(
            resolve(&lib(), &by_page),
            Resolution::Known {
                by: By::FirstPageCode,
                ..
            }
        ));
    }

    #[test]
    fn unknown_when_nothing_matches() {
        let h = Hints {
            tab_course_id: Some("777"),
            lms_course_name: Some("  "),
            file_name: "notes.pdf",
            first_page: Some("Welcome"),
            ..Default::default()
        };
        assert_eq!(
            resolve(&lib(), &h),
            Resolution::Unknown {
                lms_id: Some("777".into())
            }
        );
    }

    #[test]
    fn hints_collect_codes_from_name_and_page() {
        let h = Hints {
            file_name: "cse406-lec.pdf",
            first_page: Some("CSE 406 / ITE 2037"),
            ..Default::default()
        };
        assert_eq!(h.codes(), vec!["CSE406", "ITE2037"]);
    }
}
