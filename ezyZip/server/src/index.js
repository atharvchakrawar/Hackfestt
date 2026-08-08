const express = require('express');
const cors = require('cors');
const passport = require('passport');
const path = require('path');
const config = require('./config');
const { startCronScheduler } = require('./jobs/cron');
const { LOCAL_UPLOAD_DIR } = require('./services/storage');
const { getListingFee, getBoostPricing } = require('./services/settings');

const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profiles');
const eventRoutes = require('./routes/events');
const registrationRoutes = require('./routes/registrations');
const paymentRoutes = require('./routes/payments');
const adminRoutes = require('./routes/admin');
const organizerRoutes = require('./routes/organizer');

const app = express();

app.use(cors({ origin: config.frontendUrl, credentials: true }));
app.use(express.json({
  limit: '10mb',
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  },
}));
app.use(passport.initialize());
app.use('/uploads', express.static(LOCAL_UPLOAD_DIR));

app.get('/', (_req, res) => {
  res.json({
    name: 'HackConnect API',
    status: 'ok',
    frontend: config.frontendUrl,
    health: '/api/health'
  });
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', version: '3.0.0' });
});

app.get('/api/settings/public', async (_req, res) => {
  try {
    const listingFee = await getListingFee();
    const boostPricing = await getBoostPricing();
    res.json({ listing_fee: listingFee, boost_pricing: boostPricing });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/registrations', registrationRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin/settings', adminRoutes);
app.use('/api/organizer', organizerRoutes);

/** Manual cron trigger (admin/dev) */
app.post('/api/cron/run', async (_req, res) => {
  const { runAllCronJobs } = require('./services/cron');
  const result = await runAllCronJobs();
  res.json(result);
});

const PORT = config.port;

if (require.main === module) {
  startCronScheduler();
  app.listen(PORT, () => {
    console.log(`HackConnect API running on http://localhost:${PORT}`);
  });
}

module.exports = app;


