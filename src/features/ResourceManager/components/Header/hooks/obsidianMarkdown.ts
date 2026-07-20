/** Paths that should not become notes when importing an Obsidian vault ZIP. */
const SKIP_PATH_SEGMENTS = new Set(['.obsidian', '.trash', '.git', '.smart-env', 'node_modules']);

/**
 * True when this archive entry should be ignored (config dirs, trash, etc.).
 */
export const shouldSkipObsidianPath = (path: string): boolean => {
  const normalized = path.replaceAll('\\', '/');
  return normalized.split('/').some((segment) => SKIP_PATH_SEGMENTS.has(segment));
};

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Parse an Obsidian-style markdown note: strip YAML frontmatter, resolve title.
 * Title priority: frontmatter `title` → first `# heading` → filename stem.
 */
export const parseObsidianMarkdownNote = (
  raw: string,
  filePath: string,
): { content: string; title: string } => {
  let body = raw.replace(/^\uFEFF/, '');
  let frontmatterTitle: string | undefined;

  const fmMatch = body.match(FRONTMATTER_RE);
  if (fmMatch) {
    const block = fmMatch[1];
    const titleLine = block.split(/\r?\n/).find((line) => /^\s*title\s*:/i.test(line));
    if (titleLine) {
      const value = titleLine.replace(/^\s*title\s*:\s*/i, '').trim();
      frontmatterTitle = value
        .replaceAll(/^['"]|['"]$/g, '')
        .replace(/^\[(.*)\]$/, '$1')
        .trim();
      if (!frontmatterTitle) frontmatterTitle = undefined;
    }
    body = body.slice(fmMatch[0].length);
  }

  body = body.trim();

  const lines = body.split('\n');
  const firstLine = lines[0]?.trim() || '';
  let headingTitle: string | undefined;
  if (firstLine.startsWith('#')) {
    headingTitle = firstLine.replace(/^#+\s*/, '').trim() || undefined;
    // Only consume the heading when it is used as the document title.
    if (!frontmatterTitle && headingTitle) {
      body = lines.slice(1).join('\n').trim();
    }
  }

  const filename = filePath.replaceAll('\\', '/').split('/').pop() || 'Untitled';
  const filenameTitle = filename.replace(/\.md$/i, '').replace(/\.markdown$/i, '') || 'Untitled';

  const title = frontmatterTitle || headingTitle || filenameTitle;

  return { content: body, title };
};
