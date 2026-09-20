import pdfParse from 'pdf-parse';
import Tesseract from 'tesseract.js';
import { extractInvoiceFields, type ExtractedAnalysis } from './extraction.js';

export interface OcrResult {
  text: string;
  analysis: ExtractedAnalysis;
}

export async function analyzeDocument(buffer: Buffer, mimeType: string): Promise<OcrResult> {
  let text: string;
  if (mimeType === 'application/pdf') {
    try {
      const parsed = await pdfParse(buffer);
      text = parsed.text.trim();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'erreur inconnue';
      throw new Error(`Impossible d'extraire le texte du PDF : ${message}`);
    }
    if (!text) {
      throw new Error("Ce PDF ne contient pas de texte extractible. Convertissez sa page en image pour utiliser l'OCR.");
    }
  } else {
    const result = await Tesseract.recognize(buffer, 'fra+eng', { logger: () => undefined });
    text = result.data.text.trim();
  }
  return { text, analysis: extractInvoiceFields(text) };
}
