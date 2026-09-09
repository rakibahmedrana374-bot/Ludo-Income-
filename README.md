# Ludo Income — Render Ready

Includes:
- User authentication and random UID
- Deposit / Withdraw
- My Statement with date/time
- Tournament matches
- Auto-close after configured number of players (default 2)
- Room Code visible only to joined players after match is full
- 🎉 My Match page
- Winner screenshot upload from My Match only
- One screenshot per user/match by default
- Admin screenshot review with User Profile button
- Admin match/player details with UID and mobile
- Admin Match Settings, Profile Settings and Deposit Settings

## Render
Build: `npm install`
Start: `npm start`

Environment variables:
- `ADMIN_MOBILE`
- `ADMIN_PASSWORD`
- `JWT_SECRET`

Note: JSON file storage is for demo/testing. For a real-money production system, use a persistent database and stronger security/audit controls.
