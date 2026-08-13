import { strFromU8, unzipSync } from 'fflate';

export interface OfficeSlidePreview {
  number: number;
  text: string;
}

const decodeXml = (value: string) =>
  value
    .replaceAll(/<[^>]+>/g, '')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .trim();

const unzipOffice = (data: ArrayBuffer | Uint8Array) => {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return unzipSync(bytes);
};

const matchAllText = (xml: string, pattern: RegExp) =>
  [...xml.matchAll(pattern)].map((match) => decodeXml(match[1] ?? '')).filter(Boolean);

export const parsePptxSlides = (data: ArrayBuffer | Uint8Array): OfficeSlidePreview[] => {
  const files = unzipOffice(data);
  const slidePaths = Object.keys(files)
    .filter((path) => /ppt\/slides\/slide\d+\.xml$/i.test(path))
    .sort((a, b) => {
      const left = Number(a.match(/slide(\d+)/i)?.[1] ?? 0);
      const right = Number(b.match(/slide(\d+)/i)?.[1] ?? 0);
      return left - right;
    });

  return slidePaths.map((path) => {
    const xml = strFromU8(files[path]);
    const number = Number(path.match(/slide(\d+)/i)?.[1] ?? 0);
    const paragraphs = [...xml.matchAll(/<a:p\b[\s\S]*?<\/a:p>/gi)].map((block) =>
      matchAllText(block[0], /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/gi).join(''),
    );
    const text = paragraphs.filter(Boolean).join('\n').trim();
    return { number, text };
  });
};

const toHtmlParagraphs = (lines: string[]) =>
  lines
    .filter(Boolean)
    .map(
      (line) =>
        `<p>${line.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</p>`,
    )
    .join('');

export const parseOdtHtml = (data: ArrayBuffer | Uint8Array): string => {
  const files = unzipOffice(data);
  const content = files['content.xml'];
  if (!content) return '';

  const xml = strFromU8(content);
  const blocks = [...xml.matchAll(/<text:(?:h|p)\b[^>]*>([\s\S]*?)<\/text:(?:h|p)>/gi)].map(
    (match) => decodeXml(match[1] ?? ''),
  );
  return toHtmlParagraphs(blocks);
};

export const parseDocxHtml = (data: ArrayBuffer | Uint8Array): string => {
  const files = unzipOffice(data);
  const document = files['word/document.xml'];
  if (!document) return '';

  const xml = strFromU8(document);
  const paragraphs = [...xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/gi)].map((block) =>
    matchAllText(block[0], /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gi).join(''),
  );
  return toHtmlParagraphs(paragraphs);
};
