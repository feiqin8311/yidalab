// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { canWorkspacePreview, resolveArtifactHtml, resolveLegacyDocumentId } from './previewSource';

describe('dingpan previewSource', () => {
  it('prefers args.html as message artifact', () => {
    expect(resolveArtifactHtml({ html: '  <html>x</html>  ' })).toBe('<html>x</html>');
    expect(resolveArtifactHtml({ documentId: 'docs_1' })).toBe('');
    expect(resolveArtifactHtml(undefined)).toBe('');
  });

  it('skips document fetch when args.html is present (even with deleted documentId)', () => {
    expect(
      resolveLegacyDocumentId(
        { documentId: 'docs_deleted', html: '<html>still</html>' },
        { documentId: 'docs_deleted' },
      ),
    ).toBe('');
  });

  it('falls back to documentId for legacy rows without message html', () => {
    expect(resolveLegacyDocumentId({ documentId: 'docs_old' }, {})).toBe('docs_old');
    expect(resolveLegacyDocumentId({}, { documentId: 'docs_from_state' })).toBe('docs_from_state');
    expect(resolveLegacyDocumentId({}, {})).toBe('');
  });

  it('enables workspace preview for html or documentId; link-only is false', () => {
    expect(canWorkspacePreview({ html: '<html/>' }, {})).toBe(true);
    expect(canWorkspacePreview({ documentId: 'docs_1' }, {})).toBe(true);
    expect(canWorkspacePreview({}, { documentId: 'docs_1' })).toBe(true);
    expect(canWorkspacePreview({}, {})).toBe(false);
  });
});
