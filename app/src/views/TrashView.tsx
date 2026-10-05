import { useState } from "react";
import { api, type TrashedCourse } from "../api";
import { t } from "../i18n";
import { ago } from "../format";
import { useLoad } from "../useLoad";

/**
 * Sorted 휴지통: 지운 과목을 되살리거나 완전히 지운다.
 * 완전히 지워도 과목 폴더는 macOS 휴지통으로 가므로 Finder에서는 한 번 더 꺼낼 수 있다.
 */
export function TrashView() {
  const { data, error, reload } = useLoad(api.trash);
  const [confirmEmpty, setConfirmEmpty] = useState(false);

  return (
    <div className="course trash">
      <header className="trash-head">
        <div>
          <strong>{t("Trash", "휴지통")}</strong>
          <p className="muted">
            {t(
              "Deleted classes stay here. Restoring brings back their files and recent changes.",
              "지운 과목은 여기 남아요. 되살리면 자료와 최근 변경도 함께 돌아와요.",
            )}
          </p>
        </div>
        {data && data.length > 0 && !confirmEmpty && (
          <button onClick={() => setConfirmEmpty(true)}>{t("Empty Trash", "휴지통 비우기")}</button>
        )}
      </header>

      {confirmEmpty && data && (
        <div className="callout trash-confirm">
          <p>
            {t(
              `Permanently delete ${data.length} ${data.length === 1 ? "class" : "classes"}? Their folders go to the macOS Trash.`,
              `과목 ${data.length}개를 완전히 지울까요? 과목 폴더는 macOS 휴지통으로 가요.`,
            )}
          </p>
          <div className="actions">
            <button onClick={() => setConfirmEmpty(false)}>{t("Cancel", "취소")}</button>
            <button
              className="danger"
              onClick={async () => {
                await api.emptyTrash();
                setConfirmEmpty(false);
                reload();
              }}
            >
              {t("Delete All", "모두 지우기")}
            </button>
          </div>
        </div>
      )}

      {error && <p className="empty warn">{error}</p>}
      {data?.length === 0 && (
        <p className="empty muted">{t("Trash is empty.", "휴지통이 비어 있어요.")}</p>
      )}
      {data && data.length > 0 && (
        <ul className="files trash-list">
          {data.map((item) => (
            <TrashRow key={item.course.id} item={item} onDone={reload} />
          ))}
        </ul>
      )}
    </div>
  );
}

function TrashRow({ item, onDone }: { item: TrashedCourse; onDone: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const { course } = item;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="trash-row">
      <div className="trash-main">
        <span className="trash-text">
          <strong>{course.name}</strong>
          <span className="muted">
            {t(
              `${course.fileCount} files · deleted ${ago(item.removedAtMs)}`,
              `파일 ${course.fileCount}개 · ${ago(item.removedAtMs)} 지움`,
            )}
          </span>
        </span>
        {!confirm && (
          <span className="trash-actions">
            <button
              className="primary"
              disabled={busy}
              onClick={() => run(() => api.restoreCourse(course.id))}
            >
              {t("Restore", "되살리기")}
            </button>
            <button disabled={busy} onClick={() => setConfirm(true)}>
              {t("Delete Permanently", "완전히 삭제")}
            </button>
          </span>
        )}
      </div>

      {confirm && (
        <div className="trash-confirm">
          <p className="muted">
            {t(
              "Removes it from Sorted and moves its folder to the macOS Trash.",
              "Sorted에서 완전히 지우고, 과목 폴더는 macOS 휴지통으로 보내요.",
            )}
          </p>
          <div className="actions">
            <button onClick={() => setConfirm(false)}>{t("Cancel", "취소")}</button>
            <button
              className="danger"
              disabled={busy}
              onClick={() => run(() => api.purgeCourse(course.id))}
            >
              {t("Delete Permanently", "완전히 삭제")}
            </button>
          </div>
        </div>
      )}
      {error && <p className="field-error trash-error">{error}</p>}
    </li>
  );
}
