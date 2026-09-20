import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type { MultipartFile } from '@fastify/multipart';
import { config } from '../config.js';
import { ApiError } from '../errors.js';

export const allowedDocumentMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf'
]);

const extensions: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf'
};

function hasExpectedSignature(buffer: Buffer, mimeType: string): boolean {
  if (mimeType === 'application/pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  if (mimeType === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === 'image/webp') return buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  return false;
}

export interface StoredUpload {
  originalName: string;
  storedName: string;
  mimeType: string;
  sizeBytes: number;
  path: string;
  buffer: Buffer;
}

export async function storeMultipartFile(part: MultipartFile): Promise<StoredUpload> {
  if (!allowedDocumentMimeTypes.has(part.mimetype)) {
    throw new ApiError(415, 'Format refusé. Utilisez une image JPEG, PNG, WEBP ou un PDF.', 'TYPE_FICHIER_REFUSE');
  }
  const buffer = await part.toBuffer();
  if (part.file.truncated || buffer.byteLength > config.maxUploadBytes) {
    throw new ApiError(413, 'Le fichier dépasse la taille maximale de 10 Mo.', 'FICHIER_TROP_VOLUMINEUX');
  }
  if (buffer.byteLength === 0) throw new ApiError(400, 'Le fichier envoyé est vide.', 'FICHIER_VIDE');
  if (!hasExpectedSignature(buffer, part.mimetype)) {
    throw new ApiError(415, 'Le contenu du fichier ne correspond pas au format annoncé.', 'TYPE_FICHIER_REFUSE');
  }
  const now = new Date();
  const dateDirectory = [
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0')
  ].join('/');
  const directory = join(config.storageDir, dateDirectory);
  await mkdir(directory, { recursive: true });
  const filename = `${randomUUID()}${extensions[part.mimetype] ?? extname(part.filename).toLowerCase()}`;
  const storedName = `${dateDirectory}/${filename}`;
  const path = join(config.storageDir, storedName);
  await writeFile(path, buffer, { flag: 'wx' });
  return {
    originalName: basename(part.filename).slice(0, 255),
    storedName,
    mimeType: part.mimetype,
    sizeBytes: buffer.byteLength,
    path,
    buffer
  };
}

export async function removeStoredFile(path: string): Promise<void> {
  await unlink(path).catch(() => undefined);
}

export function storedFilePath(storedName: string): string {
  if (!/^(?:\d{4}\/\d{2}\/\d{2}\/)?[0-9a-f-]{36}\.(?:jpg|png|webp|pdf)$/.test(storedName)) {
    throw new ApiError(400, 'Nom de fichier stocké invalide.', 'FICHIER_INVALIDE');
  }
  return join(config.storageDir, storedName);
}
