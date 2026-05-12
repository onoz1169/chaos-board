import { useState, useCallback, useRef, useEffect } from "react";

export const ARCHIVE_LIST_ID = "__archive__";

export interface TaskItem {
  id: string;
  title: string;
  done: boolean;
  doneAt?: string;
  due?: string;
  parent?: string;
  notes?: string;
}

export interface TaskList {
  id: string;
  title: string;
  tasks: TaskItem[];
}

export interface TasksData {
  version: 1;
  lists: TaskList[];
}

interface Props {
  data: TasksData;
  onChange: (data: TasksData) => void;
  activeDetail?: { listId: string; taskId: string } | null;
  onOpenDetail?: (listId: string, taskId: string) => void;
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function formatDue(due: string): string {
  const JST = 9 * 60 * 60 * 1000;
  const d = new Date(new Date(due).getTime() + JST);
  const today = new Date(Date.now() + JST);
  today.setUTCHours(0, 0, 0, 0);
  const diff = Math.floor((d.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return `${Math.abs(diff)}日超過`;
  if (diff === 0) return "今日";
  if (diff === 1) return "明日";
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

function isOverdue(due: string): boolean {
  const JST = 9 * 60 * 60 * 1000;
  const d = new Date(new Date(due).getTime() + JST);
  const today = new Date(Date.now() + JST);
  today.setUTCHours(0, 0, 0, 0);
  return d < today;
}

export default function TaskPanel({ data, onChange, activeDetail, onOpenDetail }: Props) {
  const [dragging, setDragging] = useState<{ listId: string; taskId: string } | null>(null);
  const [dragOverListId, setDragOverListId] = useState<string | null>(null);
  const [dragOverCardId, setDragOverCardId] = useState<string | "end" | null>(null);

  const updateData = useCallback((updater: (d: TasksData) => TasksData) => {
    onChange(updater(data));
  }, [data, onChange]);

  const addList = useCallback(() => {
    updateData((d) => ({
      ...d,
      lists: [...d.lists, { id: uid(), title: "新しいリスト", tasks: [] }],
    }));
  }, [updateData]);

  const renameList = useCallback((listId: string, title: string) => {
    updateData((d) => ({
      ...d,
      lists: d.lists.map((l) => l.id === listId ? { ...l, title } : l),
    }));
  }, [updateData]);

  const deleteList = useCallback((listId: string) => {
    updateData((d) => ({
      ...d,
      lists: d.lists.filter((l) => l.id !== listId),
    }));
  }, [updateData]);

  const addTask = useCallback((listId: string) => {
    const newTask: TaskItem = { id: uid(), title: "", done: false };
    updateData((d) => ({
      ...d,
      lists: d.lists.map((l) =>
        l.id === listId ? { ...l, tasks: [...l.tasks, newTask] } : l,
      ),
    }));
    return newTask.id;
  }, [updateData]);

  const updateTask = useCallback((listId: string, taskId: string, patch: Partial<TaskItem>) => {
    updateData((d) => ({
      ...d,
      lists: d.lists.map((l) =>
        l.id === listId
          ? { ...l, tasks: l.tasks.map((t) => t.id === taskId ? { ...t, ...patch } : t) }
          : l,
      ),
    }));
  }, [updateData]);

  const deleteTask = useCallback((listId: string, taskId: string) => {
    updateData((d) => ({
      ...d,
      lists: d.lists.map((l) =>
        l.id === listId
          ? { ...l, tasks: l.tasks.filter((t) => t.id !== taskId && t.parent !== taskId) }
          : l,
      ),
    }));
  }, [updateData]);

  const moveTask = useCallback((fromListId: string, taskId: string, toListId: string, beforeCardId?: string | "end") => {
    updateData((d) => {
      const fromList = d.lists.find((l) => l.id === fromListId);
      if (!fromList) return d;
      const task = fromList.tasks.find((t) => t.id === taskId);
      if (!task) return d;
      const movedTask = { ...task, parent: undefined };

      return {
        ...d,
        lists: d.lists.map((l) => {
          if (l.id === fromListId && l.id !== toListId) {
            return { ...l, tasks: l.tasks.filter((t) => t.id !== taskId && t.parent !== taskId) };
          }
          if (l.id === toListId) {
            let tasks = l.id === fromListId
              ? l.tasks.filter((t) => t.id !== taskId && t.parent !== taskId)
              : [...l.tasks];
            if (!beforeCardId || beforeCardId === "end") {
              tasks = [...tasks, movedTask];
            } else {
              const idx = tasks.findIndex((t) => t.id === beforeCardId);
              tasks.splice(idx >= 0 ? idx : tasks.length, 0, movedTask);
            }
            return { ...l, tasks };
          }
          return l;
        }),
      };
    });
  }, [updateData]);

  const handleDrop = useCallback((toListId: string, beforeCardId?: string | "end") => {
    if (!dragging) return;
    moveTask(dragging.listId, dragging.taskId, toListId, beforeCardId);
    setDragging(null);
    setDragOverListId(null);
    setDragOverCardId(null);
  }, [dragging, moveTask]);

  const regularLists = data.lists.filter((l) => l.id !== ARCHIVE_LIST_ID);

  return (
    <div className="kanban-board">
      {regularLists.map((list) => {
        const rootTasks = list.tasks.filter((t) => !t.parent);
        return (
          <KanbanColumn
            key={list.id}
            list={list}
            rootTasks={rootTasks}
            allTasks={list.tasks}
            activeTaskId={activeDetail?.listId === list.id ? activeDetail.taskId : null}
            isDragOver={dragOverListId === list.id}
            draggingId={dragging?.taskId ?? null}
            dragOverCardId={dragOverListId === list.id ? dragOverCardId : null}
            onRename={(title) => renameList(list.id, title)}
            onDelete={() => deleteList(list.id)}
            onAddTask={() => addTask(list.id)}
            onUpdateTask={(taskId, patch) => updateTask(list.id, taskId, patch)}
            onDeleteTask={(taskId) => deleteTask(list.id, taskId)}
            onDragStart={(taskId) => setDragging({ listId: list.id, taskId })}
            onDragEnd={() => { setDragging(null); setDragOverListId(null); setDragOverCardId(null); }}
            onDragOverList={() => setDragOverListId(list.id)}
            onDragOverCard={(cardId) => { setDragOverListId(list.id); setDragOverCardId(cardId); }}
            onDrop={handleDrop}
            onOpenDetail={onOpenDetail ? (taskId) => onOpenDetail(list.id, taskId) : undefined}
          />
        );
      })}
      <button className="kanban-add-col-btn" onClick={addList}>+ リストを追加</button>
    </div>
  );
}

interface ColumnProps {
  list: TaskList;
  rootTasks: TaskItem[];
  allTasks: TaskItem[];
  activeTaskId: string | null;
  isDragOver: boolean;
  draggingId: string | null;
  dragOverCardId: string | "end" | null;
  onRename: (title: string) => void;
  onDelete: () => void;
  onAddTask: () => string;
  onUpdateTask: (taskId: string, patch: Partial<TaskItem>) => void;
  onDeleteTask: (taskId: string) => void;
  onDragStart: (taskId: string) => void;
  onDragEnd: () => void;
  onDragOverList: () => void;
  onDragOverCard: (cardId: string | "end") => void;
  onDrop: (toListId: string, beforeCardId?: string | "end") => void;
  onOpenDetail?: (taskId: string) => void;
}

function KanbanColumn({
  list, rootTasks, allTasks, activeTaskId, isDragOver, draggingId, dragOverCardId,
  onRename, onDelete, onAddTask, onUpdateTask, onDeleteTask,
  onDragStart, onDragEnd, onDragOverList, onDragOverCard, onDrop, onOpenDetail,
}: ColumnProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(list.title);
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const doneCount = rootTasks.filter((t) => t.done).length;
  const totalCount = rootTasks.length;

  const handleAddTask = () => {
    const newId = onAddTask();
    setPendingFocusId(newId);
  };

  return (
    <div
      className={`kanban-col${isDragOver ? " kanban-col-drag-over" : ""}`}
      onDragOver={(e) => { e.preventDefault(); onDragOverList(); }}
      onDrop={(e) => { e.preventDefault(); onDrop(list.id, dragOverCardId ?? "end"); }}
    >
      <div className="kanban-col-header">
        <div className="kanban-col-header-left">
          {editingTitle ? (
            <input
              className="kanban-col-title-input"
              value={titleValue}
              autoFocus
              onChange={(e) => setTitleValue(e.target.value)}
              onBlur={() => { setEditingTitle(false); onRename(titleValue || list.title); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur(); }}
            />
          ) : (
            <span className="kanban-col-title" onDoubleClick={() => setEditingTitle(true)}>
              {list.title}
            </span>
          )}
          <span className="kanban-col-count">{doneCount}/{totalCount}</span>
        </div>
        <div className="kanban-col-header-actions">
          <button className="kanban-col-action-btn" onClick={handleAddTask} title="カードを追加">+</button>
          <button className="kanban-col-action-btn kanban-col-delete-btn" onClick={onDelete} title="リスト削除">×</button>
        </div>
      </div>
      {totalCount > 0 && (
        <div className="kanban-col-progress">
          <div
            className="kanban-col-progress-bar"
            style={{ width: `${Math.round((doneCount / totalCount) * 100)}%` }}
          />
        </div>
      )}

      <div className="kanban-col-body">
        {rootTasks.map((task) => {
          const childCount = allTasks.filter((t) => t.parent === task.id).length;
          const doneChildCount = allTasks.filter((t) => t.parent === task.id && t.done).length;
          const autoFocus = pendingFocusId === task.id;
          return (
            <KanbanCard
              key={task.id}
              task={task}
              childCount={childCount}
              doneChildCount={doneChildCount}
              active={activeTaskId === task.id}
              isDragging={draggingId === task.id}
              showDropIndicatorBefore={dragOverCardId === task.id}
              autoFocus={autoFocus}
              onFocused={() => setPendingFocusId(null)}
              onUpdate={(patch) => onUpdateTask(task.id, patch)}
              onDelete={() => onDeleteTask(task.id)}
              onDragStart={() => onDragStart(task.id)}
              onDragEnd={onDragEnd}
              onDragOver={() => onDragOverCard(task.id)}
              onOpenDetail={onOpenDetail ? () => onOpenDetail(task.id) : undefined}
            />
          );
        })}

        {/* Drop zone at the end */}
        <div
          className={`kanban-drop-end${dragOverCardId === "end" && isDragOver ? " kanban-drop-end-active" : ""}`}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); onDragOverCard("end"); }}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onDrop(list.id, "end"); }}
        />

        {rootTasks.length === 0 && (
          <div className="kanban-col-empty" onClick={handleAddTask}>+ カードを追加</div>
        )}
      </div>

      <button className="kanban-add-card-btn" onClick={handleAddTask}>+ カードを追加</button>
    </div>
  );
}

interface CardProps {
  task: TaskItem;
  childCount: number;
  doneChildCount: number;
  active: boolean;
  isDragging: boolean;
  showDropIndicatorBefore: boolean;
  autoFocus: boolean;
  onFocused: () => void;
  onUpdate: (patch: Partial<TaskItem>) => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: () => void;
  onOpenDetail?: () => void;
}

function KanbanCard({
  task, childCount, doneChildCount, active, isDragging, showDropIndicatorBefore,
  autoFocus, onFocused, onUpdate, onDelete, onDragStart, onDragEnd, onDragOver, onOpenDetail,
}: CardProps) {
  const [editing, setEditing] = useState(autoFocus);
  const [titleValue, setTitleValue] = useState(task.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) {
      setEditing(true);
      setTimeout(() => inputRef.current?.focus(), 0);
      onFocused();
    }
  }, [autoFocus, onFocused]);

  useEffect(() => {
    if (!editing) setTitleValue(task.title);
  }, [task.title, editing]);

  const commitTitle = () => {
    setEditing(false);
    if (titleValue.trim() === "") { onDelete(); return; }
    onUpdate({ title: titleValue.trim() });
  };

  return (
    <>
      {showDropIndicatorBefore && <div className="kanban-drop-indicator" />}
      <div
        className={`kanban-card${task.done ? " kanban-card-done" : ""}${active ? " kanban-card-active" : ""}${isDragging ? " kanban-card-dragging" : ""}`}
        draggable={!editing}
        onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; onDragStart(); }}
        onDragEnd={onDragEnd}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); onDragOver(); }}
        onDrop={(e) => e.stopPropagation()}
      >
        <div className="kanban-card-top">
          <input
            type="checkbox"
            className="kanban-card-check"
            checked={task.done}
            onChange={(e) => onUpdate({
              done: e.target.checked,
              doneAt: e.target.checked ? new Date().toISOString() : undefined,
            })}
          />
          <div className="kanban-card-title-wrap">
            {editing ? (
              <input
                ref={inputRef}
                className="kanban-card-input"
                value={titleValue}
                onChange={(e) => setTitleValue(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); commitTitle(); }
                  if (e.key === "Escape") { setTitleValue(task.title); setEditing(false); }
                }}
              />
            ) : (
              <span
                className={`kanban-card-title${task.done ? " kanban-card-title-done" : ""}`}
                onDoubleClick={() => setEditing(true)}
              >
                {task.title || <span className="kanban-card-placeholder">タスク名</span>}
              </span>
            )}
          </div>
          {onOpenDetail && (
            <button
              className="kanban-card-detail-btn"
              onClick={onOpenDetail}
              title="詳細を開く"
            >⋯</button>
          )}
        </div>

        <div className="kanban-card-meta">
          {task.due && (
            <span className={`kanban-card-due${isOverdue(task.due) && !task.done ? " kanban-card-due-overdue" : ""}`}>
              {formatDue(task.due)}
            </span>
          )}
          {childCount > 0 && (
            <span className="kanban-card-subtasks">
              ☑ {doneChildCount}/{childCount}
            </span>
          )}
          {task.notes && <span className="kanban-card-has-notes">≡</span>}
        </div>
      </div>
    </>
  );
}
