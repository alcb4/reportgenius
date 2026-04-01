---
name: BullMQ custom jobId colon restriction
description: BullMQ rejects custom jobId strings containing ":" — use underscore as separator
type: feedback
---

BullMQ's `Job.validateOptions()` throws `Error: Custom Id cannot contain :` if a custom `jobId` option contains a colon character.

**Why:** Discovered during Task 5 when using `batchId:studentId` as the BullMQ job ID format. Both values are UUIDs which do not themselves contain colons, but the separator did.

**How to apply:** When constructing BullMQ custom job IDs from multiple UUID-like components, use `_` (underscore) as separator: `${batchId}_${studentId}`. The logical identifier inside `job.data.jobId` can use any format since it is not passed to BullMQ's ID validation.
