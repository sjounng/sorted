# Sorted

LMS에서 받은 강의자료 PDF를 과목·주차별로 자동 정리하고, 중복 다운로드를 알려 주고, 새 버전이 올라오면 무엇이 바뀌었는지 보여 주는 Chrome 확장 + Mac 앱.

CSE406 소프트웨어공학 Phase 1 프로젝트.

## 구조

```
extension/        Chrome 확장 (MV3). 다운로드의 출처만 앱에 넘긴다.
app/              Mac 앱 (Tauri)
  src/            앱 화면 (TypeScript)
  src-tauri/      앱 본체 (Rust)
  core/           판정 로직과 확장↔앱 통신 (Rust, 화면과 무관)
  native-host/    Chrome이 띄우는 중계 프로그램 (Rust)
scripts/          설치 스크립트
spike/            기술 검증용 일회성 코드
docs/             기획안 사본, 설계 메모
```

<!-- run:start -->

## 실행하기

필요한 것: macOS, Chrome, Rust (`rustup`), Node.js 22 이상.

```sh
# 1. 앱 실행 (Dock에 아이콘이 생기고 창이 뜬다. 창을 닫아도 뒤에서 돌고, 종료는 ⌘Q)
cd app
npm install
npm run tauri dev

# 2. 다른 터미널에서 중계 프로그램 설치 (한 번만, 코드가 바뀌면 다시)
./scripts/install-native-host.sh

# 3. Chrome에서 chrome://extensions → 개발자 모드 → "압축해제된 확장 프로그램 로드" → extension/ 선택
```

확장 아이콘을 누르면 앱에 hello 메시지를 보낸다. 배지가 `OK`면 연결 성공, `Q`면 앱이 꺼져 있어 메시지를 보관해 둔 것, `!`면 연결 실패다. 자세한 내용은 [docs/native-messaging.md](docs/native-messaging.md).

<!-- run:end -->

## 작업 방식

- **GitHub Flow.** `main`은 항상 동작하는 상태로 두고, 모든 작업은 이슈 → 브랜치 → PR로 한다.
- **브랜치 이름:** `feat/<이슈번호>-<짧은-이름>` (버그는 `fix/`, 문서는 `docs/`)
- **PR:** 본문에 `Closes #이슈번호`와 FR 번호를 쓰고, 인수 조건을 체크하고 CI가 통과하면 합친다. 상대 영역을 건드린 PR은 그 팀원에게 리뷰를 요청한다.
- **커밋 메시지:** `feat(app): ...`, `fix(extension): ...`, `docs: ...` 처럼 영역을 앞에 쓴다.
- **개인정보:** 실제 강의 PDF, 학번, 다운로드 URL의 쿼리 문자열은 커밋·이슈·로그에 남기지 않는다.

## 팀

| 이름 | 맡은 부분                                                                    |
| ---- | ---------------------------------------------------------------------------- |
| 예원 | 앱 화면 (`app/src/`)                                                         |
| 준우 | 확장, 앱 내부 (`extension/`, `app/src-tauri`, `app/core`, `app/native-host`) |
