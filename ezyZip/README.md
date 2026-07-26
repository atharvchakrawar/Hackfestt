# HackConnect Platform v3.0

Full-stack HackConnect platform with **Next.js + Node.js + PostgreSQL + Tailwind CSS**.

## Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 14, Tailwind CSS, TypeScript |
| Backend | Node.js, Express |
| Database | PostgreSQL with SQL migrations |
| Auth | JWT + Google OAuth (passport-google-oauth20) |
| Payments | Razorpay (dev mode included) |
| Receipts | PDFKit → Cloudinary/local storage |
| Email | Nodemailer (dev mode logs to console) |
| Export | ExcelJS (.xlsx) |
| Cron | node-cron (hourly, idempotent) |

## Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL 14+

### 1. Create database
```sql
CREATE DATABASE college_events;
```

### 2. Install & setup
```bash
npm run setup
```

Copy environment files:
```bash
cp server/.env.example server/.env
cp web/.env.example web/.env.local
```

### 3. Run migrations & seed
```bash
npm run migrate
npm run seed
```

### 4. Start dev servers
```bash
npm run dev
```

| Service | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
| API | http://localhost:4000 |

## Demo Accounts

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@collegeevents.in | admin123 |
| Organizer | organizer@mit.edu | organizer123 |
| Student | aarav@mit.edu | student123 |

## Features

### Payments & Receipts
- Student → Organizer: Razorpay registration fees with PDF receipt generation
- Organizer → Platform: Configurable listing fee on event creation
- Receipts uploaded to Cloudinary (or local in dev mode)
- Confirmation emails with PDF attachment

### Event Filters (shareable URL params)
- College (searchable dropdown)
- Event Type (multi-select OR)
- Free/Paid
- Sort: Event Date, Newest, Oldest, Date Modified

### Registration Limits
- `max_registrations` required; auto-sets `full` status
- Registration disabled when full/closed

### Team Registration
- Individual and team participation types
- Team members stored in `team_members` table
- Receipt lists all team members

### Auto-close & Auto-hide (hourly cron)
- Past deadline → `registration_status = closed`
- Past event date → `is_visible = false`
- Expired boosts disabled

### Location Recommendations
- Browser geolocation + Nominatim reverse geocode
- City stored in localStorage
- "Near You" badge; boosted events rank first

### Excel Export
- `GET /api/events/:id/export` (organizer JWT required)
- ExcelJS with all registration columns

### Boosted Events
- Admin-configurable pricing (3-day, 7-day tiers)
- Featured styling; pinned above filtered results

### Google OAuth
- Auto-create account on first login
- Link existing accounts

### User Profiles (`/profile`)
- Role-specific fields with auto-fill on registration

### Admin Settings (`/admin/settings`)
- Listing fee, boost pricing, event approval mode

## API Routes

```
Auth
  POST /api/auth/student/register
  POST /api/auth/organizer/register
  POST /api/auth/login
  GET  /api/auth/google
  GET  /api/auth/google/callback

Events
  GET  /api/events?college&type&fee&sort&search
  GET  /api/events/colleges
  POST /api/events                    [organizer]
  POST /api/events/:id/listing-payment [organizer]
  POST /api/events/:id/boost          [organizer]
  GET  /api/events/:id/export         [organizer]

Registrations
  POST /api/registrations/register    [student]
  POST /api/registrations/:id/payment [student]

Admin
  GET/PUT /api/admin/settings         [admin]
```

## Legacy Flask App

The original Flask + SQLite app remains in `backend/` and `frontend/` for reference.
The new platform runs from `server/` and `web/`.

## Environment Variables

See `server/.env.example` and `web/.env.example` for all configuration options.
Dev modes (`PAYMENT_DEV_MODE`, `EMAIL_DEV_MODE`, `STORAGE_DEV_MODE`) work without external services.



