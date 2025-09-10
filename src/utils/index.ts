import * as fs from 'fs-extra';
import * as path from 'path';

/**
 * Utility functions for DevRev Coder Agent
 */

export function sanitizePath(inputPath: string, basePath: string): string {
  const resolved = path.resolve(basePath, inputPath);
  if (!resolved.startsWith(basePath)) {
    throw new Error(`Path ${inputPath} is outside the allowed directory`);
  }
  return resolved;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

export function getFileExtension(filePath: string): string {
  return path.extname(filePath).toLowerCase();
}

export function isTextFile(filePath: string): boolean {
  const textExtensions = [
    '.txt', '.md', '.json', '.yaml', '.yml', '.xml', '.csv',
    '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cpp', '.c',
    '.h', '.cs', '.php', '.rb', '.go', '.rs', '.swift', '.kt',
    '.scala', '.html', '.css', '.scss', '.less', '.sql', '.sh',
    '.bash', '.zsh', '.ps1', '.dockerfile', '.gitignore',
    '.env', '.config', '.ini', '.toml', '.lock'
  ];
  
  const extension = getFileExtension(filePath);
  return textExtensions.includes(extension);
}

export function isBinaryFile(filePath: string): boolean {
  const binaryExtensions = [
    '.exe', '.bin', '.dll', '.so', '.dylib', '.app',
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.ico',
    '.mp3', '.mp4', '.avi', '.mov', '.wmv', '.flv',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.zip', '.tar', '.gz', '.rar', '.7z',
    '.woff', '.woff2', '.ttf', '.otf', '.eot'
  ];
  
  const extension = getFileExtension(filePath);
  return binaryExtensions.includes(extension);
}

export async function isGitRepository(directoryPath: string): Promise<boolean> {
  try {
    const gitPath = path.join(directoryPath, '.git');
    const stats = await fs.stat(gitPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

export function parseGitUrl(url: string): { owner: string; repo: string } | null {
  // Handle GitHub URLs
  const githubMatch = url.match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)/);
  if (githubMatch) {
    return { owner: githubMatch[1], repo: githubMatch[2] };
  }
  
  return null;
}

export function formatTimestamp(date: Date): string {
  return date.toISOString().replace('T', ' ').replace(/\..+/, '');
}

export function calculateComplexityScore(content: string): number {
  let score = 0;
  
  // Basic metrics
  const lines = content.split('\n').length;
  score += Math.min(lines / 100, 5); // Max 5 points for line count
  
  // Complexity indicators
  const complexityPatterns = [
    /if\s*\(/g,
    /else\s*\{/g,
    /for\s*\(/g,
    /while\s*\(/g,
    /switch\s*\(/g,
    /catch\s*\(/g,
    /function\s+/g,
    /class\s+/g,
    /interface\s+/g,
    /async\s+/g
  ];
  
  complexityPatterns.forEach(pattern => {
    const matches = content.match(pattern);
    if (matches) {
      score += matches.length * 0.5;
    }
  });
  
  return Math.min(score, 10); // Cap at 10
}

export function extractImportStatements(content: string, language: 'typescript' | 'javascript' | 'python'): string[] {
  const imports: string[] = [];
  const lines = content.split('\n');
  
  switch (language) {
    case 'typescript':
    case 'javascript':
      lines.forEach(line => {
        const trimmed = line.trim();
        if (trimmed.startsWith('import ') || trimmed.startsWith('const ') && trimmed.includes('require(')) {
          imports.push(trimmed);
        }
      });
      break;
      
    case 'python':
      lines.forEach(line => {
        const trimmed = line.trim();
        if (trimmed.startsWith('import ') || trimmed.startsWith('from ')) {
          imports.push(trimmed);
        }
      });
      break;
  }
  
  return imports;
}

export function generateHash(content: string): string {
  // Simple hash function for content identification
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

export class RateLimiter {
  private requests: number[] = [];
  private limit: number;
  private windowMs: number;

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  async isAllowed(): Promise<boolean> {
    const now = Date.now();
    
    // Remove old requests outside the window
    this.requests = this.requests.filter(time => now - time < this.windowMs);
    
    if (this.requests.length < this.limit) {
      this.requests.push(now);
      return true;
    }
    
    return false;
  }

  async waitForSlot(): Promise<void> {
    while (!(await this.isAllowed())) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}

export function validateEnvironmentVariables(): { isValid: boolean; missing: string[] } {
  const required = ['OPENROUTER_API_KEY'];
  const missing: string[] = [];
  
  required.forEach(envVar => {
    if (!process.env[envVar]) {
      missing.push(envVar);
    }
  });
  
  return {
    isValid: missing.length === 0,
    missing
  };
}
