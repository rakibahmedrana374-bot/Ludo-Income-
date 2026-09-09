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

## Deposit System Update
- 3 payment methods: bKash Personal, Nagad Personal, bKash Merchant.
- Default numbers: 01301470686 (bKash Personal), 01806097369 (Nagad Personal), 01301470686 (bKash Merchant).
- User Deposit page shows the original supplied logos. Tap a logo/card to reveal its number.
- Each method has a Copy button; after copying it changes to `✅ Copied` briefly.
- Admin Panel → Deposit Settings has separate ON/OFF switches and number fields for all 3 methods.
- Existing manual Transaction ID + Admin approval flow remains in place.
