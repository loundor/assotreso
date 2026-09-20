import test from 'node:test';
import assert from 'node:assert/strict';
import { generateRealisticBankFeed } from '../src/services/bankin.js';

test('génère un relevé bancaire réaliste au format Bankin', () => {
  const ops = generateRealisticBankFeed('Crédit Agricole', 'FR7630006000011234567890189');
  assert.ok(Array.isArray(ops));
  assert.ok(ops.length >= 5);
  for (const op of ops) {
    assert.ok(typeof op.operationDate === 'string');
    assert.match(op.operationDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(typeof op.amount === 'number' && op.amount !== 0);
    assert.ok(typeof op.description === 'string' && op.description.length > 0);
  }
});
