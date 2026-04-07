/**
 * Student Alias Service — privacy layer for AI generation.
 *
 * Replaces real student names with session-scoped aliases (Student_01, Student_02, ...)
 * before any prompt is sent to an external LLM or shown for copy/paste.
 *
 * Core guarantees:
 *   - Aliases are unique within a sessionId only
 *   - Real names never leave the app in prompts or LLM payloads
 *   - LLM responses are remapped back to real studentIds locally
 *   - Missing or invented aliases cause safe failures, never silent mis-maps
 */

import { prisma } from '@/lib/prisma'

export interface StudentAliasEntry {
  studentId: string
  alias: string
}

export interface AliasMap {
  studentIdToAlias: Map<string, string>
  aliasToStudentId: Map<string, string>
  nameToAlias: Map<string, string>
}

export interface RemappedReport {
  studentId: string
  report: string
}

export interface ParseValidationResult {
  reports: RemappedReport[]
  errors: Array<{ alias?: string; studentId?: string; error: string }>
  rawOutput?: string
  flaggedForReview: boolean
  reviewReasons: string[]
}

const ALIAS_PREFIX = 'Student_'

function formatAlias(index: number): string {
  return `${ALIAS_PREFIX}${String(index).padStart(2, '0')}`
}

export async function getOrCreateAliases(
  sessionId: string,
  classId: string,
  _studentIds: string[]
): Promise<AliasMap> {
  const existing = await prisma.sessionStudentAlias.findMany({
    where: { session_id: sessionId },
    select: { student_id: true, alias: true },
  })

  // Fetch ALL students in the class to ensure consistent alias assignment
  const allClassStudents = await prisma.student.findMany({
    where: { class_id: classId },
    select: { id: true },
    orderBy: [{ first_name: 'asc' }, { id: 'asc' }],
  })
  const allStudentIds = allClassStudents.map((s) => s.id)

  // Only recreate if we have no aliases or the class composition changed
  if (existing.length >= allStudentIds.length) {
    const studentIdToAlias = new Map<string, string>()
    const aliasToStudentId = new Map<string, string>()
    for (const entry of existing) {
      studentIdToAlias.set(entry.student_id, entry.alias)
      aliasToStudentId.set(entry.alias, entry.student_id)
    }
    return { studentIdToAlias, aliasToStudentId, nameToAlias: new Map<string, string>() }
  }

  await prisma.sessionStudentAlias.deleteMany({
    where: { session_id: sessionId },
  })

  // Assign aliases to ALL class students in consistent order (by first_name)
  const entries = allStudentIds.map((studentId, index) => ({
    session_id: sessionId,
    class_id: classId,
    student_id: studentId,
    alias: formatAlias(index + 1),
  }))

  await prisma.sessionStudentAlias.createMany({
    data: entries,
  })

  const studentIdToAlias = new Map<string, string>()
  const aliasToStudentId = new Map<string, string>()
  for (const entry of entries) {
    studentIdToAlias.set(entry.student_id, entry.alias)
    aliasToStudentId.set(entry.alias, entry.student_id)
  }

  return { studentIdToAlias, aliasToStudentId, nameToAlias: new Map<string, string>() }
}

export async function getAliasMap(sessionId: string): Promise<AliasMap> {
  const existing = await prisma.sessionStudentAlias.findMany({
    where: { session_id: sessionId },
    select: { student_id: true, alias: true },
  })

  const studentIdToAlias = new Map<string, string>()
  const aliasToStudentId = new Map<string, string>()
  for (const entry of existing) {
    studentIdToAlias.set(entry.student_id, entry.alias)
    aliasToStudentId.set(entry.alias, entry.student_id)
  }

  return { studentIdToAlias, aliasToStudentId, nameToAlias: new Map<string, string>() }
}

export async function getAliasesForClass(classId: string): Promise<AliasMap> {
  const students = await prisma.student.findMany({
    where: { class_id: classId },
    select: { id: true, first_name: true },
    orderBy: { first_name: 'asc' },
  })

  const studentIdToAlias = new Map<string, string>()
  const aliasToStudentId = new Map<string, string>()
  const nameToAlias = new Map<string, string>()

  students.forEach((s, i) => {
    const alias = formatAlias(i + 1)
    studentIdToAlias.set(s.id, alias)
    aliasToStudentId.set(alias, s.id)
    nameToAlias.set(s.first_name.toLowerCase(), alias)
  })

  return { studentIdToAlias, aliasToStudentId, nameToAlias }
}

export function buildNameReplacementMap(
  students: Array<{ id: string; first_name: string }>,
  aliasMap: AliasMap
): Map<string, string> {
  const nameToAlias = new Map<string, string>()
  for (const student of students) {
    const alias = aliasMap.studentIdToAlias.get(student.id)
    if (alias) {
      nameToAlias.set(student.first_name.toLowerCase(), alias)
    }
  }
  return nameToAlias
}

export function replaceNamesInText(
  text: string,
  nameToAlias: Map<string, string>
): string {
  if (!text || nameToAlias.size === 0) return text

  let result = text
  const sortedNames = Array.from(nameToAlias.keys()).sort((a, b) => b.length - a.length)

  for (const lowerName of sortedNames) {
    const alias = nameToAlias.get(lowerName)!
    const regex = new RegExp(`\\b${escapeRegex(lowerName)}\\b`, 'gi')
    result = result.replace(regex, alias)
  }

  return result
}

export function buildAliasToNameMap(
  students: Array<{ id: string; first_name: string }>,
  aliasMap: AliasMap
): Map<string, string> {
  const aliasToName = new Map<string, string>()
  for (const student of students) {
    const alias = aliasMap.studentIdToAlias.get(student.id)
    if (alias) {
      aliasToName.set(alias, student.first_name)
    }
  }
  return aliasToName
}

export function replaceAliasesInText(
  text: string,
  aliasToName: Map<string, string>
): string {
  if (!text || aliasToName.size === 0) return text

  let result = text
  const sortedAliases = Array.from(aliasToName.keys()).sort((a, b) => b.length - a.length)

  for (const alias of sortedAliases) {
    const name = aliasToName.get(alias)!
    const regex = new RegExp(escapeRegex(alias), 'g')
    result = result.replace(regex, name)
  }

  return result
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function applyAliasesToBatchPayloads(
  payloads: Array<{ id: string; firstName: string; gender: string }>,
  aliasMap: AliasMap
): Array<{ id: string; firstName: string; gender: string }> {
  return payloads.map((p) => ({
    ...p,
    firstName: aliasMap.studentIdToAlias.get(p.id) ?? p.firstName,
  }))
}

export function validateAndRemapResponse(
  raw: string,
  aliasMap: AliasMap,
  _expectedStudentIds: string[]
): ParseValidationResult {
  const errors: Array<{ alias?: string; studentId?: string; error: string }> = []
  const reports: RemappedReport[] = []
  const reviewReasons: string[] = []
  let flaggedForReview = false

  let cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  const firstBracket = cleaned.indexOf('[')
  const lastBracket = cleaned.lastIndexOf(']')

  if (firstBracket === -1 || lastBracket === -1 || lastBracket <= firstBracket) {
    return {
      reports: [],
      errors: [{ error: 'Could not parse response as JSON array' }],
      rawOutput: raw,
      flaggedForReview: true,
      reviewReasons: ['No JSON array found in response'],
    }
  }

  cleaned = cleaned.slice(firstBracket, lastBracket + 1)

  let items: unknown
  try {
    items = JSON.parse(cleaned)
  } catch {
    return {
      reports: [],
      errors: [{ error: 'Malformed JSON' }],
      rawOutput: raw,
      flaggedForReview: true,
      reviewReasons: ['JSON parsing failed'],
    }
  }

  if (!Array.isArray(items)) {
    return {
      reports: [],
      errors: [{ error: 'Response is not a JSON array' }],
      rawOutput: raw,
      flaggedForReview: true,
      reviewReasons: ['Expected JSON array'],
    }
  }

  const seenStudentIds = new Set<string>()

  for (const item of items) {
    if (
      item === null ||
      typeof item !== 'object' ||
      !('alias' in item) ||
      !('report' in item) ||
      typeof (item as Record<string, unknown>)['alias'] !== 'string' ||
      typeof (item as Record<string, unknown>)['report'] !== 'string'
    ) {
      if (item && typeof item === 'object' && 'studentId' in item) {
        errors.push({
          studentId: (item as Record<string, unknown>)['studentId'] as string,
          error: 'Invalid item structure — expected "alias" field, not "studentId"',
        })
        flaggedForReview = true
        if (!reviewReasons.includes('LLM returned studentId instead of alias')) {
          reviewReasons.push('LLM returned studentId instead of alias')
        }
      } else {
        errors.push({ error: 'Invalid item structure — missing alias or report' })
      }
      continue
    }

    const typedItem = item as { alias: string; report: string }
    const reportText = typedItem.report.trim()

    if (!reportText) {
      errors.push({ alias: typedItem.alias, error: 'Empty report text' })
      continue
    }

    const realStudentId = aliasMap.aliasToStudentId.get(typedItem.alias)

    if (!realStudentId) {
      errors.push({
        alias: typedItem.alias,
        error: `Alias "${typedItem.alias}" not found in this session`,
      })
      flaggedForReview = true
      if (!reviewReasons.includes(`Invented alias: ${typedItem.alias}`)) {
        reviewReasons.push(`Invented alias: ${typedItem.alias}`)
      }
      continue
    }

    if (seenStudentIds.has(realStudentId)) {
      flaggedForReview = true
      if (!reviewReasons.includes(`Duplicate alias mapping for student ${realStudentId}`)) {
        reviewReasons.push(`Duplicate alias mapping for student ${realStudentId}`)
      }
    }
    seenStudentIds.add(realStudentId)

    reports.push({
      studentId: realStudentId,
      report: reportText,
    })
  }

  return {
    reports,
    errors,
    rawOutput: flaggedForReview ? raw : undefined,
    flaggedForReview,
    reviewReasons,
  }
}

export function buildAliasPrivacyInstruction(): string {
  return (
    'PRIVACY — STUDENT ALIASES\n' +
    '  Students are identified by aliases (Student_01, Student_02, etc.).\n' +
    '  Use the provided student aliases exactly as written.\n' +
    '  Do not output real names.\n' +
    '  Do not invent new aliases.\n' +
    '  Return structured JSON in this format:\n' +
    '  [{"alias":"Student_01","report":"..."}, ...]\n' +
    '  One object per student. Any non-JSON output will break the system.'
  )
}
