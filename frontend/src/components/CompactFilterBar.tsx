"use client";

/**
 * CompactFilterBar — extracted shared component.
 *
 * Primary row (always visible ~48px):
 *   Tone pills (left 50%) | Disciplines list + Add (right 50%) | [Filters ▼]
 *
 * Expansion panel: three columns — Tests | Progression | Class Overview
 *
 * All filter changes are forwarded to onSave immediately (caller may debounce).
 *
 * Prop interfaces are intentionally minimal so both the session detail page and
 * the review page can pass their own session/discipline types without extra casting.
 */

import { useState, useEffect, useRef } from "react";

// ── Shared types ───────────────────────────────────────────────────────────────

export interface TestFilterState {
  includeMark: boolean;
  includePercentage: boolean;
  includeGrade: boolean;
  includeLowMention: boolean;
}

// UI-only: adds "included" per-test tracking
export interface LocalTestFilterState extends TestFilterState {
  included: boolean;
}

export interface ClassTest {
  id: string;
  name: string;
  max_mark: number;
  topics: string[];
  _count: { results: number };
}

export interface MatchedDisciplineProgression {
  name: string;
  currentScore: number;
  previousScore: number;
  trend: "improved" | "declined" | "maintained";
}

export interface ProgressionData {
  previousSession: { id: string; name: string; completed_at: string } | null;
  matchedDisciplines: MatchedDisciplineProgression[];
}

// Minimal session shape required by CompactFilterBar
export interface FilterBarSession {
  tone: string;
  test_filters: Record<string, TestFilterState> | null;
  progression_filters: string[];
  enable_progression: boolean;
  allow_negative_progression: boolean;
  class_overview: string | null;
}

// Minimal discipline shape required by CompactFilterBar
export interface FilterBarDiscipline {
  id: string;
  name: string;
}

// Patch shape forwarded to onSave
export type FilterBarPatch = Partial<
  Pick<
    FilterBarSession,
    | "tone"
    | "test_filters"
    | "progression_filters"
    | "enable_progression"
    | "allow_negative_progression"
    | "class_overview"
  >
>;

// Internal state
interface FilterBarState {
  tone: "gentle" | "balanced" | "direct";
  testFilters: Record<string, LocalTestFilterState>;
  enableProgression: boolean;
  allowNegativeProgression: boolean;
  progressionDisciplines: string[];
  classOverview: string;
}

// ── SelectTestsModal ───────────────────────────────────────────────────────────

function SelectTestsModal({
  classTests,
  currentTestFilters,
  onClose,
  onDone,
}: {
  classTests: ClassTest[];
  currentTestFilters: Record<string, LocalTestFilterState>;
  onClose: () => void;
  onDone: (selectedIds: Set<string>) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const [id, tf] of Object.entries(currentTestFilters)) {
      if (tf.included) initial.add(id);
    }
    return initial;
  });

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-1">
          Add Tests to This Report Session
        </h2>
        <p className="text-xs text-gray-400 mb-4">
          Select which tests to include in generated reports.
        </p>
        {classTests.length === 0 ? (
          <p className="text-sm text-gray-400 italic py-4 text-center">
            No tests found for this class.
          </p>
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {classTests.map((test) => (
              <label
                key={test.id}
                className="flex items-center gap-3 cursor-pointer rounded-md px-3 py-2 hover:bg-gray-50 transition"
              >
                <input
                  type="checkbox"
                  checked={selected.has(test.id)}
                  onChange={() => toggle(test.id)}
                  className="accent-indigo-600 w-4 h-4 shrink-0"
                />
                <span className="text-sm text-gray-700 flex-1">{test.name}</span>
                <span className="text-xs text-gray-400 shrink-0">{test.max_mark} max</span>
              </label>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-3 mt-5">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-md border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
          >
            Cancel
          </button>
          <button
            onClick={() => onDone(selected)}
            className="px-4 py-2 rounded-md bg-indigo-600 text-sm font-semibold text-white hover:bg-indigo-700 transition"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ── CompactFilterBar ───────────────────────────────────────────────────────────

export default function CompactFilterBar({
  session,
  disciplines,
  classTests,
  progressionData,
  onSave,
  onAddDiscipline,
  isReadOnly = false,
}: {
  session: FilterBarSession;
  disciplines: FilterBarDiscipline[];
  classTests: ClassTest[];
  progressionData: ProgressionData | null;
  onSave: (patch: FilterBarPatch) => void;
  onAddDiscipline?: () => void;
  isReadOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [testsExpandedRaw, setTestsExpandedRaw] = useState(false);
  const [showSelectTests, setShowSelectTests] = useState(false);

  // Local filter state — synced from session on mount
  const [filterState, setFilterState] = useState<FilterBarState>(() => {
    if (!session) {
      return { tone: "balanced", testFilters: {}, enableProgression: true, allowNegativeProgression: true, progressionDisciplines: [], classOverview: "" };
    }
    const savedFilters = session.test_filters ?? {};
    const testFilters: Record<string, LocalTestFilterState> = {};
    for (const test of classTests) {
      const saved = savedFilters[test.id];
      testFilters[test.id] = {
        included: saved !== undefined,
        includeMark: saved?.includeMark ?? false,
        includePercentage: saved?.includePercentage ?? true,
        includeGrade: saved?.includeGrade ?? false,
        includeLowMention: saved?.includeLowMention ?? false,
      };
    }
    return {
      tone: (session.tone as "gentle" | "balanced" | "direct") ?? "balanced",
      testFilters,
      enableProgression: session.enable_progression ?? true,
      allowNegativeProgression: session.allow_negative_progression ?? true,
      progressionDisciplines: session.progression_filters ?? [],
      classOverview: session.class_overview ?? "",
    };
  });

  // Derive active test count early so we can use it for the lock
  const activeTestCount = Object.values(filterState.testFilters).filter(
    (tf) => tf.included
  ).length;

  // testsExpanded is locked open whenever tests exist — raw state only takes
  // effect when no tests are added.
  const testsExpanded = activeTestCount > 0 ? true : testsExpandedRaw;
  function setTestsExpanded(val: boolean | ((prev: boolean) => boolean)) {
    // Do not collapse while tests exist
    if (activeTestCount > 0) return;
    setTestsExpandedRaw(val);
  }

  // Sync tone from session when it changes externally
  useEffect(() => {
    if (!session) return;
    setFilterState((prev) => ({
      ...prev,
      tone: (session.tone as "gentle" | "balanced" | "direct") ?? "balanced",
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.tone]);

  // Sync classTests into testFilters when tests load
  useEffect(() => {
    if (!session) return;
    setFilterState((prev) => {
      const saved = session.test_filters ?? {};
      const merged = { ...prev.testFilters };
      for (const test of classTests) {
        if (!merged[test.id]) {
          const s = saved[test.id];
          merged[test.id] = {
            included: s !== undefined,
            includeMark: s?.includeMark ?? false,
            includePercentage: s?.includePercentage ?? true,
            includeGrade: s?.includeGrade ?? false,
            includeLowMention: s?.includeLowMention ?? false,
          };
        }
      }
      return { ...prev, testFilters: merged };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classTests.length]);

  // Class overview debounce ref
  const overviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Guard: if session is null/undefined, render a minimal loading state (all hooks are above)
  if (!session) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4 animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-24 mb-2" />
        <div className="h-6 bg-gray-200 rounded w-32" />
      </div>
    );
  }

  // ── Tone ──
  function handleToneChange(t: "gentle" | "balanced" | "direct") {
    setFilterState((prev) => ({ ...prev, tone: t }));
    onSave({ tone: t });
  }

  // ── Test filter ──
  function handleTestFilterChange(
    testId: string,
    field: keyof LocalTestFilterState,
    value: boolean
  ) {
    setFilterState((prev) => {
      const current: LocalTestFilterState = prev.testFilters[testId] ?? {
        included: false,
        includeMark: false,
        includePercentage: true,
        includeGrade: false,
        includeLowMention: false,
      };
      const updated: Record<string, LocalTestFilterState> = {
        ...prev.testFilters,
        [testId]: { ...current, [field]: value },
      };
      return { ...prev, testFilters: updated };
    });
    // Build forSave from current filterState snapshot (captured in closure).
    const currentFilters = filterState.testFilters;
    const currentEntry: LocalTestFilterState = currentFilters[testId] ?? {
      included: false,
      includeMark: false,
      includePercentage: true,
      includeGrade: false,
      includeLowMention: false,
    };
    const updatedForSave: Record<string, LocalTestFilterState> = {
      ...currentFilters,
      [testId]: { ...currentEntry, [field]: value },
    };
    const forSave: Record<string, TestFilterState> = {};
    for (const [id, tf] of Object.entries(updatedForSave)) {
      if (tf.included) {
        forSave[id] = {
          includeMark: tf.includeMark,
          includePercentage: tf.includePercentage,
          includeGrade: tf.includeGrade,
          includeLowMention: tf.includeLowMention,
        };
      }
    }
    onSave({ test_filters: forSave });
  }

  // ── Select-tests modal done ──
  function handleSelectTestsDone(selectedIds: Set<string>) {
    setShowSelectTests(false);
    const updatedFilters: Record<string, LocalTestFilterState> = {
      ...filterState.testFilters,
    };
    for (const test of classTests) {
      const current = updatedFilters[test.id] ?? {
        included: false,
        includeMark: false,
        includePercentage: true,
        includeGrade: false,
        includeLowMention: false,
      };
      updatedFilters[test.id] = {
        ...current,
        included: selectedIds.has(test.id),
      };
    }
    const forSave: Record<string, TestFilterState> = {};
    for (const [id, tf] of Object.entries(updatedFilters)) {
      if (tf.included) {
        forSave[id] = {
          includeMark: tf.includeMark,
          includePercentage: tf.includePercentage,
          includeGrade: tf.includeGrade,
          includeLowMention: tf.includeLowMention,
        };
      }
    }
    setFilterState((prev) => ({ ...prev, testFilters: updatedFilters }));
    onSave({ test_filters: forSave });
  }

  // ── Progression toggles ──
  function handleEnableProgressionChange(val: boolean) {
    setFilterState((prev) => ({ ...prev, enableProgression: val }));
    onSave({ enable_progression: val });
  }

  function handleAllowNegativeChange(val: boolean) {
    setFilterState((prev) => ({ ...prev, allowNegativeProgression: val }));
    onSave({ allow_negative_progression: val });
  }

  function handleProgressionDisciplineToggle(name: string) {
    const set = new Set(filterState.progressionDisciplines);
    if (set.has(name)) set.delete(name);
    else set.add(name);
    const arr = Array.from(set);
    setFilterState((prev) => ({ ...prev, progressionDisciplines: arr }));
    onSave({ progression_filters: arr });
  }

  // ── Class overview ──
  function handleOverviewChange(val: string) {
    setFilterState((prev) => ({ ...prev, classOverview: val }));
    if (overviewTimerRef.current) clearTimeout(overviewTimerRef.current);
    overviewTimerRef.current = setTimeout(() => {
      onSave({ class_overview: val.trim() || null });
    }, 600);
  }

  const matchedDisciplines = progressionData?.previousSession
    ? progressionData.matchedDisciplines
    : [];
  const hasProgression = matchedDisciplines.length > 0;

  const TONE_HINTS: Record<"gentle" | "balanced" | "direct", string> = {
    gentle: "Positive language, focuses on strengths and growth areas",
    balanced: "Mix of praise and constructive feedback",
    direct: "Clear strengths + direct areas for improvement",
  };

  // Included test ids for compact row display
  const includedTests = classTests.filter(
    (t) => filterState.testFilters[t.id]?.included
  );

  return (
    <div className="relative mb-3">
      {/* Select Tests Modal */}
      {showSelectTests && (
        <SelectTestsModal
          classTests={classTests}
          currentTestFilters={filterState.testFilters}
          onClose={() => setShowSelectTests(false)}
          onDone={handleSelectTestsDone}
        />
      )}

      {/* Primary row — full width split: Tone (50%) | Disciplines (50%) + toggle */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm px-4 py-2 flex items-center w-full">
        {/* Tone section — left half */}
        <div className="w-1/2 pr-4 border-r border-gray-100 flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-400 shrink-0">Tone:</span>
          {(["gentle", "balanced", "direct"] as const).map((t, idx) => (
            <div key={t} className="relative group" style={{ isolation: "isolate" }}>
              <button
                onClick={() => handleToneChange(t)}
                disabled={isReadOnly}
                title={TONE_HINTS[t]}
                className={`h-14 px-5 rounded-full text-sm font-medium transition border ${
                  filterState.tone === t
                    ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                    : "border-gray-200 text-gray-400 hover:border-gray-300 hover:text-gray-600"
                }`}
              >
                {filterState.tone === t ? "●" : "○"}{" "}
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
              {/* Index 0 (Gentle) anchors to left edge to avoid sidebar clipping;
                  all other pills use centered positioning */}
              <span
                className={`absolute bottom-full mb-2 hidden group-hover:block bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap pointer-events-none ${
                  idx === 0
                    ? "left-0"
                    : "left-1/2 -translate-x-1/2"
                }`}
                style={{ zIndex: 9999 }}
              >
                {TONE_HINTS[t]}
              </span>
            </div>
          ))}
        </div>

        {/* Disciplines section — right half + toggle */}
        <div className="w-1/2 pl-4 flex items-center gap-2 min-w-0">
          <span className="text-xs text-gray-400 shrink-0">Disciplines:</span>
          <div className="flex flex-wrap gap-x-1.5 gap-y-1 items-center flex-1 min-w-0">
            {disciplines.length === 0 ? (
              <span className="text-xs text-gray-400">None</span>
            ) : (
              disciplines.map((d) => (
                <span
                  key={d.id}
                  className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700 whitespace-normal break-words max-w-none"
                >
                  {d.name}
                </span>
              ))
            )}
            {!isReadOnly && onAddDiscipline && (
              <button
                onClick={onAddDiscipline}
                className="text-xs text-indigo-500 hover:text-indigo-700 font-medium transition shrink-0 whitespace-nowrap"
              >
                + Add Discipline
              </button>
            )}
          </div>
          {/* Filters toggle */}
          <button
            onClick={() => setOpen((v) => !v)}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium border transition shrink-0 ${
              open
                ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                : "border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700"
            }`}
          >
            {activeTestCount > 0 ||
            filterState.enableProgression ||
            filterState.classOverview ? (
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-indigo-500" />
            ) : null}
            Filters
            <svg
              className={`w-3 h-3 transition-transform ${
                open ? "rotate-180" : ""
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Expansion panel */}
      {open && (
        <div className="mt-1 bg-white rounded-lg border border-gray-200 shadow-md p-4 grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-gray-100 gap-0">
          {/* LEFT — Tests */}
          <div className="pb-4 md:pb-0 md:pr-4">
            {/* Collapsible header — locked open when tests exist */}
            <button
              onClick={() => setTestsExpanded((v) => !v)}
              disabled={activeTestCount > 0}
              className="flex items-center justify-between w-full mb-2 group"
            >
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Tests – include in reports
                {activeTestCount > 0 && (
                  <span className="ml-1.5 inline-flex items-center rounded-full bg-indigo-100 px-1.5 py-0.5 text-xs font-medium text-indigo-600 normal-case">
                    {activeTestCount}
                  </span>
                )}
              </h3>
              <svg
                className={`w-3.5 h-3.5 text-gray-400 transition-transform ${
                  testsExpanded ? "rotate-180" : ""
                } ${activeTestCount > 0 ? "opacity-0 pointer-events-none" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>

            {/* Collapsed summary */}
            {!testsExpanded && (
              <p className="text-xs text-gray-400 italic">
                {activeTestCount === 0
                  ? "No tests added."
                  : `${activeTestCount} test${activeTestCount === 1 ? "" : "s"} included.`}
              </p>
            )}

            {/* Expanded content */}
            {testsExpanded && (
              <div className="space-y-2">
                {includedTests.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">
                    No tests added yet.
                  </p>
                ) : (
                  includedTests.map((test) => {
                    const tf = filterState.testFilters[test.id]!;
                    return (
                      <div
                        key={test.id}
                        className="border border-gray-100 rounded-md p-2"
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-medium text-gray-700">
                            {test.name}
                            <span className="ml-1.5 text-gray-400 font-normal">
                              ({test.max_mark} max)
                            </span>
                          </span>
                          {!isReadOnly && (
                            <button
                              onClick={() => {
                                // Remove this test from included
                                const next = new Set(
                                  Object.keys(filterState.testFilters).filter(
                                    (id) => filterState.testFilters[id]?.included && id !== test.id
                                  )
                                );
                                handleSelectTestsDone(next);
                              }}
                              className="text-gray-300 hover:text-red-400 transition ml-2 shrink-0"
                              title="Remove test"
                            >
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {(
                            [
                              {
                                key: "includeMark" as const,
                                label: "Mark",
                                hint: undefined as string | undefined,
                              },
                              {
                                key: "includePercentage" as const,
                                label: "%",
                                hint: undefined as string | undefined,
                              },
                              {
                                key: "includeGrade" as const,
                                label: "Grade",
                                hint: undefined as string | undefined,
                              },
                              {
                                key: "includeLowMention" as const,
                                label: "Low score",
                                hint: "Add a comment for students scoring under 40%" as
                                  | string
                                  | undefined,
                              },
                            ]
                          ).map(({ key, label, hint }) => (
                            <label
                              key={key}
                              className="flex items-center gap-1 cursor-pointer group/cb"
                            >
                              <input
                                type="checkbox"
                                checked={tf[key]}
                                onChange={(e) =>
                                  handleTestFilterChange(
                                    test.id,
                                    key,
                                    e.target.checked
                                  )
                                }
                                disabled={isReadOnly}
                                className="accent-indigo-600 w-3 h-3"
                              />
                              <span className="text-xs text-gray-600">
                                {label}
                              </span>
                              {hint && (
                                <span className="relative">
                                  <svg
                                    className="w-3 h-3 text-gray-300 group-hover/cb:text-gray-500 transition"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                    strokeWidth={2}
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                                    />
                                  </svg>
                                  <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover/cb:block bg-gray-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap z-50 pointer-events-none w-48 text-center">
                                    {hint}
                                  </span>
                                </span>
                              )}
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })
                )}
                {!isReadOnly && (
                  <button
                    onClick={() => setShowSelectTests(true)}
                    className="text-xs text-indigo-500 hover:text-indigo-700 font-medium transition"
                  >
                    + Add test
                  </button>
                )}
              </div>
            )}

            {/* Always-visible "+ Add test" when collapsed */}
            {!testsExpanded && !isReadOnly && (
              <button
                onClick={() => {
                  setTestsExpanded(true);
                  setShowSelectTests(true);
                }}
                className="text-xs text-indigo-500 hover:text-indigo-700 font-medium transition mt-1 block"
              >
                + Add test
              </button>
            )}
          </div>

          {/* MIDDLE — Progression */}
          <div className="py-4 md:py-0 md:px-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Progression Since Last Report
            </h3>
            {!progressionData?.previousSession ? (
              <p className="text-xs text-gray-400 italic">
                No previous session found.
              </p>
            ) : (
              <div className="space-y-1.5">
                {/* Master enable toggle */}
                <label
                  className={`flex items-center gap-2 cursor-pointer pb-2 mb-1 border-b border-gray-100 ${
                    isReadOnly ? "opacity-40 pointer-events-none" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={filterState.enableProgression}
                    onChange={(e) =>
                      handleEnableProgressionChange(e.target.checked)
                    }
                    disabled={isReadOnly}
                    className="accent-indigo-600 w-3.5 h-3.5"
                  />
                  <span className="text-xs font-medium text-gray-700">
                    Include progression in reports
                  </span>
                </label>

                {/* Per-discipline checkboxes — only relevant when enabled */}
                <div
                  className={
                    filterState.enableProgression
                      ? ""
                      : "opacity-40 pointer-events-none"
                  }
                >
                  {!hasProgression ? (
                    <p className="text-xs text-gray-400 italic">
                      No matched disciplines vs.{" "}
                      {progressionData.previousSession.name}.
                    </p>
                  ) : (
                    matchedDisciplines.map((disc) => {
                      const isIncluded =
                        filterState.progressionDisciplines.includes(disc.name);
                      const trendColor =
                        disc.trend === "improved"
                          ? "text-green-600"
                          : disc.trend === "declined"
                          ? "text-red-500"
                          : "text-gray-400";
                      const trendIcon =
                        disc.trend === "improved"
                          ? "↑"
                          : disc.trend === "declined"
                          ? "↓"
                          : "=";
                      return (
                        <label
                          key={disc.name}
                          className="flex items-center gap-2 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={isIncluded}
                            onChange={() =>
                              handleProgressionDisciplineToggle(disc.name)
                            }
                            disabled={isReadOnly || !filterState.enableProgression}
                            className="accent-indigo-600 w-3.5 h-3.5"
                          />
                          <span className="text-xs text-gray-700">
                            {disc.name}
                          </span>
                          <span className={`text-xs font-bold ${trendColor}`}>
                            {trendIcon}
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>

                {/* Allow negative toggle — only relevant when progression is enabled */}
                <label
                  className={`flex items-center gap-2 cursor-pointer pt-2 mt-1 border-t border-gray-100 ${
                    isReadOnly || !filterState.enableProgression
                      ? "opacity-40 pointer-events-none"
                      : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={filterState.allowNegativeProgression}
                    onChange={(e) =>
                      handleAllowNegativeChange(e.target.checked)
                    }
                    disabled={isReadOnly || !filterState.enableProgression}
                    className="accent-indigo-600 w-3.5 h-3.5"
                  />
                  <span className="text-xs text-gray-600">
                    Include negative progression comments
                  </span>
                </label>
              </div>
            )}
          </div>

          {/* RIGHT — Class Overview */}
          <div className="pt-4 md:pt-0 md:pl-4">
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Class Overview
            </label>
            <textarea
              value={filterState.classOverview}
              onChange={(e) => handleOverviewChange(e.target.value)}
              onBlur={() =>
                onSave({
                  class_overview: filterState.classOverview.trim() || null,
                })
              }
              placeholder="Add class-wide context for all reports..."
              rows={3}
              maxLength={500}
              disabled={isReadOnly}
              className="mt-1 w-full text-sm border border-gray-200 rounded-md px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-60 disabled:bg-gray-50"
            />
            <p className="text-xs text-gray-400 text-right mt-0.5">
              {filterState.classOverview.length} / 500
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
