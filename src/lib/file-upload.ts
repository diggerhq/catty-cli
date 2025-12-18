import { readFileSync, statSync, appendFileSync } from 'fs';
import { basename, extname } from 'path';
import { homedir } from 'os';

// Debug logging to file (avoids terminal corruption)
function debugLog(msg: string): void {
  if (process.env.CATTY_DEBUG === '1') {
    const logFile = `${homedir()}/.catty-debug.log`;
    appendFileSync(logFile, `${new Date().toISOString()} ${msg}\n`);
  }
}

// Supported file types for auto-upload
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];
const DOCUMENT_EXTENSIONS = ['.pdf', '.txt', '.md', '.json', '.xml', '.csv'];
const SUPPORTED_EXTENSIONS = [...IMAGE_EXTENSIONS, ...DOCUMENT_EXTENSIONS];

// Max file size for auto-upload (10MB)
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// Chunk size for large file uploads (10KB raw = ~13KB base64)
export const CHUNK_SIZE = 10 * 1024;

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
 * Returns the first valid file path found
 */
export function detectFilePath(input: string): string | null {
  const paths = detectFilePaths(input);
  return paths.length > 0 ? paths[0] : null;
}

/**
 * Detects all file paths in input that could be uploaded
 * Returns array of valid file paths
 */
export function detectFilePaths(input: string): string[] {
  const trimmed = input.trim();
  
  debugLog(`detectFilePaths input: ${JSON.stringify(trimmed)}`);
  
  // Handle escaped paths (e.g., /path/to/Screenshot\ 2024-12-17\ at\ 10.30.png)
  // Split on unescaped spaces to handle multiple files
  // An unescaped space is a space NOT preceded by a backslash
  const rawPaths = splitOnUnescapedSpaces(trimmed);
  
  debugLog(`split paths: ${JSON.stringify(rawPaths)}`);
  
  const validPaths: string[] = [];
  
  for (const rawPath of rawPaths) {
    // Unescape the path (convert "\ " to " ")
    const unescaped = rawPath.replace(/\\ /g, ' ');
    
    // Skip empty
    if (!unescaped) continue;
    
    // Handle tilde expansion
    const expanded = unescaped.startsWith('~') 
      ? unescaped.replace(/^~/, process.env.HOME || '~')
      : unescaped;
    
    // Check if it's an absolute path
    if (!expanded.startsWith('/') && !expanded.match(/^[A-Za-z]:\\/)) {
      debugLog(`skipping non-absolute: ${expanded}`);
      continue;
    }
    
    // Check if file exists
    try {
      statSync(expanded);
      debugLog(`found file: ${expanded}`);
      validPaths.push(expanded);
    } catch (err) {
      debugLog(`file not found: ${expanded} - ${err}`);
      // File doesn't exist, try next
      continue;
    }
  }

  debugLog(`found ${validPaths.length} valid files`);
  return validPaths;
}

/**
 * Split string on unescaped spaces (spaces not preceded by backslash)
 */
function splitOnUnescapedSpaces(input: string): string[] {
  const results: string[] = [];
  let current = '';
  let i = 0;
  
  while (i < input.length) {
    if (input[i] === '\\' && i + 1 < input.length && input[i + 1] === ' ') {
      // Escaped space - keep it (including the backslash for now)
      current += '\\ ';
      i += 2;
    } else if (input[i] === ' ') {
      // Unescaped space - split here
      if (current) {
        results.push(current);
        current = '';
      }
      i++;
    } else {
      current += input[i];
      i++;
    }
  }
  
  if (current) {
    results.push(current);
  }
  
  return results;
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
 * Also sanitizes the filename to remove spaces and special characters
 */
export function generateUniqueFilename(originalFilename: string): string {
  const timestamp = Date.now();
  const ext = extname(originalFilename);
  const nameWithoutExt = basename(originalFilename, ext);
  // Sanitize: replace spaces with underscores, remove other problematic chars
  const sanitized = nameWithoutExt
    .replace(/\s+/g, '_')           // spaces -> underscores
    .replace(/[^a-zA-Z0-9_-]/g, ''); // remove other special chars
  return `${sanitized}-${timestamp}${ext}`;
}

