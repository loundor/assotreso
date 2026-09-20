import test from 'node:test';
import assert from 'node:assert/strict';
import { absoluteMoneyCents, parseInvoiceAllocations } from '../src/services/allocations.js';

test('normalise les montants positifs d’allocation en centimes', () => {
  assert.deepEqual(parseInvoiceAllocations([
    { projectId: 'project-1', amount: '12,30' },
    { categoryId: 'category-1', amount: 7.5 }
  ]), [
    { projectId: 'project-1', categoryId: null, amount: '12.30', amountCents: 1230 },
    { projectId: null, categoryId: 'category-1', amount: '7.50', amountCents: 750 }
  ]);
  assert.equal(absoluteMoneyCents('-19.90', 'TTC'), 1990);
});

test('refuse les allocations nulles, négatives ou sans cible', () => {
  assert.throws(() => parseInvoiceAllocations([{ projectId: 'project-1', amount: 0 }]));
  assert.throws(() => parseInvoiceAllocations([{ categoryId: 'category-1', amount: '-1.00' }]));
  assert.throws(() => parseInvoiceAllocations([{ amount: '1.00' }]));
});

test('refuse plus de deux décimales', () => {
  assert.throws(() => parseInvoiceAllocations([{ projectId: 'project-1', amount: '1.001' }]));
});
