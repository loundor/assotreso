import test from 'node:test';
import assert from 'node:assert/strict';
import { extractInvoiceFields } from '../src/services/extraction.js';

test('extrait les principaux champs d’une facture française', () => {
  const text = `ACME FOURNITURES\nFacture N° FA-2026-0042\nDate : 14/09/2026\nSIRET : 123 456 789 00012\ncontact@acme.fr\nTotal HT : 100,00 €\nTVA 20% : 20,00 €\nTotal TTC : 120,00 €\nPaiement : carte bancaire`;
  const result = extractInvoiceFields(text);
  assert.equal(result.supplier, 'ACME FOURNITURES');
  assert.equal(result.invoiceDate, '2026-09-14');
  assert.equal(result.invoiceNumber, 'FA-2026-0042');
  assert.equal(result.totalHt, 100);
  assert.equal(result.vatAmount, 20);
  assert.equal(result.totalTtc, 120);
  assert.equal(result.siret, '12345678900012');
  assert.equal(result.email, 'contact@acme.fr');
  assert.equal(result.paymentMethod, 'CARTE BANCAIRE');
  assert.ok(result.confidence >= 0.8);
  assert.deepEqual(result.warnings, []);
});

test('analyse une facture opérateur avec date textuelle et tableau HT/TTC', () => {
  const text = `TISSERAND SEBASTIEN
3 RUE DE LARGITZEN
Facture Freebox
n°1498751217 du 02 Septembre 2026
HT TTC
Services de Free 53,54€ 63,98€
Total 53,54€ 63,98€
Dont TVA 10%: 0,27€ TVA 20%: 10,17€
Somme à payer le 04 Septembre 2026 63,98€
Free SAS au capital de 3.441.812 € - B 421 938 861 RCS Paris`;
  const result = extractInvoiceFields(text);
  assert.equal(result.supplier, 'Free SAS');
  assert.equal(result.recipient, 'TISSERAND SEBASTIEN');
  assert.equal(result.invoiceNumber, '1498751217');
  assert.equal(result.invoiceDate, '2026-09-02');
  assert.equal(result.totalHt, 53.54);
  assert.equal(result.vatAmount, 10.44);
  assert.equal(result.totalTtc, 63.98);
  assert.deepEqual(result.warnings, []);
});

test('calcule la TVA par différence entre TTC et HT', () => {
  const result = extractInvoiceFields('Librairie du Centre\nDate 01/02/2026\nTotal HT 45,00\nNet à payer 49,50');
  assert.equal(result.totalHt, 45);
  assert.equal(result.totalTtc, 49.5);
  assert.equal(result.vatAmount, 4.5);
});

test('reste prudent lorsque le texte est insuffisant', () => {
  const result = extractInvoiceFields('DOCUMENT ILLISIBLE');
  assert.equal(result.totalTtc, null);
  assert.equal(result.invoiceDate, null);
  assert.ok(result.confidence < 0.5);
  assert.ok(result.warnings.includes('Montant TTC non détecté.'));
});

test('signale une incohérence entre les montants', () => {
  const result = extractInvoiceFields('Société Exemple\n01-08-2026\nTotal HT: 100,00\nTVA: 30,00\nTotal TTC: 120,00');
  assert.ok(result.warnings.some((warning) => warning.includes('incohérents')));
});
