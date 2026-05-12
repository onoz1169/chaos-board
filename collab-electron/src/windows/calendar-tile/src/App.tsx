import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { DateSelectArg, EventClickArg, DatesSetArg, EventContentArg } from "@fullcalendar/core";
import jaLocale from "@fullcalendar/core/locales/ja";
import { between } from "@holiday-jp/holiday_jp";
import EventModal from "./EventModal";
import AuthSetup from "./AuthSetup";
import TaskPanel, { type TasksData, type TaskItem, ARCHIVE_LIST_ID } from "./TaskPanel";
import TaskDetailPane from "./TaskDetailPane";

interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  description?: string;
  location?: string;
  calendarId?: string;
  color?: string;
}

interface CalendarInfo {
  id: string;
  summary: string;
  backgroundColor: string;
  foregroundColor: string;
  primary: boolean;
}

interface ModalState {
  open: boolean;
  mode: "create" | "edit";
  event?: CalendarEvent;
  defaultStart?: string;
  defaultEnd?: string;
  defaultAllDay?: boolean;
}

const DEFAULT_TASKS: TasksData = {
  version: 1,
  lists: [{ id: "default", title: "タスク", tasks: [] }],
};

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function isBeforeTodayJST(isoString: string): boolean {
  const doneJST = new Date(new Date(isoString).getTime() + JST_OFFSET_MS);
  const todayJST = new Date(Date.now() + JST_OFFSET_MS);
  todayJST.setUTCHours(0, 0, 0, 0);
  return doneJST < todayJST;
}

function msUntilMidnightJST(): number {
  const nowInJST = Date.now() + JST_OFFSET_MS;
  const msIntoDay = nowInJST % (24 * 60 * 60 * 1000);
  return 24 * 60 * 60 * 1000 - msIntoDay;
}

function archiveDoneTasks(data: TasksData): TasksData {
  const toArchive: TasksData["lists"][0]["tasks"] = [];

  const updatedLists = data.lists.map((list) => {
    if (list.id === ARCHIVE_LIST_ID) return list;
    const kept = list.tasks.filter((t) => {
      if (t.done && t.doneAt && isBeforeTodayJST(t.doneAt)) {
        toArchive.push(t);
        return false;
      }
      return true;
    });
    return { ...list, tasks: kept };
  });

  if (toArchive.length === 0) return data;

  const archiveIdx = updatedLists.findIndex((l) => l.id === ARCHIVE_LIST_ID);
  if (archiveIdx >= 0) {
    updatedLists[archiveIdx] = {
      ...updatedLists[archiveIdx],
      tasks: [...updatedLists[archiveIdx].tasks, ...toArchive],
    };
  } else {
    updatedLists.push({ id: ARCHIVE_LIST_ID, title: "アーカイブ", tasks: toArchive });
  }

  return { ...data, lists: updatedLists };
}

export default function App() {
  const [authStatus, setAuthStatus] = useState<{ hasCredentials: boolean; hasTokens: boolean } | null>(null);
  const [calendarList, setCalendarList] = useState<CalendarInfo[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [viewRange, setViewRange] = useState<{ start: Date; end: Date } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>({ open: false, mode: "create" });
  const [currentView, setCurrentView] = useState<string>("timeGridDay");
  const [tasksData, setTasksData] = useState<TasksData>(DEFAULT_TASKS);
  const [activeDetail, setActiveDetail] = useState<{ listId: string; taskId: string } | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isDayView = currentView === "timeGridDay";

  useEffect(() => {
    window.api.tasksLoad().then((raw) => {
      if (raw && (raw as TasksData).version) {
        const archived = archiveDoneTasks(raw as TasksData);
        setTasksData(archived);
        if (archived !== raw) {
          window.api.tasksSave(archived).catch(() => {});
        }
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    function scheduleNext() {
      const ms = msUntilMidnightJST();
      return setTimeout(() => {
        setTasksData((prev) => {
          const next = archiveDoneTasks(prev);
          if (next !== prev) window.api.tasksSave(next).catch(() => {});
          return next;
        });
        timerRef.current = scheduleNext();
      }, ms);
    }
    const timerRef = { current: scheduleNext() };
    return () => clearTimeout(timerRef.current);
  }, []);

  const handleTasksChange = useCallback((data: TasksData) => {
    setTasksData(data);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      window.api.tasksSave(data).catch(() => {});
    }, 800);
  }, []);

  const openDetail = useCallback((listId: string, taskId: string) => {
    setActiveDetail({ listId, taskId });
  }, []);

  const closeDetail = useCallback(() => {
    setActiveDetail(null);
  }, []);

  const activeTask: TaskItem | null = activeDetail
    ? (tasksData.lists.find((l) => l.id === activeDetail.listId)?.tasks.find((t) => t.id === activeDetail.taskId) ?? null)
    : null;

  useEffect(() => {
    if (activeDetail && !activeTask) {
      closeDetail();
    }
  }, [activeDetail, activeTask, closeDetail]);

  const updateActiveTask = useCallback((patch: Partial<TaskItem>) => {
    if (!activeDetail) return;
    const next: TasksData = {
      ...tasksData,
      lists: tasksData.lists.map((l) =>
        l.id === activeDetail.listId
          ? { ...l, tasks: l.tasks.map((t) => t.id === activeDetail.taskId ? { ...t, ...patch } : t) }
          : l,
      ),
    };
    handleTasksChange(next);
  }, [activeDetail, tasksData, handleTasksChange]);

  const deleteActiveTask = useCallback(() => {
    if (!activeDetail) return;
    const next: TasksData = {
      ...tasksData,
      lists: tasksData.lists.map((l) =>
        l.id === activeDetail.listId
          ? { ...l, tasks: l.tasks.filter((t) => t.id !== activeDetail.taskId && t.parent !== activeDetail.taskId) }
          : l,
      ),
    };
    handleTasksChange(next);
  }, [activeDetail, tasksData, handleTasksChange]);

  const activeChildren: TaskItem[] = activeDetail
    ? (tasksData.lists.find((l) => l.id === activeDetail.listId)?.tasks.filter((t) => t.parent === activeDetail.taskId) ?? [])
    : [];

  const addActiveChild = useCallback(() => {
    if (!activeDetail) return;
    const newTask: TaskItem = { id: Math.random().toString(36).slice(2, 10), title: "", done: false, parent: activeDetail.taskId };
    const next: TasksData = {
      ...tasksData,
      lists: tasksData.lists.map((l) =>
        l.id === activeDetail.listId ? { ...l, tasks: [...l.tasks, newTask] } : l,
      ),
    };
    handleTasksChange(next);
  }, [activeDetail, tasksData, handleTasksChange]);

  const updateChild = useCallback((childId: string, patch: Partial<TaskItem>) => {
    if (!activeDetail) return;
    const next: TasksData = {
      ...tasksData,
      lists: tasksData.lists.map((l) =>
        l.id === activeDetail.listId
          ? { ...l, tasks: l.tasks.map((t) => t.id === childId ? { ...t, ...patch } : t) }
          : l,
      ),
    };
    handleTasksChange(next);
  }, [activeDetail, tasksData, handleTasksChange]);

  const deleteChild = useCallback((childId: string) => {
    if (!activeDetail) return;
    const next: TasksData = {
      ...tasksData,
      lists: tasksData.lists.map((l) =>
        l.id === activeDetail.listId
          ? { ...l, tasks: l.tasks.filter((t) => t.id !== childId) }
          : l,
      ),
    };
    handleTasksChange(next);
  }, [activeDetail, tasksData, handleTasksChange]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  const calendarColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of calendarList) map[c.id] = c.backgroundColor;
    return map;
  }, [calendarList]);

  const coloredEvents = useMemo(() =>
    events.map((e) => ({
      ...e,
      backgroundColor: e.calendarId ? (calendarColorMap[e.calendarId] ?? undefined) : undefined,
      borderColor: e.calendarId ? (calendarColorMap[e.calendarId] ?? undefined) : undefined,
    })),
  [events, calendarColorMap]);

  const holidayEvents = useMemo(() => {
    if (!viewRange) return [];
    return between(viewRange.start, viewRange.end).map((h) => ({
      id: `holiday-${h.date.toISOString()}`,
      title: "",
      start: h.date.toISOString().split("T")[0],
      allDay: true,
      display: "background",
      backgroundColor: "rgba(239, 68, 68, 0.18)",
      classNames: ["holiday-bg"],
    }));
  }, [viewRange]);

  const checkAuth = useCallback(async () => {
    const status = await window.api.calendarGetAuthStatus();
    setAuthStatus(status);
    if (status.hasTokens) {
      const list = await window.api.calendarFetchCalendarList() as CalendarInfo[];
      setCalendarList(list);
      setSelectedIds(new Set(list.map((c) => c.id)));
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const fetchEvents = useCallback(async (start: Date, end: Date, ids?: Set<string>) => {
    const activeIds = Array.from(ids ?? selectedIds);
    if (activeIds.length === 0) { setEvents([]); return; }
    setLoading(true);
    setError(null);
    try {
      const data = await window.api.calendarFetchEvents(
        start.toISOString(),
        end.toISOString(),
        activeIds,
      ) as CalendarEvent[];
      setEvents(data);
    } catch (e: any) {
      setError(e?.message ?? "Failed to fetch events");
    } finally {
      setLoading(false);
    }
  }, [selectedIds]);

  const handleDatesSet = useCallback((arg: DatesSetArg) => {
    setViewRange({ start: arg.start, end: arg.end });
    setCurrentView(arg.view.type);
    if (authStatus?.hasTokens) fetchEvents(arg.start, arg.end);
  }, [authStatus, fetchEvents]);

  const getEventClassNames = useCallback((arg: EventContentArg) => {
    if (!arg.event.start || !arg.event.end || arg.event.allDay) return [];
    const hours = (arg.event.end.getTime() - arg.event.start.getTime()) / 3600000;
    return hours >= 4 ? ["fc-event-long"] : [];
  }, []);

  const handleDateSelect = (arg: DateSelectArg) => {
    setModal({
      open: true,
      mode: "create",
      defaultStart: arg.startStr,
      defaultEnd: arg.endStr,
      defaultAllDay: arg.allDay,
    });
  };

  const handleEventClick = (arg: EventClickArg) => {
    const ev = events.find((e) => e.id === arg.event.id);
    if (!ev) return;
    setModal({ open: true, mode: "edit", event: ev });
  };

  const handleSave = async (data: {
    title: string;
    start: string;
    end: string;
    allDay: boolean;
    description?: string;
    location?: string;
  }) => {
    try {
      if (modal.mode === "create") {
        const created = await window.api.calendarCreateEvent(data) as CalendarEvent;
        setEvents((prev) => [...prev, created]);
      } else if (modal.mode === "edit" && modal.event) {
        const updated = await window.api.calendarUpdateEvent(modal.event.id, data) as CalendarEvent;
        setEvents((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
      }
      setModal({ open: false, mode: "create" });
    } catch (e: any) {
      alert(e?.message ?? "保存に失敗しました");
    }
  };

  if (!authStatus) return <div className="cal-loading">読み込み中...</div>;

  if (!authStatus.hasCredentials || !authStatus.hasTokens) {
    return <AuthSetup authStatus={authStatus} onConnected={checkAuth} />;
  }

  return (
    <div className={`cal-root${isDayView ? " cal-root-split" : ""}`}>
      {loading && <div className="cal-banner">読み込み中...</div>}
      {error && <div className="cal-banner cal-banner-error">{error}</div>}

      <div className={isDayView ? "cal-calendar-pane" : "cal-calendar-full"}>
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView="timeGridDay"
          locale={jaLocale}
          firstDay={1}
          headerToolbar={{
            left: "prev,next",
            center: "",
            right: "timeGridWeek,timeGrid3Day,timeGridDay",
          }}
          views={{
            timeGrid3Day: { type: "timeGrid", duration: { days: 3 }, buttonText: "3" },
          }}
          buttonText={{ week: "w", day: "1", today: "今日" }}
          dayHeaderContent={(args) => String(args.date.getDate())}
          slotLabelContent={(args) => String(args.date.getHours())}
          displayEventTime={false}
          selectable
          editable={false}
          events={[...coloredEvents, ...holidayEvents]}
          datesSet={handleDatesSet}
          select={handleDateSelect}
          eventClick={handleEventClick}
          eventClassNames={getEventClassNames}
          height="100%"
        />
      </div>

      {isDayView && (
        <div className="cal-task-pane">
          <TaskPanel
            data={tasksData}
            onChange={handleTasksChange}
            activeDetail={activeDetail}
            onOpenDetail={openDetail}
          />
        </div>
      )}

      {activeTask && (
        <div className="task-detail-overlay" onClick={closeDetail}>
          <div className="task-detail-overlay-panel" onClick={(e) => e.stopPropagation()}>
            <TaskDetailPane
              task={activeTask}
              childTasks={activeChildren}
              onChange={updateActiveTask}
              onClose={closeDetail}
              onDelete={deleteActiveTask}
              onAddChild={addActiveChild}
              onUpdateChild={updateChild}
              onDeleteChild={deleteChild}
            />
          </div>
        </div>
      )}

      {modal.open && (
        <EventModal
          mode={modal.mode}
          event={modal.event}
          defaultStart={modal.defaultStart}
          defaultEnd={modal.defaultEnd}
          defaultAllDay={modal.defaultAllDay}
          onSave={handleSave}
          onClose={() => setModal({ open: false, mode: "create" })}
        />
      )}
    </div>
  );
}
