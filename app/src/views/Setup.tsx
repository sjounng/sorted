import { useState } from "react";
import { api, type SetupStatus } from "../api";
import { useLoad } from "../useLoad";
import { closeSelf } from "../windows";

/** 첫 실행 설정 (FR-15). 메인 창 하단의 "설정"에서도 다시 연다. */
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
      <h1>Welcome to Sorted</h1>
      <p className="muted">Set this up once. After that, just download from the LMS as usual.</p>

      <ol className="steps">
        <Step
          done={access === "granted"}
          failed={access === "denied"}
          title="Allow access to Downloads"
          detail={
            access === "denied"
              ? "Access was denied. Allow Sorted in System Settings."
              : "Needed to read new downloads and move them into your Sorted folder."
          }
        >
          {access === "unknown" && (
            <button className="primary" disabled={asking} onClick={ask}>
              {asking ? "Requesting…" : "Allow"}
            </button>
          )}
          {access === "denied" && <button onClick={api.openSystemSettings}>Open Settings</button>}
        </Step>

        <Step
          done={status.sortedFolderCreated}
          title="Create your Sorted folder"
          detail={
            status.sortedFolderCreated
              ? `Files are sorted by class in ${status.sortedFolder}.`
              : `${status.sortedFolder} is created automatically once access is allowed.`
          }
        />

        <Step
          done={status.extensionConnected}
          title="Connect the Chrome extension"
          detail={
            status.extensionConnected
              ? "Connected to the extension."
              : "Install the Sorted extension in Chrome and open it once."
          }
        />
      </ol>

      <div className="actions">
        <button className="primary" disabled={!ready} onClick={closeSelf}>
          {ready ? "Done" : "Finish the steps above"}
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
