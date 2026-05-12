import { useState } from "react";

interface Props {
  authStatus: { hasCredentials: boolean; hasTokens: boolean };
  onConnected: () => void;
}

export default function AuthSetup({ authStatus, onConnected }: Props) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [step, setStep] = useState<"credentials" | "connecting" | "error">(
    authStatus.hasCredentials && !authStatus.hasTokens ? "connecting" : "credentials"
  );
  const [errorMsg, setErrorMsg] = useState("");

  const handleSaveCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientId.trim() || !clientSecret.trim()) return;
    await window.api.calendarSaveCredentials(clientId.trim(), clientSecret.trim());
    setStep("connecting");
  };

  const handleConnect = async () => {
    setStep("connecting");
    setErrorMsg("");
    try {
      await window.api.calendarConnect();
      onConnected();
    } catch (e: any) {
      setErrorMsg(e?.message ?? "認証に失敗しました");
      setStep("error");
    }
  };

  return (
    <div className="auth-root">
      <div className="auth-box">
        <div className="auth-icon">📅</div>
        <h2>Google Calendar 連携</h2>

        {step === "credentials" && (
          <>
            <p className="auth-desc">
              Google Cloud Console で OAuth 2.0 クライアント ID を作成し、
              <br />Client ID と Client Secret を入力してください。
            </p>
            <ol className="auth-steps">
              <li>console.cloud.google.com でプロジェクトを作成</li>
              <li>「Google Calendar API」を有効化</li>
              <li>「OAuth 2.0 クライアント ID」を作成（種類: デスクトップアプリ）</li>
              <li>リダイレクト URI に <code>http://localhost:49152/oauth/callback</code> を追加</li>
            </ol>
            <form className="auth-form" onSubmit={handleSaveCredentials}>
              <label>
                Client ID
                <input type="text" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="xxx.apps.googleusercontent.com" required />
              </label>
              <label>
                Client Secret
                <input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="GOCSPX-..." required />
              </label>
              <button type="submit" className="btn-connect">次へ</button>
            </form>
          </>
        )}

        {step === "connecting" && (
          <>
            <p className="auth-desc">
              ブラウザでGoogleアカウントにサインインして、
              <br />カレンダーへのアクセスを許可してください。
            </p>
            <button className="btn-connect" onClick={handleConnect}>
              ブラウザで認証する
            </button>
            <button className="btn-back" onClick={() => setStep("credentials")}>
              ← 認証情報を変更
            </button>
          </>
        )}

        {step === "error" && (
          <>
            <p className="auth-error">{errorMsg}</p>
            <button className="btn-connect" onClick={handleConnect}>再試行</button>
            <button className="btn-back" onClick={() => setStep("credentials")}>
              ← 認証情報を変更
            </button>
          </>
        )}
      </div>
    </div>
  );
}
