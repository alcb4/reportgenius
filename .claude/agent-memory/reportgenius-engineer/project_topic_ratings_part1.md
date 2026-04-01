---
name: Topic Ratings Part 1 — Backend Implementation
description: TopicRating schema, bulk upsert/GET routes, prompt-builder scored topics, report service integration, session topic mutation safety
type: project
---

TopicRating model added to schema with organization_id, session_id, student_id, topic_name, score; unique constraint on (session_id, student_id, topic_name); back-relations on Organization, ReportSession, Student.

Migration: 20260327100202_add_topic_ratings — required manual SQL creation + prisma migrate resolve --applied to baseline the pre-existing migration first.

New routes in backend/src/routes/topic-ratings.ts:
- POST /sessions/:sessionId/topic-ratings/bulk — validates topics exist in session.topics_covered, validates students belong to session's class, bulk upsert via Map keyed by student_id|topic_name, single $transaction
- GET /sessions/:sessionId/topic-ratings — returns { topics: session.topics_covered, ratings: [] } if none exist, 404 if session not found

Prompt builder: when topicRatings present, replaces plain topics list with "Topic performance:\n[topic]: [quality word]" section; adds instruction 7b about per-topic contrast prose. scoreToTopicQuality maps 5→exceptional, 4→strong, 3→developing, 2→requires focus, 1→needs support.

Report service: fetches topicRating.findMany after discipline ratings; passes topicRatings to buildPrompt if rows > 0, else undefined.

Sessions PUT: computes removedTopics = old_topics - new_topics; if any removed, $transaction deletes orphaned TopicRatings + updates session atomically.

New PATCH /sessions/:sessionId/topics/rename: validates oldName in topics, newName not already in topics, $transaction updates topics_covered array + topicRating.updateMany.

**Why:** Topic-level performance data enriches LLM prompts with per-topic quality contrast without exposing numeric scores to the output.

**How to apply:** The Prisma client copy pattern (root .prisma/client → backend/node_modules/.prisma/client) was required again here — apply this after every prisma generate run.
