import { useEffect, useRef, useCallback } from "react";

export default function MemoPane() {
  const editorRef = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    window.api.scratchpadLoad().then((content) => {
      if (editorRef.current && content) {
        editorRef.current.innerHTML = content;
      }
    }).catch(() => {});
  }, []);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const content = editorRef.current?.innerHTML ?? "";
      window.api.scratchpadSave(content).catch(() => {});
    }, 600);
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  return (
    <div className="memo-pane">
      <div className="memo-pane-header">メモ</div>
      <div
        ref={editorRef}
        className="memo-pane-editor"
        contentEditable
        suppressContentEditableWarning
        onInput={scheduleSave}
        data-placeholder="メモを入力..."
      />
    </div>
  );
}
