Project Overview Document
Product Name: ReportGenius (placeholder—feel free to change)

Vision
A privacy‑first, self‑hosted open‑source SaaS for teachers to generate, edit, and export individualized student reports using structured ratings + LLM, with full history tracking and bulk class processing. International/curriculum‑agnostic design prioritises speed and simplicity for solo teachers, with architecture ready for multi‑tenant orgs.

Target Users (v1)

Solo teachers worldwide who manage their own classes/subjects.

Self‑hosters: Deploy via Docker/Postgres; bring your own LLM API key.

Core Value Prop
Turn hours of repetitive report writing into minutes: rate students on disciplines → bulk‑generate personalised drafts → edit/redo/export. No PII to LLM, local data control.

Key Constraints

Open source core (MIT license).

Self‑hosted only (no managed SaaS v1).

Prioritise performance (bulk gen, fast edits).

International: No UK‑only assumptions—users define years, subjects, curriculums freely.

Non‑Goals (v1)

School‑level multi‑user (shipped but UI‑hidden).

Mobile app.

Real‑time collab.

Advanced analytics.

High‑Level Architecture
Stack (chosen for your full‑stack prefs, performance, OSS ecosystem):

Frontend: Next.js 15 (React/TypeScript) – fast SPA with forms, rich text editor (Quill or Tiptap), bulk previews.

Backend: Node.js/Express (TypeScript) or Fastify – REST API, auth, bulk jobs. (Python/FastAPI viable if you prefer.)

DB: Postgres – excellent for concurrent bulk writes, history queries, international text (UTF8). SQLite too slow for bulk gen; Dockerise Postgres for easy self‑host.

LLM Layer: Unified adapter (e.g. multi-llm-api-gateway or custom) – default OpenAI GPT‑4o‑mini, user‑selectable Claude/Grok/etc via env vars. Failover: queue jobs if API down, retry with alt model.

Exports: PDF (Puppeteer/jsPDF), CSV/Excel (xlsx lib). Bulk exports zip multiple files.

Deployment: Docker Compose (app + Postgres + Redis for queues), GitHub README with docker‑up.sh.

Data Model (multi‑tenant ready):

Table	Key Fields	Purpose
Table	Key Fields	Purpose
organizations	id, name, settings_json	Implicit tenant (solo=1 org/user) 
users	id, email, password_hash, organization_id	Auth/users 
classes	id, org_id, name, year_group, subject, term	Flexible: “Grade 8 Math Term 2” 
students	id, org_id, class_id, first_name, gender, notes	Minimal PII, history per class 
disciplines	id, org_id/class_id, name (e.g. “Homework”)	Configurable per class 
ratings	id, student_id, discipline_id, score_1_5, comment	Structured input 
reports	id, student_id, ratings_snapshot, llm_prompt, llm_response, edited_content, status (draft/final), model_used	Full audit trail 
Critical Flows

Setup: User signs up → auto‑creates org → configures LLM keys/models in settings.

Class mgmt: Add class (year/subject/term free‑text), bulk‑add students (manual/CSV).

Bulk gen: Select class → enter ratings for all students (grid UI) → “Generate all” → queue jobs → preview/edit page with redo per‑student.

Edit/Export: Per‑class dashboard: edit rich text, bulk redo, export class CSV/PDF zip.

History: Per‑student timeline across years/classes.

Privacy/LLM Rules

Prompt: {first_name}, {gender/pronouns}, ratings summary, topics, length/tone only.

Adapter validates/sanitises inputs. Fallback: local model URL if no cloud keys.