# Implementation TODO (Feature 1–14)

## Phase 0 — Audit & Alignment
- [ ] Inspect Node DB migrations/schema to confirm existing tables/columns: events, registrations, team_members, payments, settings, email_logs.
- [ ] Inspect Node cron job wiring and verify update mechanisms for updated_at/is_visible/boost expiry.
- [ ] Inspect frontend DiscoverContent + filters routing to see which backend it calls.
- [ ] Decide mapping: which backend endpoints the Next app should use (prefer Node server).

## Phase 1 — Dual Payment Ecosystem
- [ ] Ensure payment types: student registration vs organizer listing exist end-to-end.
- [ ] Implement/verify Razorpay order creation, webhook verification, DB updates on success.
- [ ] Receipt generation: exact required fields; upload to S3/Cloudinary; store receipt_url.
- [ ] Store payment records in payments table with required fields.
- [ ] Email receipt attachments (Nodemailer + HTML template); implement email_logs.
- [ ] Team receipt + team member emailing.

## Phase 2 — Filters/Sorting/UI
- [ ] College dropdown filter: dynamic distinct colleges + URL query param sync.
- [ ] updated_at + Sort By dropdown: Newest/Oldest/Date Modified/Event Date (Upcoming).
- [ ] event visibility + registration closed/full badges in EventCard/detail.

## Phase 3 — Cron Jobs (idempotent)
- [ ] Hourly cron: auto-close registrations and auto-hide past events.
- [ ] Full-cap logic: current_registrations counter + registration_status='full'.
- [ ] Boost expiry cron resets is_boosted.

## Phase 4 — Team Registration
- [ ] participation_type + team min/max.
- [ ] team_members table insert during registration.
- [ ] Payment per team; disable register when full.

## Phase 5 — Export
- [ ] Organizer-only Excel export route /api/organizer/events/:id/export.
- [ ] exceljs generation with required columns.

## Phase 6 — Sponsored UI
- [ ] Boosted pinning in listing and “Sponsored” styling.

## Phase 7 — OAuth + Profile + Confirmation
- [ ] next-auth Google OAuth.
- [ ] /profile page: user_profiles + organizer verification fields.
- [ ] Auto-fill registration forms from profile.
- [ ] Transactional HTML confirmation email + receipts.

## Phase 8 — Hardening
- [ ] Add/verify role middleware guards for all new routes.
- [ ] Add JSDoc/comments for new functions.
- [ ] Run lint/tests/build and ensure routes work.

