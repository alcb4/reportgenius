TASK: FIX EXPORT AUTH 401 ERROR

The PDF/XLSX export endpoints return "AUTH_MISSING" because they
lack the Authorization header or auth middleware.

1. Frontend: Audit the fetch/axios call to /api/v1/sessions/:id/export/*
   Ensure it includes the same Authorization: Bearer token as
   the working ratings/reports APIs. Match the exact pattern.

2. Backend: Confirm export routes in backend/src/routes/[reports/sessions].ts
   have the same auth middleware applied as ratings endpoints.
   Should be identical auth pattern.

Test:
- PDF export → downloads without 401
- XLSX export → downloads without 401

End with: "Export auth fixed. PDF and XLSX download working."