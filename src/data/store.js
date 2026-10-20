'use strict';

/**
 * In-memory data store seeded with demo invoices. Serverless instances are
 * stateless, so writes live for the lifetime of a warm instance only; this is
 * intentional for the public demo (no database required).
 */

const STATUSES = ['open', 'funded', 'settled', 'cancelled'];

const seed = () => [
  {
    id: 'INV_0001',
    sme: 'Acme Components Ltd',
    smeAddress: 'GA7TXEBMEPQCLHIYCWDN7RKAO5IMRD2UV7O7TZXMEW6VZUMEXNR4XBB5',
    debtor: 'Globex Retail',
    amount: 100,
    currency: 'XLM',
    fundedAmount: 0,
    yieldBps: 800,
    dueDate: '2027-01-17',
    // maturity = 00:00:00 UTC of dueDate = 1800144000; on-chain seed = 1800132005 (delta ≈ 3.3 h, within ±1 day).
    maturity: 1800144000,
    status: 'open',
    onChain: true,
    createdAt: '2026-10-19T00:00:00.000Z',
  },
  {
    id: 'INV_0002',
    sme: 'Northwind Textiles',
    smeAddress: 'GBNORTHWINDDEMOADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    debtor: 'Initech Wholesale',
    amount: 25000,
    currency: 'USDC',
    fundedAmount: 18000,
    yieldBps: 650,
    dueDate: '2026-12-30',
    maturity: 1798588800,
    status: 'open',
    onChain: false,
    createdAt: '2026-10-02T09:30:00.000Z',
  },
  {
    id: 'INV_0003',
    sme: 'Blue Harbor Logistics',
    smeAddress: 'GBBLUEHARBORDEMOADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    debtor: 'Umbrella Foods',
    amount: 42000,
    currency: 'USDC',
    fundedAmount: 42000,
    yieldBps: 720,
    dueDate: '2026-11-28',
    maturity: 1795824000,
    status: 'funded',
    onChain: false,
    createdAt: '2026-09-15T14:00:00.000Z',
  },
  {
    id: 'INV_0004',
    sme: 'Sunrise Agritech',
    smeAddress: 'GBSUNRISEDEMOADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    debtor: 'Stark Industries',
    amount: 12500,
    currency: 'USDC',
    fundedAmount: 12500,
    yieldBps: 900,
    dueDate: '2026-09-30',
    maturity: 1790726400,
    status: 'settled',
    onChain: false,
    createdAt: '2026-07-01T08:00:00.000Z',
  },
];

let invoices = seed();

/** @returns {object[]} all invoices */
function list() {
  return invoices;
}

/**
 * @param {string} id invoice id
 * @returns {object|undefined} the invoice
 */
function get(id) {
  return invoices.find((i) => i.id === id);
}

/**
 * @param {object} invoice validated invoice fields
 * @returns {object} the stored invoice
 */
function create(invoice) {
  const id = `INV_${String(invoices.length + 1).padStart(4, '0')}`;
  const record = {
    id,
    fundedAmount: 0,
    status: 'open',
    onChain: false,
    createdAt: new Date().toISOString(),
    ...invoice,
  };
  invoices.push(record);
  return record;
}

/**
 * Records an investor contribution against an open invoice.
 *
 * @param {object} invoice target invoice
 * @param {number} amount contribution amount
 * @returns {object} updated invoice
 */
function fund(invoice, amount) {
  invoice.fundedAmount = Math.min(invoice.amount, invoice.fundedAmount + amount);
  if (invoice.fundedAmount >= invoice.amount) {
    invoice.status = 'funded';
  }
  return invoice;
}

/** Restores the seed data (used by tests). */
function reset() {
  invoices = seed();
}

module.exports = { STATUSES, list, get, create, fund, reset };
