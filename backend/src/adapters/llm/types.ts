/**
 * Shared types for all LLM adapters.
 *
 * ReportPrompt contains ONLY the privacy-safe fields permitted by the
 * privacy policy: first_name, gender, aggregated rating summary, topics, tone,
 * and length. No last names, birthdates, org names, or any other PII.
 */

export type ReportLength = "short" | "medium" | "long";

/** Map length enum to approximate word count target. */
export const LENGTH_WORD_COUNT: Record<ReportLength, number> = {
  short: 100,
  medium: 200,
  long: 350,
};

/**
 * A single discipline trend entry for historical progression context.
 * Contains only discipline name, trend direction, and numeric scores.
 * No PII — purely pedagogical signal for the LLM.
 */
export interface ProgressionItem {
  name: string;
  trend: "improved" | "declined" | "maintained";
  previous: number;
  current: number;
}

/**
 * A single test result item to include in the prompt.
 * Only non-PII academic data — test name, percentage, grade.
 */
export interface TestContextItem {
  testName: string;
  /** Percentage score, e.g. 72. Present when includeMark or includePercentage is enabled. */
  percentage?: number;
  /** Grade letter, e.g. "B". Present when includeGrade is enabled and boundaries are set. */
  grade?: string | null;
  /** When true, the prompt explicitly asks the LLM to acknowledge the low score. */
  lowMention?: boolean;
}

/**
 * The complete payload passed to prompt-builder and then to the LLM.
 * Every field is explicitly allow-listed — add nothing else here.
 *
 * Privacy contract: first_name, gender, ratingSummary, topics, tone, length,
 * optional topicRatings (score per topic — no PII), optional progression
 * (historical discipline trends — scores only, no PII), and optional
 * testContext (test name + percentage/grade — no PII). Nothing else.
 */
export interface ReportPrompt {
  firstName: string;
  gender: string;
  /** Pre-formatted rating summary: e.g. "Behaviour: 4/5, Homework: 3/5 (needs reminders)" */
  ratingSummary: string;
  /** Topics covered in the class, e.g. ["photosynthesis", "cell division"] */
  topics: string[];
  tone: string;
  length: ReportLength;
  /**
   * Optional per-topic scores (1–5). When present, prompt builder uses scored
   * section instead of a plain topic list. No PII — topic names and scores only.
   */
  topicRatings?: Array<{ topicName: string; score: number }>;
  /**
   * Optional historical progression data (previous → current scores per discipline).
   * When present, prompt builder appends a progression context section.
   * No PII — discipline names and numeric scores only.
   */
  progression?: ProgressionItem[];
  /**
   * Optional test results context. When present, each item is appended as a
   * context line before the CRITICAL INSTRUCTIONS block so the LLM can
   * reference the test score naturally in the report.
   */
  testContext?: TestContextItem[];
}

/**
 * Unified interface every LLM adapter must implement.
 * The factory selects the concrete implementation at runtime.
 */
export interface LLMAdapter {
  /** Generate a student report and return the raw text response. */
  generateReport(prompt: ReportPrompt): Promise<string>;
  /** Ping the provider API to confirm credentials are valid. */
  validateConnection(): Promise<boolean>;
}
