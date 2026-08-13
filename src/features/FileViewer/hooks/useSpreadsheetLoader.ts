import { useEffect, useState } from 'react';

import {
  parseSpreadsheetBuffer,
  type SpreadsheetSheetPreview,
} from '../Renderer/Spreadsheet/parseSpreadsheet';

export const useSpreadsheetLoader = (url: string | null) => {
  const [sheets, setSheets] = useState<SpreadsheetSheetPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!url) {
      setSheets([]);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();

    const loadFile = async () => {
      try {
        setLoading(true);
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Failed to load file: ${response.statusText}`);
        }
        const buffer = await response.arrayBuffer();
        setSheets(parseSpreadsheetBuffer(buffer));
        setError(null);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err : new Error('Unknown error'));
        setSheets([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void loadFile();

    return () => controller.abort();
  }, [url]);

  return { error, loading, sheets };
};
