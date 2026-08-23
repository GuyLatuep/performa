import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import Blockmark from "./Blockmark";

const AUTHOR = "Malte Polzin";
const EMAIL = "malte@polz.in";

export default function About({ onClose }: { onClose: () => void }) {
  const [version, setVersion] = useState("");

  useEffect(() => {
    getVersion().then(setVersion);
  }, []);

  return (
    <div className="setup settings-page about">
      <div className="setup-mark">
        <Blockmark />
      </div>
      <span className="eyebrow">Über</span>
      <h1>performa</h1>

      <dl className="about-facts">
        <div>
          <dt>Version</dt>
          <dd>
            v{version} · {__BUILT_AT__.slice(0, 16).replace("T", " ")} UTC
          </dd>
        </div>
        <div>
          <dt>Autor</dt>
          <dd>{AUTHOR}</dd>
        </div>
        <div>
          <dt>E-Mail</dt>
          <dd>
            <button
              className="link about-mail"
              onClick={() => openUrl(`mailto:${EMAIL}`)}
            >
              {EMAIL}
            </button>
          </dd>
        </div>
      </dl>

      <div className="about-text">
        <p>
          performa ist nur ein kleines Nebenprojekt von mir. Ich will keine
          Rechte verletzen und keinen Schaden anrichten. Wenn Sie finden, dass
          ich Ihre Rechte verletze oder Schaden anrichte, dann schreiben Sie mir
          ganz schnell eine E-Mail und wir klären das.
        </p>
        <p>
          Wenn Sie, was auch sein kann, für diese App gut finden, dann können
          wir uns gerne duzen. Schreib mir doch auch eine E-Mail, wenn du
          willst, Freunde machen das so.
        </p>
      </div>

      <div className="row">
        <button type="button" onClick={onClose}>
          Zurück
        </button>
      </div>
    </div>
  );
}
