import test from 'node:test';
import assert from 'node:assert/strict';
import { csvEscape, parseBankCsv, parseCsvRows } from '../src/services/csv.js';

test('parse un CSV bancaire français débit/crédit', () => {
  const csv = 'Date opération;Libellé;Débit;Crédit;Référence\n14/09/2026;Achat matériel;19,90;;CB42\n15/09/2026;Cotisation;;50,00;VIR7';
  const rows = parseBankCsv(csv);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    operationDate: '2026-09-14',
    amount: -19.9,
    description: 'Achat matériel',
    bankLabel: 'Achat matériel',
    bankReference: 'CB42'
  });
  assert.equal(rows[1]?.amount, 50);
});

test('gère les séparateurs et guillemets CSV', () => {
  assert.deepEqual(parseCsvRows('a,b\n"x,y","z""z"'), [['a', 'b'], ['x,y', 'z"z']]);
  assert.equal(csvEscape('Texte; avec "guillemets"'), '"Texte; avec ""guillemets"""');
});
