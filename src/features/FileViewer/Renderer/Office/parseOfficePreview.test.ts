import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { parseDocxHtml, parseOdtHtml, parsePptxSlides } from './parseOfficePreview';

describe('parsePptxSlides', () => {
  it('extracts slide text in slide order', () => {
    const zip = zipSync({
      'ppt/slides/slide2.xml': strToU8('<p:sld><a:p><a:t>Second</a:t></a:p></p:sld>'),
      'ppt/slides/slide1.xml': strToU8(
        '<p:sld><a:p><a:t>First</a:t> <a:t>slide</a:t></a:p></p:sld>',
      ),
    });

    expect(parsePptxSlides(zip)).toEqual([
      { number: 1, text: 'Firstslide' },
      { number: 2, text: 'Second' },
    ]);
  });
});

describe('parseOdtHtml', () => {
  it('turns ODT paragraphs into html', () => {
    const zip = zipSync({
      'content.xml': strToU8(
        '<office:document-content><text:h>Title</text:h><text:p>Body &amp; more</text:p></office:document-content>',
      ),
    });

    expect(parseOdtHtml(zip)).toBe('<p>Title</p><p>Body &amp; more</p>');
  });
});

describe('parseDocxHtml', () => {
  it('turns Word paragraphs into html', () => {
    const zip = zipSync({
      'word/document.xml': strToU8(
        '<w:document><w:p><w:t>Hello</w:t> <w:t>world</w:t></w:p><w:p><w:t>Next</w:t></w:p></w:document>',
      ),
    });

    expect(parseDocxHtml(zip)).toBe('<p>Helloworld</p><p>Next</p>');
  });
});
