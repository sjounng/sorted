import { useState } from "react";
import { api, type AssignChoice } from "../api";
import { ago } from "../format";
import { useLoad } from "../useLoad";
import { closeSelf } from "../windows";

const NEW = "__new__";

/** 과목을 알아내지 못한 파일에 과목을 고른다 (FR-5). 고른 답은 앱이 기억한다. */
export function Assign({ id }: { id: string }) {
  const { data } = useLoad(() => api.assignRequest(id), [id]);
  const [picked, setPicked] = useState<string>();
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  if (!data) return <main className="dialog" />;

  const choice: AssignChoice | undefined =
    picked === NEW
      ? newName.trim()
        ? { newCourseName: newName.trim() }
        : undefined
      : picked
        ? { courseId: picked }
        : undefined;

  const save = async () => {
    if (!choice) return;
    setSaving(true);
    await api.assignCourse(data.fileId, choice).finally(() => setSaving(false));
    await closeSelf();
  };

  const skip = async () => {
    await api.skipAssign(data.fileId);
    await closeSelf();
  };

  return (
    <main className="dialog">
      <h1>Which class is this for?</h1>
      <p className="file">
        <strong>{data.fileName}</strong>
        <span className="muted"> · downloaded {ago(data.atMs)}</span>
      </p>
      {data.tabTitle && <p className="muted hint">Page open at download: {data.tabTitle}</p>}

      <fieldset className="choices">
        {data.courses.map((c) => (
          <label key={c.id} className="choice">
            <input
              type="radio"
              name="course"
              checked={picked === c.id}
              onChange={() => setPicked(c.id)}
            />
            {c.name}
          </label>
        ))}
        <label className="choice">
          <input
            type="radio"
            name="course"
            checked={picked === NEW}
            onChange={() => setPicked(NEW)}
          />
          New class
        </label>
        {picked === NEW && (
          <input
            className="text"
            autoFocus
            placeholder="Class name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
        )}
      </fieldset>

      <p className="muted hint">
        Files from this class page will be sorted automatically next time.
      </p>

      <div className="actions">
        <button onClick={skip}>Later</button>
        <button className="primary" disabled={!choice || saving} onClick={save}>
          Sort
        </button>
      </div>
    </main>
  );
}
