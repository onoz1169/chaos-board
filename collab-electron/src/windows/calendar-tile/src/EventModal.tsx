import { useState } from "react";

interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  description?: string;
  location?: string;
}

interface Props {
  mode: "create" | "edit";
  event?: CalendarEvent;
  defaultStart?: string;
  defaultEnd?: string;
  defaultAllDay?: boolean;
  onSave: (data: {
    title: string;
    start: string;
    end: string;
    allDay: boolean;
    description?: string;
    location?: string;
  }) => void;
  onClose: () => void;
}

function toDatetimeLocal(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(0, 16);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toDateLocal(iso: string): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

export default function EventModal({ mode, event, defaultStart, defaultEnd, defaultAllDay, onSave, onClose }: Props) {
  const [title, setTitle] = useState(event?.title ?? "");
  const [allDay, setAllDay] = useState(event?.allDay ?? defaultAllDay ?? false);
  const [start, setStart] = useState(
    event ? (event.allDay ? toDateLocal(event.start) : toDatetimeLocal(event.start))
           : (defaultAllDay ? toDateLocal(defaultStart ?? "") : toDatetimeLocal(defaultStart ?? ""))
  );
  const [end, setEnd] = useState(
    event ? (event.allDay ? toDateLocal(event.end) : toDatetimeLocal(event.end))
           : (defaultAllDay ? toDateLocal(defaultEnd ?? "") : toDatetimeLocal(defaultEnd ?? ""))
  );
  const [description, setDescription] = useState(event?.description ?? "");
  const [location, setLocation] = useState(event?.location ?? "");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      await onSave({
        title: title.trim(),
        start: allDay ? start : new Date(start).toISOString(),
        end: allDay ? end : new Date(end).toISOString(),
        allDay,
        description: description.trim() || undefined,
        location: location.trim() || undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>{mode === "create" ? "予定を作成" : "予定を編集"}</span>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <form className="modal-form" onSubmit={handleSubmit}>
          <label>
            タイトル <span className="required">*</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="予定のタイトル"
              required
              autoFocus
            />
          </label>

          <label className="checkbox-label">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
            終日
          </label>

          <div className="form-row">
            <label>
              開始
              {allDay
                ? <input type="date" value={start} onChange={(e) => setStart(e.target.value)} required />
                : <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
              }
            </label>
            <label>
              終了
              {allDay
                ? <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} required />
                : <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required />
              }
            </label>
          </div>

          <label>
            場所
            <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="場所（任意）" />
          </label>

          <label>
            説明
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="説明（任意）" rows={3} />
          </label>

          <div className="modal-actions">
            <button type="button" className="btn-cancel" onClick={onClose}>キャンセル</button>
            <button type="submit" className="btn-save" disabled={saving}>
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
