import { api, type CleanupChoice } from "../api";
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
      <h1>Delete the old version?</h1>
      <p className="file">
        <strong>{data.fileName}</strong>
        <span className="muted">
          {" "}
          · v{data.oldVersion} · {size(data.sizeBytes)}
        </span>
      </p>

      {data.hasAnnotations ? (
        <p className="callout warn">
          This file looks annotated: it changed after you downloaded it. Move your notes before
          deleting.
        </p>
      ) : (
        <p className="muted">The file goes to the Trash and its comparison data is removed.</p>
      )}

      <div className="actions">
        <button onClick={() => api.revealInFinder(data.oldPath)}>Show in Finder</button>
        <span className="spacer" />
        <button onClick={() => choose("keep")}>Keep</button>
        <button
          className={data.hasAnnotations ? "danger" : "primary"}
          onClick={() => choose("delete")}
        >
          Move to Trash
        </button>
      </div>
    </main>
  );
}
