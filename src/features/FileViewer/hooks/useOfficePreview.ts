import { useEffect, useState } from 'react';

import {
  type OfficeSlidePreview,
  parseDocxHtml,
  parseOdtHtml,
  parsePptxSlides,
} from '../Renderer/Office/parseOfficePreview';

export type OfficePreviewKind = 'docx' | 'odt' | 'pptx';

export const useOfficePreview = (url: string | null, kind: OfficePreviewKind) => {
  const [html, setHtml] = useState('');
  const [slides, setSlides] = useState<OfficeSlidePreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!url) {
      setHtml('');
      setSlides([]);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();

    const load = async () => {
      try {
        setLoading(true);
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Failed to load file: ${response.statusText}`);
        }
        const buffer = await response.arrayBuffer();

        if (kind === 'pptx') {
          setSlides(parsePptxSlides(buffer));
          setHtml('');
        } else if (kind === 'odt') {
          setHtml(parseOdtHtml(buffer));
          setSlides([]);
        } else {
          setHtml(parseDocxHtml(buffer));
          setSlides([]);
        }
        setError(null);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err : new Error('Unknown error'));
        setHtml('');
        setSlides([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void load();
    return () => controller.abort();
  }, [kind, url]);

  return { error, html, loading, slides };
};
