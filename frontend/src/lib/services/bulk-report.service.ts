/**
 * Bulk report generation service — serverless-compatible implementation.
 *
 * Replaces the BullMQ-based queue from the Express backend with a
 * synchronous in-process implementation suitable for Vercel serverless.
 * Batches are tracked in a module-level Map (per-invocation scope).
 */

import { generateSingleReport } from './report.service'
import { prisma } from '@/lib/prisma'

export interface BatchResult {
  studentId: string
  reportId?: string
  status: 'completed' | 'failed'
  error?: string
}

export interface BatchStatus {
  batchId: string
  total: number
  completed: number
  failed: number
  pending: number
  active: number
  results: BatchResult[]
}

// In-memory batch state (lives for the duration of the serverless invocation)
const batchStore = new Map<string, BatchStatus>()

export async function bulkGenerateReports(
  sessionId: string,
  organizationId: string,
  options: { llmProvider?: string }
): Promise<{ batchId: string; totalJobs: number }> {
  const session = await prisma.reportSession.findFirst({
    where: { id: sessionId, organization_id: organizationId },
    select: { id: true, tone: true, length: true, class_id: true },
  })

  if (!session) {
    throw Object.assign(
      new Error('Session not found or does not belong to this organization'),
      { code: 'SESSION_NOT_FOUND', statusCode: 404 }
    )
  }

  const students = await prisma.student.findMany({
    where: { class_id: session.class_id, organization_id: organizationId },
    select: { id: true },
  })

  if (students.length === 0) {
    throw Object.assign(
      new Error('No students found in this session\'s class'),
      { code: 'NO_STUDENTS', statusCode: 422 }
    )
  }

  const batchId = crypto.randomUUID()
  const results: BatchResult[] = []

  // Generate reports synchronously (serverless — no background jobs)
  for (const student of students) {
    try {
      const report = await generateSingleReport(student.id, sessionId, organizationId, {
        tone: session.tone,
        length: session.length as 'short' | 'medium' | 'long',
        llmProvider: options.llmProvider,
      })
      results.push({ studentId: student.id, reportId: report.id, status: 'completed' })
    } catch (err) {
      results.push({
        studentId: student.id,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const completed = results.filter((r) => r.status === 'completed').length
  const failed = results.filter((r) => r.status === 'failed').length

  const status: BatchStatus = {
    batchId,
    total: students.length,
    completed,
    failed,
    pending: 0,
    active: 0,
    results,
  }

  batchStore.set(batchId, status)

  return { batchId, totalJobs: students.length }
}

export async function getBatchStatus(
  batchId: string,
  organizationId: string // reserved for multi-tenant isolation in future DB-backed implementation
): Promise<BatchStatus> {
  void organizationId;
  const status = batchStore.get(batchId)

  if (!status) {
    throw Object.assign(
      new Error('Batch not found'),
      { code: 'BATCH_NOT_FOUND', statusCode: 404 }
    )
  }

  return status
}

export async function retryFailedJobs(
  batchId: string,
  organizationId: string // reserved for multi-tenant isolation in future DB-backed implementation
): Promise<{ requeued: number }> {
  void organizationId;
  const status = batchStore.get(batchId)

  if (!status) {
    throw Object.assign(
      new Error('Batch not found'),
      { code: 'BATCH_NOT_FOUND', statusCode: 404 }
    )
  }

  // Return 0 — synchronous implementation has no retry queue
  return { requeued: 0 }
}
