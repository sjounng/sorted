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
      <h1>Sorted 시작하기</h1>
      <p className="muted">한 번만 설정하면, 그다음부터는 LMS에서 평소처럼 받기만 하면 돼요.</p>

      <ol className="steps">
        <Step
          done={access === "granted"}
          failed={access === "denied"}
          title="다운로드 폴더 접근 허용"
          detail={
            access === "denied"
              ? "접근이 거부됐어요. 시스템 설정에서 Sorted를 허용해 주세요."
              : "받은 파일을 읽고 정리 폴더로 옮기는 데 필요해요."
          }
        >
          {access === "unknown" && (
            <button className="primary" disabled={asking} onClick={ask}>
              {asking ? "요청 중…" : "허용하기"}
            </button>
          )}
          {access === "denied" && <button onClick={api.openSystemSettings}>설정 열기</button>}
        </Step>

        <Step
          done={status.sortedFolderCreated}
          title="정리 폴더 만들기"
          detail={
            status.sortedFolderCreated
              ? `${status.sortedFolder}에 과목별로 정리해요.`
              : `${status.sortedFolder}를 만들어요. 접근을 허용하면 자동으로 만들어져요.`
          }
        />

        <Step
          done={status.extensionConnected}
          title="Chrome 확장 연결"
          detail={
            status.extensionConnected
              ? "확장과 연결됐어요."
              : "Chrome에 Sorted 확장을 설치하고 한 번 실행해 주세요."
          }
        />
      </ol>

      <div className="actions">
        <button className="primary" disabled={!ready} onClick={closeSelf}>
          {ready ? "완료" : "설정을 마쳐 주세요"}
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
