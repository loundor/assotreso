import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePromptMarkdownPath, findAgyExecutable, agyIsAvailable } from '../src/services/agy.js';
import { access } from 'node:fs/promises';

test('trouve le fichier markdown d’instructions', async () => {
  const markdownPath = await resolvePromptMarkdownPath();
  assert.ok(markdownPath.endsWith('analyse_justificatif.md'));
  await assert.doesNotReject(access(markdownPath));
});

test('identifie le binaire agy ou son chemin par défaut', async () => {
  const binary = await findAgyExecutable();
  assert.ok(typeof binary === 'string' && binary.length > 0);
});

test('vérifie la disponibilité de agy sur l’environnement', async () => {
  const available = await agyIsAvailable();
  assert.equal(typeof available, 'boolean');
});
