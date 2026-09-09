# Ludo Income — Deposit Logo Fixed

This build fixes the payment-logo loading issue. The three supplied original logo images are embedded directly into the user/admin HTML, so they continue to display even if the `payment-logos` folder is omitted during GitHub upload.

Deposit behavior:
- No payment number is shown initially.
- Tap the payment logo to reveal that method's number.
- Copy button appears beside the revealed number.
- Copy changes to ✅ Copied temporarily.
- Admin can enable/disable each of the three methods and edit their numbers.

Methods:
- bKash Personal: 01301470686
- Nagad Personal: 01806097369
- bKash Merchant: 01301470686
