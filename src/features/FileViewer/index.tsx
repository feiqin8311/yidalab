'use client';

import { MARKDOWN_MIME_TYPES } from '@lobechat/const';
import type { CSSProperties } from 'react';
import { memo } from 'react';

import { isHtmlFile } from '@/components/HtmlPreview';
import { type FileListItem } from '@/types/files';

import NotSupport from './NotSupport';
import AudioViewer from './Renderer/Audio';
import CodeViewer from './Renderer/Code';
import HTMLViewer from './Renderer/HTML';
import ImageViewer from './Renderer/Image';
import MarkdownViewer from './Renderer/Markdown';
import OfficeViewer from './Renderer/Office';
import PDFViewer from './Renderer/PDF';
import SpreadsheetViewer from './Renderer/Spreadsheet';
import VideoViewer from './Renderer/Video';

// File type definitions
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.svg', '.avif'];
const IMAGE_MIME_TYPES = new Set([
  'image/jpg',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/svg+xml',
  'image/avif',
  'svg',
]);

const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.ogg', '.mov'];
const VIDEO_MIME_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
  'mp4',
  'webm',
  'ogg',
  'mov',
]);

const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.oga'];
const AUDIO_MIME_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/mp4',
  'audio/aac',
  'audio/flac',
  'audio/ogg',
  'mp3',
  'wav',
  'm4a',
  'aac',
  'flac',
]);

const MARKDOWN_EXTENSIONS = ['.md', '.mdx', '.markdown'];
const MARKDOWN_FILE_MIME_TYPES = new Set(['md', 'mdx', 'markdown', ...MARKDOWN_MIME_TYPES]);

const CODE_EXTENSIONS = [
  // JavaScript/TypeScript
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  // Python
  '.py',
  '.pyw',
  // Java/JVM
  '.java',
  '.kt',
  '.kts',
  '.scala',
  '.groovy',
  // C/C++
  '.c',
  '.h',
  '.cpp',
  '.cxx',
  '.cc',
  '.hpp',
  '.hxx',
  // Other compiled languages
  '.cs',
  '.go',
  '.rs',
  '.rb',
  '.php',
  '.swift',
  '.lua',
  '.r',
  '.dart',
  // Shell
  '.sh',
  '.bash',
  '.zsh',
  // Web
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.sass',
  '.less',
  // Data formats
  '.json',
  '.xml',
  '.yaml',
  '.yml',
  '.toml',
  '.sql',
  // Functional languages
  '.ex',
  '.exs',
  '.erl',
  '.hrl',
  '.clj',
  '.cljs',
  '.cljc',
  // Other
  '.vim',
  '.graphql',
  '.gql',
  '.txt',
];

const CODE_MIME_TYPES = new Set([
  // JavaScript/TypeScript
  'js',
  'jsx',
  'ts',
  'tsx',
  'application/javascript',
  'application/x-javascript',
  'text/javascript',
  'application/typescript',
  'text/typescript',
  // Python
  'python',
  'text/x-python',
  'application/x-python-code',
  // Java/JVM
  'java',
  'text/x-java-source',
  'kotlin',
  'scala',
  // C/C++
  'c',
  'text/x-c',
  'cpp',
  'text/x-c++',
  // Other languages
  'csharp',
  'go',
  'rust',
  'ruby',
  'php',
  'text/x-php',
  'swift',
  'lua',
  'r',
  'dart',
  // Shell
  'bash',
  'shell',
  'text/x-shellscript',
  // Web
  'html',
  'text/html',
  'css',
  'text/css',
  'scss',
  'sass',
  'less',
  // Data
  'json',
  'application/json',
  'xml',
  'text/xml',
  'application/xml',
  'yaml',
  'text/yaml',
  'application/x-yaml',
  'toml',
  'sql',
  'text/x-sql',
  // Other
  'graphql',
  'txt',
  'text/plain',
]);

const SPREADSHEET_EXTENSIONS = ['.xls', '.xlsx', '.xlsm', '.csv', '.ods'];
const SPREADSHEET_MIME_TYPES = new Set([
  'xls',
  'xlsx',
  'xlsm',
  'csv',
  'ods',
  'text/csv',
  'application/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroenabled.12',
  'application/vnd.oasis.opendocument.spreadsheet',
]);

const DOCX_EXTENSIONS = ['.docx'];
const DOCX_MIME_TYPES = new Set([
  'docx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const PPTX_EXTENSIONS = ['.pptx'];
const PPTX_MIME_TYPES = new Set([
  'pptx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

const ODT_EXTENSIONS = ['.odt'];
const ODT_MIME_TYPES = new Set(['odt', 'application/vnd.oasis.opendocument.text']);

// Archive file types - not supported for preview
const ARCHIVE_EXTENSIONS = ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.tgz'];
const ARCHIVE_MIME_TYPES = new Set([
  'zip',
  'rar',
  '7z',
  'application/zip',
  'application/x-zip-compressed',
  'application/x-rar-compressed',
  'application/x-7z-compressed',
  'application/x-tar',
  'application/gzip',
  'application/x-gzip',
  'application/x-bzip2',
  'application/x-xz',
]);

// Helper function to check file type
const matchesFileType = (
  fileType: string | undefined,
  fileName: string | undefined,
  extensions: string[],
  mimeTypes: Set<string>,
): boolean => {
  const lowerFileType = fileType?.toLowerCase();
  const lowerFileName = fileName?.toLowerCase();

  // Check MIME type
  if (lowerFileType && mimeTypes.has(lowerFileType)) {
    return true;
  }

  // Check file extension in fileType
  if (lowerFileType && extensions.some((ext) => lowerFileType.includes(ext.slice(1)))) {
    return true;
  }

  // Check file extension in fileName
  if (lowerFileName && extensions.some((ext) => lowerFileName.endsWith(ext))) {
    return true;
  }

  return false;
};

interface FileViewerProps extends FileListItem {
  className?: string;
  style?: CSSProperties;
}

/**
 * Preview any file type.
 */
const FileViewer = memo<FileViewerProps>(({ id, style, fileType, url, name }) => {
  // PDF files
  if (fileType?.toLowerCase() === 'pdf' || name?.toLowerCase().endsWith('.pdf')) {
    return <PDFViewer fileId={id} url={url} />;
  }

  // Image files
  if (matchesFileType(fileType, name, IMAGE_EXTENSIONS, IMAGE_MIME_TYPES)) {
    return <ImageViewer fileId={id} url={url} />;
  }

  // Video files
  if (matchesFileType(fileType, name, VIDEO_EXTENSIONS, VIDEO_MIME_TYPES)) {
    return <VideoViewer fileId={id} url={url} />;
  }

  // Archive files (zip, rar, 7z, etc.) - not supported for preview
  // Check before code files to avoid false matches
  if (matchesFileType(fileType, name, ARCHIVE_EXTENSIONS, ARCHIVE_MIME_TYPES)) {
    return <NotSupport fileName={name} style={style} url={url} />;
  }

  // Spreadsheets: local xlsx parse. Office Online iframe is blank for private URLs.
  if (matchesFileType(fileType, name, SPREADSHEET_EXTENSIONS, SPREADSHEET_MIME_TYPES)) {
    return <SpreadsheetViewer fileId={id} url={url} />;
  }

  if (matchesFileType(fileType, name, DOCX_EXTENSIONS, DOCX_MIME_TYPES)) {
    return <OfficeViewer fileId={id} kind={'docx'} url={url} />;
  }

  if (matchesFileType(fileType, name, PPTX_EXTENSIONS, PPTX_MIME_TYPES)) {
    return <OfficeViewer fileId={id} kind={'pptx'} url={url} />;
  }

  if (matchesFileType(fileType, name, ODT_EXTENSIONS, ODT_MIME_TYPES)) {
    return <OfficeViewer fileId={id} kind={'odt'} url={url} />;
  }

  if (matchesFileType(fileType, name, AUDIO_EXTENSIONS, AUDIO_MIME_TYPES)) {
    return <AudioViewer fileId={id} url={url} />;
  }

  if (matchesFileType(fileType, name, MARKDOWN_EXTENSIONS, MARKDOWN_FILE_MIME_TYPES)) {
    return <MarkdownViewer fileId={id} url={url} />;
  }

  // HTML files should render as a sandboxed preview before the broader code-file fallback.
  if (isHtmlFile({ fileName: name, fileType })) {
    return <HTMLViewer fileId={id} url={url} />;
  }

  // Code / plain text
  if (matchesFileType(fileType, name, CODE_EXTENSIONS, CODE_MIME_TYPES)) {
    return <CodeViewer fileId={id} fileName={name} url={url} />;
  }

  // Unsupported file type
  return <NotSupport fileName={name} style={style} url={url} />;
});

export default FileViewer;
