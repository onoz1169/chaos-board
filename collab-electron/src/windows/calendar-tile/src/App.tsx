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
import MemoPane from "./MemoPane";

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
  const [calPaneWidth, setCalPaneWidth] = useState<number>(30);
  const splitRef = useRef<HTMLDivElement>(null);

  const isDayView = currentView === "timeGridDay";

  const handleSplitDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = splitRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const startX = e.clientX;
    const startPct = calPaneWidth;

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    function onMove(mv: MouseEvent) {
      const delta = mv.clientX - startX;
      const newPct = Math.min(80, Math.max(15, startPct + (delta / rect.width) * 100));
      setCalPaneWidth(newPct);
    }
    function onUp() {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [calPaneWidth]);

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
    <div className={`cal-root${isDayView ? " cal-root-split" : ""}`} ref={splitRef}>
      {loading && <div className="cal-banner">読み込み中...</div>}
      {error && <div className="cal-banner cal-banner-error">{error}</div>}

      <div
        className={isDayView ? "cal-calendar-pane" : "cal-calendar-full"}
        style={isDayView ? { width: `${calPaneWidth}%` } : undefined}
      >
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
        <>
          <div className="cal-split-handle" onMouseDown={handleSplitDrag} />
          <div className="cal-memo-pane">
            <MemoPane />
          </div>
        </>
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
