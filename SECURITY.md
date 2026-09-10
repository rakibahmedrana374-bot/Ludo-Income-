# Security Hardening

This release adds a production-oriented security layer:

- Helmet security headers and disabled `X-Powered-By`.
- Strict JSON/urlencoded request size limits.
- CORS allowlist via `CORS_ORIGINS`; same-origin requests continue to work.
- Rate limiting for login, registration/password reset, OTP requests, and admin login.
- Production startup requires a strong `JWT_SECRET` (32+ characters) and explicit `ADMIN_PASSWORD`.
- JWT sessions now expire after 2 hours and are backed by server-side session records.
- Logout revokes the current session; password changes/resets revoke all user sessions.
- Admin password changes revoke all admin sessions.
- Blocked users are rejected on every authenticated request, not only at login.
- Password policy: users 8+ characters with upper/lowercase and a number; admins 10+ with the same complexity.
- Public static serving is allowlisted so `database.json`, `server.js`, package files, and other source files are not exposed.
- Database writes use a temporary file + atomic rename and restrictive file permissions where supported.
- Upload MIME filtering and centralized upload/error handling were tightened.
- Frontend auth tokens are stored in `sessionStorage` instead of persistent `localStorage`, with logout calling the server to revoke the session.

## Required production environment

Set at minimum:

- `NODE_ENV=production`
- `JWT_SECRET=<random secret, 32+ chars; preferably 64+ random bytes>`
- `ADMIN_PASSWORD=<strong admin password>`
- `ADMIN_MOBILE=<admin mobile>`
- `CORS_ORIGINS=<comma-separated trusted origins>` only if the frontend is hosted on a different origin.

This hardening does **not** make JSON file storage suitable for high-concurrency real-money production. PostgreSQL/transactional storage is still recommended before launch.
