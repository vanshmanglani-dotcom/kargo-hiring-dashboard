import 'server-only';

export interface ParsedFile {
  text: string;
  mime: string;
  bytes: Buffer;
}

/** Pull plain text out of a CV file (PDF, DOCX or TXT). Scanned/image PDFs return little text — the
 *  extraction step then sends the file itself to Gemini to read. */
export async function parseFile(file: File): Promise<ParsedFile> {
  const bytes = Buffer.from(await file.arrayBuffer());
  const name = file.name.toLowerCase();
  let mime = file.type || '';
  let text = '';

  if (name.endsWith('.pdf') || mime === 'application/pdf' || bytes.subarray(0, 4).toString() === '%PDF') {
    mime = 'application/pdf';
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const out = await extractText(pdf, { mergePages: true });
    text = Array.isArray(out.text) ? out.text.join('\n') : out.text;
  } else if (name.endsWith('.docx') || bytes.subarray(0, 2).toString() === 'PK') {
    mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const mammoth = await import('mammoth');
    text = (await mammoth.extractRawText({ buffer: bytes })).value;
  } else {
    mime = 'text/plain';
    text = bytes.toString('utf8');
  }
  return { text: normalise(text), mime, bytes };
}

function normalise(t: string) {
  return t
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
