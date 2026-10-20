'use strict';

const config = require('./config');

const Invoice = {
  type: 'object',
  properties: {
    id: { type: 'string', example: 'INV_0001' },
    sme: { type: 'string', example: 'Acme Components Ltd' },
    smeAddress: { type: 'string', nullable: true },
    debtor: { type: 'string', example: 'Globex Retail' },
    amount: { type: 'number', example: 25000 },
    currency: { type: 'string', example: 'USDC' },
    fundedAmount: { type: 'number', example: 0 },
    yieldBps: { type: 'integer', example: 800 },
    dueDate: { type: 'string', format: 'date', description: 'ISO 8601 calendar date (YYYY-MM-DD). Must be a real date strictly in the future and within the contract horizon.' },
    maturity: {
      type: 'integer',
      description:
        'Unix timestamp in seconds for the on-chain maturity. Defined as 00:00:00 UTC of the day after dueDate. ' +
        'For INV_0001 (dueDate 2027-01-17) this equals 1800172800, within ±1 day of the on-chain seed value 1800132005.',
      example: 1800172800,
    },
    status: { type: 'string', enum: ['open', 'funded', 'settled', 'cancelled'] },
    onChain: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
  },
};

const json = (schema) => ({ content: { 'application/json': { schema } } });
const ErrorBody = { type: 'object', properties: { error: { type: 'string' } } };
const ValidationErrorBody = {
  type: 'object',
  properties: {
    error: { type: 'string', example: 'Validation failed' },
    details: { type: 'array', items: { type: 'string' }, description: 'Per-field error messages' },
  },
};

/**
 * Builds the OpenAPI document for the given public base URL.
 *
 * @param {string} baseUrl server URL to advertise
 * @returns {object} OpenAPI 3.0 document
 */
function buildSpec(baseUrl) {
  return {
    openapi: '3.0.3',
    info: {
      title: 'LiquiFact API',
      version: config.version,
      description:
        'Invoice liquidity network on Stellar. SMEs tokenize invoices, investors fund them, and a Soroban escrow ' +
        `contract holds funds until settlement. Escrow contract (testnet): ${config.contractId}`,
    },
    servers: [{ url: baseUrl }],
    tags: [{ name: 'System' }, { name: 'Invoices' }, { name: 'Escrow' }],
    paths: {
      '/health': {
        get: {
          tags: ['System'],
          summary: 'Liveness probe',
          responses: { 200: { description: 'Service is up', ...json({ type: 'object' }) } },
        },
      },
      '/api/stats': {
        get: { tags: ['System'], summary: 'Marketplace totals', responses: { 200: { description: 'Totals' } } },
      },
      '/api/invoices': {
        get: {
          tags: ['Invoices'],
          summary: 'List invoices',
          parameters: [
            {
              name: 'status',
              in: 'query',
              schema: { type: 'string', enum: ['open', 'funded', 'settled', 'cancelled'] },
            },
            {
              name: 'dueBefore',
              in: 'query',
              description: 'Return only invoices whose dueDate is strictly before this YYYY-MM-DD date.',
              schema: { type: 'string', format: 'date' },
            },
            {
              name: 'dueAfter',
              in: 'query',
              description: 'Return only invoices whose dueDate is strictly after this YYYY-MM-DD date.',
              schema: { type: 'string', format: 'date' },
            },
          ],
          responses: {
            200: {
              description: 'Invoices',
              ...json({
                type: 'object',
                properties: {
                  data: { type: 'array', items: Invoice },
                  count: { type: 'integer' },
                },
              }),
            },
            400: { description: 'Invalid filter (status, dueBefore, or dueAfter)', ...json(ErrorBody) },
          },
        },
        post: {
          tags: ['Invoices'],
          summary: 'Submit an invoice for financing',
          description:
            `dueDate must be a real ISO 8601 calendar date (YYYY-MM-DD), strictly more than ` +
            `${config.minTenorDays} day(s) in the future and at most ${config.maxTenorDays} days out ` +
            `(≈ 5 years, matching the escrow contract's maturity_max_horizon). ` +
            `The response includes a computed \`maturity\` (Unix seconds) for on-chain use.`,
          requestBody: {
            required: true,
            ...json({
              type: 'object',
              required: ['sme', 'debtor', 'amount', 'dueDate'],
              properties: {
                sme: { type: 'string' },
                debtor: { type: 'string' },
                amount: { type: 'number' },
                currency: { type: 'string', default: 'USDC' },
                yieldBps: { type: 'integer', default: 800 },
                dueDate: {
                  type: 'string',
                  format: 'date',
                  description:
                    'Canonical YYYY-MM-DD. Must be a real calendar date, strictly in the future ' +
                    '(> today + MIN_TENOR_DAYS), and within MAX_TENOR_DAYS (default 1825 ≈ 5 years).',
                },
                smeAddress: { type: 'string' },
              },
            }),
          },
          responses: {
            201: { description: 'Created', ...json({ type: 'object', properties: { data: Invoice } }) },
            400: { description: 'Validation failed (per-field errors)', ...json(ValidationErrorBody) },
          },
        },
      },
      '/api/invoices/{id}': {
        get: {
          tags: ['Invoices'],
          summary: 'Get an invoice',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: { description: 'Invoice', ...json({ type: 'object', properties: { data: Invoice } }) },
            404: { description: 'Not found', ...json(ErrorBody) },
          },
        },
      },
      '/api/invoices/{id}/fund': {
        post: {
          tags: ['Invoices'],
          summary: 'Record an investor contribution (demo, off-chain)',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { required: true, ...json({ type: 'object', properties: { amount: { type: 'number' } } }) },
          responses: {
            200: { description: 'Updated invoice' },
            400: { description: 'Invalid amount' },
            404: { description: 'Not found' },
            409: { description: 'Invoice not open' },
          },
        },
      },
      '/api/escrow': {
        get: { tags: ['Escrow'], summary: 'Deployed escrow contract metadata', responses: { 200: { description: 'Contract info' } } },
      },
      '/api/escrow/live': {
        get: {
          tags: ['Escrow'],
          summary: 'Live escrow state read from Soroban RPC (falls back to deploy snapshot)',
          responses: { 200: { description: 'Escrow state' } },
        },
      },
    },
  };
}

module.exports = { buildSpec };
