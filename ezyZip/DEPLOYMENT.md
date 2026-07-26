# HackConnect Deployment Notes

## Data Persistence

For deployed production, use a real PostgreSQL database and set `DATABASE_URL` in the server environment.

Required:

```env
NODE_ENV=production
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE
JWT_SECRET=replace_with_a_long_random_secret
FRONTEND_URL=https://your-frontend-domain.com
```

Student profile data, registrations, payments, receipts, and event history are stored in PostgreSQL. After deployment, the same student email will see the same saved profile and participation history after logout/login as long as the deployed server points to the same `DATABASE_URL`.

The local `server/dev-db-snapshot.json` fallback is only for laptop testing when PostgreSQL is not running. Do not use it for production.

## Email

Real email requires SMTP:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_gmail_app_password
EMAIL_FROM=HackConnect <your_email@gmail.com>
EMAIL_DEV_MODE=false
```

Without SMTP credentials, emails are logged only in dev mode and will not reach inboxes.

## Payments

Use Razorpay keys in the server `.env`:

```env
RAZORPAY_KEY_ID=...
RAZORPAY_KEY_SECRET=...
PAYMENT_DEV_MODE=false
```

For live production payments, replace test keys with live Razorpay keys and configure the webhook secret.


