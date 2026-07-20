import { describe, expect, it } from 'vitest';

import { parseObsidianMarkdownNote, shouldSkipObsidianPath } from './obsidianMarkdown';

describe('shouldSkipObsidianPath', () => {
  it('skips vault config and trash', () => {
    expect(shouldSkipObsidianPath('MyVault/.obsidian/app.json')).toBe(true);
    expect(shouldSkipObsidianPath('.obsidian/workspace.json')).toBe(true);
    expect(shouldSkipObsidianPath('Notes/.trash/old.md')).toBe(true);
    expect(shouldSkipObsidianPath('folder/.git/config')).toBe(true);
  });

  it('keeps normal notes', () => {
    expect(shouldSkipObsidianPath('Projects/plan.md')).toBe(false);
    expect(shouldSkipObsidianPath('inbox.md')).toBe(false);
  });
});

describe('parseObsidianMarkdownNote', () => {
  it('uses frontmatter title and strips frontmatter', () => {
    const raw = `---
title: Weekly Review
tags: [ops]
---
# ignored heading

Body text.
`;
    expect(parseObsidianMarkdownNote(raw, 'a/b.md')).toEqual({
      content: '# ignored heading\n\nBody text.',
      title: 'Weekly Review',
    });
  });

  it('falls back to first heading when no frontmatter title', () => {
    const raw = `# Meeting notes

Action items.
`;
    expect(parseObsidianMarkdownNote(raw, 'meeting.md')).toEqual({
      content: 'Action items.',
      title: 'Meeting notes',
    });
  });

  it('falls back to filename', () => {
    expect(parseObsidianMarkdownNote('plain body', 'folder/My Note.md')).toEqual({
      content: 'plain body',
      title: 'My Note',
    });
  });
});
