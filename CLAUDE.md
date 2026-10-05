# Sorted — 작업 안내 (Claude Code용)

LMS에서 받은 강의자료 PDF를 과목·주차별로 자동 정리하는 Chrome 확장 + Mac 앱.
앱은 Dock에 뜨는 보통 앱이다 (메뉴 막대 앱에서 바꿈, 2026-10-03). 창을 닫아도 뒤에서 돌고, 종료는 ⌘Q.
CSE406 소프트웨어공학 Phase 1 프로젝트 (3분 대면 시연, 영어). 평가에서 도구 사용, git 이력, 이슈 추적을 본다.

- 대화는 **한국어**로 한다.
- 기획안(요구사항, 아키텍처, 일정): Claude Docs "Sorted 기획안"
  https://claude.ai/code/artifact/68de80c1-8330-47aa-9dab-9719871144e1
- 화면 ↔ 앱 내부 약속: `docs/app-api.md` (명령마다 있음/바꿈/새로 표시) / 연결 구조: `docs/native-messaging.md` / 스파이크 결과: `docs/spike-3.md`

## 팀과 맡은 부분

| 이름 | 맡은 부분                                                                                                               |
| ---- | ----------------------------------------------------------------------------------------------------------------------- |
| 예원 | 앱 화면 `app/src/` (React + TypeScript). **화면 코드는 건드리지 않는다.** 필요한 건 `docs/app-api.md`에 약속으로 적는다 |
| 준우 | 확장 `extension/`, 앱 내부 `app/src-tauri`, `app/core`, `app/native-host`                                               |

## 구조

```
extension/          Chrome MV3 확장. LMS 다운로드 감지, LMS(Canvas) API로 과목명·주차 조회 (canvas.js)
app/core/           판정 로직 (Rust, 화면 무관): course(과목 판정) judge(문서·버전) library(목록 저장)
                    organize(~/Sorted 이동) fingerprint(PDF·SHA-256) ipc/framing/queue/paths(통신)
app/native-host/    Chrome이 메시지마다 띄우는 중계 프로그램 → 유닉스 소켓 → 앱. 앱이 꺼져 있으면 pending.jsonl에 보관
app/src-tauri/      Mac 앱 본체. pipeline(정리 흐름) organizer(상태·보류 목록) inbox probe(스파이크 #3 확인용)
app/src/            앱 화면 (예원 담당). api/types.ts·backend.ts = docs/app-api.md를 TS로 옮긴 것
scripts/            install-native-host.sh / uninstall-native-host.sh
(server/)           판정 보조 서버 (선택, FR-18, 4단계 예정). Lambda + LLM. API 키는 여기에만 둔다
```

데이터: `~/Library/Application Support/Sorted/` (sorted.sock, pending.jsonl, library.json, history.json(최근 변경), schedule.json(일정), setup-done(첫 설정 끝냄), probe-history.jsonl, logs/)
정리 폴더: `~/Sorted/<과목명>/<주차>/<원래 파일명>.pdf` (환경 변수 `SORTED_ROOT`로 바꿀 수 있음)

> 저장소는 `~/dev/sorted`에 있다 (2026-10-04에 `~/sorted`에서 옮김: 디스크가 대소문자를 구분하지 않아 `~/Sorted`와 겹쳤음).
> 개발 중 확인은 테스트 폴더로: `open --env SORTED_ROOT="$HOME/SortedTest" app/target/release/bundle/macos/Sorted.app`
> 빌드한 앱 안에서는 실제 데이터, 브라우저 개발 화면(`localhost:1420`)에서는 목업을 쓴다 (#47). `VITE_BACKEND=mock|tauri`로 고정할 수 있다.
> 테스트 폴더를 문서·데스크톱 같은 보호 폴더 안에 두지 않는다: 빌드마다 서명이 바뀌어 macOS가 권한 창을 다시 띄운다.

## 확인 명령 (CI와 같음)

```sh
npm run format:check && npm run lint                         # 저장소 루트
cd app && npm run typecheck && npm test                      # 화면·확장 테스트 (vitest가 extension/도 돈다)
cd app && cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace
```

실행:

```sh
./scripts/install-native-host.sh                            # 중계 프로그램 등록 (native-host 바뀌면 다시)
cd app && npm run tauri build -- --bundles app && open target/release/bundle/macos/Sorted.app
```

## 작업 규칙

- GitHub Flow: 이슈 → `feat/<이슈번호>-<이름>` 브랜치 → PR → CI 통과 → **merge commit**으로 합침 (squash 안 함, 이력 보존). 승인 필수 아님.
- PR 본문: `Closes #N` (끝난 것), `Refs #N` (일부만, 화면 쪽 남은 것). 커밋 메시지: `feat(core): …`, `fix(extension): …`, `docs: …`, 본문 끝에 `Refs #N`.
- 커밋 작성자는 준우(`sjounng`). Claude가 쓴 코드면 커밋 끝에 `Co-Authored-By: Claude <noreply@anthropic.com>`.
- 코드 주석·문서는 한국어. Prettier(printWidth 100)·rustfmt 적용 후 커밋.
- **개인정보:** 실제 강의 PDF, 학번, LMS URL의 쿼리(`?` 뒤), LMS API 응답의 user_id·수강 정보는 커밋·로그·이슈에 남기지 않는다. 확장은 앱에 보내기 전에 URL 쿼리를 지우고, 로그에는 메시지 내용을 남기지 않는다 (테스트로 확인 중).
  판정 보조 서버(FR-18)에는 파일명·첫 페이지 글자·후보 문서 이름만 보낸다 (PDF·학번·URL 안 보냄). 사용자 동의를 받고, 꺼도 동작해야 한다.
- 확실하지 않으면 파일에 손대지 않는다. 중복 파일은 묻기 전까지 지우거나 옮기지 않는다. 지울 땐 휴지통.

## 주의할 점

- zsh에서 큰따옴표 안의 `!`는 history expansion 에러가 난다. PR 본문은 작은따옴표나 `--body-file - <<'EOF'`로.
- `extension/`이 바뀌면 `chrome://extensions`에서 Sorted 새로고침해야 반영된다.
- 다운로드 폴더 권한(가정 4)은 `tauri dev`가 아니라 빌드한 `.app`으로 확인한다 (dev는 터미널 권한을 빌림).
- Sorted 앱은 하나만 뜰 수 있다 (소켓). 새로 띄우기 전에 ⌘Q로 종료 (PR #20 전 빌드는 메뉴 막대에서 종료).
- 확장 ID는 manifest의 `key`로 `phgmelpblnighkdkldoamokdbjbmencf` 고정.

## 이슈 번호

| 이슈                    | 내용                                                                                 | 단계 |
| ----------------------- | ------------------------------------------------------------------------------------ | ---- |
| #1, #2(PR)              | 스파이크: 네이티브 메시징                                                            | 끝   |
| #3                      | 스파이크: 남은 가정 (과목 ID, content_id, 해시, 권한, 과목명·주차)                   | 끝   |
| #4~#9                   | FR-1 감지, FR-2 PDF만, FR-3 문서 식별, FR-4 버전, FR-5 과목 판정, FR-6 폴더 정리     | 2    |
| #14, #15, #18, #23      | FR-11 과목명, FR-12 주차 순서, FR-15 첫 설정, FR-17 모듈 이름이 달라도 주차 맞추기   | 2    |
| #10, #11, #16, #17, #19 | FR-7 중복 알림, FR-8 새 버전, FR-13 메인 창, FR-14 파일 추적(xattr), FR-16 연결 끊김 | 3    |
| #30                     | FR-19 LMS 일정(과제·퀴즈·영상 마감)                                                  | 3    |
| #12, #13, #24           | FR-9 변경 보여주기, FR-10 구버전 정리, FR-18 이름 바뀐 새 버전 찾기(판정 보조 서버)  | 4    |

## 지금 상태 (2026-10-04)

- 앱 내부 명령: `docs/app-api.md`의 1~3단계 명령을 모두 채움 (메인 창, 과목, 휴지통, 일정, 첫 실행 설정, 과목 지정, 중복, 파일 열기).
  4단계(`comparison`, `cleanup_request`, `resolve_cleanup`)만 남음.
- 끝난 기능 (이슈 닫힘): FR-1~7, FR-11, FR-14(옮긴 파일 추적), FR-15(첫 실행 설정), FR-16(연결 끊김), FR-17(모듈 이름 주차).
- 진행 중: FR-12 주차 순서 #15 (같은 주차 안 순서·사용자 순서 남음), FR-13 메인 창 #16·#34 (예원 디자인 개편),
  FR-19 일정 #30 (플래너·주차학습 영상·지각 마감까지 실제 LMS로 확인).
- 빌드한 앱 + 실제 LMS로 확인: 정리, 주차 이름 맞추기, 옮긴 파일 따라가기, 중복 창·휴지통, 앱이 꺼졌을 때 보관, 일정, 첫 실행 설정.
- 화면 기본값은 아직 목업(`VITE_BACKEND`). 예원 개편 뒤 `tauri`로 바꾼다.
- 작업한 브랜치는 머지 후에도 지우지 않고 남겨 둔다. 쌓인 PR은 머지 전에 대상 브랜치를 확인한다 (#28이 main이 아닌 곳에 들어간 적 있음).

## 다음 할 일

1. 예원에게 전할 것 (화면): 과목 화면·일정 탭이 `overview-changed`를 구독해 다운로드 직후 바로 바뀌게,
   설정 창이 열려 있는 동안 상태를 다시 불러오게 (지금은 앱이 창을 새로 고침), 디자인 개편 뒤 기본값을 `tauri`로.
2. probe(스파이크 #3 확인 코드) 제거와 메시지 기록 창 정리 (예원과 상의).
3. 시연 준비: README에 아키텍처 Mermaid 그림 (`docs/plan.md`에서 빠진 그림도), 설계 문서 영어 번역, 3분 영어 대본·리허설.
   시연은 기본 정리 폴더 `~/Sorted`로 (테스트 폴더 기록과 섞이지 않게 시작 전 정리).
4. 4단계 (시연엔 설계로만): FR-9 변경 비교·FR-10 구버전 정리 (#12, #13), FR-18 판정 보조 서버 (#24).
5. FR-19 남은 것: 같은 수업의 "수업자료 강의실"(별도 LMS 과목)을 한 과목으로 묶어 보기 (필요하면).
   LMS 인증 방식·실제 응답 원문은 비공개로만 공유받음 → 저장소·로그에 넣지 않는다.
6. 로컬 Rust(1.94)가 CI(1.99)보다 낮아 새 clippy 규칙을 놓칠 수 있다 → `rustup update stable` 검토.
