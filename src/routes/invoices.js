'use strict';

const express = require('express');
const store = require('../data/store');
const config = require('../config');
const { parseIsoDate } = require('../lib/dates');

const router = express.Router();

/**
 * Returns midnight UTC of today (start of the current UTC day).
 *
 * @param {number} nowMs  Current epoch ms (injectable for tests, defaults to Date.now()).
 * @returns {number} Epoch ms of 00:00:00 UTC today.
 */
function todayUtcMs(nowMs) {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Validates a create-invoice payload.
 *
 * dueDate rules:
 *  1. Must match /^\d{4}-\d{2}-\d{2}$/ exactly (no lenient Date.parse).
 *  2. Must be a real calendar date (no roll-overs like 2027-02-30).
 *  3. Must be strictly > today + MIN_TENOR_DAYS (UTC).
 *  4. Must be <= today + MAX_TENOR_DAYS (UTC, matches escrow contract horizon).
 *
 * @param {object} body  Request body.
 * @param {{ now?: number }} [opts]  Injectable clock; `now` is epoch ms (default Date.now()).
 * @returns {{ value?: object, errors?: string[] }}
 */
function validateInvoice(body, opts = {}) {
  const errors = [];
  const b = body || {};
  const str = (k, max = 120) => {
    if (typeof b[k] !== 'string' || !b[k].trim() || b[k].length > max) {
      errors.push(`${k} must be a non-empty string (max ${max} chars)`);
    }
  };
  str('sme');
  str('debtor');
  if (typeof b.amount !== 'number' || !(b.amount > 0) || b.amount > 1e12) {
    errors.push('amount must be a positive number');
  }
  const yieldBps = b.yieldBps === undefined ? 800 : b.yieldBps;
  if (!Number.isInteger(yieldBps) || yieldBps < 0 || yieldBps > 10000) {
    errors.push('yieldBps must be an integer between 0 and 10000');
  }

  // --- dueDate validation ---
  const parsed = parseIsoDate(b.dueDate);
  if (!parsed) {
    errors.push('dueDate must be a real calendar date in YYYY-MM-DD format');
  } else {
    const nowMs = typeof opts.now === 'number' ? opts.now : Date.now();
    const todayMs = todayUtcMs(nowMs);
    const minMs = todayMs + config.minTenorDays * 86_400_000;
    const maxMs = todayMs + config.maxTenorDays * 86_400_000;
    const dueDateMs = parsed.date.getTime(); // 00:00:00 UTC of dueDate

    if (dueDateMs < minMs) {
      errors.push(
        `dueDate must be at least ${config.minTenorDays} day(s) in the future (received ${b.dueDate})`
      );
    } else if (dueDateMs > maxMs) {
      errors.push(
        `dueDate must be within ${config.maxTenorDays} days from today (max ~${Math.round(config.maxTenorDays / 365)} years)`
      );
    }
  }

  if (errors.length) {
    return { errors };
  }

  return {
    value: {
      sme: b.sme.trim(),
      debtor: b.debtor.trim(),
      smeAddress: typeof b.smeAddress === 'string' ? b.smeAddress : null,
      amount: b.amount,
      currency: typeof b.currency === 'string' ? b.currency.toUpperCase().slice(0, 12) : 'USDC',
      yieldBps,
      dueDate: b.dueDate,
      maturity: parsed.unixSeconds,
    },
  };
}

router.get('/', (req, res) => {
  const { status, dueBefore, dueAfter } = req.query;

  if (status && !store.STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of ${store.STATUSES.join(', ')}` });
  }

  // Validate dueBefore / dueAfter filters with the same strict parser.
  let dueBeforeDate = null;
  let dueAfterDate = null;

  if (dueBefore !== undefined) {
    const p = parseIsoDate(dueBefore);
    if (!p) {
      return res
        .status(400)
        .json({ error: 'dueBefore must be a real calendar date in YYYY-MM-DD format' });
    }
    dueBeforeDate = p.date;
  }
  if (dueAfter !== undefined) {
    const p = parseIsoDate(dueAfter);
    if (!p) {
      return res
        .status(400)
        .json({ error: 'dueAfter must be a real calendar date in YYYY-MM-DD format' });
    }
    dueAfterDate = p.date;
  }

  let data = store.list();
  if (status) {
    data = data.filter((i) => i.status === status);
  }
  if (dueBeforeDate) {
    data = data.filter((i) => {
      const p = parseIsoDate(i.dueDate);
      return p && p.date < dueBeforeDate;
    });
  }
  if (dueAfterDate) {
    data = data.filter((i) => {
      const p = parseIsoDate(i.dueDate);
      return p && p.date > dueAfterDate;
    });
  }

  return res.json({ data, count: data.length });
});

router.get('/:id', (req, res) => {
  const invoice = store.get(req.params.id);
  if (!invoice) {
    return res.status(404).json({ error: 'Invoice not found' });
  }
  return res.json({ data: invoice });
});

router.post('/', (req, res) => {
  const { value, errors } = validateInvoice(req.body);
  if (errors) {
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }
  return res.status(201).json({ data: store.create(value) });
});

router.post('/:id/fund', (req, res) => {
  const invoice = store.get(req.params.id);
  if (!invoice) {
    return res.status(404).json({ error: 'Invoice not found' });
  }
  const amount = req.body && req.body.amount;
  if (typeof amount !== 'number' || !(amount > 0)) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }
  if (invoice.status !== 'open') {
    return res.status(409).json({ error: `Invoice is ${invoice.status}; only open invoices can be funded` });
  }
  return res.json({ data: store.fund(invoice, amount) });
});

module.exports = router;
module.exports.validateInvoice = validateInvoice;
