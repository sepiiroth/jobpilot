import { workerData, parentPort } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
try {
  const { getDocumentProxy, extractText } = await import(
    pathToFileURL(workerData.module)
  );
  const pdf = await getDocumentProxy(workerData.pdf, {
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    enableXfa: false,
    maxImageSize: 0,
  });
  try {
    if (pdf.numPages > 20) throw new Error('Page limit');
    const { text } = await extractText(pdf, { mergePages: true });
    if (!text.trim() || Buffer.byteLength(text) > 100000)
      throw new Error('Text limit');
    parentPort.postMessage({ text });
  } finally {
    await pdf.destroy();
  }
} catch {
  parentPort.postMessage({ error: 'PDF_UNREADABLE' });
}
