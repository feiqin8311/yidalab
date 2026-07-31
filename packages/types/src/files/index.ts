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

/** How the server may process content for a file node. */
export type ResourceProcessingPolicy = 'none' | 'on_demand' | 'persistent';

/** Why a node entered persistent processing (audit / UI). */
export type ResourcePersistReason = 'resource_upload' | 'document_import' | 'knowledge_base';

export type ResourcePlacementType =
  | 'message_attachment'
  | 'resource_library'
  | 'knowledge_base'
  | 'document_asset'
  | 'agent_knowledge';

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
