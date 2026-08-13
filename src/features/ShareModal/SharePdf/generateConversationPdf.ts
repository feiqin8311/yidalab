import { marked } from 'marked';

import { buildJpegPdf, bytesToBase64 } from './buildJpegPdf';

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 48;
const SCALE = 2;
const FONT =
  'system-ui, "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", "Microsoft YaHei", sans-serif';

const contentWidth = PAGE_WIDTH - MARGIN * 2;

const wrapText = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] => {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (!paragraph) {
      lines.push('');
      continue;
    }
    let current = '';
    for (const ch of paragraph) {
      const next = current + ch;
      if (current && ctx.measureText(next).width > maxWidth) {
        lines.push(current);
        current = ch;
      } else {
        current = next;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
};

const canvasToJpeg = async (canvas: HTMLCanvasElement): Promise<Uint8Array> => {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (next) => (next ? resolve(next) : reject(new Error('Failed to encode PDF page'))),
      'image/jpeg',
      0.86,
    );
  });
  return new Uint8Array(await blob.arrayBuffer());
};

const createPageCanvas = () => {
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_WIDTH * SCALE;
  canvas.height = PAGE_HEIGHT * SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  ctx.fillStyle = '#222';
  ctx.textBaseline = 'top';
  return { canvas, ctx };
};

export const generateConversationPdf = async (
  markdownContent: string,
  title?: string,
): Promise<{ filename: string; pdf: string }> => {
  const tokens = marked.lexer(markdownContent || '');
  const pages: Array<{
    height: number;
    jpeg: Uint8Array;
    pixelHeight: number;
    pixelWidth: number;
    width: number;
  }> = [];

  let { canvas, ctx } = createPageCanvas();
  let y = MARGIN;

  const flushPage = async () => {
    pages.push({
      height: PAGE_HEIGHT,
      jpeg: await canvasToJpeg(canvas),
      pixelHeight: canvas.height,
      pixelWidth: canvas.width,
      width: PAGE_WIDTH,
    });
    ({ canvas, ctx } = createPageCanvas());
    y = MARGIN;
  };

  const ensureSpace = async (height: number) => {
    if (y + height > PAGE_HEIGHT - MARGIN) await flushPage();
  };

  const drawLines = async (lines: string[], font: string, lineHeight: number, color: string) => {
    ctx.fillStyle = color;
    ctx.font = font;
    for (const line of lines) {
      await ensureSpace(lineHeight);
      ctx.fillText(line, MARGIN, y);
      y += lineHeight;
    }
  };

  if (title?.trim()) {
    ctx.font = `bold 18px ${FONT}`;
    const titleLines = wrapText(ctx, title.trim(), contentWidth);
    await drawLines(titleLines, `bold 18px ${FONT}`, 26, '#111');
    y += 12;
  }

  for (const token of tokens) {
    switch (token.type) {
      case 'heading': {
        const size = Math.max(16 - (token.depth - 1) * 2, 12);
        ctx.font = `bold ${size}px ${FONT}`;
        await drawLines(
          wrapText(ctx, token.text, contentWidth),
          `bold ${size}px ${FONT}`,
          size + 8,
          '#222',
        );
        y += 4;
        break;
      }
      case 'paragraph': {
        ctx.font = `12px ${FONT}`;
        await drawLines(wrapText(ctx, token.text, contentWidth), `12px ${FONT}`, 18, '#333');
        y += 8;
        break;
      }
      case 'list': {
        ctx.font = `12px ${FONT}`;
        for (const item of token.items) {
          await drawLines(
            wrapText(ctx, `• ${item.text}`, contentWidth),
            `12px ${FONT}`,
            18,
            '#333',
          );
        }
        y += 8;
        break;
      }
      case 'blockquote': {
        ctx.font = `12px ${FONT}`;
        await drawLines(wrapText(ctx, token.text, contentWidth), `12px ${FONT}`, 18, '#666');
        y += 8;
        break;
      }
      case 'code': {
        ctx.font = `10px ui-monospace, SFMono-Regular, Menlo, monospace`;
        await drawLines(
          wrapText(ctx, token.text, contentWidth),
          `10px ui-monospace, SFMono-Regular, Menlo, monospace`,
          14,
          '#333',
        );
        y += 8;
        break;
      }
      case 'hr': {
        await ensureSpace(16);
        ctx.strokeStyle = '#ddd';
        ctx.beginPath();
        ctx.moveTo(MARGIN, y + 6);
        ctx.lineTo(PAGE_WIDTH - MARGIN, y + 6);
        ctx.stroke();
        y += 16;
        break;
      }
      default: {
        if ('text' in token && token.text) {
          ctx.font = `12px ${FONT}`;
          await drawLines(
            wrapText(ctx, String(token.text), contentWidth),
            `12px ${FONT}`,
            18,
            '#333',
          );
        }
      }
    }
  }

  await flushPage();

  const safeTitle = (title?.trim() || 'chat-export').replaceAll(/[\\/:*?"<>|]/g, '_');
  return {
    filename: `${safeTitle}.pdf`,
    pdf: bytesToBase64(buildJpegPdf(pages)),
  };
};
