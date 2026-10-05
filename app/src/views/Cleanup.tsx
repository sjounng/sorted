import { api, type CleanupChoice } from "../api";
import { t } from "../i18n";
import { size } from "../format";
import { useLoad } from "../useLoad";
import { closeSelf } from "../windows";

/** 새 버전을 확인한 뒤 구버전을 지울지 묻는다 (FR-10). */
export function Cleanup({ id }: { id: string }) {
  const { data } = useLoad(() => api.cleanupRequest(id), [id]);
  if (!data) return <main className="dialog" />;

  const choose = async (choice: CleanupChoice) => {
    await api.resolveCleanup(data.documentId, choice);
    await closeSelf();
  };

  return (
    <main className="dialog">
      <h1>{t("Delete the old version?", "이전 버전을 지울까요?")}</h1>
      <p className="file">
        <strong>{data.fileName}</strong>
        <span className="muted">
          {" "}
          · v{data.oldVersion} · {size(data.sizeBytes)}
        </span>
      </p>

      {data.hasAnnotations ? (
        <p className="callout warn">
          {t(
            "This file looks annotated: it changed after you downloaded it. Move your notes before deleting.",
            "필기한 파일 같아요. 받은 뒤에 내용이 바뀌었어요. 지우기 전에 필기를 옮겨 두세요.",
          )}
        </p>
      ) : (
        <p className="muted">
          {t(
            "The file goes to the Trash and its comparison data is removed.",
            "파일은 휴지통으로 가고, 비교용 데이터는 지워져요.",
          )}
        </p>
      )}

      <div className="actions">
        <button onClick={() => api.revealInFinder(data.oldPath)}>
          {t("Show in Finder", "Finder에서 보기")}
        </button>
        <span className="spacer" />
        <button onClick={() => choose("keep")}>{t("Keep", "그대로 두기")}</button>
        <button
          className={data.hasAnnotations ? "danger" : "primary"}
          onClick={() => choose("delete")}
        >
          {t("Move to Trash", "휴지통으로")}
        </button>
      </div>
    </main>
  );
}
