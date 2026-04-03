"use client";

/**
 * Test score entry page.
 *
 * URL: /classes/[id]/tests/[testId]/entry
 *
 * Allows a teacher to enter and edit student scores for a given test.
 * Scores can be typed as "42/50" (numerator used) or just "42".
 * Grade and percentage are computed live from the test's grade_boundaries.
 * Auto-saves on blur; "Save All" saves all dirty rows in one bulk call.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, APIError } from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TestDetail {
  id: string;
  name: string;
  topics: string[];
  max_mark: number;
  grade_boundaries: Record<string, number>;
  created_at: string;
  _count?: { results: number };
}

interface Student {
  id: string;
  first_name: string;
  last_name: string | null;
  student_ref_id: string | null;
  gender: string | null;
  created_at: string;
}

interface ClassDetailResponse {
  data: {
    id: string;
    name: string;
    year_group: string | null;
    subject: string | null;
    archived: boolean;
    students: Student[];
  };
}

interface TestResult {
  id: string;
  student_id: string;
  score: number;
  comment: string | null;
  calculated: { percentage?: number; grade?: string | null };
}

interface TestResultsResponse {
  data: TestResult[];
}

interface TestDetailResponse {
  data: TestDetail;
}

// ── Row state for a single student ────────────────────────────────────────────

interface ResultRow {
  scoreInput: string;         // raw text the user typed, e.g. "42/50" or "42"
  comment: string;
  percentage: number | null;  // computed live
  grade: string | null;       // computed live
  dirty: boolean;             // unsaved changes exist
}

// ── Grade calculation (mirrors the backend) ───────────────────────────────────

function calculateGrade(
  score: number,
  maxMark: number,
  boundaries: Record<string, number>
): { percentage: number; grade: string } {
  const percentage = Math.round((score / maxMark) * 100);
  const sorted = Object.entries(boundaries).sort((a, b) => b[1] - a[1]);
  const grade = sorted.find(([, threshold]) => percentage >= threshold)?.[0] ?? "U";
  return { percentage, grade };
}

function parseScoreInput(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Accept "42/50" — take the numerator
  const slashIndex = trimmed.indexOf("/");
  const raw = slashIndex !== -1 ? trimmed.slice(0, slashIndex) : trimmed;
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

// ── Grade badge ───────────────────────────────────────────────────────────────

function GradeBadge({ grade }: { grade: string | null }) {
  if (grade === null) return <span className="text-gray-400">—</span>;

  const colourMap: Record<string, string> = {
    "A*": "bg-purple-100 text-purple-700",
    A: "bg-green-100 text-green-700",
    B: "bg-blue-100 text-blue-700",
    C: "bg-yellow-100 text-yellow-700",
    D: "bg-orange-100 text-orange-700",
    E: "bg-red-100 text-red-600",
    U: "bg-gray-100 text-gray-500",
  };
  const cls = colourMap[grade] ?? "bg-gray-100 text-gray-600";
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold ${cls}`}
    >
      {grade}
    </span>
  );
}

// ── Boundary summary line ─────────────────────────────────────────────────────

function BoundarySummary({
  boundaries,
}: {
  boundaries: Record<string, number>;
}) {
  const sorted = Object.entries(boundaries).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) {
    return <span className="text-gray-400 italic text-xs">No grade boundaries set</span>;
  }
  return (
    <span className="text-xs text-gray-600">
      {sorted.map(([grade, threshold], i) => (
        <span key={grade}>
          {i > 0 && <span className="mx-1 text-gray-300">|</span>}
          <span className="font-semibold text-gray-700">{grade}</span>
          {" "}
          <span className="text-gray-500">&ge;{threshold}%</span>
        </span>
      ))}
    </span>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TestEntryPage() {
  const params = useParams<{ id: string; testId: string }>();
  const router = useRouter();

  const classId = params.id ?? "";
  const testId = params.testId ?? "";

  const [test, setTest] = useState<TestDetail | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [results, setResults] = useState<Map<string, ResultRow>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  // Track which row is currently auto-saving (for per-row blur save)
  const autoSavingRef = useRef(false);

  // ── Initial data load ───────────────────────────────────────────────────────

  useEffect(() => {
    if (!classId || !testId) return;
    let cancelled = false;

    async function load() {
      try {
        const [testResult, classResult, resultsResult] = await Promise.all([
          apiFetch<TestDetailResponse>(
            `/api/v1/classes/${classId}/tests/${testId}`
          ),
          apiFetch<ClassDetailResponse>(`/api/v1/classes/${classId}`),
          apiFetch<TestResultsResponse>(
            `/api/v1/tests/${testId}/results`
          ).catch(() => ({ data: [] as TestResult[] })),
        ]);

        if (cancelled) return;

        const fetchedTest = testResult.data;
        const fetchedStudents = classResult.data.students;
        const fetchedResults = resultsResult.data;

        // Build a lookup map from existing results
        const existingMap = new Map<string, TestResult>();
        for (const r of fetchedResults) {
          existingMap.set(r.student_id, r);
        }

        // Build initial results map — one entry per student
        const initialResults = new Map<string, ResultRow>();
        for (const s of fetchedStudents) {
          const existing = existingMap.get(s.id);
          if (existing) {
            const { percentage, grade } = calculateGrade(
              existing.score,
              fetchedTest.max_mark,
              fetchedTest.grade_boundaries
            );
            initialResults.set(s.id, {
              scoreInput: String(existing.score),
              comment: existing.comment ?? "",
              percentage,
              grade,
              dirty: false,
            });
          } else {
            initialResults.set(s.id, {
              scoreInput: "",
              comment: "",
              percentage: null,
              grade: null,
              dirty: false,
            });
          }
        }

        setTest(fetchedTest);
        setStudents(fetchedStudents);
        setResults(initialResults);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof APIError && err.status === 404) {
          router.replace(`/classes/${classId}`);
        } else {
          setError(
            err instanceof APIError ? err.message : "Failed to load test data."
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
  }, [classId, testId, router]);

  // ── Score input change handler ──────────────────────────────────────────────

  const handleScoreChange = useCallback(
    (studentId: string, value: string) => {
      if (!test) return;

      const parsed = parseScoreInput(value);
      let percentage: number | null = null;
      let grade: string | null = null;

      if (parsed !== null) {
        const computed = calculateGrade(
          parsed,
          test.max_mark,
          test.grade_boundaries
        );
        percentage = computed.percentage;
        grade = computed.grade;
      }

      setResults((prev) => {
        const next = new Map(prev);
        const existing = next.get(studentId);
        if (!existing) return prev;
        next.set(studentId, {
          ...existing,
          scoreInput: value,
          percentage,
          grade,
          dirty: true,
        });
        return next;
      });
    },
    [test]
  );

  // ── Comment change handler ──────────────────────────────────────────────────

  const handleCommentChange = useCallback(
    (studentId: string, value: string) => {
      setResults((prev) => {
        const next = new Map(prev);
        const existing = next.get(studentId);
        if (!existing) return prev;
        next.set(studentId, { ...existing, comment: value, dirty: true });
        return next;
      });
    },
    []
  );

  // ── Bulk save logic ─────────────────────────────────────────────────────────

  const saveDirtyRows = useCallback(
    async (rowsToSave: Array<{ studentId: string; row: ResultRow }>) => {
      if (!test || rowsToSave.length === 0) return;

      setSaving(true);
      setSaveError(null);

      const payloadWithNulls = rowsToSave.map(({ studentId, row }) => {
        const score = parseScoreInput(row.scoreInput);
        if (score === null) return null;
        const comment = row.comment.trim() || undefined;
        return { studentId, score, comment };
      });
      const payload = payloadWithNulls.filter(
        (r): r is NonNullable<typeof r> => r !== null
      );

      if (payload.length === 0) {
        setSaving(false);
        return;
      }

      try {
        await apiFetch(`/api/v1/tests/${testId}/results/bulk`, {
          method: "POST",
          body: { results: payload },
        });

        // Mark saved rows as clean
        setResults((prev) => {
          const next = new Map(prev);
          for (const { studentId } of rowsToSave) {
            const existing = next.get(studentId);
            if (existing) {
              next.set(studentId, { ...existing, dirty: false });
            }
          }
          return next;
        });

        setLastSaved(new Date());
      } catch (err) {
        setSaveError(
          err instanceof APIError ? err.message : "Save failed. Please try again."
        );
      } finally {
        setSaving(false);
      }
    },
    [test, testId]
  );

  // ── Auto-save on blur ───────────────────────────────────────────────────────

  const handleBlur = useCallback(
    async (studentId: string) => {
      if (autoSavingRef.current) return;
      const row = results.get(studentId);
      if (!row || !row.dirty) return;

      autoSavingRef.current = true;
      try {
        await saveDirtyRows([{ studentId, row }]);
      } finally {
        autoSavingRef.current = false;
      }
    },
    [results, saveDirtyRows]
  );

  // ── Save All handler ────────────────────────────────────────────────────────

  const handleSaveAll = useCallback(async () => {
    const dirty: Array<{ studentId: string; row: ResultRow }> = [];
    for (const [studentId, row] of results.entries()) {
      if (row.dirty) dirty.push({ studentId, row });
    }
    if (dirty.length > 0) {
      await saveDirtyRows(dirty);
    }
  }, [results, saveDirtyRows]);

  // ── Derived state ───────────────────────────────────────────────────────────

  const hasDirty = Array.from(results.values()).some((r) => r.dirty);
  const enteredCount = Array.from(results.values()).filter(
    (r) => r.scoreInput.trim() !== ""
  ).length;

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <span className="text-sm text-gray-500">Loading test...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
        <Link
          href={`/classes/${classId}`}
          className="mt-4 inline-flex text-sm text-indigo-600 hover:underline"
        >
          Back to class
        </Link>
      </div>
    );
  }

  if (!test) return null;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <nav className="flex items-center gap-1.5 text-sm text-gray-500">
            <Link href="/classes" className="hover:text-gray-700">
              Classes
            </Link>
            <span>/</span>
            <Link
              href={`/classes/${classId}`}
              className="hover:text-gray-700"
            >
              Class
            </Link>
            <span>/</span>
            <span className="text-gray-800 font-medium">{test.name}</span>
          </nav>

          <h1 className="text-2xl font-bold text-gray-900">{test.name}</h1>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
            <span>
              Max mark:{" "}
              <span className="font-medium text-gray-700">{test.max_mark}</span>
            </span>
            <span>
              {enteredCount} / {students.length} entered
            </span>
            {lastSaved && (
              <span className="text-green-600">
                Saved {lastSaved.toLocaleTimeString()}
              </span>
            )}
          </div>

          {Object.keys(test.grade_boundaries).length > 0 && (
            <div className="pt-1">
              <BoundarySummary boundaries={test.grade_boundaries} />
            </div>
          )}

          {test.topics.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {test.topics.map((topic) => (
                <span
                  key={topic}
                  className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700"
                >
                  {topic}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          {hasDirty && (
            <span className="inline-flex items-center gap-1.5 text-xs text-amber-600">
              <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
              Unsaved changes
            </span>
          )}
          <button
            onClick={handleSaveAll}
            disabled={saving || !hasDirty}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-indigo-600 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {saving ? "Saving..." : "Save All"}
          </button>
          <Link
            href={`/classes/${classId}`}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
          >
            Back
          </Link>
        </div>
      </div>

      {/* ── Save error ── */}
      {saveError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {saveError}
        </div>
      )}

      {/* ── Score table ── */}
      {students.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white px-5 py-10 text-center text-sm text-gray-400">
          No students in this class.
        </div>
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Student
                </th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Score
                </th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  %
                </th>
                {Object.keys(test.grade_boundaries).length > 0 && (
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Grade
                  </th>
                )}
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Comment
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {students.map((student) => {
                const row = results.get(student.id);
                if (!row) return null;

                const displayName = student.last_name
                  ? `${student.first_name} ${student.last_name}`
                  : student.first_name;

                return (
                  <tr
                    key={student.id}
                    className="hover:bg-gray-50 transition-colors"
                  >
                    {/* Student name */}
                    <td className="px-5 py-3">
                      <span className="font-medium text-gray-800">
                        {displayName}
                      </span>
                      {student.student_ref_id && (
                        <span className="ml-2 text-xs text-gray-400">
                          #{student.student_ref_id}
                        </span>
                      )}
                      {row.dirty && (
                        <span
                          className="ml-2 inline-block w-1.5 h-1.5 rounded-full bg-amber-400 align-middle"
                          title="Unsaved"
                        />
                      )}
                    </td>

                    {/* Score input */}
                    <td className="px-5 py-3">
                      <input
                        type="text"
                        value={row.scoreInput}
                        onChange={(e) =>
                          handleScoreChange(student.id, e.target.value)
                        }
                        onBlur={() => handleBlur(student.id)}
                        placeholder={`/ ${test.max_mark}`}
                        className="w-24 rounded border border-gray-300 px-2 py-1 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
                      />
                    </td>

                    {/* Percentage */}
                    <td className="px-5 py-3 text-gray-600 tabular-nums">
                      {row.percentage !== null ? (
                        <span>{row.percentage}%</span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>

                    {/* Grade — only shown when boundaries are configured */}
                    {Object.keys(test.grade_boundaries).length > 0 && (
                      <td className="px-5 py-3">
                        <GradeBadge grade={row.grade} />
                      </td>
                    )}

                    {/* Comment */}
                    <td className="px-5 py-3">
                      <input
                        type="text"
                        value={row.comment}
                        onChange={(e) =>
                          handleCommentChange(student.id, e.target.value)
                        }
                        onBlur={() => handleBlur(student.id)}
                        placeholder="Optional note"
                        className="w-full min-w-40 rounded border border-gray-300 px-2 py-1 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
