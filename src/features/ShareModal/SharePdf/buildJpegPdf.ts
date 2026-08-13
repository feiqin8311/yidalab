const encoder = new TextEncoder();

const padOffset = (offset: number) => offset.toString().padStart(10, '0');

/**
 * Wrap JPEG page images in a minimal single/multi-page PDF.
 * Pages are drawn 1:1 into an A4-sized media box (caller scales the JPEG).
 */
export const buildJpegPdf = (
  pages: Array<{
    height: number;
    jpeg: Uint8Array;
    pixelHeight?: number;
    pixelWidth?: number;
    width: number;
  }>,
): Uint8Array => {
  if (pages.length === 0) {
    throw new Error('PDF has no pages');
  }

  const chunks: Uint8Array[] = [];
  let offset = 0;
  const write = (data: Uint8Array | string) => {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data;
    chunks.push(bytes);
    offset += bytes.length;
  };

  write('%PDF-1.4\n');

  const xref: number[] = [0];
  const obj = (id: number, body: string | Uint8Array[]) => {
    xref[id] = offset;
    write(`${id} 0 obj\n`);
    if (typeof body === 'string') {
      write(body);
    } else {
      for (const part of body) write(part);
    }
    write('\nendobj\n');
  };

  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');

  const pageObjectIds = pages.map((_, i) => 3 + i * 3);
  obj(
    2,
    `<< /Type /Pages /Count ${pages.length} /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] >>`,
  );

  for (const [i, page] of pages.entries()) {
    const pageId = 3 + i * 3;
    const contentId = pageId + 1;
    const imageId = pageId + 2;
    const content = `q ${page.width} 0 0 ${page.height} 0 0 cm /Im0 Do Q`;
    const contentBytes = encoder.encode(content);

    obj(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] /Contents ${contentId} 0 R /Resources << /XObject << /Im0 ${imageId} 0 R >> >> >>`,
    );
    obj(contentId, [
      encoder.encode(`<< /Length ${contentBytes.length} >>\nstream\n`),
      contentBytes,
      encoder.encode('\nendstream'),
    ]);
    const imageWidth = page.pixelWidth ?? page.width;
    const imageHeight = page.pixelHeight ?? page.height;
    obj(imageId, [
      encoder.encode(
        `<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
      ),
      page.jpeg,
      encoder.encode('\nendstream'),
    ]);
  }

  const xrefOffset = offset;
  write(`xref\n0 ${xref.length}\n`);
  write('0000000000 65535 f \n');
  for (let i = 1; i < xref.length; i++) {
    write(`${padOffset(xref[i])} 00000 n \n`);
  }
  write(`trailer\n<< /Size ${xref.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  const out = new Uint8Array(offset);
  let cursor = 0;
  for (const chunk of chunks) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  return out;
};

export const bytesToBase64 = (bytes: Uint8Array): string => {
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
};
