const ARTIFACT_RE =
  /<lobeArtifact(?:\s[^>]*?)?type=["']text\/html["'][^>]*>([\s\S]*?)<\/lobeArtifact>/i;
const ARTIFACT_LOOSE_RE = /<lobeArtifact(?:\s[^>]*)?>([\s\S]*?)<\/lobeArtifact>/i;

/**
 * Extract a closed text/html lobeArtifact body. Returns null if missing/unclosed.
 */
export const extractOpsHtmlArtifact = (content: string | undefined | null): string | null => {
  if (!content) return null;
  const strict = content.match(ARTIFACT_RE);
  if (strict?.[1]) {
    const html = strict[1].trim();
    return html.length > 0 ? html : null;
  }
  // Prefer type=text/html; if type omitted but closed artifact looks like HTML, accept.
  const loose = content.match(ARTIFACT_LOOSE_RE);
  if (!loose?.[1]) return null;
  const body = loose[1].trim();
  if (!body) return null;
  if (/<!DOCTYPE\s+html/i.test(body) || /<html[\s>]/i.test(body) || /<body[\s>]/i.test(body)) {
    return body;
  }
  return null;
};
