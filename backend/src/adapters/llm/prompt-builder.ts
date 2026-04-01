/**
 * Prompt builder — the ONLY place in the codebase that constructs LLM prompts.
 *
 * Privacy contract (enforced by type system):
 *   - Input type ReportPrompt contains only: firstName, gender, ratingSummary,
 *     topics, tone, length.
 *   - NO last names, org names, class names, birthdates, internal_notes,
 *     parent info, email addresses, or any other PII may appear here.
 *
 * The output prompt template is fixed. Never modify it without updating the
 * privacy review in docs/tech-spec.md.
 */

import { ReportPrompt, ProgressionItem, TestContextItem, LENGTH_WORD_COUNT } from "./types";

/**
 * Format a raw ratings array into the allow-listed summary string.
 * Input:  [{ disciplineName, score, comment? }]
 * Output: "Behaviour: 4/5, Homework: 3/5 (needs reminders), Participation: 5/5"
 *
 * Exported separately so the report service can call it before constructing
 * the ReportPrompt object.
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

/**
 * Map a student's stored gender code to an explicit pronoun string for the prompt.
 * Using full pronoun phrases rather than single-char codes avoids ambiguity for the LLM.
 */
function resolvePronouns(gender: string | null | undefined): string {
  switch (gender?.toUpperCase()) {
    case "M":  return "He/Him (use he, his, him)";
    case "F":  return "She/Her (use she, her, hers)";
    case "N":  return "They/Them (use they, their, them)";
    default:   return "They/Them (use they, their, them)";
  }
}

/**
 * Map a numeric score (1–5) to a qualitative descriptor for the prompt.
 * Score names are kept generic so the LLM does not echo back subject names.
 */
function scoreToDescriptor(score: number): string {
  if (score >= 5) return "excellent";
  if (score >= 4) return "good";
  if (score >= 3) return "satisfactory";
  if (score >= 2) return "developing";
  return "needs support";
}

/**
 * Map a topic score (1–5) to the quality word used in the LLM prompt.
 * These descriptors tell the LLM how the student performed on each topic
 * without ever exposing a numeric value.
 */
function scoreToTopicQuality(score: number): string {
  if (score >= 5) return "exceptional understanding";
  if (score >= 4) return "strong grasp";
  if (score >= 3) return "developing understanding";
  if (score >= 2) return "requires further focus";
  return "needs significant support";
}

/**
 * Map a trend + tone combination to natural language phrasing for the prompt.
 * Tone "gentle"  → encouraging, soft language.
 * Tone "balanced"→ factual improvement/decline statements.
 * Tone "direct"  → explicit performance shift language.
 */
function trendPhrase(
  item: ProgressionItem,
  tone: string
): string {
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

/**
 * Build the optional progression context section appended to the prompt.
 * Only call this when payload.progression is non-empty.
 */
function buildProgressionSection(
  progression: ProgressionItem[],
  tone: string
): string {
  const lines = progression.map((item) => trendPhrase(item, tone));
  return [
    `Historical progression (reference only the following disciplines):`,
    ...lines,
    ``,
    `Incorporate these trends naturally into the Strengths / Areas to Improve sections. Use phrasing appropriate to the selected report tone. Do NOT quote numeric scores from this section literally — convert them to qualitative language.`,
  ].join("\n");
}

/**
 * Build the privacy-safe LLM prompt from a ReportPrompt payload.
 *
 * CRITICAL INSTRUCTIONS block tells the LLM:
 *   - Never mention numeric scores or discipline/category names.
 *   - Never include a title or heading line.
 *   - Write prose only, in the correct tone and length.
 *
 * When topicRatings are present, a scored topic section replaces the plain
 * topics list and an additional instruction guides per-topic prose contrast.
 */
export function buildPrompt(payload: ReportPrompt): string {
  const wordCount = LENGTH_WORD_COUNT[payload.length];

  // Determine the topics section — scored or plain depending on whether
  // topic ratings have been provided for this student.
  const hasTopicRatings =
    payload.topicRatings !== undefined && payload.topicRatings.length > 0;

  const topicsLine = (() => {
    if (!hasTopicRatings) {
      return payload.topics.length > 0
        ? payload.topics.join(", ")
        : "general curriculum topics";
    }
    // Build scored section — topic names with quality descriptors only.
    // Format: "Topic performance:\n[topicName]: [quality word]"
    const scoredLines = (payload.topicRatings as Array<{ topicName: string; score: number }>)
      .map((tr) => `${tr.topicName}: ${scoreToTopicQuality(tr.score)}`)
      .join("\n");
    return `Topic performance:\n${scoredLines}`;
  })();

  // Convert the raw ratings summary into qualitative descriptors only.
  // The discipline names are used here solely to derive an overall performance
  // picture; they must NOT appear in the output.
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

  // Extract teacher notes (comments) from the rating summary without leaking
  // discipline names — strip the "DisciplineName: N/5" prefix from each part.
  const teacherNotes = payload.ratingSummary
    .split(",")
    .map((part) => {
      const match = part.match(/\(([^)]+)\)/);
      return match ? match[1].trim() : null;
    })
    .filter((n): n is string => n !== null && n.length > 0);

  const notesLine = teacherNotes.length > 0
    ? `Teacher notes to incorporate (do NOT quote verbatim): ${teacherNotes.join("; ")}`
    : "";

  // Build test context lines — one per test result item.
  // Format: "Test: "[name]" — 72% (grade B). Incorporate this naturally."
  const testLines: string[] =
    payload.testContext && payload.testContext.length > 0
      ? (payload.testContext as TestContextItem[]).map((tc) => {
          const parts: string[] = [];
          if (tc.percentage !== undefined) parts.push(`${tc.percentage}%`);
          if (tc.grade) parts.push(`grade ${tc.grade}`);
          const context = parts.length > 0 ? ` — ${parts.join(", ")}` : "";
          const lowNote =
            tc.lowMention && tc.percentage !== undefined && tc.percentage < 50
              ? ` This score is below average — acknowledge it honestly with ${payload.tone} tone.`
              : "";
          return `Test: "${tc.testName}"${context}.${lowNote} Incorporate this result naturally in the report.`;
        })
      : [];

  const lines = [
    `You are writing a school report card comment for a student named ${payload.firstName}.`,
    `Pronouns: ${resolvePronouns(payload.gender)}.`,
    `Overall performance level: ${performanceLevel}.`,
    hasTopicRatings ? topicsLine : `Topics covered this term: ${topicsLine}.`,
    notesLine,
    ...testLines,
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
    `4. NEVER mention the 1–5 discipline rating scores, or any assessment category/discipline names (e.g. do not write "Behaviour", "Homework", "Participation"). You MAY reference test percentages and grades if provided above.`,
    `5. Express performance qualitatively using natural language tied to specific observations — not generic phrases.`,
    `6. Include 1–2 specific references to topics covered.`,
    ...(hasTopicRatings
      ? [
          `6b. Topic performance ratings are provided. Write paragraph 2 referencing topics individually where scores differ notably. Where a student scored higher on one topic than another, acknowledge the contrast naturally in prose. Never mention scores or numbers.`,
        ]
      : []),
    `7. Structure the report in 2–3 short paragraphs separated by blank lines. NEVER write as a single block of text.`,
    `   - Paragraph 1: Overall character, attitude, and engagement in class.`,
    `   - Paragraph 2: Academic performance with specific topic references.`,
    `   - Paragraph 3 (include for medium/long reports only): Progress made and what to focus on going forward — written as a specific, grounded observation, not a platitude.`,
    `8. Use the pronouns specified above consistently throughout the entire report. Never switch pronouns mid-report.`,
    `9. No sign-off, greeting, or closing line.`,
    `10. BANNED phrases — never use any of these, replace with specific observations grounded in topics or context:`,
    `    "making good progress" | "paying dividends" | "opportunity to apply themselves"`,
    `    "I look forward to seeing" | "shows great potential" | "valuable contribution to the learning environment"`,
    `    "when given the opportunity" | "it is clear that" | "goes without saying"`,
  ].filter((l) => l !== undefined);

  // Append progression context if provided and non-empty.
  const hasProgression =
    payload.progression !== undefined && payload.progression.length > 0;
  if (hasProgression) {
    lines.push(``);
    lines.push(buildProgressionSection(payload.progression as ProgressionItem[], payload.tone));
  }

  return lines.join("\n");
}
