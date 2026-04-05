"use client";

/**
 * RatingsGrid — the core teacher workflow component.
 *
 * Renders a grid of students × disciplines where each cell is a [1][2][3][4][5]
 * score picker. Scores update local state instantly; cells auto-save on blur via
 * POST /api/v1/sessions/:sessionId/ratings (bulk upsert with a single entry).
 * A full-grid auto-save fires every 30 seconds for any pending changes.
 *
 * Topic ratings appear after discipline columns. They auto-save on blur via
 * POST /api/v1/sessions/:sessionId/topic-ratings/bulk and flush every 30 seconds.
 *
 * Keyboard navigation:
 *   Tab         → next discipline in same row
 *   Shift+Tab   → previous discipline
 *   Enter       → same discipline, next student row
 *   Left/Right  → change score value within focused cell
 *
 * Per-student features:
 *   - Sparkline (read-only dots + line) once all disciplines are scored
 *   - Row colour: green avg ≥ 4, yellow avg 2–3, red avg ≤ 1
 *   - Report status dot + Generate / View / Edit buttons
 *   - Comment text input (saves on blur alongside ratings)
 *
 * Bulk generation:
 *   - "Generate All Reports" button (active when ≥ 1 student fully rated)
 *   - Shows count: "Generate reports for X fully rated students"
 *   - Progress toast polls GET .../status every 2s
 */

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  KeyboardEvent,
  FocusEvent,
} from "react";
import Link from "next/link";
import { apiFetch, APIError } from "@/lib/api";
import SparklineGrid from "@/components/SparklineGrid";

// ── Drag-to-grade types ───────────────────────────────────────────────────────

/** Internal drag tracking stored in a ref (no re-renders during pointer move). */
interface DragState {
  studentId: string;
  /** Left/right bounds + centerX of each discipline column, measured once on mousedown. */
  colBounds: Array<{ discId: string; left: number; right: number; centerX: number; centerY: number }>;
  /** Band samples (1–5) collected per discipline during the drag. */
  samples: Map<string, number[]>;
  /** True once the pointer has moved ≥8px horizontally — prevents accidental commits. */
  active: boolean;
  startX: number;
  rowTop: number;
  rowHeight: number;
}

/** Drives the visual SVG overlay — updated on every pointermove. */
interface DragPreview {
  studentId: string;
  /** disciplineId → preview score (1–5). Only includes columns the pointer has visited. */
  scores: Map<string, number>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GridDiscipline {
  id: string;
  name: string;
  category: string | null;
  is_custom: boolean;
}

export interface GridStudentRating {
  session_discipline_id: string;
  score: number | null;
  comment: string | null;
}

export interface GridStudent {
  id: string;
  first_name: string;
  last_name: string | null;
  student_ref_id: string | null;
  gender: string | null;
  ratings: GridStudentRating[];
}

export interface GridReport {
  id: string;
  student_id: string;
  status: string;
  word_count?: number | null;
}

interface RatingsGridProps {
  sessionId: string;
  students: GridStudent[];
  disciplines: GridDiscipline[];
  reports: Map<string, GridReport>;
  isReadOnly: boolean;
  onReportCreated: (report: GridReport) => void;
  onBulkBatchStarted: (batchId: string) => void;
  topics: string[];
}

// Cell state key: "studentId|disciplineId"
type CellKey = string;

interface CellValue {
  score: number | null;
  comment: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function cellKey(studentId: string, disciplineId: string): CellKey {
  return `${studentId}|${disciplineId}`;
}

function avgScore(scores: (number | null)[]): number | null {
  const valid = scores.filter((s): s is number => s !== null);
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function rowColour(avg: number | null): string {
  if (avg === null) return "";
  if (avg >= 4) return "bg-green-50/40";
  if (avg >= 2) return "bg-yellow-50/40";
  return "bg-red-50/40";
}


/** Sparkles icon (heroicons outline) used for the generate action. */
function SparklesIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
    </svg>
  );
}

/** Report status icon — colour signals state, no separate dot. */
function ReportStatusCell({
  report,
  studentId,
  fullyRated,
  anyRated,
  isGenerating,
  isReadOnly,
  onGenerate,
}: {
  report: GridReport | undefined;
  studentId: string;
  fullyRated: boolean;
  anyRated: boolean;
  isGenerating: boolean;
  isReadOnly: boolean;
  onGenerate: (id: string) => void;
}) {
  if (report) {
    const failed = report.status === "failed";
    const iconClass = failed
      ? "text-red-500 hover:text-red-700"
      : "text-green-500 hover:text-green-700";
    const tooltip = failed ? "Generation failed — click to retry" : "View / edit report";
    if (failed) {
      return (
        <button
          onClick={() => onGenerate(studentId)}
          title={tooltip}
          className="transition"
        >
          <SparklesIcon className={`w-4 h-4 ${iconClass} transition`} />
        </button>
      );
    }
    return (
      <Link href={`/reports/${report.id}/edit`} title={tooltip}>
        <SparklesIcon className={`w-4 h-4 ${iconClass} transition`} />
      </Link>
    );
  }

  if (isReadOnly) {
    return <SparklesIcon className="w-4 h-4 text-gray-300" />;
  }

  const tooltip = !anyRated
    ? "Add at least one rating before generating"
    : !fullyRated
    ? "Some disciplines unrated — report will use partial data"
    : "Generate report";

  const iconColour = !anyRated
    ? "text-gray-300"
    : !fullyRated
    ? "text-amber-400 hover:text-amber-600"
    : "text-gray-400 hover:text-indigo-600";

  return (
    <button
      onClick={() => onGenerate(studentId)}
      disabled={isGenerating || !anyRated}
      title={tooltip}
      className="transition disabled:cursor-not-allowed"
    >
      {isGenerating ? (
        <svg className="animate-spin w-4 h-4 text-indigo-400" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
        </svg>
      ) : (
        <SparklesIcon className={`w-4 h-4 ${iconColour} transition`} />
      )}
    </button>
  );
}

// ── Bulk progress toast ────────────────────────────────────────────────────────

interface BatchStatus {
  batchId: string;
  total: number;
  completed: number;
  failed: number;
  pending: number;
  active: number;
  results: Array<{
    studentId: string;
    status: string;
    reportId?: string;
    error?: string;
  }>;
}

function BulkProgressToast({
  sessionId,
  batchId,
  onDone,
  onReportCreated,
  onDismiss,
}: {
  sessionId: string;
  batchId: string;
  onDone: () => void;
  onReportCreated: (report: GridReport) => void;
  onDismiss: () => void;
}) {
  const [status, setStatus] = useState<BatchStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cancelledRef = useRef(false);

  // Keep callbacks in refs (updated via effect, not during render)
  const onDoneRef = useRef(onDone);
  const onReportCreatedRef = useRef(onReportCreated);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);
  useEffect(() => { onReportCreatedRef.current = onReportCreated; }, [onReportCreated]);

  useEffect(() => {
    cancelledRef.current = false;

    async function tick() {
      if (cancelledRef.current) return;
      try {
        const s = await apiFetch<BatchStatus>(
          `/api/v1/sessions/${sessionId}/generate/bulk/${batchId}/status`
        );
        if (cancelledRef.current) return;
        setStatus(s);

        for (const r of s.results) {
          if (r.reportId && r.studentId) {
            onReportCreatedRef.current({
              id: r.reportId,
              student_id: r.studentId,
              status: "draft",
            });
          }
        }

        const isDone = s.pending === 0 && s.active === 0;
        if (isDone) {
          onDoneRef.current();
        } else {
          setTimeout(tick, 2000);
        }
      } catch (err) {
        if (cancelledRef.current) return;
        setError(err instanceof APIError ? err.message : "Polling failed.");
        onDoneRef.current();
      }
    }

    const timer = setTimeout(tick, 0);
    return () => {
      cancelledRef.current = true;
      clearTimeout(timer);
    };
  }, [sessionId, batchId]);

  const isDone = status !== null && status.pending === 0 && status.active === 0;
  const pct = status && status.total > 0
    ? Math.round(((status.completed + status.failed) / status.total) * 100)
    : 0;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm mx-auto">
      <div className="bg-white rounded-xl shadow-2xl border border-gray-200 px-5 py-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <p className="text-sm font-semibold text-gray-800">
            {isDone
              ? status!.failed > 0
                ? `${status!.completed} complete, ${status!.failed} failed`
                : `${status!.completed} reports ready`
              : `Generating reports... ${status ? `${status.completed + status.failed} / ${status.total}` : "starting"}`}
          </p>
          {isDone && (
            <button
              onClick={onDismiss}
              className="text-gray-400 hover:text-gray-600 transition shrink-0"
              aria-label="Dismiss"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {!isDone && (
          <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
            <div
              className="h-2 rounded-full bg-indigo-600 transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        )}

        {isDone && !error && status!.failed === 0 && (
          <p className="text-xs text-green-600 font-medium">All reports generated successfully.</p>
        )}
        {isDone && status!.failed > 0 && (
          <p className="text-xs text-red-600">{status!.failed} failed. Try generating individually.</p>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </div>
  );
}

// ── Main RatingsGrid ───────────────────────────────────────────────────────────

export default function RatingsGrid({
  sessionId,
  students,
  disciplines,
  reports,
  isReadOnly,
  onReportCreated,
  onBulkBatchStarted,
  topics,
}: RatingsGridProps) {
  // Guard: render loading skeleton if no data yet
  if (!students?.length && !disciplines?.length) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6 animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-24 mb-4" />
        <div className="space-y-2">
          <div className="h-8 bg-gray-100 rounded" />
          <div className="h-8 bg-gray-100 rounded" />
          <div className="h-8 bg-gray-100 rounded" />
        </div>
      </div>
    );
  }

  // ── Grid state ─────────────────────────────────────────────────────────────

  // Build initial grid from incoming student ratings
  const localKey = `rg_grid_${sessionId}`;

  const buildInitialGrid = useCallback(() => {
    const grid = new Map<CellKey, CellValue>();
    // Try to rehydrate from localStorage first (survives page reload)
    let stored: Record<string, CellValue> = {};
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(localKey) : null;
      if (raw) stored = JSON.parse(raw) as Record<string, CellValue>;
    } catch { /* ignore corrupt cache */ }

    for (const student of students) {
      for (const disc of disciplines) {
        const existing = student.ratings.find(
          (r) => r.session_discipline_id === disc.id
        );
        const key = cellKey(student.id, disc.id);
        // Prefer server value if it has a score, otherwise use cached draft
        const serverScore = existing?.score ?? null;
        const cached = stored[key];
        grid.set(key, {
          score: serverScore ?? cached?.score ?? null,
          comment: existing?.comment ?? cached?.comment ?? null,
        });
      }
    }
    return grid;
  }, [students, disciplines, localKey]);

  const [grid, setGrid] = useState<Map<CellKey, CellValue>>(buildInitialGrid);
  const [comments, setComments] = useState<Map<string, string>>(() => {
    const m = new Map<string, string>();
    for (const student of students) {
      const firstComment = student.ratings.find((r) => r.comment)?.comment ?? "";
      m.set(student.id, firstComment);
    }
    return m;
  });

  // Persist grid to localStorage whenever it changes
  useEffect(() => {
    try {
      const obj: Record<string, CellValue> = {};
      grid.forEach((v, k) => { obj[k] = v; });
      localStorage.setItem(localKey, JSON.stringify(obj));
    } catch { /* quota exceeded — ignore */ }
  }, [grid, localKey]);

  // Tracks which cells have unsaved changes
  const [pendingSave, setPendingSave] = useState<Set<CellKey>>(new Set());
  const [pendingComments, setPendingComments] = useState<Set<string>>(new Set());

  const hasUnsaved = pendingSave.size > 0 || pendingComments.size > 0;

  // Mirror pendingComments in a ref so the students-sync effect below can read
  // the current value without listing it as a dependency (which would cause the
  // effect to re-fire on every keystroke and overwrite in-progress edits).
  const pendingCommentsRef = useRef(pendingComments);
  pendingCommentsRef.current = pendingComments;

  // Sync grid when students/disciplines change (e.g. after discipline added)
  useEffect(() => {
    setGrid(buildInitialGrid());
  }, [buildInitialGrid]);

  // Sync comments Map when students data loads or changes.
  // The lazy useState initializer only runs on mount (when students=[] from the
  // async parent fetch), so this effect is the only path that hydrates real
  // server comments into the textarea. Students whose comments are actively
  // being edited (present in pendingComments) are skipped to avoid clobbering.
  useEffect(() => {
    setComments((prev) => {
      const next = new Map(prev);
      for (const student of students) {
        if (!pendingCommentsRef.current.has(student.id)) {
          const serverComment =
            student.ratings.find((r) => r.comment)?.comment ?? "";
          next.set(student.id, serverComment);
        }
      }
      return next;
    });
  }, [students]);

  // ── Topic ratings state ────────────────────────────────────────────────────

  // Keyed by `${studentId}|${topicName}` → score
  const [topicGrid, setTopicGrid] = useState<Map<string, number | null>>(() => new Map());
  const [topicSaveError, setTopicSaveError] = useState<string | null>(null);

  // Load topic ratings on mount
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;

    async function loadTopicRatings() {
      try {
        interface TopicRatingEntry {
          studentId: string;
          topicName: string;
          score: number;
        }
        interface TopicRatingsResponse {
          ratings: TopicRatingEntry[];
        }
        const result = await apiFetch<TopicRatingsResponse>(
          `/api/v1/sessions/${sessionId}/topic-ratings`
        );
        if (cancelled) return;
        const m = new Map<string, number | null>();
        for (const r of result.ratings) {
          m.set(`${r.studentId}|${r.topicName}`, r.score);
        }
        setTopicGrid(m);
      } catch (err) {
        // Non-fatal — topics are optional
        console.error("[RatingsGrid] Failed to load topic ratings:", err);
      }
    }

    loadTopicRatings();
    return () => { cancelled = true; };
  }, [sessionId]);

  // ── Save logic ─────────────────────────────────────────────────────────────

  const [saveError, setSaveError] = useState<string | null>(null);

  /**
   * Save a single cell (student × discipline) to the API.
   * Uses POST /sessions/:id/ratings with a single rating entry.
   */
  const saveSingleRating = useCallback(
    async (studentId: string, disciplineId: string) => {
      const key = cellKey(studentId, disciplineId);
      const cell = grid.get(key);
      if (!cell || cell.score === null) return; // Nothing to save if no score

      try {
        await apiFetch(`/api/v1/sessions/${sessionId}/ratings`, {
          method: "POST",
          body: {
            ratings: [
              {
                studentId,
                sessionDisciplineId: disciplineId,
                score: cell.score,
                comment: comments.get(studentId)?.trim() || undefined,
              },
            ],
          },
        });
        setPendingSave((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
        setPendingComments((prev) => {
          const next = new Set(prev);
          next.delete(studentId);
          return next;
        });
      } catch (err) {
        setSaveError(err instanceof APIError ? err.message : "Auto-save failed.");
      }
    },
    [sessionId, grid, comments]
  );

  /**
   * Flush all pending discipline changes to the API in one bulk call.
   */
  const saveAllPending = useCallback(async () => {
    if (pendingSave.size === 0 && pendingComments.size === 0) return;

    const ratings: Array<{
      studentId: string;
      sessionDisciplineId: string;
      score: number;
      comment?: string;
    }> = [];

    for (const key of pendingSave) {
      const [studentId, disciplineId] = key.split("|");
      const cell = grid.get(key);
      if (!cell || cell.score === null) continue;
      ratings.push({
        studentId,
        sessionDisciplineId: disciplineId,
        score: cell.score,
        comment: comments.get(studentId)?.trim() || undefined,
      });
    }

    // Also flush comment-only changes for students with at least one score
    for (const studentId of pendingComments) {
      // Find all scored disciplines for this student and include them
      for (const disc of disciplines) {
        const key = cellKey(studentId, disc.id);
        const cell = grid.get(key);
        if (cell?.score !== null && cell !== undefined && !pendingSave.has(key)) {
          ratings.push({
            studentId,
            sessionDisciplineId: disc.id,
            score: cell.score as number,
            comment: comments.get(studentId)?.trim() || undefined,
          });
        }
      }
    }

    if (ratings.length === 0) return;

    try {
      await apiFetch(`/api/v1/sessions/${sessionId}/ratings`, {
        method: "POST",
        body: { ratings },
      });
      setPendingSave(new Set());
      setPendingComments(new Set());
      setSaveError(null);
    } catch (err) {
      setSaveError(err instanceof APIError ? err.message : "Save failed.");
    }
  }, [sessionId, pendingSave, pendingComments, grid, comments, disciplines]);

  // 30-second auto-save interval for discipline ratings
  useEffect(() => {
    const timer = setInterval(saveAllPending, 30_000);
    return () => clearInterval(timer);
  }, [saveAllPending]);


  // ── Score change handler ────────────────────────────────────────────────────

  function handleScoreChange(studentId: string, disciplineId: string, score: number) {
    if (isReadOnly) return;
    const key = cellKey(studentId, disciplineId);
    setGrid((prev) => {
      const next = new Map(prev);
      next.set(key, { score, comment: prev.get(key)?.comment ?? null });
      return next;
    });
    setPendingSave((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }

  // ── Topic score change handler ─────────────────────────────────────────────

  async function handleTopicScoreChange(studentId: string, topicName: string, score: number) {
    if (isReadOnly) return;
    const key = `${studentId}|${topicName}`;
    setTopicGrid((prev) => new Map(prev).set(key, score));
    setTopicSaveError(null);
    try {
      await apiFetch(`/api/v1/sessions/${sessionId}/topic-ratings/bulk`, {
        method: "POST",
        body: { ratings: [{ studentId, topicName, score }] },
      });
    } catch (err) {
      setTopicSaveError(err instanceof APIError ? err.message : "Failed to save topic rating.");
    }
  }

  // ── Comment change handler ─────────────────────────────────────────────────

  function handleCommentChange(studentId: string, value: string) {
    if (isReadOnly) return;
    setComments((prev) => new Map(prev).set(studentId, value));
    setPendingComments((prev) => new Set(prev).add(studentId));
  }

  // ── Blur handlers (cell auto-save) ─────────────────────────────────────────

  function handleCellBlur(
    e: FocusEvent<HTMLDivElement>,
    studentId: string,
    disciplineId: string
  ) {
    // Only save if focus left the entire score-group (not just moved between pip buttons)
    const relatedTarget = e.relatedTarget as HTMLElement | null;
    const currentTarget = e.currentTarget as HTMLElement;
    if (relatedTarget && currentTarget.contains(relatedTarget)) return;

    const key = cellKey(studentId, disciplineId);
    if (pendingSave.has(key)) {
      saveSingleRating(studentId, disciplineId);
    }
  }

  function handleCommentBlur(studentId: string) {
    if (!pendingComments.has(studentId)) return;
    // Save comment alongside all scored disciplines for this student
    const ratingsToPush: Array<{
      studentId: string;
      sessionDisciplineId: string;
      score: number;
      comment?: string;
    }> = [];
    for (const disc of disciplines) {
      const key = cellKey(studentId, disc.id);
      const cell = grid.get(key);
      if (cell?.score !== null && cell !== undefined) {
        ratingsToPush.push({
          studentId,
          sessionDisciplineId: disc.id,
          score: cell.score as number,
          comment: comments.get(studentId)?.trim() || undefined,
        });
      }
    }
    if (ratingsToPush.length === 0) {
      setPendingComments((prev) => {
        const next = new Set(prev);
        next.delete(studentId);
        return next;
      });
      return;
    }
    apiFetch(`/api/v1/sessions/${sessionId}/ratings`, {
      method: "POST",
      body: { ratings: ratingsToPush },
    })
      .then(() => {
        setPendingComments((prev) => {
          const next = new Set(prev);
          next.delete(studentId);
          return next;
        });
      })
      .catch((err: unknown) => {
        setSaveError(err instanceof APIError ? err.message : "Auto-save failed.");
      });
  }

  // ── Keyboard navigation ────────────────────────────────────────────────────

  // Cell refs indexed by "studentIdx-disciplineIdx"
  const cellRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  function navKey(si: number, di: number) {
    return `${si}-${di}`;
  }

  function handleCellKeyDown(
    e: KeyboardEvent<HTMLDivElement>,
    si: number,
    di: number,
    studentId: string,
    disciplineId: string,
    currentScore: number | null
  ) {
    switch (e.key) {
      case "Tab": {
        e.preventDefault();
        const nextDi = e.shiftKey ? di - 1 : di + 1;
        if (nextDi >= 0 && nextDi < disciplines.length) {
          cellRefs.current.get(navKey(si, nextDi))?.focus();
        } else if (!e.shiftKey && nextDi >= disciplines.length) {
          // Move to comment for this row
          const commentInput = document.getElementById(`comment-${students[si].id}`);
          commentInput?.focus();
        } else if (e.shiftKey && nextDi < 0 && si > 0) {
          cellRefs.current.get(navKey(si - 1, disciplines.length - 1))?.focus();
        }
        break;
      }
      case "Enter": {
        e.preventDefault();
        if (si + 1 < students.length) {
          cellRefs.current.get(navKey(si + 1, di))?.focus();
        }
        break;
      }
      case "ArrowRight": {
        e.preventDefault();
        if (currentScore !== null && currentScore < 5) {
          handleScoreChange(studentId, disciplineId, currentScore + 1);
        } else if (currentScore === null) {
          handleScoreChange(studentId, disciplineId, 1);
        }
        break;
      }
      case "ArrowLeft": {
        e.preventDefault();
        if (currentScore !== null && currentScore > 1) {
          handleScoreChange(studentId, disciplineId, currentScore - 1);
        }
        break;
      }
      default:
        // Number keys 1-5 set score directly
        if (e.key >= "1" && e.key <= "5") {
          e.preventDefault();
          handleScoreChange(studentId, disciplineId, parseInt(e.key, 10));
        }
        break;
    }
  }

  // ── Drag-to-grade ─────────────────────────────────────────────────────────

  const dragRef = useRef<DragState | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);

  /** Map Y offset within a row → score band 1–5 (top = 5, bottom = 1). */
  function yToBand(clientY: number, rowTop: number, rowHeight: number): number {
    const ratio = Math.max(0, Math.min(1, (clientY - rowTop) / rowHeight));
    return Math.max(1, Math.min(5, Math.ceil((1 - ratio) * 5)));
  }

  /** Commit drag results: majority band per discipline, only if ≥2 columns traversed. */
  function commitDrag(state: DragState) {
    if (!state.active) return;
    const traversed = Array.from(state.samples.entries()).filter(([, s]) => s.length > 0);
    if (traversed.length < 2) return; // accidental single-cell drag — ignore

    for (const [discId, samples] of traversed) {
      // Majority vote across samples
      const tally = new Array<number>(6).fill(0);
      for (const b of samples) tally[b]++;
      const winner = tally.reduce((best, cnt, band) => cnt > tally[best] ? band : best, 1);
      handleScoreChange(state.studentId, discId, winner);
    }
    // Trigger save for all changed cells
    setPendingSave((prev) => {
      const next = new Set(prev);
      for (const [discId] of traversed) next.add(cellKey(state.studentId, discId));
      return next;
    });
  }

  function handleDiscMouseDown(
    e: React.MouseEvent<HTMLTableCellElement>,
    studentId: string,
    rowEl: HTMLTableRowElement
  ) {
    if (isReadOnly || e.button !== 0) return;
    // Don't hijack clicks on buttons/inputs/links inside the cell
    if ((e.target as HTMLElement).closest("button, input, a")) return;

    const rowRect = rowEl.getBoundingClientRect();
    const container = tableContainerRef.current;
    if (!container) return;

    // Measure all discipline column bounds
    const colBounds: DragState["colBounds"] = [];
    for (const disc of disciplines) {
      const td = rowEl.querySelector<HTMLElement>(`[data-disc-id="${disc.id}"]`);
      if (!td) continue;
      const r = td.getBoundingClientRect();
      colBounds.push({
        discId: disc.id,
        left: r.left,
        right: r.right,
        centerX: r.left + r.width / 2,
        centerY: r.top + r.height / 2,
      });
    }

    dragRef.current = {
      studentId,
      colBounds,
      samples: new Map(),
      active: false,
      startX: e.clientX,
      rowTop: rowRect.top,
      rowHeight: rowRect.height,
    };
  }

  // Attach window-level pointer tracking while a drag is in progress
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      const state = dragRef.current;
      if (!state) return;

      // Activate once we've moved ≥8px horizontally
      if (!state.active && Math.abs(e.clientX - state.startX) >= 8) {
        state.active = true;
      }
      if (!state.active) return;

      const band = yToBand(e.clientY, state.rowTop, state.rowHeight);

      // Collect samples for all columns the pointer currently overlaps
      for (const col of state.colBounds) {
        if (e.clientX >= col.left && e.clientX <= col.right) {
          const existing = state.samples.get(col.discId) ?? [];
          existing.push(band);
          state.samples.set(col.discId, existing);
        }
      }

      // Build preview from majority band per visited discipline
      const previewScores = new Map<string, number>();
      for (const [discId, samples] of state.samples.entries()) {
        if (samples.length === 0) continue;
        const tally = new Array<number>(6).fill(0);
        for (const b of samples) tally[b]++;
        const winner = tally.reduce((best, cnt, band) => cnt > tally[best] ? band : best, 1);
        previewScores.set(discId, winner);
      }
      setDragPreview({ studentId: state.studentId, scores: previewScores });
    }

    function onMouseUp(e: MouseEvent) {
      const state = dragRef.current;
      if (!state) return;
      if (e.button !== 0) return;
      commitDrag(state);
      dragRef.current = null;
      setDragPreview(null);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && dragRef.current) {
        dragRef.current = null;
        setDragPreview(null);
      }
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("keydown", onKeyDown as unknown as EventListener);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("keydown", onKeyDown as unknown as EventListener);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReadOnly, disciplines, students]);

  // ── Progress calculation ───────────────────────────────────────────────────

  const fullyRatedStudentIds = new Set<string>();
  const anyRatedStudentIds = new Set<string>();
  for (const student of students) {
    const allRated = disciplines.every((disc) => {
      const cell = grid.get(cellKey(student.id, disc.id));
      return cell?.score !== null;
    });
    const hasAny = disciplines.some((disc) => {
      const cell = grid.get(cellKey(student.id, disc.id));
      return (cell?.score ?? null) !== null;
    });
    if (disciplines.length > 0 && allRated) {
      fullyRatedStudentIds.add(student.id);
    }
    if (disciplines.length > 0 && hasAny) {
      anyRatedStudentIds.add(student.id);
    }
  }

  const fullyRatedCount = fullyRatedStudentIds.size;
  const anyRatedCount = anyRatedStudentIds.size;
  const progressPct =
    students.length > 0 ? Math.round((fullyRatedCount / students.length) * 100) : 0;

  // ── Single generate ────────────────────────────────────────────────────────

  const [generatingStudentId, setGeneratingStudentId] = useState<string | null>(null);

  async function handleGenerateSingle(studentId: string) {
    setGeneratingStudentId(studentId);
    try {
      interface GenerateResponse {
        report: GridReport;
      }
      const result = await apiFetch<GenerateResponse>(
        `/api/v1/sessions/${sessionId}/students/${studentId}/generate`,
        { method: "POST", body: {} }
      );
      const report = result.report;
      onReportCreated({
        id: report.id,
        student_id: report.student_id ?? (report as unknown as Record<string, string>).studentId,
        status: report.status,
        word_count: report.word_count,
      });
    } catch (err) {
      setSaveError(err instanceof APIError ? err.message : "Failed to generate report.");
    } finally {
      setGeneratingStudentId(null);
    }
  }

  // ── Bulk generate ──────────────────────────────────────────────────────────

  const [bulkBatchId, setBulkBatchId] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkDone, setBulkDone] = useState(false);

  async function handleBulkGenerate() {
    // Save all pending first
    await saveAllPending();
    setBulkError(null);
    setBulkDone(false);
    try {
      interface BulkGenerateResponse {
        batchId: string;
        totalJobs: number;
      }
      const result = await apiFetch<BulkGenerateResponse>(
        `/api/v1/sessions/${sessionId}/generate/bulk`,
        { method: "POST", body: {} }
      );
      setBulkBatchId(result.batchId);
      onBulkBatchStarted(result.batchId);
    } catch (err) {
      setBulkError(err instanceof APIError ? err.message : "Failed to start bulk generation.");
    }
  }

  const isBulkRunning = bulkBatchId !== null && !bulkDone;

  // ── View mode ──────────────────────────────────────────────────────────────

  type ViewMode = "table" | "sparkline";
  const [viewMode, setViewMode] = useState<ViewMode>("table");

  // ── SparklineGrid accessor callbacks (stable references) ──────────────────

  const getScore = useCallback(
    (studentId: string, disciplineId: string): number | null =>
      grid.get(cellKey(studentId, disciplineId))?.score ?? null,
    [grid]
  );

  const getComment = useCallback(
    (studentId: string): string => comments.get(studentId) ?? "",
    [comments]
  );

  const getTopicScore = useCallback(
    (studentId: string, topicName: string): number | null =>
      topicGrid.get(`${studentId}|${topicName}`) ?? null,
    [topicGrid]
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  if (students.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm px-6 py-10 text-center">
        <p className="text-sm text-gray-400">No students in this class.</p>
      </div>
    );
  }

  if (disciplines.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm px-6 py-10 text-center">
        <p className="text-sm text-gray-400 mb-1">No disciplines configured for this session.</p>
        <p className="text-xs text-gray-400">Add a discipline above to begin rating.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Mode switcher */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="inline-flex rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
          <button
            onClick={() => setViewMode("table")}
            className={`px-4 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500 ${
              viewMode === "table"
                ? "bg-indigo-600 text-white"
                : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            Table View
          </button>
          <button
            onClick={() => setViewMode("sparkline")}
            className={`px-4 py-2 text-sm font-medium transition border-l border-gray-200 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500 ${
              viewMode === "sparkline"
                ? "bg-indigo-600 text-white"
                : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            Sparkline View
          </button>
        </div>
      </div>

      {/* Progress bar + Generate CTA */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm px-5 py-3">
        <div className="flex items-center gap-4">
          {/* Left: label */}
          <span className="flex-none text-xs font-medium text-gray-600 whitespace-nowrap">
            {fullyRatedCount} / {students.length} students fully rated
          </span>
          {/* Middle: progress bar */}
          <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
            <div
              className="h-2 rounded-full bg-indigo-600 transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          {/* Right: unsaved indicator + Generate CTA */}
          <div className="flex-none flex items-center gap-3">
            {hasUnsaved && (
              <span className="flex items-center gap-1 text-xs text-amber-600 whitespace-nowrap">
                <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                Unsaved
              </span>
            )}
            {!isReadOnly && (
              <button
                onClick={handleBulkGenerate}
                disabled={anyRatedCount === 0 || isBulkRunning}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-indigo-600 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition shadow-sm whitespace-nowrap"
              >
                {isBulkRunning
                  ? "Generating..."
                  : anyRatedCount === 0
                  ? "Generate reports"
                  : `Generate ${anyRatedCount} report${anyRatedCount !== 1 ? "s" : ""}`}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Error banner */}
      {(saveError || bulkError || topicSaveError) && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 flex items-center justify-between">
          <span className="text-sm text-red-700">{saveError ?? bulkError ?? topicSaveError}</span>
          <button
            onClick={() => { setSaveError(null); setBulkError(null); setTopicSaveError(null); }}
            className="text-red-400 hover:text-red-600 ml-3 transition"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Sparkline View */}
      {viewMode === "sparkline" && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <SparklineGrid
            students={students}
            disciplines={disciplines}
            getScore={getScore}
            onScoreChange={handleScoreChange}
            onScoreCommit={saveSingleRating}
            getComment={getComment}
            onCommentChange={handleCommentChange}
            onCommentBlur={handleCommentBlur}
            isReadOnly={isReadOnly}
            reports={reports}
            fullyRatedStudentIds={fullyRatedStudentIds}
            generatingStudentId={generatingStudentId}
            onGenerate={handleGenerateSingle}
            topics={topics}
            getTopicScore={getTopicScore}
            onTopicScoreChange={handleTopicScoreChange}
          />
        </div>
      )}

      {/* Grid (Table View) */}
      <div
        ref={tableContainerRef}
        className="relative bg-white rounded-lg border border-gray-200 shadow-sm overflow-x-auto w-full"
        style={{ display: viewMode === "table" ? undefined : "none" }}
      >
        {/* Drag-to-grade SVG overlay */}
        {dragPreview && dragPreview.scores.size >= 1 && (() => {
          const container = tableContainerRef.current;
          if (!container) return null;
          const containerRect = container.getBoundingClientRect();
          const state = dragRef.current;
          if (!state) return null;

          // Build points: [x, y] for each visited discipline in order
          const points: Array<[number, number]> = [];
          for (const col of state.colBounds) {
            const score = dragPreview.scores.get(col.discId);
            if (score === undefined) continue;
            // x: column center, relative to container
            const x = col.centerX - containerRect.left + container.scrollLeft;
            // y: map score (1–5) to row position — score 5 = near top, score 1 = near bottom
            const rowRelTop = state.rowTop - containerRect.top + container.scrollTop;
            const y = rowRelTop + state.rowHeight * (1 - (score - 1) / 4);
            points.push([x, y]);
          }
          if (points.length < 1) return null;

          const ptStr = points.map(([x, y]) => `${x},${y}`).join(" ");
          return (
            <svg
              className="absolute inset-0 pointer-events-none"
              style={{ width: "100%", height: "100%", zIndex: 20 }}
            >
              {points.length >= 2 && (
                <polyline
                  points={ptStr}
                  fill="none"
                  stroke="rgb(99,102,241)"
                  strokeWidth="2"
                  strokeOpacity="0.55"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
              {points.map(([x, y], i) => (
                <circle key={i} cx={x} cy={y} r="5" fill="rgb(99,102,241)" fillOpacity="0.7" />
              ))}
            </svg>
          );
        })()}
        <table className="table-fixed w-full text-sm border-collapse">
          <colgroup>
            <col style={{ width: "180px" }} />
            {disciplines.map((disc) => (
              <col key={disc.id} style={{ width: "110px" }} />
            ))}
            {topics.map((topicName) => (
              <col key={topicName} style={{ width: "110px" }} />
            ))}
            {/* Comment column — no explicit width, absorbs remaining space */}
            <col />
            <col style={{ width: "40px" }} />
          </colgroup>
          <thead>
            {/* Row 1: group labels */}
            <tr className="bg-slate-100 border-b border-gray-200">
              <th
                rowSpan={2}
                className="sticky left-0 z-10 bg-slate-100 px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide"
              >
                Student
              </th>
              {disciplines.length > 0 && (
                <th
                  colSpan={disciplines.length}
                  className="px-2 py-1.5 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide border-b border-gray-100"
                >
                  Disciplines
                </th>
              )}
              {topics.length > 0 && (
                <th
                  colSpan={topics.length}
                  className="px-2 py-1.5 text-center text-xs font-semibold text-slate-400 uppercase tracking-wide italic border-l-2 border-slate-400 border-b border-gray-100"
                >
                  Topic Performance
                </th>
              )}
              <th
                rowSpan={2}
                className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide"
              >
                Comment
              </th>
              <th
                rowSpan={2}
                className="px-3 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide"
              >
                <SparklesIcon className="w-4 h-4 mx-auto text-gray-400" />
              </th>
            </tr>
            {/* Row 2: individual column names */}
            <tr className="border-b border-gray-200 bg-gray-50">
              {disciplines.map((disc, di) => (
                <th
                  key={disc.id}
                  className={`px-1 py-2 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide ${di > 0 ? "border-l border-slate-200" : ""} ${di % 2 === 1 ? "bg-slate-50" : ""}`}
                  title={disc.name}
                >
                  <span className="truncate block max-w-[110px] mx-auto" title={disc.name}>
                    {disc.name}
                  </span>
                </th>
              ))}
              {topics.map((topicName, ti) => (
                <th
                  key={topicName}
                  className={`px-1 py-2 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide ${ti === 0 ? "border-l-2 border-slate-400" : "border-l border-slate-200"}`}
                  title={topicName}
                >
                  <span className="truncate block max-w-[110px] mx-auto italic" title={topicName}>
                    {topicName.length > 10 ? topicName.slice(0, 10) + "…" : topicName}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {students.map((student, si) => {
              const scores = disciplines.map(
                (disc) => grid.get(cellKey(student.id, disc.id))?.score ?? null
              );
              const avg = avgScore(scores);
              const isFullyRated = fullyRatedStudentIds.has(student.id);
              const isAnyRated = anyRatedStudentIds.has(student.id);
              const report = reports.get(student.id);
              const isGenerating = generatingStudentId === student.id;
              const rowBg = rowColour(avg);

              return (
                <tr
                  key={student.id}
                  className={`transition-colors hover:brightness-[0.97] ${rowBg} ${dragPreview?.studentId === student.id ? "select-none" : ""}`}
                >
                  {/* Student name */}
                  <td className={`sticky left-0 z-10 px-4 py-2.5 ${rowBg || "bg-white"}`}>
                    <div className="font-medium text-gray-900 text-sm leading-tight">
                      {student.first_name}{student.last_name ? ` ${student.last_name}` : ""}
                    </div>
                    {(student.gender || student.student_ref_id) && (
                      <div className="text-xs text-gray-400 leading-tight">
                        {[
                          student.gender,
                          student.student_ref_id ? `ID: ${student.student_ref_id}` : null,
                        ].filter(Boolean).join(" • ")}
                      </div>
                    )}
                  </td>

                  {/* Discipline score cells */}
                  {disciplines.map((disc, di) => {
                    const key = cellKey(student.id, disc.id);
                    const cell = grid.get(key);
                    const score = cell?.score ?? null;
                    const colBg = di % 2 === 1 ? "bg-slate-50/60" : "";

                    // Show drag preview highlight for this cell
                    const previewScore = dragPreview?.studentId === student.id
                      ? dragPreview.scores.get(disc.id)
                      : undefined;

                    return (
                      <td
                        key={disc.id}
                        data-disc-id={disc.id}
                        onMouseDown={(e) => {
                          const tr = (e.currentTarget as HTMLElement).closest("tr") as HTMLTableRowElement | null;
                          if (tr) handleDiscMouseDown(e, student.id, tr);
                        }}
                        className={`px-1 py-3 text-center cursor-crosshair ${di > 0 ? "border-l border-slate-200" : ""} ${previewScore !== undefined ? "bg-indigo-50/80" : colBg}`}
                      >
                        <div
                          ref={(el) => {
                            if (el) cellRefs.current.set(navKey(si, di), el);
                            else cellRefs.current.delete(navKey(si, di));
                          }}
                          role="group"
                          aria-label={`${disc.name} score for ${student.first_name}`}
                          tabIndex={0}
                          onBlur={(e) => handleCellBlur(e, student.id, disc.id)}
                          onKeyDown={(e) =>
                            handleCellKeyDown(e, si, di, student.id, disc.id, score)
                          }
                          className="inline-flex gap-px rounded focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-1"
                        >
                          {[1, 2, 3, 4, 5].map((v) => {
                            const active = score === v;
                            // During drag on this row, dim buttons to let SVG overlay shine
                            const isDragRow = dragPreview?.studentId === student.id;
                            return (
                              <button
                                key={v}
                                type="button"
                                tabIndex={-1}
                                disabled={isReadOnly}
                                onClick={() => handleScoreChange(student.id, disc.id, v)}
                                aria-label={`Score ${v}`}
                                aria-pressed={score === v}
                                className={`w-5 h-5 rounded text-xs font-bold transition-all select-none
                                  ${isReadOnly ? "cursor-default" : "cursor-pointer hover:scale-110"}
                                  ${isDragRow ? "opacity-30" : ""}
                                  ${active
                                    ? "bg-indigo-600 text-white shadow-sm"
                                    : "bg-slate-200 text-slate-700 hover:bg-indigo-100 hover:text-indigo-700"
                                  }`}
                              >
                                {v}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                    );
                  })}

                  {/* Topic score cells */}
                  {topics.map((topicName, ti) => {
                    const key = `${student.id}|${topicName}`;
                    const score = topicGrid.get(key) ?? null;
                    return (
                      <td
                        key={topicName}
                        className={`px-1 py-3 text-center ${ti === 0 ? "border-l-2 border-slate-400" : "border-l border-slate-200"}`}
                      >
                        <div
                          className="inline-flex gap-px rounded focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-1"
                          tabIndex={0}
                        >
                          {[1, 2, 3, 4, 5].map((v) => {
                            const active = score === v;
                            return (
                              <button
                                key={v}
                                type="button"
                                tabIndex={-1}
                                disabled={isReadOnly}
                                onClick={() => handleTopicScoreChange(student.id, topicName, v)}
                                aria-label={`Topic ${topicName} score ${v}`}
                                className={`w-5 h-5 rounded text-xs font-bold transition-all select-none
                                  ${isReadOnly ? "cursor-default" : "cursor-pointer hover:scale-110"}
                                  ${active
                                    ? "bg-indigo-600 text-white shadow-sm"
                                    : "bg-slate-200 text-slate-700 hover:bg-indigo-100 hover:text-indigo-700"
                                  }`}
                              >
                                {v}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                    );
                  })}

                  {/* Comment — flexible column that expands to fill remaining width */}
                  <td className="px-2 py-2 w-full">
                    <input
                      id={`comment-${student.id}`}
                      type="text"
                      disabled={isReadOnly}
                      value={comments.get(student.id) ?? ""}
                      onChange={(e) => handleCommentChange(student.id, e.target.value)}
                      onBlur={() => handleCommentBlur(student.id)}
                      placeholder="Key observations…"
                      className="w-full text-xs rounded border border-gray-200 px-2 py-1.5 text-gray-700 placeholder:text-gray-300 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 outline-none transition disabled:bg-gray-50 disabled:text-gray-400"
                    />
                  </td>

                  {/* Report status */}
                  <td className="px-3 py-2">
                    <ReportStatusCell
                      report={report}
                      studentId={student.id}
                      fullyRated={isFullyRated}
                      anyRated={isAnyRated}
                      isGenerating={isGenerating}
                      isReadOnly={isReadOnly}
                      onGenerate={handleGenerateSingle}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>


      {/* Bulk progress toast */}
      {bulkBatchId !== null && (
        <BulkProgressToast
          sessionId={sessionId}
          batchId={bulkBatchId}
          onDone={() => setBulkDone(true)}
          onReportCreated={onReportCreated}
          onDismiss={() => { setBulkBatchId(null); setBulkDone(false); }}
        />
      )}
    </div>
  );
}
