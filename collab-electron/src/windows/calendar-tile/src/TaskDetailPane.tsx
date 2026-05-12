import { useEffect, useRef, useState } from "react";
import type { TaskItem } from "./TaskPanel";

interface Props {
  task: TaskItem;
  childTasks: TaskItem[];
  onChange: (patch: Partial<TaskItem>) => void;
  onClose: () => void;
  onDelete: () => void;
  onAddChild: () => void;
  onUpdateChild: (childId: string, patch: Partial<TaskItem>) => void;
  onDeleteChild: (childId: string) => void;
}

function toDateInput(due: string | undefined): string {
  if (!due) return "";
  const JST = 9 * 60 * 60 * 1000;
  const d = new Date(new Date(due).getTime() + JST);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fromDateInput(value: string): string | undefined {
  if (!value) return undefined;
  const [y, m, d] = value.split("-").map(Number);
  const JST = 9 * 60 * 60 * 1000;
  const utcMidnight = Date.UTC(y, m - 1, d);
  return new Date(utcMidnight - JST).toISOString();
}

export default function TaskDetailPane({ task, childTasks, onChange, onClose, onDelete, onAddChild, onUpdateChild, onDeleteChild }: Props) {
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? "");
  const titleRef = useRef<HTMLInputElement>(null);
  const lastIdRef = useRef(task.id);

  useEffect(() => {
    if (lastIdRef.current !== task.id) {
      setTitle(task.title);
      setNotes(task.notes ?? "");
      lastIdRef.current = task.id;
    }
  }, [task.id, task.title, task.notes]);

  useEffect(() => {
    setTimeout(() => titleRef.current?.focus(), 0);
  }, [task.id]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const commitTitle = () => {
    const v = title.trim();
    if (v && v !== task.title) onChange({ title: v });
  };

  const commitNotes = () => {
    const v = notes.trim();
    if ((v || undefined) !== task.notes) onChange({ notes: v || undefined });
  };

  const handleDelete = () => {
    const label = task.title || "このタスク";
    if (window.confirm(`「${label}」を削除しますか？`)) onDelete();
  };

  return (
    <div className="task-detail">
      <div className="task-detail-header">
        <span className="task-detail-title">タスク詳細</span>
        <button className="task-detail-close" onClick={onClose} title="閉じる">×</button>
      </div>
      <div className="task-detail-body">
        <label className="task-detail-field">
          <span className="task-detail-label">タイトル</span>
          <input
            ref={titleRef}
            className="task-detail-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          />
        </label>

        {!task.parent && (
          <div className="task-detail-field">
            <span className="task-detail-label">子タスク</span>
            <div className="task-detail-children">
              {childTasks.map((c) => (
                <ChildRow
                  key={c.id}
                  child={c}
                  onUpdate={(patch) => onUpdateChild(c.id, patch)}
                  onDelete={() => onDeleteChild(c.id)}
                />
              ))}
              <button
                type="button"
                className="task-detail-add-child-btn"
                onClick={onAddChild}
              >
                + 子タスクを追加
              </button>
            </div>
          </div>
        )}

        <label className="task-detail-field task-detail-field-row">
          <input
            type="checkbox"
            className="task-detail-checkbox"
            checked={task.done}
            onChange={(e) =>
              onChange({
                done: e.target.checked,
                doneAt: e.target.checked ? new Date().toISOString() : undefined,
              })
            }
          />
          <span className="task-detail-label">完了</span>
        </label>

        <label className="task-detail-field">
          <span className="task-detail-label">期限</span>
          <input
            type="date"
            className="task-detail-input"
            value={toDateInput(task.due)}
            onChange={(e) => onChange({ due: fromDateInput(e.target.value) })}
          />
        </label>

        <label className="task-detail-field task-detail-field-grow">
          <span className="task-detail-label">メモ</span>
          <textarea
            className="task-detail-textarea"
            value={notes}
            placeholder="メモを入力..."
            onChange={(e) => setNotes(e.target.value)}
            onBlur={commitNotes}
          />
        </label>

        <button
          type="button"
          className="task-detail-delete-btn"
          onClick={handleDelete}
          title="削除"
        >
          削除
        </button>
      </div>
    </div>
  );
}

function ChildRow({
  child,
  onUpdate,
  onDelete,
}: {
  child: TaskItem;
  onUpdate: (patch: Partial<TaskItem>) => void;
  onDelete: () => void;
}) {
  const [value, setValue] = useState(child.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue(child.title);
  }, [child.id, child.title]);

  useEffect(() => {
    if (child.title === "") inputRef.current?.focus();
  }, [child.id, child.title]);

  const commit = () => {
    const v = value.trim();
    if (v === "") { onDelete(); return; }
    if (v !== child.title) onUpdate({ title: v });
  };

  return (
    <div className="task-detail-child">
      <input
        type="checkbox"
        className="task-detail-checkbox"
        checked={child.done}
        onChange={(e) => onUpdate({
          done: e.target.checked,
          doneAt: e.target.checked ? new Date().toISOString() : undefined,
        })}
      />
      <input
        ref={inputRef}
        className={`task-detail-child-input${child.done ? " task-detail-child-done" : ""}`}
        value={value}
        placeholder="子タスク名"
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") { setValue(child.title); (e.target as HTMLInputElement).blur(); }
        }}
      />
      <button
        type="button"
        className="task-detail-child-delete"
        onClick={onDelete}
        title="削除"
      >×</button>
    </div>
  );
}
