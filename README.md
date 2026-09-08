# Ludo Income — Render Ready Admin

This package keeps the supplied `index.html` as the user app and adds a Node/Express backend plus a green-button admin panel.

## Render
Build Command: `npm install`
Start Command: `npm start`
Root Directory: leave empty.

## URLs
User: `/`
Admin: `/admin`
Health: `/api/health`

## Admin login
Set environment variables in Render:
ADMIN_MOBILE=your admin mobile
ADMIN_PASSWORD=your strong password
JWT_SECRET=your long random secret

If ADMIN_* are not set, the demo defaults are 01700000000 / ChangeMe123!; change them before real use.

## GitHub
Repository root must contain `index.html`, `server.js`, `package.json`, `public/admin.html`, `data/`, and `uploads/`. Do not upload only the ZIP file.

## Important
JSON storage is suitable for testing/demo only. A production money-handling service should use a persistent database, secure payment verification, audit logs, rate limiting, backups, and comply with applicable laws/payment-provider rules.
