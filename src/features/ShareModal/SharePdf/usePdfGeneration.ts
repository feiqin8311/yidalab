import { useCallback, useState } from 'react';

import { generateConversationPdf } from './generateConversationPdf';

interface PdfGenerationParams {
  content: string;
  title: string;
}

interface PdfGenerationState {
  downloadPdf: () => Promise<void>;
  error: string | null;
  generatePdf: (params: PdfGenerationParams) => Promise<void>;
  loading: boolean;
  pdfData: string | null;
}

export const usePdfGeneration = (): PdfGenerationState => {
  const [pdfData, setPdfData] = useState<string | null>(null);
  const [filename, setFilename] = useState<string>('chat-export.pdf');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const generatePdf = useCallback(
    async (params: PdfGenerationParams) => {
      if (loading) return;

      try {
        setLoading(true);
        setError(null);
        setPdfData(null);

        const result = await generateConversationPdf(params.content, params.title);

        setPdfData(result.pdf);
        setFilename(result.filename);
      } catch (error) {
        console.error('Failed to generate PDF:', error);
        setError(error instanceof Error ? error.message : 'Failed to generate PDF');
      } finally {
        setLoading(false);
      }
    },
    [loading],
  );

  const downloadPdf = useCallback(async () => {
    if (!pdfData) return;

    try {
      // Convert base64 to blob
      const byteCharacters = atob(pdfData);
      const byteNumbers = Array.from({ length: byteCharacters.length }, (_, i) =>
        byteCharacters.charCodeAt(i),
      );
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'application/pdf' });

      // Create download link
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download PDF:', error);
      throw error;
    }
  }, [pdfData, filename]);

  return {
    downloadPdf,
    error,
    generatePdf,
    loading,
    pdfData,
  };
};
