/**
 * Frontend mirror of backend/src/adapters/llm/prompt-builder.ts
 *
 * Used by the Free AI Model panel to produce a prompt identical to what the
 * paid LLM path sends to OpenAI/Claude. Keep this in sync with the backend
 * whenever prompt-builder.ts changes.
 *
 * Privacy contract (same as backend):
 *   - Only firstName, gender, ratingSummary, topics, tone, length enter the prompt.
 *   - NO last names, student IDs, parent info, or other PII.
 */

export type ReportLength = "short" | "medium" | "long";

const LENGTH_WORD_COUNT: Record<ReportLength, number> = {
  short: 100,
  medium: 200,
  long: 350,
};

export interface ProgressionItem {
  name: string;
  trend: "improved" | "declined" | "maintained";
  previous: number;
  current: number;
}

export interface FreeModelPromptInput {
  firstName: string;
  gender: string | null | undefined;
  /** Pre-formatted: "Behaviour: 4/5, Homework: 3/5 (needs reminders)" */
  ratingSummary: string;
  topics: string[];
  tone: string;
  length: string;
  topicRatings?: Array<{ topicName: string; score: number }>;
  progression?: ProgressionItem[];
}

/**
 * Format a raw ratings array into the allow-listed summary string.
 * Mirrors backend formatRatingSummary() exactly.
 */
export function formatRatingSummary(
  ratings: Array<{ disciplineName: string; score: number; comment?: string | null }>
): string {
  return ratings
    .map((r) => {
      const base = `${r.disciplineName}: ${r.score}/5`;
      return r.comment ? `${base} (${r.comment})` : base;
    })
    .join(", ");
}

function resolvePronouns(gender: string | null | undefined): string {
  switch (gender?.toUpperCase()) {
    case "M":  return "He/Him (use he, his, him)";
    case "F":  return "She/Her (use she, her, hers)";
    case "N":  return "They/Them (use they, their, them)";
    default:   return "They/Them (use they, their, them)";
  }
}

function scoreToDescriptor(score: number): string {
  if (score >= 5) return "excellent";
  if (score >= 4) return "good";
  if (score >= 3) return "satisfactory";
  if (score >= 2) return "developing";
  return "needs support";
}

function scoreToTopicQuality(score: number): string {
  if (score >= 5) return "exceptional understanding";
  if (score >= 4) return "strong grasp";
  if (score >= 3) return "developing understanding";
  if (score >= 2) return "requires further focus";
  return "needs significant support";
}

function trendPhrase(item: ProgressionItem, tone: string): string {
  const { name, trend, previous, current } = item;
  const toneKey = tone.toLowerCase();

  if (trend === "improved") {
    if (toneKey === "gentle") return `${name}: shows positive development (${previous} to ${current})`;
    if (toneKey === "direct") return `${name}: rating improved from ${previous} to ${current}`;
    return `${name}: improved from ${previous} to ${current}`;
  }
  if (trend === "declined") {
    if (toneKey === "gentle") return `${name}: has found some challenge in this area (${previous} to ${current})`;
    if (toneKey === "direct") return `${name}: rating declined from ${previous} to ${current}`;
    return `${name}: declined from ${previous} to ${current}`;
  }
  // maintained
  if (toneKey === "gentle") return `${name}: has continued to demonstrate consistent performance at ${current}`;
  if (toneKey === "direct") return `${name}: maintained at ${current}`;
  return `${name}: maintained at ${current}`;
}

function buildProgressionSection(progression: ProgressionItem[], tone: string): string {
  const lines = progression.map((item) => trendPhrase(item, tone));
  return [
    `Historical progression (reference only the following disciplines):`,
    ...lines,
    ``,
    `Incorporate these trends naturally into the Strengths / Areas to Improve sections. Use phrasing appropriate to the selected report tone. Do NOT quote numeric scores from this section literally — convert them to qualitative language.`,
  ].join("\n");
}

/**
 * Build the LLM prompt from a FreeModelPromptInput.
 * Output is identical to the backend buildPrompt() for the same inputs.
 */
export function buildFreeModelPrompt(payload: FreeModelPromptInput): string {
  const wordCount = LENGTH_WORD_COUNT[payload.length as ReportLength] ?? 200;

  const hasTopicRatings =
    payload.topicRatings !== undefined && payload.topicRatings.length > 0;

  const topicsLine = (() => {
    if (!hasTopicRatings) {
      return payload.topics.length > 0
        ? payload.topics.join(", ")
        : "general curriculum topics";
    }
    const scoredLines = (payload.topicRatings as Array<{ topicName: string; score: number }>)
      .map((tr) => `${tr.topicName}: ${scoreToTopicQuality(tr.score)}`)
      .join("\n");
    return `Topic performance:\n${scoredLines}`;
  })();

  const performanceLevel = (() => {
    const scores = payload.ratingSummary
      .split(",")
      .map((part) => {
        const match = part.match(/(\d+)\/5/);
        return match ? parseInt(match[1], 10) : null;
      })
      .filter((s): s is number => s !== null);

    if (scores.length === 0) return "satisfactory";
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    return scoreToDescriptor(Math.round(avg));
  })();

  const teacherNotes = payload.ratingSummary
    .split(",")
    .map((part) => {
      const match = part.match(/\(([^)]+)\)/);
      return match ? match[1].trim() : null;
    })
    .filter((n): n is string => n !== null && n.length > 0);

  const notesLine =
    teacherNotes.length > 0
      ? `Teacher notes to incorporate (do NOT quote verbatim): ${teacherNotes.join("; ")}`
      : "";

  const lines: string[] = [
    `You are writing a school report card comment for a student named ${payload.firstName}.`,
    `Pronouns: ${resolvePronouns(payload.gender)}.`,
    `Overall performance level: ${performanceLevel}.`,
    hasTopicRatings ? topicsLine : `Topics covered this term: ${topicsLine}.`,
    notesLine,
    ``,
    `CRITICAL INSTRUCTIONS — you MUST follow these exactly:`,
    `1. Write approximately ${wordCount} words total. No bullet points.`,
    `2. Tone: ${payload.tone}. ${
      payload.tone === "gentle"
        ? "Use warm, supportive language. Frame challenges softly and celebrate effort."
        : payload.tone === "direct"
        ? "Use clear, precise language. State observations plainly without softening."
        : "Balance honesty and encouragement. Be factual but constructive."
    }`,
    `3. Do NOT output a title, heading, or subject line of any kind. Start directly with the report text.`,
    `4. NEVER mention any numeric score, rating, or number (e.g. "4 out of 5", "80%", "scored highly").`,
    `5. NEVER mention the names of assessment categories or disciplines (e.g. do not write "Behaviour", "Homework", "Participation", or any other category label).`,
    `6. Express performance qualitatively using natural language tied to specific observations — not generic phrases.`,
    `7. Include 1–2 specific references to topics covered.`,
    ...(hasTopicRatings
      ? [
          `7b. Topic performance ratings are provided. Write paragraph 2 referencing topics individually where scores differ notably. Where a student scored higher on one topic than another, acknowledge the contrast naturally in prose. Never mention scores or numbers.`,
        ]
      : []),
    `8. Structure the report in 2–3 short paragraphs separated by blank lines. NEVER write as a single block of text.`,
    `   - Paragraph 1: Overall character, attitude, and engagement in class.`,
    `   - Paragraph 2: Academic performance with specific topic references.`,
    `   - Paragraph 3 (include for medium/long reports only): Progress made and what to focus on going forward — written as a specific, grounded observation, not a platitude.`,
    `9. Use the pronouns specified above consistently throughout the entire report. Never switch pronouns mid-report.`,
    `10. No sign-off, greeting, or closing line.`,
    `11. BANNED phrases — never use any of these, replace with specific observations grounded in topics or context:`,
    `    "making good progress" | "paying dividends" | "opportunity to apply themselves"`,
    `    "I look forward to seeing" | "shows great potential" | "valuable contribution to the learning environment"`,
    `    "when given the opportunity" | "it is clear that" | "goes without saying"`,
  ].filter((l) => l !== undefined);

  const hasProgression =
    payload.progression !== undefined && payload.progression.length > 0;
  if (hasProgression) {
    lines.push(``);
    lines.push(buildProgressionSection(payload.progression as ProgressionItem[], payload.tone));
  }

  return lines.join("\n");
}
