"use client";

/**
 * SparklineGrid — music-staff view for the ratings workflow.
 *
 * Each student row renders a five-line staff (scores 1–5, bottom to top).
 * Existing scores appear as a polyline with numbered filled circles.
 * Unscored disciplines show an open hollow circle at the midpoint (score 3).
 *
 * If `topics` prop is provided with entries, topic columns are appended after
 * discipline columns on the staff. A vertical divider separates the two groups.
 * Topic points use the same circle+score style; unrated topics show a hollow
 * dashed circle at the midpoint. The polyline continues seamlessly across all
 * points (discipline + topic).
 *
 * Interaction modes
 * ─────────────────
 * Click  : clicking within a discipline's vertical band snaps to the nearest
 *          staff line (score 1–5) and commits immediately.
 * Drag   : mousedown + ≥8px horizontal movement activates a live polyline
 *          preview in semi-transparent indigo. Pointer Y maps to nearest staff
 *          line. Majority-vote per discipline column. Committed on mouseup.
 *          Esc cancels with no changes.
 *
 * Topic columns only support click (not drag) for score entry.
 *
 * Props mirror the subset of RatingsGrid state needed to drive this view.
 */

import {
  useRef,
  useEffect,
  useState,
  useCallback,
  type MouseEvent as ReactMouseEvent,
} from "react";
import Link from "next/link";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SparklineDiscipline {
  id: string;
  name: string;
}

export interface SparklineStudent {
  id: string;
  first_name: string;
  last_name: string | null;
  student_ref_id: string | null;
  gender: string | null;
}

export interface SparklineReport {
  id: string;
  status: string;
}

interface SparklineGridProps {
  students: SparklineStudent[];
  disciplines: SparklineDiscipline[];
  /** Reads current score for (studentId, disciplineId). Returns null if unscored. */
  getScore: (studentId: string, disciplineId: string) => number | null;
  /** Called when the user commits a score change. */
  onScoreChange: (studentId: string, disciplineId: string, score: number) => void;
  /** Reads the current comment for a student. */
  getComment: (studentId: string) => string;
  /** Called when comment text changes. */
  onCommentChange: (studentId: string, value: string) => void;
  /** Called when comment input loses focus — triggers save. */
  onCommentBlur: (studentId: string) => void;
  isReadOnly: boolean;
  reports: Map<string, SparklineReport>;
  fullyRatedStudentIds: Set<string>;
  generatingStudentId: string | null;
  onGenerate: (studentId: string) => void;
  /** Optional topic names to show after discipline columns. */
  topics?: string[];
  /** Reads current topic score for (studentId, topicName). Returns null if unscored. */
  getTopicScore?: (studentId: string, topicName: string) => number | null;
  /** Called when the user sets a topic score. */
  onTopicScoreChange?: (studentId: string, topicName: string, score: number) => void;
  /** Called when focus leaves a topic score group — triggers save. */
  onTopicBlur?: (studentId: string, topicName: string) => void;
}

/** Sparkles icon — same as in RatingsGrid. */
function SparklesIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
    </svg>
  );
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Height of each student row's staff area in px. */
const STAFF_H = 90;
/** Vertical padding inside the staff drawing area (top and bottom). */
const STAFF_PAD_V = 12;
/** Radius of the scored circles. */
const CIRCLE_R = 11;
/** Radius of the hollow placeholder circles. */
const HOLLOW_R = 9;
/** Score-line label column width (left edge: "5 4 3 2 1"). */
const SCORE_LABEL_W = 16;
/** ViewBox width used by both the header SVG and the per-row staff SVG — must match. */
const VW = 1000;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Map a score (1–5) to a Y coordinate inside the staff area.
 * Score 5 → near top (y = STAFF_PAD_V), Score 1 → near bottom (y = STAFF_H - STAFF_PAD_V).
 */
function scoreToY(score: number): number {
  return STAFF_PAD_V + ((5 - score) / 4) * (STAFF_H - STAFF_PAD_V * 2);
}

/**
 * Map a clientY offset (relative to the staff SVG top) to the nearest score 1–5.
 */
function yToScore(relY: number): number {
  const usable = STAFF_H - STAFF_PAD_V * 2;
  const ratio = Math.max(0, Math.min(1, (relY - STAFF_PAD_V) / usable));
  // Snap to nearest integer score (1–5). ratio 0 → score 5, ratio 1 → score 1.
  const raw = 5 - ratio * 4;
  return Math.max(1, Math.min(5, Math.round(raw)));
}

/** Average of non-null scores. Returns null if none. */
function avgScores(scores: (number | null)[]): number | null {
  const valid = scores.filter((s): s is number => s !== null);
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

/** Colour based on average score — consistent with TableView. */
function avgColour(avg: number | null): string {
  if (avg === null) return "#94a3b8"; // slate-400 neutral
  if (avg >= 4) return "#16a34a";    // green-600
  if (avg >= 2) return "#ca8a04";    // yellow-600
  return "#dc2626";                   // red-600
}

/** Row background tint based on average score. */
function rowTint(avg: number | null): string {
  if (avg === null) return "";
  if (avg >= 4) return "bg-green-50/40";
  if (avg >= 2) return "bg-yellow-50/40";
  return "bg-red-50/40";
}

/** Truncate a string to maxLen characters + ellipsis if needed. */
function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen) + "…" : s;
}

// ── Drag state (stored in ref, no re-renders during move) ─────────────────────

interface StaffDragState {
  studentId: string;
  svgLeft: number;   // getBoundingClientRect().left of the SVG element
  svgWidth: number;  // total SVG width in px
  svgTop: number;    // getBoundingClientRect().top of the SVG element
  /** x-center of each discipline column inside the SVG. */
  colCenters: Array<{ discId: string; xCenter: number }>;
  /** Width of each discipline band (for hit detection). */
  colWidth: number;
  startX: number;
  active: boolean;
  /** Collected Y-samples per discipline (score values). */
  samples: Map<string, number[]>;
}

// ── Staff SVG ─────────────────────────────────────────────────────────────────

/**
 * Renders the music-staff SVG for a single student row.
 * Pure SVG — no event handlers here; the parent attaches them to the container div.
 *
 * When topics are provided, they are rendered after discipline columns with a
 * heavier vertical divider separating the two groups.
 */
function StaffSVG({
  disciplines,
  scores,
  dragScores,
  isDragging,
  colour,
  topics,
  topicScores,
}: {
  disciplines: SparklineDiscipline[];
  /** Current committed scores, indexed by discipline id. */
  scores: Map<string, number | null>;
  /** Live drag preview scores (only present when isDragging). */
  dragScores: Map<string, number> | null;
  isDragging: boolean;
  colour: string;
  topics: string[];
  topicScores: Map<string, number | null>;
}) {
  const discCount = disciplines.length;
  const topicCount = topics.length;
  const totalCount = discCount + topicCount;

  if (discCount === 0) return null;

  const VH = STAFF_H;
  const staffLeft = SCORE_LABEL_W;
  const staffWidth = VW - SCORE_LABEL_W;
  const colW = staffWidth / totalCount;

  // x center of a column by overall index
  function colX(i: number): number {
    return staffLeft + colW * i + colW / 2;
  }

  // x boundary of the topic section (start of first topic column)
  const topicSectionX = totalCount > discCount
    ? staffLeft + colW * discCount
    : null;

  // Staff line Y positions (scores 1–5)
  const staffLines = [5, 4, 3, 2, 1].map((s) => scoreToY(s));

  // Build polyline points for committed scores across ALL columns (disc + topic)
  const committedPoints: Array<[number, number]> = [];
  for (let i = 0; i < discCount; i++) {
    const score = scores.get(disciplines[i].id) ?? null;
    if (score !== null) {
      committedPoints.push([colX(i), scoreToY(score)]);
    }
  }
  for (let i = 0; i < topicCount; i++) {
    const score = topicScores.get(topics[i]) ?? null;
    if (score !== null) {
      committedPoints.push([colX(discCount + i), scoreToY(score)]);
    }
  }

  // Build drag preview polyline (discipline columns only)
  const previewPoints: Array<[number, number]> = [];
  if (dragScores && dragScores.size > 0) {
    for (let i = 0; i < discCount; i++) {
      const ds = dragScores.get(disciplines[i].id);
      if (ds !== undefined) {
        previewPoints.push([colX(i), scoreToY(ds)]);
      }
    }
  }

  return (
    <svg
      viewBox={`0 0 ${VW} ${VH}`}
      width="100%"
      height={VH}
      className="block"
      aria-hidden="true"
    >
      {/* ── Score-level labels (left edge: 5 4 3 2 1) ── */}
      {[5, 4, 3, 2, 1].map((s) => (
        <text
          key={s}
          x={SCORE_LABEL_W - 2}
          y={scoreToY(s) + 3.5}
          textAnchor="end"
          fontSize="9"
          fill="#94a3b8"
          fontFamily="system-ui, sans-serif"
        >
          {s}
        </text>
      ))}

      {/* ── 5 horizontal staff lines ── */}
      {staffLines.map((y, idx) => (
        <line
          key={idx}
          x1={staffLeft}
          y1={y}
          x2={VW}
          y2={y}
          stroke="#e2e8f0"
          strokeWidth="0.8"
        />
      ))}

      {/* ── Vertical dividers between discipline columns ── */}
      {disciplines.map((_, i) => {
        if (i === 0) return null;
        return (
          <line
            key={`div-${i}`}
            x1={staffLeft + colW * i}
            y1={STAFF_PAD_V / 2}
            x2={staffLeft + colW * i}
            y2={STAFF_H - STAFF_PAD_V / 2}
            stroke="#f1f5f9"
            strokeWidth="0.6"
            strokeDasharray="3,3"
          />
        );
      })}

      {/* ── Heavy divider between disciplines and topics ── */}
      {topicSectionX !== null && (
        <line
          x1={topicSectionX}
          y1={STAFF_PAD_V / 2}
          x2={topicSectionX}
          y2={STAFF_H - STAFF_PAD_V / 2}
          stroke="#94a3b8"
          strokeWidth="1.5"
        />
      )}

      {/* ── Vertical dividers between topic columns ── */}
      {topics.map((_, i) => {
        if (i === 0) return null;
        return (
          <line
            key={`topic-div-${i}`}
            x1={staffLeft + colW * (discCount + i)}
            y1={STAFF_PAD_V / 2}
            x2={staffLeft + colW * (discCount + i)}
            y2={STAFF_H - STAFF_PAD_V / 2}
            stroke="#f1f5f9"
            strokeWidth="0.6"
            strokeDasharray="3,3"
          />
        );
      })}

      {/* ── Committed polyline (all columns) ── */}
      {committedPoints.length >= 2 && !isDragging && (
        <polyline
          points={committedPoints.map(([x, y]) => `${x},${y}`).join(" ")}
          fill="none"
          stroke={colour}
          strokeWidth="1.8"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}

      {/* ── Committed discipline score circles ── (dimmed during drag) */}
      {disciplines.map((disc, i) => {
        const score = scores.get(disc.id) ?? null;
        const cx = colX(i);

        if (score !== null) {
          return (
            <g key={disc.id} opacity={isDragging ? 0.25 : 1}>
              <circle cx={cx} cy={scoreToY(score)} r={CIRCLE_R} fill={colour} />
              <text
                x={cx}
                y={scoreToY(score) + 4}
                textAnchor="middle"
                fontSize="9"
                fontWeight="700"
                fill="white"
                fontFamily="system-ui, sans-serif"
              >
                {score}
              </text>
            </g>
          );
        }

        // Unscored — hollow placeholder at score 3
        return (
          <g key={disc.id} opacity={isDragging ? 0.25 : 1}>
            <circle
              cx={cx}
              cy={scoreToY(3)}
              r={HOLLOW_R}
              fill="none"
              stroke="#94a3b8"
              strokeWidth="1.2"
              strokeDasharray="3,2"
            />
          </g>
        );
      })}

      {/* ── Topic score circles ── */}
      {topics.map((topicName, i) => {
        const score = topicScores.get(topicName) ?? null;
        const cx = colX(discCount + i);

        if (score !== null) {
          return (
            <g key={`topic-${topicName}`}>
              <circle cx={cx} cy={scoreToY(score)} r={CIRCLE_R} fill={colour} fillOpacity="0.7" />
              <text
                x={cx}
                y={scoreToY(score) + 4}
                textAnchor="middle"
                fontSize="9"
                fontWeight="700"
                fill="white"
                fontFamily="system-ui, sans-serif"
              >
                {score}
              </text>
            </g>
          );
        }

        // Unscored topic — hollow dashed circle at midpoint
        return (
          <g key={`topic-${topicName}`}>
            <circle
              cx={cx}
              cy={scoreToY(3)}
              r={HOLLOW_R}
              fill="none"
              stroke="#c4b5fd"
              strokeWidth="1.2"
              strokeDasharray="3,2"
            />
          </g>
        );
      })}

      {/* ── Drag preview polyline ── */}
      {previewPoints.length >= 2 && (
        <polyline
          points={previewPoints.map(([x, y]) => `${x},${y}`).join(" ")}
          fill="none"
          stroke="rgb(99,102,241)"
          strokeWidth="2.2"
          strokeOpacity="0.6"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}

      {/* ── Drag preview circles ── */}
      {isDragging &&
        dragScores &&
        disciplines.map((disc, i) => {
          const ds = dragScores.get(disc.id);
          if (ds === undefined) return null;
          const cx = colX(i);
          const cy = scoreToY(ds);
          return (
            <g key={`drag-${disc.id}`}>
              <circle
                cx={cx}
                cy={cy}
                r={CIRCLE_R}
                fill="rgb(99,102,241)"
                fillOpacity="0.75"
              />
              <text
                x={cx}
                y={cy + 4}
                textAnchor="middle"
                fontSize="9"
                fontWeight="700"
                fill="white"
                fontFamily="system-ui, sans-serif"
              >
                {ds}
              </text>
            </g>
          );
        })}

      {/* Discipline labels removed — rendered once in the shared sticky header */}
    </svg>
  );
}

// ── SparklineHeader ───────────────────────────────────────────────────────────

/**
 * A single sticky header row that renders discipline names (and optional topic
 * names) above the staff rows. Uses the exact same VW / SCORE_LABEL_W geometry
 * as StaffSVG so columns align pixel-perfectly regardless of container width.
 */
function SparklineHeader({
  disciplines,
  topics,
}: {
  disciplines: SparklineDiscipline[];
  topics: string[];
}) {
  if (disciplines.length === 0) return null;

  const totalCount = disciplines.length + topics.length;
  const staffWidth = VW - SCORE_LABEL_W;
  const colW = staffWidth / totalCount;

  function colX(i: number): number {
    return SCORE_LABEL_W + colW * i + colW / 2;
  }

  const topicSectionX = topics.length > 0
    ? SCORE_LABEL_W + colW * disciplines.length
    : null;

  return (
    <div className="flex items-stretch bg-white border-b border-gray-200">
      {/* Match the student name column width */}
      <div className="min-w-[120px] max-w-[160px] shrink-0 px-4 py-2 flex items-end">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Student</span>
      </div>
      {/* Header SVG — same viewBox width as StaffSVG */}
      <div className="flex-1 min-w-0 px-0 py-1">
        <svg
          viewBox={`0 0 ${VW} 38`}
          width="100%"
          height={38}
          aria-hidden="true"
          className="block"
        >
          {/* Section label: "Topics" above topic columns */}
          {topicSectionX !== null && (
            <text
              x={topicSectionX + (colW * topics.length) / 2}
              y={11}
              textAnchor="middle"
              fontSize="9"
              fontStyle="italic"
              fill="#a78bfa"
              fontFamily="system-ui, sans-serif"
            >
              Topics
            </text>
          )}

          {/* Heavy divider line in header */}
          {topicSectionX !== null && (
            <line
              x1={topicSectionX}
              y1={0}
              x2={topicSectionX}
              y2={38}
              stroke="#94a3b8"
              strokeWidth="1.2"
            />
          )}

          {/* Discipline column names */}
          {disciplines.map((disc, i) => (
            <text
              key={disc.id}
              x={colX(i)}
              y={30}
              textAnchor="middle"
              fontSize="11"
              fontWeight="500"
              fill="#475569"
              fontFamily="system-ui, sans-serif"
            >
              {truncate(disc.name, 11)}
            </text>
          ))}

          {/* Topic column names */}
          {topics.map((topicName, i) => (
            <text
              key={`th-topic-${topicName}`}
              x={colX(disciplines.length + i)}
              y={30}
              textAnchor="middle"
              fontSize="10"
              fontStyle="italic"
              fontWeight="400"
              fill="#7c3aed"
              fontFamily="system-ui, sans-serif"
            >
              {truncate(topicName, 11)}
            </text>
          ))}
        </svg>
      </div>
      {/* Spacer: comment column */}
      <div className="shrink-0 w-44 border-l border-gray-100 pl-3 flex items-end pb-1.5">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Observations</span>
      </div>
      {/* Spacer: report button column */}
      <div className="shrink-0 w-10 border-l border-gray-100" />
    </div>
  );
}

// ── SparklineGrid ─────────────────────────────────────────────────────────────

export default function SparklineGrid({
  students,
  disciplines,
  getScore,
  onScoreChange,
  getComment,
  onCommentChange,
  onCommentBlur,
  isReadOnly,
  reports,
  fullyRatedStudentIds,
  generatingStudentId,
  onGenerate,
  topics = [],
  getTopicScore,
  onTopicScoreChange,
  onTopicBlur,
}: SparklineGridProps) {
  // ── Drag state ──────────────────────────────────────────────────────────────

  const dragRef = useRef<StaffDragState | null>(null);
  /** Container div refs per student — used for getBoundingClientRect. */
  const containerRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  /** Set to true when a drag was activated (≥8px); suppresses the click event. */
  const dragActivatedRef = useRef(false);

  // Per-student drag preview scores — only one student active at a time.
  const [dragPreview, setDragPreview] = useState<{
    studentId: string;
    scores: Map<string, number>;
  } | null>(null);

  // ── Commit drag ─────────────────────────────────────────────────────────────

  const commitDrag = useCallback(
    (state: StaffDragState) => {
      if (!state.active) return;
      const traversed = Array.from(state.samples.entries()).filter(
        ([, s]) => s.length > 0
      );
      if (traversed.length < 2) return; // accidental single-column — ignore

      for (const [discId, samples] of traversed) {
        // Majority vote
        const tally = new Array<number>(7).fill(0);
        for (const s of samples) tally[s]++;
        const winner = tally.reduce(
          (best, cnt, band) => (cnt > tally[best] ? band : best),
          1
        );
        onScoreChange(state.studentId, discId, winner);
      }
    },
    [onScoreChange]
  );

  // ── Global mouse handlers (attached once, cleaned up on unmount) ────────────

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      const state = dragRef.current;
      if (!state) return;

      // Activate after ≥8px horizontal movement
      if (!state.active && Math.abs(e.clientX - state.startX) >= 8) {
        state.active = true;
        dragActivatedRef.current = true;
      }
      if (!state.active) return;

      // Map pointer Y to score using the SVG bounding rect
      const relY = e.clientY - state.svgTop;
      const score = yToScore(relY);

      // Collect samples for whichever discipline column the pointer is over
      // (topic columns are excluded from drag; click-only)
      const relX = e.clientX - state.svgLeft;
      const colW = state.svgWidth / disciplines.length;
      const colIdx = Math.max(
        0,
        Math.min(disciplines.length - 1, Math.floor(relX / colW))
      );
      const disc = disciplines[colIdx];
      if (disc) {
        const existing = state.samples.get(disc.id) ?? [];
        existing.push(score);
        state.samples.set(disc.id, existing);
      }

      // Build preview from majority per visited disc
      const preview = new Map<string, number>();
      for (const [discId, samples] of state.samples.entries()) {
        if (samples.length === 0) continue;
        const tally = new Array<number>(7).fill(0);
        for (const s of samples) tally[s]++;
        const winner = tally.reduce(
          (best, cnt, band) => (cnt > tally[best] ? band : best),
          1
        );
        preview.set(discId, winner);
      }
      setDragPreview({ studentId: state.studentId, scores: preview });
    }

    function onMouseUp(e: MouseEvent) {
      const state = dragRef.current;
      if (!state || e.button !== 0) return;
      commitDrag(state);
      dragRef.current = null;
      setDragPreview(null);
      // dragActivatedRef stays true until the click event fires and clears it
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && dragRef.current) {
        dragRef.current = null;
        dragActivatedRef.current = false;
        setDragPreview(null);
      }
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [disciplines, commitDrag]);

  // ── Mouse down on a student's staff area ───────────────────────────────────

  function handleStaffMouseDown(
    e: ReactMouseEvent<HTMLDivElement>,
    studentId: string
  ) {
    if (isReadOnly || e.button !== 0) return;
    if ((e.target as HTMLElement).closest("input, button, a")) return;

    const containerEl = containerRefs.current.get(studentId);
    if (!containerEl) return;
    const rect = containerEl.getBoundingClientRect();

    const colW = rect.width / disciplines.length;

    dragRef.current = {
      studentId,
      svgLeft: rect.left,
      svgWidth: rect.width,
      svgTop: rect.top,
      colCenters: disciplines.map((d, i) => ({
        discId: d.id,
        xCenter: rect.left + colW * i + colW / 2,
      })),
      colWidth: colW,
      startX: e.clientX,
      active: false,
      samples: new Map(),
    };

    // Prevent text selection during drag
    e.preventDefault();
  }

  // ── Click on a discipline band (alternative to drag) ─────────────────────

  function handleStaffClick(
    e: ReactMouseEvent<HTMLDivElement>,
    studentId: string
  ) {
    if (isReadOnly) return;
    if ((e.target as HTMLElement).closest("input, button, a")) return;

    // Suppress click when it's the tail end of a drag gesture
    if (dragActivatedRef.current) {
      dragActivatedRef.current = false;
      return;
    }

    const containerEl = containerRefs.current.get(studentId);
    if (!containerEl) return;
    const rect = containerEl.getBoundingClientRect();

    // Map X to discipline index
    const relX = e.clientX - rect.left;
    const colW = rect.width / disciplines.length;
    const colIdx = Math.max(
      0,
      Math.min(disciplines.length - 1, Math.floor(relX / colW))
    );
    const disc = disciplines[colIdx];
    if (!disc) return;

    // Map Y to score
    const relY = e.clientY - rect.top;
    const score = yToScore(relY);

    onScoreChange(studentId, disc.id, score);
  }

  // ── Empty states ───────────────────────────────────────────────────────────

  if (students.length === 0 || disciplines.length === 0) return null;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      <SparklineHeader disciplines={disciplines} topics={topics} />
    <div className="space-y-0 divide-y divide-gray-100">
      {students.map((student) => {
        const scores = disciplines.map((d) => getScore(student.id, d.id));
        const avg = avgScores(scores);
        const colour = avgColour(avg);
        const tint = rowTint(avg);

        const scoresMap = new Map<string, number | null>();
        for (let i = 0; i < disciplines.length; i++) {
          scoresMap.set(disciplines[i].id, scores[i]);
        }

        // Build topic scores map keyed by topicName for StaffSVG
        const topicScoresMap = new Map<string, number | null>();
        for (const topicName of topics) {
          topicScoresMap.set(
            topicName,
            getTopicScore ? getTopicScore(student.id, topicName) : null
          );
        }

        const isDraggingThisStudent =
          dragPreview?.studentId === student.id && dragPreview.scores.size > 0;

        return (
          <div
            key={student.id}
            className={`flex items-stretch gap-3 px-4 py-2 transition-colors ${tint} ${
              isDraggingThisStudent ? "select-none" : ""
            }`}
          >
            {/* Left: student info */}
            <div className="flex flex-col justify-center min-w-[120px] max-w-[160px] shrink-0">
              <div className="font-medium text-gray-900 text-sm leading-tight">
                {student.first_name}
                {student.last_name ? ` ${student.last_name}` : ""}
              </div>
              {(student.gender || student.student_ref_id) && (
                <div className="text-xs text-gray-400 leading-tight mt-0.5">
                  {[
                    student.gender,
                    student.student_ref_id
                      ? `ID: ${student.student_ref_id}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              )}
            </div>

            {/* Staff area — flex-1, measured for drag/click coordinates */}
            <div
              ref={(el) => {
                if (el) containerRefs.current.set(student.id, el);
                else containerRefs.current.delete(student.id);
              }}
              className={`flex-1 min-w-0 ${isReadOnly ? "cursor-default" : "cursor-crosshair"}`}
              onMouseDown={(e) => handleStaffMouseDown(e, student.id)}
              onClick={(e) => handleStaffClick(e, student.id)}
            >
              <StaffSVG
                disciplines={disciplines}
                scores={scoresMap}
                dragScores={
                  isDraggingThisStudent ? dragPreview!.scores : null
                }
                isDragging={isDraggingThisStudent}
                colour={colour}
                topics={topics}
                topicScores={topicScoresMap}
              />
            </div>

            {/* Topic score buttons — rendered inline below the staff when topics exist */}
            {topics.length > 0 && (
              <div className="flex flex-col justify-center gap-1 shrink-0 border-l border-slate-300 pl-2">
                {topics.map((topicName) => {
                  const score = getTopicScore
                    ? getTopicScore(student.id, topicName)
                    : null;
                  return (
                    <div key={topicName} className="flex items-center gap-1">
                      <span className="text-xs text-slate-400 italic w-16 truncate" title={topicName}>
                        {topicName.length > 8 ? topicName.slice(0, 8) + "…" : topicName}
                      </span>
                      <div
                        className="inline-flex gap-px rounded focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-1"
                        tabIndex={0}
                        onBlur={() => onTopicBlur && onTopicBlur(student.id, topicName)}
                      >
                        {[1, 2, 3, 4, 5].map((v) => {
                          const active = score === v;
                          return (
                            <button
                              key={v}
                              type="button"
                              tabIndex={-1}
                              disabled={isReadOnly}
                              onClick={() =>
                                onTopicScoreChange &&
                                onTopicScoreChange(student.id, topicName, v)
                              }
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
                    </div>
                  );
                })}
              </div>
            )}

            {/* Comment field — fixed width, full staff height, right of the staff */}
            <div className="shrink-0 w-44 flex items-center border-l border-gray-100 pl-3">
              <textarea
                disabled={isReadOnly}
                value={getComment(student.id)}
                onChange={(e) => onCommentChange(student.id, e.target.value)}
                onBlur={() => onCommentBlur(student.id)}
                placeholder="Key observations…"
                rows={3}
                className="w-full text-xs rounded border border-gray-200 px-2 py-1.5 text-gray-700 placeholder:text-gray-300 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 outline-none transition resize-none disabled:bg-gray-50 disabled:text-gray-400"
                style={{ height: STAFF_H }}
              />
            </div>

            {/* Report generate button */}
            {(() => {
              const report = reports.get(student.id);
              const fullyRated = fullyRatedStudentIds.has(student.id);
              const isGenerating = generatingStudentId === student.id;
              return (
                <div className="shrink-0 w-10 flex items-center justify-center border-l border-gray-100">
                  {report ? (
                    report.status === "failed" ? (
                      <button
                        onClick={() => onGenerate(student.id)}
                        title="Generation failed — click to retry"
                        className="transition"
                      >
                        <SparklesIcon className="w-4 h-4 text-red-500 hover:text-red-700 transition" />
                      </button>
                    ) : (
                      <Link href={`/reports/${report.id}/edit`} title="View / edit report">
                        <SparklesIcon className="w-4 h-4 text-green-500 hover:text-green-700 transition" />
                      </Link>
                    )
                  ) : isGenerating ? (
                    <svg className="animate-spin w-4 h-4 text-indigo-400" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                  ) : (
                    <button
                      onClick={() => onGenerate(student.id)}
                      disabled={isReadOnly || !fullyRated}
                      title={fullyRated ? "Generate report" : "Rate all disciplines first"}
                      className="transition disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <SparklesIcon className="w-4 h-4 text-gray-400 hover:text-indigo-600 transition" />
                    </button>
                  )}
                </div>
              );
            })()}
          </div>
        );
      })}
    </div>
    </div>
  );
}
