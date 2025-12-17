import { readFileSync, statSync } from 'fs';
import { basename, extname } from 'path';

// Supported file types for auto-upload
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];
const DOCUMENT_EXTENSIONS = ['.pdf', '.txt', '.md', '.json', '.xml', '.csv'];
const SUPPORTED_EXTENSIONS = [...IMAGE_EXTENSIONS, ...DOCUMENT_EXTENSIONS];

// Max file size for auto-upload (10MB)
const MAX_FILE_SIZE = 10 * 1024 * 1024;

export interface FileUploadResult {
  shouldUpload: boolean;
  localPath?: string;
  remotePath?: string;
  content?: Buffer;
  filename?: string;
  mimeType?: string;
}

/**
 * Detects if input contains a file path that should be uploaded
 */
export function detectFilePath(input: string): string | null {
  // Look for absolute paths (macOS/Linux)
  const unixPathMatch = input.match(/(?:^|\s)(\/[^\s]+)(?:\s|$)/);
  if (unixPathMatch) {
    return unixPathMatch[1].trim();
  }

  // Look for absolute paths (Windows)
  const winPathMatch = input.match(/(?:^|\s)([A-Za-z]:\\[^\s]+)(?:\s|$)/);
  if (winPathMatch) {
    return winPathMatch[1].trim();
  }

  // Look for paths with tilde expansion
  const tildeMatch = input.match(/(?:^|\s)(~\/[^\s]+)(?:\s|$)/);
  if (tildeMatch) {
    const path = tildeMatch[1].trim();
    // Expand tilde to home directory
    return path.replace(/^~/, process.env.HOME || '~');
  }

  return null;
}

/**
 * Checks if a file should be auto-uploaded based on extension and size
 */
export function shouldAutoUpload(filePath: string): FileUploadResult {
  try {
    // Check if file exists
    const stats = statSync(filePath);

    // Check if it's a file (not a directory)
    if (!stats.isFile()) {
      return { shouldUpload: false };
    }

    // Check file size
    if (stats.size > MAX_FILE_SIZE) {
      return { shouldUpload: false };
    }

    // Check extension
    const ext = extname(filePath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      return { shouldUpload: false };
    }

    // Read file content
    const content = readFileSync(filePath);
    const filename = basename(filePath);
    const remotePath = `/workspace/.catty-uploads/${filename}`;
    const mimeType = getMimeType(ext);

    return {
      shouldUpload: true,
      localPath: filePath,
      remotePath,
      content,
      filename,
      mimeType,
    };
  } catch {
    // File doesn't exist or can't be read
    return { shouldUpload: false };
  }
}

/**
 * Get MIME type from file extension
 */
function getMimeType(ext: string): string {
  const mimeTypes: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.csv': 'text/csv',
  };

  return mimeTypes[ext.toLowerCase()] || 'application/octet-stream';
}

/**
 * Generate a unique filename to avoid collisions
 */
export function generateUniqueFilename(originalFilename: string): string {
  const timestamp = Date.now();
  const ext = extname(originalFilename);
  const nameWithoutExt = basename(originalFilename, ext);
  return `${nameWithoutExt}-${timestamp}${ext}`;
}

