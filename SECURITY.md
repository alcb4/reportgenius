# Security Policy

## Supported Versions

Only the latest production release receives security patches.

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Email your report to: **security@[your-domain]**

Include:
- A clear description of the vulnerability and its potential impact
- Steps to reproduce (proof-of-concept, screenshots, or code snippets)
- Any suggested mitigations you are aware of

We will acknowledge your report within **48 hours** and aim to provide a fix or mitigation plan within **14 days** for critical issues.

## Disclosure Policy

We follow a **coordinated disclosure** model:
1. You report privately.
2. We confirm and triage.
3. We develop and release a fix.
4. We publicly acknowledge your contribution (unless you prefer anonymity).

Please allow us reasonable time to address the issue before public disclosure.

## Scope

In scope:
- Authentication and session management
- Data isolation between organisations (multi-tenant boundaries)
- API endpoints and rate limiting
- Injection vulnerabilities (SQL, prompt, XSS)
- Encryption of sensitive data at rest and in transit

Out of scope:
- Denial-of-service attacks
- Social engineering of staff
- Physical security
- Issues in third-party services (Vercel, Upstash, OpenAI, etc.)

## Security Practices

- All API routes are authenticated via JWT (HS256, 7-day expiry)
- Passwords are hashed with bcrypt (≥12 rounds)
- API keys stored in the database are encrypted with AES-256-GCM
- Per-IP rate limiting on auth and LLM routes (Upstash Redis in production)
- Login lockout after 5 consecutive failures (15-minute window)
- HTTP security headers set on all responses (CSP, HSTS, X-Frame-Options, etc.)
- Multi-tenant isolation: every database query is scoped to the authenticated organisation
