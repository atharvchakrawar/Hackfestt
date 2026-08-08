const cron = require('node-cron');
const { runAllCronJobs } = require('../services/cron');

/**
 * Start hourly cron scheduler for event maintenance tasks.
 */
function startCronScheduler() {
  cron.schedule('0 * * * *', async () => {
    try {
      const result = await runAllCronJobs();
      console.log('[CRON]', result);
    } catch (err) {
      console.error('[CRON ERROR]', err);
    }
  });
  console.log('Cron scheduler started (hourly)');
}

if (require.main === module) {
  runAllCronJobs()
    .then((r) => {
      console.log('Manual cron run:', r);
      process.exit(0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

module.exports = { startCronScheduler };
