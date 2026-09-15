# Talabat Vendor Portal — Claude Context

**Live:** https://talabat-vendor-portal.vercel.app  
**Repo:** `omarm-boop/talabat-vendor-portal` (GitHub)  
**Sheet:** `1MlxEtSPmPcc4Usq13w9CWedvNMws0Un2XD6QNaazSiQ` (Google Sheets)

## Architecture

- Static `index.html` — single-page app (no framework)
- `api/` — Vercel serverless functions (Node.js)
- `lib/verify.js` — HMAC-SHA256 stateless auth; `lib/cors.js`, `lib/email.js`
- Google Sheets API v4 for all data storage
- Upstash Redis for caching (`sheet:v1:all`, 30s TTL)

## Critical: Sheet Tab Names

| Tab | Purpose |
|-----|---------|
| **Sheet1** | ALL vendor request data (28 columns). This is the correct tab for every API file. |
| Credentials | Vendor accounts (Chain ID, hashed password, branch info) |
| Lists | Dropdown values (status labels, rejection reasons) |
| Team | Monitor/agent accounts |
| Form Responses 1/2/3 | EMPTY — only 2 columns, no data. Never use these. |

**All 6 write/read API files must use `const TAB = 'Sheet1'`** (requests.js, submit.js, assign.js, bulk-action.js, sla-check.js, update-status.js). A previous session accidentally changed them all to `'Form Responses 1'` which broke the portal — always verify this constant before touching those files.

## Auth Flow

- Vendor login: `api/auth.js` → checks Credentials sheet → returns HMAC token
- Token headers: `X-Portal-Email`, `X-Portal-Role`, `X-Portal-Ts`, `X-Portal-Token`
- Vendor session token must include `role: 'vendor'` (field added 2026-09-15)
- Monitor/agent: checked via `TEAM_CREDENTIALS` env var first, then Team sheet (Chain ID = '0')
- bcrypt: plain-text passwords auto-upgraded on first login
- Session stored in `localStorage` key `tlb_session`, 8-hour expiry

## Sheet1 Column Layout (submit.js writes these)

```
A=Timestamp, B=Month Name, C=Week#, D=Chain Name, E=Request Type,
F=Barcode, G=SKU, H=Item Name, I=Explanation/Notes, J=Email (vendorId@vendor.portal),
K=Image link, L=File link, M=Price, N=Branch Name, O=unused,
P=Delist reason, Q-S=unused, T=Status,
U=Assignee (written by assign.js),
V=Rejection Reason (written by update-status.js),
W=AssignedAt timestamp,
X=Priority flag,
Y=Audit log (append-only)
```

## Vendor ID Extraction (requests.js)

Email in col J is stored as `vendorId@vendor.portal`. The Vendor ID is extracted as:
```js
obj['Vendor ID'] = email.replace('@vendor.portal', '')
```

## Known Test Credentials

| Role | Login | Password |
|------|-------|----------|
| Vendor | 502519 (Abu Auf - Mohandseen Syria) | 123456 |
| Monitor | omar.m@talabat.com | 123456 |
| Agent | agent1@talabat.com | 123456 |

## Known Bug (open)

`api/requests.js` line 133: `Rejection Reason` fallback chain still includes `obj['Branch Name / اسم الفرع']`, which causes the branch name to appear as rejection reason for non-rejected requests. Fix: remove that fallback, keep only `obj['Reason'] || ''`.

## Do Not Touch

The legacy Google Form at `https://docs.google.com/forms/d/e/1FAIpQLSeU7J0zkKh3CW4OtKdWszQc4lynfPMAKQoNbRMjRcX33u3gbA/viewform` must never be modified.
