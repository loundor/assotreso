import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const VERSION = 'v1';
const KEY_SALT = 'association-tresorerie/ai-settings/v1';

function encryptionKey(secret: string): Buffer {
  if (!secret) throw new Error('La clé de chiffrement ne peut pas être vide.');
  return scryptSync(secret, KEY_SALT, 32);
}

export function encryptSecret(value: string, keyMaterial: string): string {
  if (!value) throw new Error('Le secret à chiffrer ne peut pas être vide.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(keyMaterial), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join(':');
}

export function decryptSecret(envelope: string, keyMaterial: string): string {
  const [version, encodedIv, encodedTag, encodedValue, ...extra] = envelope.split(':');
  if (version !== VERSION || !encodedIv || !encodedTag || !encodedValue || extra.length > 0) {
    throw new Error('Format de secret chiffré invalide.');
  }
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(keyMaterial), Buffer.from(encodedIv, 'base64url'));
  decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedValue, 'base64url')),
    decipher.final()
  ]).toString('utf8');
}
