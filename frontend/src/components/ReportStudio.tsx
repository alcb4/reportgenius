"use client";

/**
 * ReportStudio — in-page focused editor for cycling through student reports.
 *
 * Layout (top to bottom):
 *   1. Student nav header — name, pronouns, prev/next navigation
 *   2. Filters panel — disciplines, tone toggle, overview summary (collapsible)
 *   3. Report textarea — editable, live character count
 *   4. Action bar — Regenerate, Export PDF, Mark Final + Next
 *
 * Auto-saves on textarea blur (PUT /api/v1/reports/:reportId).
 * Regenerate calls POST /api/v1/sessions/:sessionId/reports/:studentId/regenerate
 * Mark Final calls PUT /api/v1/reports/:reportId with { status: "final" }.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { apiFetch, APIError } from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StudioStudent {
  id: string;
  first_name: string;
  last_name: string | null;
  gender: string | null;
  student_ref_id?: string | null;
  ratings: Array<{
    session_discipline_id: string;
    score: number | null;
    comment: string | null;
  }>;
}

export interface StudioDiscipline {
  id: string;
  name: string;
  category: string | null;
  is_custom: boolean;
}

export interface StudioSession {
  id: string;
  name: string;
  tone: string;
  length: string;
  topics_covered: string[];
  status: string;
}

interface FilterState {
  disciplineIds: string[];
  tone: string;
  overviewSummary: string;
}

interface StudioReport {
  id: string;
  student_id: string;
  status: string;
  edited_content: string;
  word_count: number | null;
}

interface ReportStudioProps {
  sessionId: string;
  classId: string;
  students: StudioStudent[];
  disciplines: StudioDiscipline[];
  initialStudentId?: string;
  session: StudioSession;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pronounLabel(gender: string | null | undefined): string {
  switch (gender?.toUpperCase()) {
    case "M":
      return "he/him";
    case "F":
      return "she/her";
    case "N":
      return "they/them";
    default:
      return "they/them";
  }
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// ── ReportStudio ──────────────────────────────────────────────────────────────

export default function ReportStudio({
  sessionId,
  classId,
  students,
  disciplines,
  initialStudentId,
  session,
}: ReportStudioProps) {
  // Student navigation
  const initialIdx =
    initialStudentId !== undefined
      ? Math.max(
          0,
          students.findIndex((s) => s.id === initialStudentId)
        )
      : 0;

  const [currentStudentIdx, setCurrentStudentIdx] = useState(initialIdx);
  const currentStudent = students[currentStudentIdx] ?? null;

  // Filters panel
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [filterState, setFilterState] = useState<FilterState>({
    disciplineIds: disciplines.map((d) => d.id),
    tone: session.tone,
    overviewSummary: "",
  });
  const lastAppliedFilter = useRef<FilterState>(filterState);

  // Report content
  const [reportContent, setReportContent] = useState("");
  const [currentReportId, setCurrentReportId] = useState<string | null>(null);
  const [reportStatus, setReportStatus] = useState<string>("draft");

  // Status flags
  const [isDirty, setIsDirty] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isMarkingFinal, setIsMarkingFinal] = useState(false);
  const [loadingReport, setLoadingReport] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Load report for current student ────────────────────────────────────────

  const loadStudentReport = useCallback(
    async (student: StudioStudent) => {
      setLoadingReport(true);
      setError(null);
      try {
        interface ReportsResponse {
          reports: StudioReport[];
        }
        const result = await apiFetch<ReportsResponse>(
          `/api/v1/sessions/${sessionId}/reports`
        );
        const found = result.reports.find((r) => r.student_id === student.id);
        if (found) {
          setReportContent(found.edited_content);
          setCurrentReportId(found.id);
          setReportStatus(found.status);
        } else {
          setReportContent("");
          setCurrentReportId(null);
          setReportStatus("draft");
        }
        setIsDirty(false);
      } catch (err) {
        setError(
          err instanceof APIError ? err.message : "Failed to load report."
        );
      } finally {
        setLoadingReport(false);
      }
    },
    [sessionId]
  );

  useEffect(() => {
    if (!currentStudent) return;
    loadStudentReport(currentStudent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStudentIdx, sessionId]);

  // ── Filter change tracking ──────────────────────────────────────────────────

  function handleFilterChange(update: Partial<FilterState>) {
    setFilterState((prev) => {
      const next = { ...prev, ...update };
      // Mark dirty only if the filter differs from what was last used to generate.
      const ref = lastAppliedFilter.current;
      const changed =
        next.tone !== ref.tone ||
        next.overviewSummary !== ref.overviewSummary ||
        next.disciplineIds.slice().sort().join(",") !==
          ref.disciplineIds.slice().sort().join(",");
      setIsDirty(changed);
      return next;
    });
  }

  // ── Auto-save on blur ───────────────────────────────────────────────────────

  async function handleTextareaBlur() {
    if (!currentReportId || !reportContent.trim()) return;
    setIsSaving(true);
    try {
      await apiFetch(`/api/v1/reports/${currentReportId}`, {
        method: "PUT",
        body: { edited_content: reportContent },
      });
    } catch {
      // Non-fatal silent fail on auto-save
    } finally {
      setIsSaving(false);
    }
  }

  // ── Regenerate ─────────────────────────────────────────────────────────────

  async function handleRegenerate() {
    if (!currentStudent) return;
    setIsRegenerating(true);
    setError(null);
    try {
      interface RegenerateResponse {
        report: string;
        reportId: string;
      }
      const result = await apiFetch<RegenerateResponse>(
        `/api/v1/sessions/${sessionId}/reports/${currentStudent.id}/regenerate`,
        {
          method: "POST",
          body: { filters: filterState },
        }
      );
      setReportContent(result.report);
      setCurrentReportId(result.reportId);
      setReportStatus("draft");
      setIsDirty(false);
      lastAppliedFilter.current = { ...filterState };
    } catch (err) {
      setError(
        err instanceof APIError ? err.message : "Regeneration failed. Try again."
      );
    } finally {
      setIsRegenerating(false);
    }
  }

  // ── Mark Final + Next ───────────────────────────────────────────────────────

  async function handleMarkFinalAndNext() {
    if (!currentReportId) return;
    setIsMarkingFinal(true);
    setError(null);
    try {
      await apiFetch(`/api/v1/reports/${currentReportId}`, {
        method: "PUT",
        body: { edited_content: reportContent, status: "final" },
      });
      setReportStatus("final");
      // Advance to next student (wrap around).
      const nextIdx = (currentStudentIdx + 1) % students.length;
      setCurrentStudentIdx(nextIdx);
    } catch (err) {
      setError(
        err instanceof APIError ? err.message : "Failed to mark as final."
      );
    } finally {
      setIsMarkingFinal(false);
    }
  }

  // ── Export single PDF ──────────────────────────────────────────────────────

  async function handleExportPDF() {
    if (!currentReportId) return;
    const token =
      typeof window !== "undefined"
        ? window.localStorage.getItem("rg_token")
        : null;
    const apiBase =
      process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(
      `${apiBase}/api/v1/sessions/${sessionId}/export/pdf`,
      { headers }
    );
    if (!res.ok) {
      setError("PDF export failed.");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `session_reports.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ── Discipline checkbox helpers ────────────────────────────────────────────

  function toggleDiscipline(id: string) {
    handleFilterChange({
      disciplineIds: filterState.disciplineIds.includes(id)
        ? filterState.disciplineIds.filter((d) => d !== id)
        : [...filterState.disciplineIds, id],
    });
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (students.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-gray-400">
        No students in this session.
      </div>
    );
  }

  const charCount = reportContent.length;
  const wordCount = countWords(reportContent);
  const progressPct =
    students.length > 1
      ? Math.round((currentStudentIdx / (students.length - 1)) * 100)
      : 100;

  const statusBadgeClass: Record<string, string> = {
    final: "bg-green-100 text-green-700",
    draft: "bg-yellow-100 text-yellow-700",
    edited: "bg-blue-100 text-blue-700",
  };

  return (
    <div className="flex flex-col gap-4">
      {/* ── Student navigation header ──────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-4">
        <div className="flex items-center justify-between gap-4">
          <button
            onClick={() =>
              setCurrentStudentIdx((i) =>
                i === 0 ? students.length - 1 : i - 1
              )
            }
            className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition"
            disabled={students.length <= 1}
          >
            Prev
          </button>

          <div className="flex-1 text-center">
            <div className="flex items-center justify-center gap-2 flex-wrap">
              <span className="text-lg font-bold text-gray-900">
                {currentStudent?.first_name}
                {currentStudent?.last_name ? ` ${currentStudent.last_name}` : ""}
              </span>
              <span className="text-sm text-gray-400">
                {pronounLabel(currentStudent?.gender)}
              </span>
              {reportStatus && (
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    statusBadgeClass[reportStatus] ?? "bg-gray-100 text-gray-600"
                  }`}
                >
                  {reportStatus.charAt(0).toUpperCase() + reportStatus.slice(1)}
                </span>
              )}
            </div>
            <div className="text-xs text-gray-400 mt-0.5">
              {currentStudentIdx + 1} of {students.length} students
            </div>
            {/* Progress bar */}
            <div className="w-full bg-gray-100 rounded-full h-1 mt-2">
              <div
                className="bg-indigo-500 h-1 rounded-full transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          <button
            onClick={() =>
              setCurrentStudentIdx((i) => (i + 1) % students.length)
            }
            className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition"
            disabled={students.length <= 1}
          >
            Next
          </button>
        </div>
      </div>

      {/* ── Filters panel ─────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <button
          onClick={() => setFiltersOpen((o) => !o)}
          className="w-full flex items-center justify-between px-5 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition"
        >
          <span className="flex items-center gap-2">
            Filters
            {isDirty && (
              <span className="inline-flex items-center rounded-full bg-indigo-100 text-indigo-700 text-xs px-2 py-0.5 font-medium">
                Changed
              </span>
            )}
          </span>
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform ${
              filtersOpen ? "rotate-180" : ""
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>

        {filtersOpen && (
          <div className="px-5 pb-5 pt-1 space-y-5 border-t border-gray-100">
            {/* Tone toggle */}
            <div>
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Tone
              </div>
              <div className="flex gap-2">
                {(["gentle", "balanced", "direct"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => handleFilterChange({ tone: t })}
                    className={`flex-1 py-1.5 rounded-lg border text-sm font-medium capitalize transition ${
                      filterState.tone === t
                        ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                        : "border-gray-200 text-gray-500 hover:border-gray-300"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Discipline checkboxes */}
            {disciplines.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Disciplines
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-400">
                    <button
                      onClick={() =>
                        handleFilterChange({
                          disciplineIds: disciplines.map((d) => d.id),
                        })
                      }
                      className="hover:text-indigo-600 transition font-medium"
                    >
                      All
                    </button>
                    <button
                      onClick={() =>
                        handleFilterChange({ disciplineIds: [] })
                      }
                      className="hover:text-gray-600 transition"
                    >
                      None
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {disciplines.map((d) => {
                    const checked = filterState.disciplineIds.includes(d.id);
                    return (
                      <label
                        key={d.id}
                        className={`flex items-center gap-1.5 cursor-pointer px-3 py-1 rounded-full border text-xs font-medium transition ${
                          checked
                            ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                            : "border-gray-200 text-gray-500 hover:border-gray-300"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleDiscipline(d.id)}
                          className="sr-only"
                        />
                        {d.name}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Overview summary */}
            <div>
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Class Context Note
              </div>
              <textarea
                value={filterState.overviewSummary}
                onChange={(e) =>
                  handleFilterChange({ overviewSummary: e.target.value })
                }
                placeholder="Optional: brief context note for all reports (e.g. 'challenging term due to disruptions')"
                rows={2}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 placeholder-gray-400 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 outline-none resize-none transition"
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Report textarea ────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Report
          </div>
          {isSaving && (
            <span className="text-xs text-gray-400 italic">Saving...</span>
          )}
        </div>

        {loadingReport ? (
          <div className="animate-pulse space-y-2">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="h-4 bg-gray-100 rounded" />
            ))}
          </div>
        ) : (
          <>
            <textarea
              value={reportContent}
              onChange={(e) => {
                setReportContent(e.target.value);
              }}
              onBlur={handleTextareaBlur}
              placeholder={
                currentReportId
                  ? "Edit the report here..."
                  : "No report generated yet. Use the Regenerate button to generate one."
              }
              rows={12}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 outline-none resize-y transition font-mono leading-relaxed"
            />
            <div className="flex items-center justify-between mt-1.5 text-xs text-gray-400">
              <span>{wordCount} words</span>
              <span>{charCount} chars</span>
            </div>
          </>
        )}
      </div>

      {/* ── Error ─────────────────────────────────────────────────────────── */}
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-4 text-red-400 hover:text-red-600 transition"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      )}

      {/* ── Action bar ────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-4 flex items-center gap-3 flex-wrap">
        {/* Regenerate */}
        <button
          onClick={handleRegenerate}
          disabled={isRegenerating}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition ${
            isDirty && !isRegenerating
              ? "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm shadow-indigo-200 ring-2 ring-indigo-300"
              : "bg-indigo-50 text-indigo-600 hover:bg-indigo-100 border border-indigo-200"
          } disabled:opacity-50`}
        >
          {isRegenerating ? (
            <>
              <svg
                className="w-4 h-4 animate-spin"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              Generating...
            </>
          ) : (
            <>
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
              {currentReportId ? "Regenerate" : "Generate"}
            </>
          )}
        </button>

        {/* Export PDF */}
        <button
          onClick={handleExportPDF}
          disabled={!currentReportId}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.8}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
            />
          </svg>
          Export PDF
        </button>

        <div className="flex-1" />

        {/* Mark Final + Next */}
        <button
          onClick={handleMarkFinalAndNext}
          disabled={!currentReportId || isMarkingFinal || reportStatus === "final"}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-40 transition"
        >
          {isMarkingFinal ? (
            "Saving..."
          ) : reportStatus === "final" ? (
            "Finalised"
          ) : (
            <>
              Mark Final
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </>
          )}
        </button>
      </div>

      {/* Quick jump to full review page */}
      <div className="text-center">
        <a
          href={`/classes/${classId}/sessions/${sessionId}/review?student=${currentStudent?.id ?? ""}`}
          className="text-xs text-gray-400 hover:text-indigo-600 underline transition"
        >
          Open full review page for this student
        </a>
      </div>
    </div>
  );
}
