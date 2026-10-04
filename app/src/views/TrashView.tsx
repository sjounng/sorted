import { useState } from "react";
import { api, type TrashedCourse } from "../api";
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
          <strong>Trash</strong>
          <p className="muted">
            Deleted classes stay here. Restoring brings back their files and recent changes.
          </p>
        </div>
        {data && data.length > 0 && !confirmEmpty && (
          <button onClick={() => setConfirmEmpty(true)}>Empty Trash</button>
        )}
      </header>

      {confirmEmpty && data && (
        <div className="callout trash-confirm">
          <p>
            Permanently delete {data.length} {data.length === 1 ? "class" : "classes"}? Their
            folders go to the macOS Trash.
          </p>
          <div className="actions">
            <button onClick={() => setConfirmEmpty(false)}>Cancel</button>
            <button
              className="danger"
              onClick={async () => {
                await api.emptyTrash();
                setConfirmEmpty(false);
                reload();
              }}
            >
              Delete All
            </button>
          </div>
        </div>
      )}

      {error && <p className="empty warn">{error}</p>}
      {data?.length === 0 && <p className="empty muted">Trash is empty.</p>}
      {data && data.length > 0 && (
        <ul className="files trash-list">
          {data.map((t) => (
            <TrashRow key={t.course.id} item={t} onDone={reload} />
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
            {course.fileCount} files · deleted {ago(item.removedAtMs)}
          </span>
        </span>
        {!confirm && (
          <span className="trash-actions">
            <button
              className="primary"
              disabled={busy}
              onClick={() => run(() => api.restoreCourse(course.id))}
            >
              Restore
            </button>
            <button disabled={busy} onClick={() => setConfirm(true)}>
              Delete Permanently
            </button>
          </span>
        )}
      </div>

      {confirm && (
        <div className="trash-confirm">
          <p className="muted">Removes it from Sorted and moves its folder to the macOS Trash.</p>
          <div className="actions">
            <button onClick={() => setConfirm(false)}>Cancel</button>
            <button
              className="danger"
              disabled={busy}
              onClick={() => run(() => api.purgeCourse(course.id))}
            >
              Delete Permanently
            </button>
          </div>
        </div>
      )}
      {error && <p className="field-error trash-error">{error}</p>}
    </li>
  );
}
