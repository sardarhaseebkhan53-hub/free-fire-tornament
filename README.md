# CLUTCHNEX — Free Fire Tournament Platform

**COMPETE. CLUTCH. CONQUER.**

A premium, production-grade Free Fire esports platform: tournaments
(Solo / Duo / Squad / Clash Squad), wallet with immutable ledger, manual
payment verification (JazzCash / EasyPaisa / bank), teams, timed
room-credential release, result verification, prize distribution, referrals,
support (tickets + WhatsApp + NEXA assistant), admin panel, SEO + blog, PWA.

- 🎨 Approved UI design: `design/` (42 locked concept screens +
  `design/DESIGN_SYSTEM_DRAFT.md`)
- 🔧 Backend: `backend/` — Express 5 + TypeScript + Prisma 7 + PostgreSQL
  (see `backend/README.md`)
- 🖥️ Frontend: `frontend/` — Next.js 16 + TypeScript + Tailwind (phased build)

## Status

Phase-by-phase build (15 phases). See the open pull request for the current
phase checklist.

## Run locally (no Docker)

```bash
cd backend
npm install
npm run db:dev        # embedded PostgreSQL on :5432
npm run db:generate   # Prisma client
npm run db:migrate:dev && npm run db:seed
npm run dev           # API on :4000
```
