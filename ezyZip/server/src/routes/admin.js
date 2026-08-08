const express = require('express');
const { query } = require('../db/pool');
const { isAdmin } = require('../middleware/auth');
const { getAllSettings, setSetting } = require('../services/settings');

const router = express.Router();

/** Get all platform settings */
router.get('/', isAdmin, async (_req, res) => {
  try {
    const settings = await getAllSettings();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Update a setting by key */
router.put('/:key', isAdmin, async (req, res) => {
  try {
    const { value, description } = req.body;
    const setting = await setSetting(req.params.key, value, description);
    res.json(setting);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Bulk update settings */
router.put('/', isAdmin, async (req, res) => {
  try {
    const updates = req.body;
    for (const [key, data] of Object.entries(updates)) {
      await setSetting(key, data.value ?? data, data.description);
    }
    res.json(await getAllSettings());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
