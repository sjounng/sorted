import { api, type DuplicateChoice } from "../api";
import { ago } from "../format";
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
      <h1>You already have this file</h1>
      <p className="file">
        <strong>{data.fileName}</strong>
      </p>
      <p className="muted">
        Same content as the file saved {ago(data.existingSavedAtMs)} in {data.courseName} ·{" "}
        {data.week}.
      </p>
      <p className="muted hint">“Open existing file” moves the new copy to the Trash.</p>

      <div className="actions">
        <button onClick={() => choose("keepBoth")}>Keep Both</button>
        <button className="primary" onClick={() => choose("openExisting")}>
          Open Existing File
        </button>
      </div>
    </main>
  );
}
