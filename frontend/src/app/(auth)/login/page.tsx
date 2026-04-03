"use client";

/**
 * Session detail page.
 *
 * Tabs:
 *   1. Ratings — full filter panel (tone, disciplines, tests, progression, class overview)
 *                above the RatingsGrid.
 *   2. Reports  — table of per-student report statuses with Generate / Edit / View links.
 *   3. Generate — BullMQ bulk generation panel.
 *
 * All filter state is auto-saved to the session via PUT /api/v1/sessions/:sessionId
 * (debounced 600 ms).
 *
 * Multi-tenant: all requests carry JWT; API enforces org isolation.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, APIError } from "@/lib/api";

// ── Authenticated export download helper ──────────────────────────────────────

async function downloadWithAuth(
  url: string,
  filename: string
): Promise<void> {
  const token =
    typeof window !== "undefined"
      ? window.localStorage.getItem("rg_token")
      : null;
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Export failed: HTTP ${response.status}`);
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}

import RatingsGrid, {
  GridDiscipline,
  GridStudent,
  GridReport,
} from "@/components/RatingsGrid";
import GenerateReportsPanel from "@/components/GenerateReportsPanel";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Discipline {
  id: string;
  name: string;
  category: string | null;
  is_custom: boolean;
  created_at: string;
}

interface TestFilterState {
  includeMark: boolean;
  includePercentage: boolean;
  includeGrade: boolean;
  includeLowMention: boolean;
}

interface SessionDetail {
  id: string;
  class_id: string;
  name: string;
  topics_covered: string[];
  tone: string;
  length: string;
  status: string;
  is_template: boolean;
  source_template_id: string | null;
  test_filters: Record<string, TestFilterState> | null;
  progression_filters: string[];
  class_overview: string | null;
  created_at: string;
  updated_at: string;
}

interface ClassTest {
  id: string;
  name: string;
  max_mark: number;
  topics: string[];
  _count: { results: number };
}

interface MatchedDisciplineProgression {
  name: string;
  currentScore: number;
  previousScore: number;
  trend: "improved" | "declined" | "maintained";
}

interface ProgressionData {
  previousSession: { id: string; name: string; completed_at: string } | null;
  matchedDisciplines: MatchedDisciplineProgression[];
}

interface SessionDetailResponse {
  data: {
    session: SessionDetail;
    students: GridStudent[];
    disciplines: Discipline[];
  };
}

interface ClassMeta {
  id: string;
  name: string;
  year_group: string | null;
  subject: string | null;
}

interface ClassDetailResponse {
  data: ClassMeta;
}

interface RatingsResponse {
  students: GridStudent[];
  disciplines: GridDiscipline[];
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ExportButton({
  label,
  url,
  filename,
  icon,
}: {
  label: string;
  url: string;
  filename: string;
  icon: "download" | "spreadsheet";
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleClick() {
    setBusy(true);
    setErr(null);
    try {
      await downloadWithAuth(url, filename);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={handleClick}
        disabled={busy}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition"
      >
        {icon === "download" ? (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        )}
        {busy ? "Exporting..." : label}
      </button>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: "bg-gray-100 text-gray-600",
    in_progress: "bg-yellow-100 text-yellow-700",
    complete: "bg-green-100 text-green-700",
  };
  const cls = map[status] ?? "bg-gray-100 text-gray-600";
  const label =
    status === "in_progress"
      ? "In Progress"
      : status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}
    >
      {label}
    </span>
  );
}

function ConfirmDialog({
  message,
  onConfirm,
  onCancel,
  confirmLabel = "Confirm",
  danger = false,
}: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  danger?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
        <p className="text-sm text-gray-700 mb-5">{message}</p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-md border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 rounded-md text-sm font-semibold text-white transition ${
              danger ? "bg-red-600 hover:bg-red-700" : "bg-indigo-600 hover:bg-indigo-700"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddDisciplineModal({
  sessionId,
  onClose,
  onAdded,
}: {
  sessionId: string;
  onClose: () => void;
  onAdded: (discipline: Discipline) => void;
}) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Discipline name is required.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      interface AddDisciplineResponse {
        data: Discipline;
      }
      const result = await apiFetch<AddDisciplineResponse>(
        `/api/v1/sessions/${sessionId}/disciplines`,
        { method: "POST", body: { name: trimmed } }
      );
      onAdded(result.data);
    } catch (err) {
      setError(
        err instanceof APIError ? err.message : "Failed to add discipline."
      );
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">
          Add Discipline
        </h2>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
          placeholder="e.g. Drama"
          autoFocus
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition mb-3"
        />
        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-md border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
          >
            Cancel
          </button>
          <button
            onClick={handleAdd}
            disabled={loading || !name.trim()}
            className="px-4 py-2 rounded-md bg-indigo-600 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 transition"
          >
            {loading ? "Adding..." : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SessionSkeleton() {
  return (
    <div className="max-w-6xl mx-auto animate-pulse space-y-6">
      <div className="h-4 bg-gray-200 rounded w-64 mb-2" />
      <div className="h-8 bg-gray-200 rounded w-1/3" />
      <div className="flex gap-2">
        {[1, 2, 3].map((n) => (
          <div key={n} className="h-6 bg-gray-100 rounded-full w-20" />
        ))}
      </div>
      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-3">
        <div className="h-5 bg-gray-200 rounded w-1/4" />
        {[1, 2, 3, 4].map((n) => (
          <div key={n} className="h-12 bg-gray-100 rounded" />
        ))}
      </div>
    </div>
  );
}

// ── Reports Tab component ──────────────────────────────────────────────────────

function ReportsTab({
  classId,
  sessionId,
  gridStudents,
  reports,
  apiUrl,
}: {
  classId: string;
  sessionId: string;
  gridStudents: GridStudent[];
  reports: Map<string, GridReport>;
  apiUrl: string;
}) {
  const [exportError, setExportError] = useState<string | null>(null);

  async function handleExport(type: "pdf" | "csv") {
    setExportError(null);
    try {
      const ext = type === "pdf" ? "zip" : "xlsx";
      await downloadWithAuth(
        `${apiUrl}/api/v1/sessions/${sessionId}/export/${type}`,
        `session_reports.${ext}`
      );
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed.");
    }
  }

  // Find first student whose report is not final, fall back to first student.
  const firstNonFinalStudentId =
    gridStudents.find((s) => {
      const r = reports.get(s.id);
      return !r || r.status !== "final";
    })?.id ?? gridStudents[0]?.id;

  function reportStatusLabel(status: string | undefined): {
    label: string;
    cls: string;
  } {
    if (!status) return { label: "No Report", cls: "text-gray-400" };
    if (status === "final") return { label: "Final", cls: "text-green-600 font-medium" };
    if (status === "draft") return { label: "Draft", cls: "text-yellow-600 font-medium" };
    if (status === "edited") return { label: "Edited", cls: "text-blue-600 font-medium" };
    return { label: status, cls: "text-gray-500" };
  }

  function actionLabel(status: string | undefined): string {
    if (!status) return "Generate";
    if (status === "final") return "View";
    return "Edit";
  }

  return (
    <div className="space-y-4">
      {/* Bulk actions bar */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm px-5 py-3 flex items-center gap-3 flex-wrap">
        {firstNonFinalStudentId && (
          <Link
            href={`/classes/${classId}/sessions/${sessionId}/review?student=${firstNonFinalStudentId}`}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-indigo-600 text-sm font-semibold text-white hover:bg-indigo-700 transition"
          >
            Review All Reports
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        )}
        <button
          onClick={() => handleExport("pdf")}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
        >
          Export PDF
        </button>
        <button
          onClick={() => handleExport("csv")}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
        >
          Export XLSX
        </button>
        {exportError && (
          <span className="text-xs text-red-600">{exportError}</span>
        )}
      </div>

      {/* Reports table */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        {gridStudents.length === 0 ? (
          <p className="px-5 py-8 text-sm text-gray-400 text-center">No students in this session.</p>
        ) : (
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Student</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Words</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {gridStudents.map((student) => {
                const report = reports.get(student.id);
                const { label, cls } = reportStatusLabel(report?.status);
                const action = actionLabel(report?.status);
                const reviewHref = `/classes/${classId}/sessions/${sessionId}/review?student=${student.id}`;
                return (
                  <tr key={student.id} className="hover:bg-gray-50 transition">
                    <td className="px-5 py-3 font-medium text-gray-800">
                      {student.first_name}
                      {student.last_name ? ` ${student.last_name}` : ""}
                      {student.student_ref_id && (
                        <span className="ml-2 text-xs text-gray-400">#{student.student_ref_id}</span>
                      )}
                    </td>
                    <td className={`px-5 py-3 ${cls}`}>{label}</td>
                    <td className="px-5 py-3 text-gray-500">
                      {report?.word_count != null ? report.word_count : "—"}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Link
                        href={reviewHref}
                        className="inline-flex items-center px-3 py-1 rounded border border-indigo-300 text-xs font-medium text-indigo-600 hover:bg-indigo-50 transition"
                      >
                        {action}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Filter Panel (inside Ratings tab) ─────────────────────────────────────────

function FilterPanel({
  session,
  disciplines,
  classTests,
  progressionData,
  onSave,
}: {
  session: SessionDetail;
  disciplines: Discipline[];
  classTests: ClassTest[];
  progressionData: ProgressionData | null;
  onSave: (patch: Partial<Pick<SessionDetail, "tone" | "test_filters" | "progression_filters" | "class_overview">>) => void;
}) {
  // Tone — initialized from session, updated immediately on change
  const [tone, setTone] = useState<string>(session.tone);

  // Discipline checkboxes — which disciplines are "included" for generation
  // (stored as a Set of discipline IDs, default: all checked)
  const [includedDisciplineIds, setIncludedDisciplineIds] = useState<Set<string>>(
    () => new Set(disciplines.map((d) => d.id))
  );

  // Test filter state — per test, which aspects to include
  const [testFilters, setTestFilters] = useState<Record<string, TestFilterState>>(() => {
    const saved = session.test_filters ?? {};
    const result: Record<string, TestFilterState> = {};
    for (const test of classTests) {
      result[test.id] = saved[test.id] ?? {
        includeMark: false,
        includePercentage: false,
        includeGrade: false,
        includeLowMention: false,
      };
    }
    return result;
  });

  // Progression filter — which discipline names are included
  const [includedProgressionItems, setIncludedProgressionItems] = useState<Set<string>>(
    () => new Set(session.progression_filters ?? [])
  );

  // Class overview textarea
  const [classOverview, setClassOverview] = useState<string>(session.class_overview ?? "");

  // Sync tone from session if it changes externally
  useEffect(() => { void Promise.resolve().then(() => { setTone(session.tone); }); }, [session.tone]);

  // Debounce ref for overview saves
  const overviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleToneChange(newTone: string) {
    setTone(newTone);
    onSave({ tone: newTone });
  }

  function handleTestFilterChange(testId: string, field: keyof TestFilterState, value: boolean) {
    const updated = {
      ...testFilters,
      [testId]: { ...(testFilters[testId] ?? { includeMark: false, includePercentage: false, includeGrade: false, includeLowMention: false }), [field]: value },
    };
    setTestFilters(updated);
    onSave({ test_filters: updated });
  }

  function toggleProgressionItem(name: string) {
    setIncludedProgressionItems((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      const arr = Array.from(next);
      onSave({ progression_filters: arr });
      return next;
    });
  }

  function handleOverviewChange(val: string) {
    setClassOverview(val);
    if (overviewTimerRef.current) clearTimeout(overviewTimerRef.current);
    overviewTimerRef.current = setTimeout(() => {
      onSave({ class_overview: val.trim() || null });
    }, 600);
  }

  const hasTests = classTests.length > 0;
  const hasProgression =
    progressionData !== null &&
    progressionData.previousSession !== null &&
    progressionData.matchedDisciplines.length > 0;

  return (
    <div className="space-y-4 mb-4">
      {/* Tone + Disciplines row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Tone selector */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm px-5 py-4">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Report Tone
          </h2>
          <div className="flex gap-2">
            {(["gentle", "balanced", "direct"] as const).map((t) => {
              const isActive = tone === t;
              return (
                <button
                  key={t}
                  onClick={() => handleToneChange(t)}
                  className={`flex-1 py-2 rounded-lg border text-sm font-medium capitalize transition ${
                    isActive
                      ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                      : "border-gray-200 text-gray-400 hover:border-gray-300 hover:text-gray-600"
                  }`}
                >
                  {t}
                  {isActive && session.tone === t && tone === session.tone && (
                    <span className="ml-1 text-xs text-gray-400">(saved)</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Disciplines checkboxes */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Disciplines in reports
            </h2>
            <div className="flex gap-3 text-xs text-gray-400">
              <button
                onClick={() => setIncludedDisciplineIds(new Set(disciplines.map((d) => d.id)))}
                className="hover:text-indigo-600 transition font-medium"
              >
                All
              </button>
              <button
                onClick={() => setIncludedDisciplineIds(new Set())}
                className="hover:text-gray-600 transition"
              >
                None
              </button>
            </div>
          </div>
          {disciplines.length === 0 ? (
            <p className="text-xs text-gray-400">No disciplines yet.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {disciplines.map((d) => {
                const checked = includedDisciplineIds.has(d.id);
                return (
                  <button
                    key={d.id}
                    onClick={() => {
                      setIncludedDisciplineIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(d.id)) next.delete(d.id);
                        else next.add(d.id);
                        return next;
                      });
                    }}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition ${
                      checked
                        ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                        : "border-gray-200 bg-white text-gray-400 hover:border-gray-300"
                    }`}
                  >
                    {checked && (
                      <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                    {d.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Tests filter card */}
      {hasTests && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm px-5 py-4">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Tests — include in reports
          </h2>
          <div className="space-y-3">
            {classTests.map((test) => {
              const tf = testFilters[test.id] ?? { includeMark: false, includePercentage: false, includeGrade: false, includeLowMention: false };
              const anyOn = tf.includeMark || tf.includePercentage || tf.includeGrade || tf.includeLowMention;
              return (
                <div
                  key={test.id}
                  className={`rounded-lg border p-3 transition ${
                    anyOn ? "border-indigo-200 bg-indigo-50/40" : "border-gray-100"
                  }`}
                >
                  <div className="text-sm font-medium text-gray-800 mb-2">
                    {test.name}
                    <span className="ml-2 text-xs text-gray-400">/{test.max_mark} marks</span>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {(
                      [
                        { key: "includeMark" as const, label: "Mark" },
                        { key: "includePercentage" as const, label: "Percentage" },
                        { key: "includeGrade" as const, label: "Grade" },
                        { key: "includeLowMention" as const, label: "Low score note" },
                      ] as const
                    ).map(({ key, label }) => (
                      <label key={key} className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={tf[key]}
                          onChange={(e) => handleTestFilterChange(test.id, key, e.target.checked)}
                          className="accent-indigo-600 w-3.5 h-3.5"
                        />
                        <span className="text-xs text-gray-600">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Historical Progression card */}
      {hasProgression && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Historical Progression
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">
                vs. {progressionData!.previousSession!.name}
              </p>
            </div>
            <div className="flex gap-3 text-xs text-gray-400">
              <button
                onClick={() => {
                  const all = progressionData!.matchedDisciplines.map((d) => d.name);
                  setIncludedProgressionItems(new Set(all));
                  onSave({ progression_filters: all });
                }}
                className="hover:text-indigo-600 transition font-medium"
              >
                All
              </button>
              <button
                onClick={() => {
                  setIncludedProgressionItems(new Set());
                  onSave({ progression_filters: [] });
                }}
                className="hover:text-gray-600 transition"
              >
                None
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {progressionData!.matchedDisciplines.map((disc) => {
              const isIncluded = includedProgressionItems.has(disc.name);
              const trendColor =
                disc.trend === "improved"
                  ? "text-green-600"
                  : disc.trend === "declined"
                  ? "text-red-500"
                  : "text-gray-400";
              const trendIcon =
                disc.trend === "improved" ? "↑" : disc.trend === "declined" ? "↓" : "=";
              return (
                <button
                  key={disc.name}
                  onClick={() => toggleProgressionItem(disc.name)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition ${
                    isIncluded
                      ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                      : "border-gray-200 text-gray-400 hover:border-gray-300"
                  }`}
                >
                  {disc.name}
                  <span className={`${trendColor} font-bold`}>{trendIcon}</span>
                  <span className="text-gray-300">{disc.previousScore}&rarr;{disc.currentScore}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Class Overview textarea */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm px-5 py-4">
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          Class Overview
        </label>
        <p className="text-xs text-gray-400 mb-2">
          Context injected into all reports for this session. Describe the class&apos;s overall progress, notable themes, or shared experiences.
        </p>
        <textarea
          value={classOverview}
          onChange={(e) => handleOverviewChange(e.target.value)}
          rows={3}
          placeholder="The class showed strong engagement with the poetry unit this term, particularly in creative expression..."
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition resize-none"
        />
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SessionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const classId =
    typeof params.id === "string" ? params.id : (params.id?.[0] ?? "");
  const sessionId =
    typeof params.sessionId === "string"
      ? params.sessionId
      : (params.sessionId?.[0] ?? "");

  // Session / class metadata
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [disciplines, setDisciplines] = useState<Discipline[]>([]);
  const [classMeta, setClassMeta] = useState<ClassMeta | null>(null);

  // Grid data (loaded separately from ratings endpoint)
  const [gridStudents, setGridStudents] = useState<GridStudent[]>([]);
  const [gridDisciplines, setGridDisciplines] = useState<GridDiscipline[]>([]);

  // Reports map (student_id → report)
  const [reports, setReports] = useState<Map<string, GridReport>>(new Map());

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // UI state
  const [activeTab, setActiveTab] = useState<"ratings" | "reports" | "generate">("ratings");
  const [showAddDiscipline, setShowAddDiscipline] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [showStatusConfirm, setShowStatusConfirm] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Tests (class-level)
  const [classTests, setClassTests] = useState<ClassTest[]>([]);

  // Historical progression data
  const [progressionData, setProgressionData] = useState<ProgressionData | null>(null);

  // ── Initial load ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!sessionId || !classId) return;
    let cancelled = false;

    async function load() {
      try {
        const [sessionResult, classResult, testsResult] = await Promise.all([
          apiFetch<SessionDetailResponse>(`/api/v1/sessions/${sessionId}`),
          apiFetch<ClassDetailResponse>(`/api/v1/classes/${classId}`),
          apiFetch<{ data: ClassTest[] }>(`/api/v1/classes/${classId}/tests`).catch(() => ({ data: [] as ClassTest[] })),
        ]);
        if (cancelled) return;
        setSession(sessionResult.data.session);
        setDisciplines(sessionResult.data.disciplines);
        setClassMeta(classResult.data);
        setClassTests(testsResult.data);

        // Fetch progression data (non-fatal if it fails)
        apiFetch<ProgressionData>(`/api/v1/sessions/${sessionId}/progression-data`)
          .then((pd) => {
            if (!cancelled) setProgressionData(pd);
          })
          .catch(() => {
            // Non-fatal — progression card is simply not shown
          });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof APIError && err.status === 404) {
          router.replace(`/classes/${classId}`);
        } else {
          setError(
            err instanceof APIError ? err.message : "Failed to load session."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [sessionId, classId, router]);

  // ── Load ratings grid ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!sessionId || loading) return;
    let cancelled = false;

    async function loadRatings() {
      try {
        const result = await apiFetch<RatingsResponse>(
          `/api/v1/sessions/${sessionId}/ratings`
        );
        if (!cancelled) {
          setGridStudents(result.students);
          setGridDisciplines(result.disciplines);
        }
      } catch {
        // Non-fatal: grid will show 0/0 state
      }
    }

    loadRatings();
    return () => {
      cancelled = true;
    };
  }, [sessionId, loading]);

  // ── Load reports ───────────────────────────────────────────────────────────

  const loadReports = useCallback(async () => {
    if (!sessionId) return;
    try {
      interface ReportsResponse {
        reports: GridReport[];
      }
      const result = await apiFetch<ReportsResponse>(
        `/api/v1/sessions/${sessionId}/reports`
      );
      const map = new Map<string, GridReport>();
      for (const r of result.reports) {
        map.set(r.student_id, r);
      }
      setReports(map);
    } catch {
      // Non-fatal
    }
  }, [sessionId]);

  useEffect(() => {
    if (!loading) loadReports();
  }, [loading, loadReports]);

  // ── Filter save (debounced) ────────────────────────────────────────────────

  const filterSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleFilterSave = useCallback(
    (patch: Partial<Pick<SessionDetail, "tone" | "test_filters" | "progression_filters" | "class_overview">>) => {
      // Optimistically update session state so derived UI is consistent
      setSession((prev) => (prev ? { ...prev, ...patch } : prev));

      if (filterSaveTimerRef.current) clearTimeout(filterSaveTimerRef.current);
      filterSaveTimerRef.current = setTimeout(async () => {
        try {
          interface UpdateSessionResponse {
            data: SessionDetail;
          }
          const result = await apiFetch<UpdateSessionResponse>(
            `/api/v1/sessions/${sessionId}`,
            { method: "PUT", body: patch }
          );
          setSession(result.data);
        } catch {
          // Non-fatal — filter state is still local; user can re-save
        }
      }, 600);
    },
    [sessionId]
  );

  // ── Report created callback ────────────────────────────────────────────────

  function handleReportCreated(report: GridReport) {
    setReports((prev) => {
      const next = new Map(prev);
      next.set(report.student_id, report);
      return next;
    });
  }

  function handleBulkBatchStarted(_batchId: string) {
    void _batchId;
    setTimeout(loadReports, 5000);
  }

  // ── Discipline added ───────────────────────────────────────────────────────

  function handleDisciplineAdded(discipline: Discipline) {
    setDisciplines((prev) => [...prev, discipline]);
    setGridDisciplines((prev) => [...prev, discipline]);
    setGridStudents((prev) =>
      prev.map((student) => ({
        ...student,
        ratings: [
          ...student.ratings,
          {
            session_discipline_id: discipline.id,
            score: null,
            comment: null,
          },
        ],
      }))
    );
    setShowAddDiscipline(false);
  }

  // ── Session status ─────────────────────────────────────────────────────────

  async function handleStatusChange(newStatus: string) {
    setShowStatusConfirm(null);
    setStatusUpdating(true);
    try {
      interface UpdateSessionResponse {
        data: SessionDetail;
      }
      const result = await apiFetch<UpdateSessionResponse>(
        `/api/v1/sessions/${sessionId}`,
        { method: "PUT", body: { status: newStatus } }
      );
      setSession(result.data);
    } catch (err) {
      setActionError(
        err instanceof APIError ? err.message : "Failed to update status."
      );
    } finally {
      setStatusUpdating(false);
    }
  }

  // ── Duplicate ──────────────────────────────────────────────────────────────

  async function handleDuplicate() {
    setDuplicating(true);
    try {
      interface DuplicateResponse {
        data: { id: string; class_id: string };
      }
      const result = await apiFetch<DuplicateResponse>(
        `/api/v1/sessions/${sessionId}/duplicate`,
        { method: "POST" }
      );
      router.push(
        `/classes/${result.data.class_id}/sessions/${result.data.id}`
      );
    } catch (err) {
      setActionError(
        err instanceof APIError ? err.message : "Failed to duplicate session."
      );
      setDuplicating(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) return <SessionSkeleton />;

  if (error) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      </div>
    );
  }

  if (!session) return null;

  const isComplete = session.status === "complete";

  const classLabel = classMeta
    ? [
        classMeta.name,
        classMeta.year_group && `Year ${classMeta.year_group}`,
        classMeta.subject,
      ]
        .filter(Boolean)
        .join(" — ")
    : "";

  // Use empty-string base so all export URLs are relative (same-origin).
  // This avoids CSP violations from calling the Express backend on port 3001 directly.
  const API_URL = "";

  return (
    <div className="w-full space-y-6">
      {/* Modals */}
      {showAddDiscipline && (
        <AddDisciplineModal
          sessionId={sessionId}
          onClose={() => setShowAddDiscipline(false)}
          onAdded={handleDisciplineAdded}
        />
      )}
      {showStatusConfirm && (
        <ConfirmDialog
          message={
            showStatusConfirm === "complete"
              ? "Mark this session as complete? Editing will be locked for all students."
              : `Change status to "${showStatusConfirm}"?`
          }
          confirmLabel="Confirm"
          onConfirm={() => handleStatusChange(showStatusConfirm)}
          onCancel={() => setShowStatusConfirm(null)}
        />
      )}

      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-gray-500 flex-wrap">
        <Link href="/dashboard" className="hover:text-indigo-600 transition">
          Dashboard
        </Link>
        <span>/</span>
        <Link
          href={`/classes/${classId}`}
          className="hover:text-indigo-600 transition truncate max-w-[180px]"
        >
          {classLabel || "Class"}
        </Link>
        <span>/</span>
        <span className="text-gray-800 font-medium truncate">
          {session.name}
        </span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900">{session.name}</h1>
            <StatusBadge status={session.status} />
            {session.is_template && (
              <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-700 px-2.5 py-0.5 text-xs font-medium">
                Template
              </span>
            )}
            {!session.is_template && session.source_template_id && (
              <span className="inline-flex items-center rounded-full bg-sky-100 text-sky-700 px-2.5 py-0.5 text-xs font-medium">
                Copied from template
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
            <span className="capitalize">{session.tone} tone</span>
            <span>·</span>
            <span className="capitalize">{session.length} length</span>
            <span>·</span>
            <span>{new Date(session.created_at).toLocaleDateString()}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {!isComplete && session.status === "draft" && (
            <button
              onClick={() => setShowStatusConfirm("in_progress")}
              disabled={statusUpdating}
              className="px-3 py-1.5 rounded-md border border-yellow-400 text-sm font-medium text-yellow-700 hover:bg-yellow-50 transition disabled:opacity-50"
            >
              Mark In Progress
            </button>
          )}
          {!isComplete && session.status === "in_progress" && (
            <button
              onClick={() => setShowStatusConfirm("complete")}
              disabled={statusUpdating}
              className="px-3 py-1.5 rounded-md border border-green-400 text-sm font-medium text-green-700 hover:bg-green-50 transition disabled:opacity-50"
            >
              Mark Complete
            </button>
          )}
          <button
            onClick={handleDuplicate}
            disabled={duplicating}
            className="px-3 py-1.5 rounded-md border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition disabled:opacity-50"
          >
            {duplicating ? "Duplicating..." : "Duplicate Session"}
          </button>
        </div>
      </div>

      {/* Action error */}
      {actionError && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-5 py-3 text-sm text-red-700 flex items-center justify-between">
          <span>{actionError}</span>
          <button
            onClick={() => setActionError(null)}
            className="text-red-400 hover:text-red-600 ml-4 transition"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Tab toggle */}
      <div className="flex border-b border-gray-200">
        <button
          onClick={() => setActiveTab("ratings")}
          className={`px-5 py-2.5 text-sm font-medium transition border-b-2 -mb-px ${
            activeTab === "ratings"
              ? "border-indigo-600 text-indigo-700"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Ratings
        </button>
        <button
          onClick={() => setActiveTab("reports")}
          className={`px-5 py-2.5 text-sm font-medium transition border-b-2 -mb-px ${
            activeTab === "reports"
              ? "border-indigo-600 text-indigo-700"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Reports
          {reports.size > 0 && (
            <span className="ml-1.5 inline-flex items-center rounded-full bg-indigo-100 px-1.5 py-0.5 text-xs font-medium text-indigo-700">
              {reports.size}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("generate")}
          className={`px-5 py-2.5 text-sm font-medium transition border-b-2 -mb-px ${
            activeTab === "generate"
              ? "border-indigo-600 text-indigo-700"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Generate Reports
        </button>
      </div>

      {/* Ratings tab — filter panel above grid */}
      {activeTab === "ratings" && (
        <div className="w-full space-y-4">
          {/* Add discipline button above filters */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400">
              Configure session filters, then enter ratings below.
            </p>
            {!isComplete && (
              <button
                onClick={() => setShowAddDiscipline(true)}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium transition"
              >
                + Add Discipline
              </button>
            )}
          </div>

          <FilterPanel
            session={session}
            disciplines={disciplines}
            classTests={classTests}
            progressionData={progressionData}
            onSave={handleFilterSave}
          />

          <RatingsGrid
            sessionId={sessionId}
            students={gridStudents}
            disciplines={gridDisciplines}
            reports={reports}
            isReadOnly={isComplete}
            onReportCreated={handleReportCreated}
            onBulkBatchStarted={handleBulkBatchStarted}
            topics={session.topics_covered}
          />
        </div>
      )}

      {/* Reports tab */}
      {activeTab === "reports" && (
        <ReportsTab
          classId={classId}
          sessionId={sessionId}
          gridStudents={gridStudents}
          reports={reports}
          apiUrl={API_URL}
        />
      )}

      {/* Generate Reports tab */}
      {activeTab === "generate" && (
        <GenerateReportsPanel
          sessionId={sessionId}
          students={gridStudents}
        />
      )}

      {/* Export section */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm px-6 py-4">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
          Export
        </h2>
        <div className="flex items-center gap-3 flex-wrap">
          <ExportButton
            label="Export All PDF (ZIP)"
            url={`${API_URL}/api/v1/sessions/${sessionId}/export/pdf`}
            filename="session_reports.zip"
            icon="download"
          />
          <ExportButton
            label="Export XLSX"
            url={`${API_URL}/api/v1/sessions/${sessionId}/export/csv`}
            filename="session_reports.xlsx"
            icon="spreadsheet"
          />
        </div>
      </div>
    </div>
  );
}
