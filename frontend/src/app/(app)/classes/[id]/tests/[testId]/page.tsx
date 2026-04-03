"use client";

/**
 * Test detail + score entry page.
 *
 * URL: /classes/[id]/tests/[testId]
 *
 * Header: test name, max mark, grade boundaries summary, topic tags,
 *         Edit button (opens edit modal), Duplicate button (class-picker modal),
 *         Save All button, Back link.
 *
 * Score entry table: student name | score input | % (auto-calc) | grade (auto-calc) | comment (inline expand).
 *
 * Auto-saves on blur. Tab key moves focus between score inputs.
 */

import React, { useEffect, useState, useCallback, useRef, KeyboardEvent, FormEvent } from "react";
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

interface ClassListItem {
  id: string;
  name: string;
  year_group: string | null;
  subject: string | null;
  archived: boolean;
  _count: { students: number };
}

// ── Row state for a single student ────────────────────────────────────────────

interface ResultRow {
  scoreInput: string;          // raw text the user typed, e.g. "42/50" or "42"
  comment: string;
  commentOpen: boolean;        // whether the inline comment textarea is expanded
  percentage: number | null;   // computed live
  grade: string | null;        // computed live
  dirty: boolean;              // unsaved changes exist
}

// ── Grade calculation ─────────────────────────────────────────────────────────

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

// ── Boundary summary ──────────────────────────────────────────────────────────

function BoundarySummary({ boundaries }: { boundaries: Record<string, number> }) {
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

// ── Tag input (topics) ────────────────────────────────────────────────────────

function TagInput({
  tags,
  onChange,
  placeholder,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}) {
  const [input, setInput] = useState("");

  function addTag() {
    const trimmed = input.trim();
    if (trimmed && !tags.includes(trimmed)) {
      onChange([...tags, trimmed]);
    }
    setInput("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      addTag();
    }
  }

  function removeTag(tag: string) {
    onChange(tags.filter((t) => t !== tag));
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder ?? "Type and press Enter"}
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition"
        />
        <button
          type="button"
          onClick={addTag}
          className="px-3 py-2 rounded-md bg-gray-100 text-sm font-medium text-gray-700 hover:bg-gray-200 transition"
        >
          Add
        </button>
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1.5 bg-indigo-50 text-indigo-700 text-sm px-3 py-1 rounded-full"
            >
              {tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                className="text-indigo-400 hover:text-indigo-700 transition"
                aria-label={`Remove ${tag}`}
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Edit Test Modal ───────────────────────────────────────────────────────────

interface BoundaryRow {
  label: string;
  pct: string;
}

function EditTestModal({
  classId,
  test,
  onClose,
  onSaved,
}: {
  classId: string;
  test: TestDetail;
  onClose: () => void;
  onSaved: (updated: TestDetail) => void;
}) {
  const [name, setName] = useState(test.name);
  const [topics, setTopics] = useState<string[]>(test.topics);
  const [maxMark, setMaxMark] = useState(String(test.max_mark));
  const [showBoundaries, setShowBoundaries] = useState(
    Object.keys(test.grade_boundaries).length > 0
  );
  const [boundaries, setBoundaries] = useState<BoundaryRow[]>(() =>
    Object.entries(test.grade_boundaries).map(([label, pct]) => ({
      label,
      pct: String(pct),
    }))
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addBoundary() {
    setBoundaries((prev) => [...prev, { label: "", pct: "" }]);
  }

  function removeBoundary(idx: number) {
    setBoundaries((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateBoundary(idx: number, field: "label" | "pct", value: string) {
    setBoundaries((prev) =>
      prev.map((b, i) => (i === idx ? { ...b, [field]: value } : b))
    );
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim()) { setError("Test name is required."); return; }
    const markNum = parseInt(maxMark, 10);
    if (!maxMark || isNaN(markNum) || markNum < 1) {
      setError("Total marks must be a positive integer.");
      return;
    }

    const grade_boundaries: Record<string, number> = {};
    for (const row of boundaries) {
      if (!row.label.trim() && !row.pct.trim()) continue;
      if (!row.label.trim()) { setError("Each grade boundary needs a label."); return; }
      const pctNum = parseFloat(row.pct);
      if (isNaN(pctNum) || pctNum < 0 || pctNum > 100) {
        setError(`Boundary "${row.label}" needs a valid percentage (0–100).`);
        return;
      }
      grade_boundaries[row.label.trim()] = pctNum;
    }

    setError(null);
    setLoading(true);

    try {
      interface TestResponse { data: TestDetail }
      const result = await apiFetch<TestResponse>(
        `/api/v1/classes/${classId}/tests/${test.id}`,
        {
          method: "PUT",
          body: {
            name: name.trim(),
            topics,
            max_mark: markNum,
            grade_boundaries,
          },
        }
      );
      onSaved(result.data);
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Failed to save test.");
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-y-auto py-8">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 my-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Edit Test</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div className="px-6 py-5 space-y-5 max-h-[70vh] overflow-y-auto">
            {/* Name */}
            <div>
              <label htmlFor="edit-test-name" className="block text-sm font-medium text-gray-700 mb-1">
                Name <span className="text-red-500">*</span>
              </label>
              <input
                id="edit-test-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition"
              />
            </div>

            {/* Total marks */}
            <div>
              <label htmlFor="edit-test-max-mark" className="block text-sm font-medium text-gray-700 mb-1">
                Total marks <span className="text-red-500">*</span>
              </label>
              <input
                id="edit-test-max-mark"
                type="number"
                min={1}
                step={1}
                value={maxMark}
                onChange={(e) => setMaxMark(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition"
              />
            </div>

            {/* Topics */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Topics covered</label>
              <TagInput tags={topics} onChange={setTopics} placeholder="Type a topic and press Enter" />
            </div>

            {/* Grade boundaries */}
            <div>
              <button
                type="button"
                onClick={() => setShowBoundaries((v) => !v)}
                className="flex items-center gap-1.5 text-sm font-medium text-gray-700 hover:text-gray-900 transition"
              >
                <svg
                  className={`w-4 h-4 transition-transform ${showBoundaries ? "rotate-90" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                Grade boundaries
                <span className="text-xs text-gray-400 font-normal ml-1">(optional)</span>
              </button>

              {showBoundaries && (
                <div className="mt-3 space-y-2">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs text-gray-400">Presets:</span>
                    <button
                      type="button"
                      onClick={() => setBoundaries([
                        { label: "A", pct: "90" },
                        { label: "B", pct: "80" },
                        { label: "C", pct: "70" },
                        { label: "D", pct: "60" },
                        { label: "E", pct: "50" },
                        { label: "F", pct: "0" },
                      ])}
                      className="rounded-full border border-gray-300 px-3 py-1 text-sm text-gray-600 hover:border-indigo-400 hover:text-indigo-600 transition"
                    >
                      A–F
                    </button>
                    <button
                      type="button"
                      onClick={() => setBoundaries([
                        { label: "9", pct: "90" },
                        { label: "8", pct: "80" },
                        { label: "7", pct: "70" },
                        { label: "6", pct: "60" },
                        { label: "5", pct: "50" },
                        { label: "4", pct: "40" },
                        { label: "3", pct: "30" },
                        { label: "2", pct: "20" },
                        { label: "1", pct: "0" },
                      ])}
                      className="rounded-full border border-gray-300 px-3 py-1 text-sm text-gray-600 hover:border-indigo-400 hover:text-indigo-600 transition"
                    >
                      1–9
                    </button>
                  </div>
                  {boundaries.length === 0 && (
                    <p className="text-xs text-gray-400">No boundaries yet. Add one below.</p>
                  )}
                  {boundaries.map((row, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={row.label}
                        onChange={(e) => updateBoundary(idx, "label", e.target.value)}
                        placeholder="Grade (e.g. A)"
                        className="w-28 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition"
                      />
                      <span className="text-sm text-gray-400">&ge;</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={row.pct}
                        onChange={(e) => updateBoundary(idx, "pct", e.target.value)}
                        placeholder="Min %"
                        className="w-24 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition"
                      />
                      <span className="text-xs text-gray-400">%</span>
                      <button
                        type="button"
                        onClick={() => removeBoundary(idx)}
                        className="text-gray-400 hover:text-red-500 transition ml-auto"
                        aria-label="Remove boundary"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addBoundary}
                    className="mt-1 text-xs font-medium text-indigo-600 hover:text-indigo-800 transition"
                  >
                    + Add boundary
                  </button>
                </div>
              )}
            </div>
          </div>

          {error && (
            <div className="mx-6 mb-2 rounded-md bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-700">
              {error}
            </div>
          )}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-md border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !name.trim() || !maxMark}
              className="px-5 py-2 rounded-md bg-indigo-600 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {loading ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Duplicate Test Modal ──────────────────────────────────────────────────────

function DuplicateTestModal({
  classId,
  test,
  onClose,
  onDuplicated,
}: {
  classId: string;
  test: TestDetail;
  onClose: () => void;
  onDuplicated: (newTest: TestDetail & { class_id: string }, targetClassId: string) => void;
}) {
  const [classes, setClasses] = useState<ClassListItem[]>([]);
  const [loadingClasses, setLoadingClasses] = useState(true);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [duplicating, setDuplicating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        interface ClassListResponse { data: ClassListItem[] }
        const result = await apiFetch<ClassListResponse>("/api/v1/classes");
        if (!cancelled) {
          setClasses(result.data.filter((c) => !c.archived));
        }
      } catch {
        if (!cancelled) setError("Failed to load classes.");
      } finally {
        if (!cancelled) setLoadingClasses(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  async function handleDuplicate() {
    if (!selectedClassId) return;
    setDuplicating(true);
    setError(null);
    try {
      interface CopyResponse { data: TestDetail & { class_id: string } }
      const result = await apiFetch<CopyResponse>(`/api/v1/classes/${classId}/tests/copy`, {
        method: "POST",
        body: { testId: test.id, targetClassId: selectedClassId },
      });
      onDuplicated(result.data, selectedClassId);
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Failed to duplicate test.");
      setDuplicating(false);
    }
  }

  const selectedClass = classes.find((c) => c.id === selectedClassId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Duplicate Test</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-gray-600">
            Duplicating <span className="font-medium">&ldquo;{test.name}&rdquo;</span>. Choose a destination class:
          </p>

          {loadingClasses ? (
            <div className="space-y-2 animate-pulse">
              {[1, 2, 3].map((n) => <div key={n} className="h-12 bg-gray-100 rounded-lg" />)}
            </div>
          ) : (
            <div className="space-y-1.5 max-h-60 overflow-y-auto">
              {classes.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedClassId(c.id)}
                  className={`w-full text-left px-4 py-3 rounded-lg border transition ${
                    selectedClassId === c.id
                      ? "border-indigo-500 bg-indigo-50"
                      : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-900">{c.name}</span>
                    {c.id === classId && (
                      <span className="text-xs text-gray-400">(this class)</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {(c.year_group || c.subject) && (
                      <p className="text-xs text-gray-400">
                        {[c.year_group && `Year ${c.year_group}`, c.subject].filter(Boolean).join(" · ")}
                      </p>
                    )}
                    <p className="text-xs text-gray-400">
                      {c._count.students} student{c._count.students !== 1 ? "s" : ""}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-md border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDuplicate}
            disabled={!selectedClassId || duplicating}
            className="px-5 py-2 rounded-md bg-indigo-600 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {duplicating
              ? "Duplicating..."
              : selectedClass
              ? `Duplicate to ${selectedClass.name}`
              : "Duplicate"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TestDetailPage() {
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
  const [toast, setToast] = useState<string | null>(null);

  // Modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);

  // Ref for score inputs to support Tab navigation
  const scoreInputRefs = useRef<Map<number, HTMLInputElement>>(new Map());
  const autoSavingRef = useRef(false);

  // ── Toast helper ────────────────────────────────────────────────────────────

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }

  // ── Initial data load ───────────────────────────────────────────────────────

  useEffect(() => {
    if (!classId || !testId) return;
    let cancelled = false;

    async function load() {
      try {
        const [testResult, classResult, resultsResult] = await Promise.all([
          apiFetch<TestDetailResponse>(`/api/v1/classes/${classId}/tests/${testId}`),
          apiFetch<ClassDetailResponse>(`/api/v1/classes/${classId}`),
          apiFetch<TestResultsResponse>(`/api/v1/tests/${testId}/results`).catch(
            () => ({ data: [] as TestResult[] })
          ),
        ]);

        if (cancelled) return;

        const fetchedTest = testResult.data;
        const fetchedStudents = classResult.data.students;
        const fetchedResults = resultsResult.data;

        const existingMap = new Map<string, TestResult>();
        for (const r of fetchedResults) {
          existingMap.set(r.student_id, r);
        }

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
              commentOpen: false,
              percentage,
              grade,
              dirty: false,
            });
          } else {
            initialResults.set(s.id, {
              scoreInput: "",
              comment: "",
              commentOpen: false,
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
    return () => { cancelled = true; };
  }, [classId, testId, router]);

  // ── Score input change ──────────────────────────────────────────────────────

  const handleScoreChange = useCallback(
    (studentId: string, value: string) => {
      if (!test) return;

      const parsed = parseScoreInput(value);
      let percentage: number | null = null;
      let grade: string | null = null;

      if (parsed !== null) {
        const computed = calculateGrade(parsed, test.max_mark, test.grade_boundaries);
        percentage = computed.percentage;
        grade = computed.grade;
      }

      setResults((prev) => {
        const next = new Map(prev);
        const existing = next.get(studentId);
        if (!existing) return prev;
        next.set(studentId, { ...existing, scoreInput: value, percentage, grade, dirty: true });
        return next;
      });
    },
    [test]
  );

  // ── Comment change ──────────────────────────────────────────────────────────

  const handleCommentChange = useCallback((studentId: string, value: string) => {
    setResults((prev) => {
      const next = new Map(prev);
      const existing = next.get(studentId);
      if (!existing) return prev;
      next.set(studentId, { ...existing, comment: value, dirty: true });
      return next;
    });
  }, []);

  // ── Toggle comment open ─────────────────────────────────────────────────────

  const toggleComment = useCallback((studentId: string) => {
    setResults((prev) => {
      const next = new Map(prev);
      const existing = next.get(studentId);
      if (!existing) return prev;
      next.set(studentId, { ...existing, commentOpen: !existing.commentOpen });
      return next;
    });
  }, []);

  // ── Tab key navigation between score inputs ─────────────────────────────────

  const handleScoreKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>, studentIndex: number) => {
      if (e.key === "Tab" && !e.shiftKey) {
        const nextInput = scoreInputRefs.current.get(studentIndex + 1);
        if (nextInput) {
          e.preventDefault();
          nextInput.focus();
        }
      }
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

        setResults((prev) => {
          const next = new Map(prev);
          for (const { studentId } of rowsToSave) {
            const existing = next.get(studentId);
            if (existing) next.set(studentId, { ...existing, dirty: false });
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

  // ── Save All ────────────────────────────────────────────────────────────────

  const handleSaveAll = useCallback(async () => {
    const dirty: Array<{ studentId: string; row: ResultRow }> = [];
    for (const [studentId, row] of results.entries()) {
      if (row.dirty) dirty.push({ studentId, row });
    }
    if (dirty.length > 0) await saveDirtyRows(dirty);
  }, [results, saveDirtyRows]);

  // ── Edit test saved ─────────────────────────────────────────────────────────

  function handleTestSaved(updated: TestDetail) {
    setTest(updated);
    setShowEditModal(false);
    // Recalculate all existing scores against new boundaries / max_mark
    setResults((prev) => {
      const next = new Map(prev);
      for (const [studentId, row] of prev.entries()) {
        const score = parseScoreInput(row.scoreInput);
        if (score !== null) {
          const { percentage, grade } = calculateGrade(
            score,
            updated.max_mark,
            updated.grade_boundaries
          );
          next.set(studentId, { ...row, percentage, grade });
        }
      }
      return next;
    });
  }

  // ── Duplicate completed ─────────────────────────────────────────────────────

  function handleDuplicated(
    newTest: TestDetail & { class_id: string },
    targetClassId: string
  ) {
    setShowDuplicateModal(false);
    const targetLabel = targetClassId === classId ? "this class" : "the selected class";
    showToast(`"${newTest.name}" duplicated to ${targetLabel}.`);
  }

  // ── Derived state ───────────────────────────────────────────────────────────

  const hasDirty = Array.from(results.values()).some((r) => r.dirty);
  const enteredCount = Array.from(results.values()).filter(
    (r) => r.scoreInput.trim() !== ""
  ).length;
  const hasBoundaries = test ? Object.keys(test.grade_boundaries).length > 0 : false;

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
      {/* Modals */}
      {showEditModal && (
        <EditTestModal
          classId={classId}
          test={test}
          onClose={() => setShowEditModal(false)}
          onSaved={handleTestSaved}
        />
      )}
      {showDuplicateModal && (
        <DuplicateTestModal
          classId={classId}
          test={test}
          onClose={() => setShowDuplicateModal(false)}
          onDuplicated={handleDuplicated}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-gray-900 text-white text-sm px-4 py-2.5 rounded-lg shadow-lg">
          {toast}
        </div>
      )}

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-1.5 text-sm text-gray-500">
            <Link href="/classes" className="hover:text-gray-700">Classes</Link>
            <span>/</span>
            <Link href={`/classes/${classId}`} className="hover:text-gray-700">Class</Link>
            <span>/</span>
            <span className="text-gray-800 font-medium">{test.name}</span>
          </nav>

          <h1 className="text-2xl font-bold text-gray-900">{test.name}</h1>

          {/* Sub-info */}
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

        {/* Action buttons */}
        <div className="flex items-center gap-3 flex-wrap">
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
          <button
            onClick={() => setShowDuplicateModal(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
          >
            Duplicate
          </button>
          <button
            onClick={() => setShowEditModal(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
          >
            Edit
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
                  Mark
                </th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  %
                </th>
                {hasBoundaries && (
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
              {students.map((student, studentIndex) => {
                const row = results.get(student.id);
                if (!row) return null;

                const displayName = student.last_name
                  ? `${student.first_name} ${student.last_name}`
                  : student.first_name;

                const hasComment = row.comment.trim().length > 0;

                return (
                  <React.Fragment key={student.id}>
                    <tr
                      className="hover:bg-gray-50 transition-colors"
                    >
                      {/* Student name */}
                      <td className="px-5 py-3">
                        <span className="font-medium text-gray-800">{displayName}</span>
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

                      {/* Mark input */}
                      <td className="px-5 py-3">
                        <input
                          type="text"
                          ref={(el) => {
                            if (el) scoreInputRefs.current.set(studentIndex, el);
                            else scoreInputRefs.current.delete(studentIndex);
                          }}
                          value={row.scoreInput}
                          onChange={(e) => handleScoreChange(student.id, e.target.value)}
                          onBlur={() => handleBlur(student.id)}
                          onKeyDown={(e) => handleScoreKeyDown(e, studentIndex)}
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

                      {/* Grade */}
                      {hasBoundaries && (
                        <td className="px-5 py-3">
                          <GradeBadge grade={row.grade} />
                        </td>
                      )}

                      {/* Comment button */}
                      <td className="px-5 py-3">
                        <button
                          type="button"
                          onClick={() => toggleComment(student.id)}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium border transition ${
                            row.commentOpen
                              ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                              : hasComment
                              ? "border-gray-300 bg-gray-50 text-gray-700"
                              : "border-gray-200 text-gray-400 hover:border-gray-300 hover:text-gray-600"
                          }`}
                          aria-label={row.commentOpen ? "Hide comment" : "Add comment"}
                        >
                          {/* Comment icon */}
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                          </svg>
                          {hasComment ? (
                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 inline-block" />
                          ) : (
                            <span>Add</span>
                          )}
                        </button>
                      </td>
                    </tr>

                    {/* Inline comment textarea */}
                    {row.commentOpen && (
                      <tr className="bg-gray-50">
                        <td colSpan={hasBoundaries ? 5 : 4} className="px-5 py-3">
                          <textarea
                            value={row.comment}
                            onChange={(e) => handleCommentChange(student.id, e.target.value)}
                            onBlur={() => handleBlur(student.id)}
                            placeholder="Add a comment for this student..."
                            rows={2}
                            className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent resize-none"
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
