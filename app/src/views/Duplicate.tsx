import { api, type DuplicateChoice } from "../api";
import { t } from "../i18n";
import { ago, weekLabel } from "../format";
import { useLoad } from "../useLoad";
import { closeSelf } from "../windows";

/** 같은 문서·같은 내용을 다시 받았을 때 (FR-7). 묻지 않고 지우는 경우는 없다. */
export function Duplicate({ id }: { id: string }) {
  const { data } = useLoad(() => api.duplicateNotice(id), [id]);
  if (!data) return <main className="dialog" />;

  const choose = async (choice: DuplicateChoice) => {
    await api.resolveDuplicate(data.id, choice);
    await closeSelf();
  };

  return (
    <main className="dialog">
      <h1>{t("You already have this file", "이미 받은 파일이에요")}</h1>
      <p className="file">
        <strong>{data.fileName}</strong>
      </p>
      <p className="muted">
        {t(
          `Same content as the file saved ${ago(data.existingSavedAtMs)} in ${data.courseName} · ${weekLabel(data.week)}.`,
          `${data.courseName} · ${data.week}에 ${ago(data.existingSavedAtMs)} 저장한 파일과 내용이 같아요.`,
        )}
      </p>
      <p className="muted hint">
        {t(
          "“Open Existing File” moves the new copy to the Trash.",
          "[기존 파일 열기]를 누르면 방금 받은 복사본은 휴지통으로 가요.",
        )}
      </p>

      <div className="actions">
        <button onClick={() => choose("keepBoth")}>{t("Keep Both", "둘 다 보관")}</button>
        <button className="primary" onClick={() => choose("openExisting")}>
          {t("Open Existing File", "기존 파일 열기")}
        </button>
      </div>
    </main>
  );
}
