export enum FilesTabs {
  All = 'all',
  Audios = 'audios',
  /** Word / RTF office documents */
  Docs = 'docs',
  Documents = 'documents',
  Excel = 'excel',
  Home = 'home',
  Images = 'images',
  Markdown = 'markdown',
  Pages = 'pages',
  Pdf = 'pdf',
  Videos = 'videos',
  Websites = 'websites',
}

export enum FileSource {
  ImageGeneration = 'image_generation',
  PageEditor = 'page-editor',
  VideoGeneration = 'video_generation',
}

export interface FileItem {
  content?: string;
  createdAt: Date;
  enabled?: boolean;
  id: string;
  name: string;
  size: number;
  source?: FileSource | null;
  type: string;
  updatedAt: Date;
  url: string;
}

export * from './list';
export * from './upload';
