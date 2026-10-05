import { useState } from "react";
import { api, type SetupStatus } from "../api";
import { changeLanguage, t, useLanguage } from "../i18n";
import { useTheme } from "../theme";
import { useLoad } from "../useLoad";
import { closeSelf } from "../windows";

/** 첫 실행 설정 (FR-15) + 환경 설정(화면 모드·언어, #46). 메인 창 사이드바의 "설정"에서도 연다. */
export function Setup() {
  const loaded = useLoad(api.setupStatus);
  const [updated, setUpdated] = useState<SetupStatus>();
  const [asking, setAsking] = useState(false);
  const status = updated ?? loaded.data;

  if (!status) return <main className="dialog" />;

  const access = status.downloadsAccess;
  const ready = access === "granted" && status.sortedFolderCreated && status.extensionConnected;

  const ask = async () => {
    setAsking(true);
    setUpdated(await api.requestDownloadsAccess().finally(() => setAsking(false)));
  };

  return (
    <main className="dialog">
      {/* 맨 위에 둔다: 아래 문장들은 언어마다 길이가 달라, 아래에 두면 언어를 바꿀 때 버튼이 움직인다 */}
      <Preferences />

      <h1>{t("Welcome to Sorted", "Sorted에 오신 걸 환영해요")}</h1>
      <p className="muted">
        {t(
          "Set this up once. After that, just download from the LMS as usual.",
          "한 번만 설정하면 돼요. 그다음부터는 평소처럼 LMS에서 받기만 하세요.",
        )}
      </p>

      <ol className="steps">
        <Step
          done={access === "granted"}
          failed={access === "denied"}
          title={t("Allow access to Downloads", "다운로드 폴더 접근 허용")}
          detail={
            access === "denied"
              ? t(
                  "Access was denied. Allow Sorted in System Settings.",
                  "접근이 거부됐어요. 시스템 설정에서 Sorted를 허용해 주세요.",
                )
              : t(
                  "Needed to read new downloads and move them into your Sorted folder.",
                  "새로 받은 파일을 읽어 정리 폴더로 옮기는 데 필요해요.",
                )
          }
        >
          {access === "unknown" && (
            <button className="primary" disabled={asking} onClick={ask}>
              {asking ? t("Requesting…", "요청하는 중…") : t("Allow", "허용")}
            </button>
          )}
          {access === "denied" && (
            <button onClick={api.openSystemSettings}>{t("Open Settings", "설정 열기")}</button>
          )}
        </Step>

        <Step
          done={status.sortedFolderCreated}
          title={t("Create your Sorted folder", "정리 폴더 만들기")}
          detail={
            status.sortedFolderCreated
              ? t(
                  `Files are sorted by class in ${status.sortedFolder}.`,
                  `${status.sortedFolder}에 과목별로 정리돼요.`,
                )
              : t(
                  `${status.sortedFolder} is created automatically once access is allowed.`,
                  `접근을 허용하면 ${status.sortedFolder}가 자동으로 만들어져요.`,
                )
          }
        />

        <Step
          done={status.extensionConnected}
          title={t("Connect the Chrome extension", "Chrome 확장 연결")}
          detail={
            status.extensionConnected
              ? t("Connected to the extension.", "확장과 연결됐어요.")
              : t(
                  "Install the Sorted extension in Chrome and open it once.",
                  "Chrome에 Sorted 확장을 설치하고 한 번 눌러 주세요.",
                )
          }
        />
      </ol>

      <div className="actions">
        <button className="primary" disabled={!ready} onClick={closeSelf}>
          {ready ? t("Done", "완료") : t("Finish the steps above", "위 단계를 마쳐 주세요")}
        </button>
      </div>
    </main>
  );
}

function Step(props: {
  done: boolean;
  failed?: boolean;
  title: string;
  detail: string;
  children?: React.ReactNode;
}) {
  const state = props.done ? "done" : props.failed ? "failed" : "todo";
  return (
    <li className={`step ${state}`}>
      <span className="mark" aria-hidden>
        {props.done ? "✓" : props.failed ? "!" : ""}
      </span>
      <div>
        <strong>{props.title}</strong>
        <p className="muted">{props.detail}</p>
        {props.children}
      </div>
    </li>
  );
}

/** 환경 설정: 화면 모드와 언어. 바꾸면 열린 창이 모두 바로 바뀐다 */
function Preferences() {
  const [theme, toggleTheme] = useTheme();
  const language = useLanguage();
  return (
    <section className="prefs" aria-label={t("Preferences", "환경 설정")}>
      <h2>{t("Preferences", "환경 설정")}</h2>
      <div className="pref-row">
        <span>{t("Appearance", "화면 모드")}</span>
        <div className="chips" role="group" aria-label={t("Appearance", "화면 모드")}>
          {(["light", "dark"] as const).map((mode) => (
            <button
              key={mode}
              className={theme === mode ? "chip active" : "chip"}
              aria-pressed={theme === mode}
              onClick={() => theme !== mode && toggleTheme()}
            >
              {mode === "light" ? t("Light", "라이트") : t("Dark", "다크")}
            </button>
          ))}
        </div>
      </div>
      <div className="pref-row">
        <span>{t("Language", "언어")}</span>
        <div className="chips" role="group" aria-label={t("Language", "언어")}>
          {(["ko", "en"] as const).map((lang) => (
            <button
              key={lang}
              className={language === lang ? "chip active" : "chip"}
              aria-pressed={language === lang}
              onClick={() => language !== lang && changeLanguage(lang)}
            >
              {lang === "ko" ? "한국어" : "English"}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
