# Ludo Income — Render Ready

This ZIP is structured for a Node/Express Render Web Service.

## Project structure

index.html
server.js
package.json
render.yaml
public/admin.html
data/database.json
uploads/

## Render settings

Build Command: npm install
Start Command: npm start
Root Directory: leave empty

## URLs

User: /
Admin: /admin
Health: /api/health

## Admin environment variables

ADMIN_MOBILE=your admin mobile
ADMIN_PASSWORD=your strong password
JWT_SECRET=your long random secret

Do not use demo/default admin credentials in production.

## Important

Upload/extract the FILES inside this ZIP to the GitHub repository root. Do not upload only the ZIP file.

The frontend uses the same server origin for API requests, so it does not depend on the old Render URL.

JSON storage is suitable for testing/demo only. For a real-money service, use a persistent database, secure payment verification, audit logs, rate limiting, backups, and comply with applicable laws/payment-provider rules.
