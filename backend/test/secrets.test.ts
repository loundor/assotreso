import test from 'node:test';
import assert from 'node:assert/strict';
import { decryptSecret, encryptSecret } from '../src/services/secrets.js';

test('chiffre et déchiffre un secret avec AES-GCM', () => {
  const encrypted = encryptSecret('sk-secret', 'jwt-secret-de-test');
  assert.notEqual(encrypted, 'sk-secret');
  assert.equal(decryptSecret(encrypted, 'jwt-secret-de-test'), 'sk-secret');
});

test('refuse de déchiffrer avec une autre clé', () => {
  const encrypted = encryptSecret('oauth-token', 'premiere-cle');
  assert.throws(() => decryptSecret(encrypted, 'autre-cle'));
});
