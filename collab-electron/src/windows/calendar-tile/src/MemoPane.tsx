import { useState, useEffect, useRef, useCallback } from "react";

interface Memo {
  id: string;
  name: string;
  content: string;
}

interface MemosData {
  version: 1;
  memos: Memo[];
  activeId: string;
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export default function MemoPane() {
  const [data, setData] = useState<MemosData | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const editorRef = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDataRef = useRef<MemosData | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const flushSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (pendingDataRef.current) {
      const toSave = pendingDataRef.current;
      pendingDataRef.current = null;
      window.api.memosSave(toSave).catch(() => {});
    }
  }, []);

  useEffect(() => {
    window.api.memosLoad().then((raw) => {
      const d = raw as MemosData;
      setData(d);
      const active = d.memos.find((m) => m.id === d.activeId);
      if (active && editorRef.current) {
        editorRef.current.innerHTML = active.content;
      }
    }).catch(() => {});
  }, []);

  const activeMemo = data ? data.memos.find((m) => m.id === data.activeId) ?? data.memos[0] : null;

  const scheduleSave = useCallback((updated: MemosData) => {
    pendingDataRef.current = updated;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const toSave = pendingDataRef.current;
      pendingDataRef.current = null;
      saveTimerRef.current = null;
      if (toSave) window.api.memosSave(toSave).catch(() => {});
    }, 600);
  }, []);

  const handleInput = useCallback(() => {
    if (!data || !activeMemo) return;
    const content = editorRef.current?.innerHTML ?? "";
    const updated: MemosData = {
      ...data,
      memos: data.memos.map((m) => m.id === activeMemo.id ? { ...m, content } : m),
    };
    setData(updated);
    scheduleSave(updated);
  }, [data, activeMemo, scheduleSave]);

  const switchMemo = useCallback((id: string) => {
    if (!data) return;
    const target = data.memos.find((m) => m.id === id);
    if (!target) return;
    const currentContent = editorRef.current?.innerHTML ?? "";
    const flushed: MemosData = {
      ...data,
      activeId: id,
      memos: data.memos.map((m) => m.id === data.activeId ? { ...m, content: currentContent } : m),
    };
    setData(flushed);
    setDropdownOpen(false);
    if (editorRef.current) editorRef.current.innerHTML = target.content;
    pendingDataRef.current = flushed;
    flushSave();
  }, [data, flushSave]);

  const addMemo = useCallback(() => {
    if (!data) return;
    const id = uid();
    const updated: MemosData = {
      ...data,
      activeId: id,
      memos: [...data.memos, { id, name: `メモ${data.memos.length + 1}`, content: "" }],
    };
    setData(updated);
    setDropdownOpen(false);
    if (editorRef.current) editorRef.current.innerHTML = "";
    scheduleSave(updated);
  }, [data, scheduleSave]);

  const deleteMemo = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!data || data.memos.length <= 1) return;
    const remaining = data.memos.filter((m) => m.id !== id);
    const newActiveId = data.activeId === id ? remaining[0].id : data.activeId;
    const updated: MemosData = { ...data, activeId: newActiveId, memos: remaining };
    setData(updated);
    if (data.activeId === id && editorRef.current) {
      editorRef.current.innerHTML = remaining[0].content;
    }
    scheduleSave(updated);
  }, [data, scheduleSave]);

  const startRename = useCallback(() => {
    if (!activeMemo) return;
    setNameValue(activeMemo.name);
    setEditingName(true);
    setDropdownOpen(false);
    setTimeout(() => nameInputRef.current?.select(), 0);
  }, [activeMemo]);

  const commitRename = useCallback(() => {
    if (!data || !activeMemo) return;
    const name = nameValue.trim() || activeMemo.name;
    const updated: MemosData = {
      ...data,
      memos: data.memos.map((m) => m.id === activeMemo.id ? { ...m, name } : m),
    };
    setData(updated);
    setEditingName(false);
    scheduleSave(updated);
  }, [data, activeMemo, nameValue, scheduleSave]);

  const copyContent = useCallback(() => {
    const text = editorRef.current?.innerText ?? "";
    navigator.clipboard.writeText(text).catch(() => {});
  }, []);

  useEffect(() => {
    const onHidden = () => { if (document.visibilityState === "hidden") flushSave(); };
    const onBlur = () => flushSave();
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("blur", onBlur);
    window.addEventListener("beforeunload", flushSave);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("beforeunload", flushSave);
      flushSave();
    };
  }, [flushSave]);

  if (!data || !activeMemo) return <div className="memo-pane" />;

  return (
    <div className="memo-pane" onClick={() => setDropdownOpen(false)}>
      <div className="memo-pane-header" onClick={(e) => e.stopPropagation()}>
        <div className="memo-pane-header-left">
          {editingName ? (
            <input
              ref={nameInputRef}
              className="memo-name-input"
              value={nameValue}
              autoFocus
              onChange={(e) => setNameValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
              }}
            />
          ) : (
            <button
              className="memo-name-btn"
              onClick={() => setDropdownOpen((v) => !v)}
              onDoubleClick={startRename}
              title="クリック: 切り替え / ダブルクリック: リネーム"
            >
              <span className="memo-name-text">{activeMemo.name}</span>
              <span
                className="memo-name-edit"
                onClick={(e) => { e.stopPropagation(); startRename(); }}
                title="リネーム"
              >✎</span>
              <span className="memo-name-arrow">{dropdownOpen ? "▴" : "▾"}</span>
            </button>
          )}

          {dropdownOpen && (
            <div className="memo-dropdown">
              {data.memos.map((m) => (
                <div
                  key={m.id}
                  className={`memo-dropdown-item${m.id === activeMemo.id ? " active" : ""}`}
                  onClick={() => switchMemo(m.id)}
                >
                  <span className="memo-dropdown-name">{m.name}</span>
                  {data.memos.length > 1 && (
                    <button
                      className="memo-dropdown-delete"
                      onClick={(e) => deleteMemo(m.id, e)}
                      title="削除"
                    >×</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="memo-pane-header-actions">
          <button className="memo-action-btn" onClick={addMemo} title="新しいメモ">+</button>
          <button className="memo-action-btn" onClick={copyContent} title="コピー">⎘</button>
        </div>
      </div>

      <div
        ref={editorRef}
        className="memo-pane-editor"
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        data-placeholder="メモを入力..."
      />
    </div>
  );
}
