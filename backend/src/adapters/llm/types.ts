/**
 * Shared types for all LLM adapters and prompt builders.
 *
 * ReportPrompt contains ONLY the privacy-safe fields permitted by the
 * privacy policy: firstName, gender, raw ratings, topics, tone, length,
 * and optional topicRatings, progression, and testContext. No last names,
 * birthdates, org names, or any other PII.
 */

export type ReportLength = "short" | "medium" | "long";

/** Target word count surfaced to the user. */
export const LENGTH_WORD_COUNT: Record<ReportLength, number> = {
  short: 100,
  medium: 200,
  long: 350,
};

/** Min/max word range used in the internal prompt. */
export const LENGTH_WORD_RANGE: Record<ReportLength, { min: number; max: number }> = {
  short: { min: 85, max: 115 },
  medium: { min: 180, max: 220 },
  long: { min: 320, max: 380 },
};

/**
 * A single discipline rating entry. Passed raw to the prompt builder so
 * the student block can list named disciplines with scores.
 * No PII — discipline names and scores only.
 */
export interface RawRating {
  name: string;
  score: number;
  comment?: string | null;
}

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
 * Only non-PII academic data — test name, percentage, grade, or mark.
 * Exactly which fields are set is determined by the session's test_filters.
 */
export interface TestContextItem {
  testName: string;
  /** Percentage score, e.g. 72. Set when includePercentage is enabled. */
  percentage?: number;
  /** Grade letter, e.g. "B". Set when includeGrade is enabled. */
  grade?: string | null;
  /** Raw mark string, e.g. "14/20". Set when includeMark is enabled. */
  mark?: string;
  /** When true, prompt acknowledges low score if percentage < 60. */
  lowMention?: boolean;
}

/**
 * The complete payload passed to the prompt builder for individual mode.
 * Every field is explicitly allow-listed — add nothing else here.
 */
export interface ReportPrompt {
  firstName: string;
  gender: string;
  /** Raw discipline ratings — name, score, optional teacher comment. */
  ratings: RawRating[];
  /** Topics covered in the class, e.g. ["photosynthesis", "cell division"] */
  topics: string[];
  tone: string;
  length: ReportLength;
  /**
   * Pre-computed Rule 6 instruction derived from the session's test_filters
   * config. Set by the caller (service/route) using resolveTestInstructionFromConfig.
   * When set, takes precedence over derivation from testContext items.
   * null = no tests configured; omit Rule 6 entirely.
   */
  testInstruction?: string | null;
  /** Optional free-text note injected into the student block (e.g. class overview, custom regeneration note). */
  contextNote?: string;
  /**
   * Optional per-topic scores (1–5). When present, student block uses
   * quality labels instead of plain topic names.
   */
  topicRatings?: Array<{ topicName: string; score: number }>;
  /**
   * Optional historical progression data (previous → current per discipline).
   * When present, appended as a progression section in the student block.
   */
  progression?: ProgressionItem[];
  /**
   * Optional test results. When present, a Tests section is added to the
   * student block and Rule 6 is injected into the header.
   */
  testContext?: TestContextItem[];
}

/**
 * Per-student payload for batch prompt assembly.
 * Same fields as ReportPrompt minus tone/length (those come from BatchSessionConfig).
 */
export interface BatchStudentPayload {
  id: string;
  firstName: string;
  gender: string;
  ratings: RawRating[];
  topics: string[];
  topicRatings?: Array<{ topicName: string; score: number }>;
  testContext?: TestContextItem[];
  progression?: ProgressionItem[];
}

/** Session-level config shared across all students in a batch. */
export interface BatchSessionConfig {
  tone: string;
  length: ReportLength;
  /**
   * Pre-computed Rule 6 instruction from resolveTestInstructionFromConfig.
   * null = no tests configured; omit Rule 6 entirely.
   */
  testInstruction: string | null;
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
