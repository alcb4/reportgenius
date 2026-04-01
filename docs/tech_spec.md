Technical Specification
Version: 1.0 (Solo Teacher MVP, multi‑tenant ready)

1. Database Schema (Postgres)
sql
-- Core entities (run migrations with Prisma or Drizzle)
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  settings JSONB DEFAULT '{}',  -- e.g. {"default_model": "gpt-4o-mini", "report_length": "medium"}
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,  -- "Year 8 Science Term 2"
  year_group VARCHAR(100),
  subject VARCHAR(100),
  term VARCHAR(100),
  topics_covered TEXT[],  -- Array: ["Fractions", "Algebra"]
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  class_id UUID REFERENCES classes(id) ON DELETE CASCADE,
  first_name VARCHAR(100) NOT NULL,
  gender VARCHAR(20),  -- "M/F/Other/Prefer not"
  internal_notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE disciplines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID REFERENCES classes(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,  -- "Behaviour", "Homework"
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  discipline_id UUID REFERENCES disciplines(id) ON DELETE CASCADE,
  score INTEGER CHECK (score >=1 AND score <=5),
  comment TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  class_id UUID REFERENCES classes(id),
  llm_model VARCHAR(100),  -- "gpt-4o-mini"
  llm_prompt TEXT,
  llm_raw_response TEXT,
  edited_content TEXT NOT NULL,  -- Rich text HTML
  status VARCHAR(20) DEFAULT 'draft',  -- draft/final
  word_count INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for perf (bulk ops)
CREATE INDEX idx_ratings_student_disc ON ratings(student_id, discipline_id);
CREATE INDEX idx_reports_org_student ON reports(organization_id, student_id);
Notes: All queries must filter by organization_id. Use JSONB for flexible settings/topics.

2. API Endpoints (REST, /api/v1/)
Method	Endpoint	Description	Auth	Bulk?
POST	/auth/register	Create user/org	No	-
POST	/auth/login	JWT token	No	-
GET	/classes	List user’s classes	Yes	Y
POST	/classes	Create class w/ disciplines	Yes	Y (CSV import students)
GET	/classes/{id}/ratings-form	Get editable ratings grid for class	Yes	Y
POST	/classes/{id}/generate	Bulk/single gen reports (queue)	Yes	Y
GET	/classes/{id}/reports	List/preview reports	Yes	Y
PUT	/reports/{id}/edit	Update edited_content	Yes	-
POST	/reports/{id}/redo	Re‑gen from same ratings	Yes	Y (multi)
GET	/exports/{classId}?format=pdf	Zip of PDFs/CSVs	Yes	Y
Auth: JWT in header, validate organization_id matches token. Rate limit bulk gen. Use BullMQ/Redis for async jobs.

3. LLM Adapter
Config (env):

text
LLM_PROVIDER=openai  # or claude,grok,local
OPENAI_API_KEY=...
CLAUDE_API_KEY=...  # Optional fallbacks
GROK_API_KEY=...
LOCAL_LLM_URL=http://localhost:11434  # Ollama etc.
DEFAULT_MODEL=gpt-4o-mini
Unified Interface: Use a lib like multi-llm-api-gateway or simple switch:

typescript
async function generateReport(payload: {firstName: string, gender: string, ratings: Rating[], topics: string[], length: 'short'|'medium'|'long'}) {
  const prompt = buildPrompt(payload);  // Templated
  const adapter = getAdapter(process.env.LLM_PROVIDER);
  try {
    const response = await adapter.chat(prompt, {model: DEFAULT_MODEL});
    return response.content;
  } catch {
    // Fallback chain: claude -> grok -> local
  }
}
Prompt Template:

text
Write a {length} student report for {firstName} ({gender} pronouns: {he/she/they}).

Key ratings (1-5): {ratings summary e.g. "Behaviour:5, Homework:3 with note 'needs reminder'"}.

Topics covered: {topics}.

Tone: professional, encouraging. Make unique, include 1-2 specific examples tied to topics/ratings. No generic phrases.
Store prompt/response for audits.

4. Frontend Structure (Next.js App Router)
Pages:

/dashboard: Class list + quick gen.

/classes/[id]: Students table → ratings grid → bulk gen button.

/classes/[id]/edit: Report list w/ rich editor (Tiptap), redo/export buttons.

/settings: LLM keys/models, export prefs.

Key Components:

RatingsGrid: Editable table (score 1-5, comment).

ReportEditor: Rich text w/ preview, word count.

BulkQueue: Progress bar for gen jobs (WebSocket/Poll).

Libs: Tiptap (editor), TanStack Table (grids), Pusher/Bull Board (jobs), jsPDF/Puppeteer (PDF).

5. Exports
CSV: Ratings + summaries (xlsx lib).

PDF: HTML‑to‑PDF via Puppeteer (styled templates). Bulk: ZIP all student PDFs.

6. Deployment (Docker Compose)
text
services:
  app:  # Next.js + API
  db: postgres:16
  redis:  # Jobs
  # README: docker compose up, visit localhost:3000
Security/Perf:

Encrypt API keys (Postgres pgcrypto).

Bulk: Process in parallel (10 concurrent LLM calls max, configurable).

GDPR: Export/delete all data per student/org.

Architecture Diagram
text
┌─────────────────┐    ┌──────────────┐    ┌──────────────┐
│   Next.js UI    │◄──►│   API Layer   │◄──►│   Postgres   │
│ (grids/editor)  │    │ (Node/Express)│    │ (tenant data)│
└─────────────────┘    └──────┬───────┘    └──────────────┘
                             │
                       ┌─────▼──────┐
                       │ LLM Adapter│ ───► OpenAI/Claude/etc
                       │ (multi‑prov)│
                       └────────────┘
                             │
                       ┌─────▼──────┐
                       │ BullMQ Jobs │ ───► Redis
                       │ (bulk gen)  │
                       └────────────┘