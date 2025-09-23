import crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import winston from 'winston';

export interface ValidationResult {
  success: boolean;
  output: string;
  timestamp: Date;
  duration: number;
  errors: string[];
  warnings: string[];
}

export interface CacheEntry {
  fileHash: string;
  filePaths: string[];
  result: ValidationResult;
  validationType: string;
  dependencies?: string[];
  metadata?: Record<string, any>;
}

export interface CacheStats {
  totalEntries: number;
  hitRate: number;
  totalHits: number;
  totalMisses: number;
  cacheSize: number;
  oldestEntry?: Date;
  newestEntry?: Date;
}

export interface ValidationCacheConfig {
  maxEntries: number;
  maxAge: number; // in milliseconds
  cacheDir?: string;
  enablePersistence: boolean;
  trackDependencies: boolean;
}

export class ValidationCache {
  private cache: Map<string, CacheEntry> = new Map();
  private hits = 0;
  private misses = 0;
  private readonly config: ValidationCacheConfig;
  private cacheFilePath?: string;

  constructor(config: Partial<ValidationCacheConfig> = {}) {
    this.config = {
      maxEntries: 100,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      enablePersistence: true,
      trackDependencies: true,
      ...config
    };

    if (this.config.enablePersistence && this.config.cacheDir) {
      this.setupPersistence();
    }
  }

  private setupPersistence(): void {
    if (!this.config.cacheDir) return;

    try {
      fs.mkdirSync(this.config.cacheDir, { recursive: true });
      this.cacheFilePath = path.join(this.config.cacheDir, 'validation-cache.json');
      this.loadCache();
    } catch (error) {
      winston.error(`Failed to setup validation cache persistence: ${error}`);
    }
  }

  private loadCache(): void {
    if (!this.cacheFilePath || !fs.existsSync(this.cacheFilePath)) return;

    try {
      const data = fs.readFileSync(this.cacheFilePath, 'utf-8');
      const cacheData = JSON.parse(data);
      
      for (const [key, entry] of Object.entries(cacheData.entries || {})) {
        const cacheEntry = entry as any;
        // Convert timestamp strings back to Date objects
        cacheEntry.result.timestamp = new Date(cacheEntry.result.timestamp);
        this.cache.set(key, cacheEntry);
      }
      
      this.hits = cacheData.stats?.hits || 0;
      this.misses = cacheData.stats?.misses || 0;
      
      winston.info(`Loaded ${this.cache.size} validation cache entries`);
      this.cleanupExpiredEntries();
    } catch (error) {
      winston.error(`Failed to load validation cache: ${error}`);
    }
  }

  private saveCache(): void {
    if (!this.cacheFilePath) return;

    try {
      const cacheData = {
        entries: Object.fromEntries(this.cache.entries()),
        stats: {
          hits: this.hits,
          misses: this.misses,
          timestamp: new Date().toISOString()
        }
      };
      
      fs.writeFileSync(this.cacheFilePath, JSON.stringify(cacheData, null, 2));
    } catch (error) {
      winston.error(`Failed to save validation cache: ${error}`);
    }
  }

  async getCachedResult(
    filePaths: string[],
    validationType: string,
    dependencies?: string[]
  ): Promise<ValidationResult | null> {
    const cacheKey = await this.generateCacheKey(filePaths, validationType, dependencies);
    const entry = this.cache.get(cacheKey);

    if (!entry) {
      this.misses++;
      return null;
    }

    // Check if entry is expired
    const age = Date.now() - entry.result.timestamp.getTime();
    if (age > this.config.maxAge) {
      this.cache.delete(cacheKey);
      this.misses++;
      return null;
    }

    // Check if files have changed
    const currentHash = await this.calculateFileHash(filePaths, dependencies);
    if (currentHash !== entry.fileHash) {
      this.cache.delete(cacheKey);
      this.misses++;
      return null;
    }

    this.hits++;
    winston.debug(`Validation cache hit for ${validationType}: ${filePaths.join(', ')}`);
    return entry.result;
  }

  async cacheResult(
    filePaths: string[],
    validationType: string,
    result: ValidationResult,
    dependencies?: string[]
  ): Promise<void> {
    const cacheKey = await this.generateCacheKey(filePaths, validationType, dependencies);
    const fileHash = await this.calculateFileHash(filePaths, dependencies);

    const entry: CacheEntry = {
      fileHash,
      filePaths: [...filePaths],
      result: {
        ...result,
        timestamp: new Date()
      },
      validationType,
      dependencies: dependencies ? [...dependencies] : undefined
    };

    this.cache.set(cacheKey, entry);
    this.maintainCacheSize();
    
    if (this.config.enablePersistence) {
      this.saveCache();
    }

    winston.debug(`Cached validation result for ${validationType}: ${filePaths.join(', ')}`);
  }

  private async generateCacheKey(
    filePaths: string[],
    validationType: string,
    dependencies?: string[]
  ): Promise<string> {
    const sortedPaths = [...filePaths].sort();
    const sortedDeps = dependencies ? [...dependencies].sort() : [];
    const keyData = {
      type: validationType,
      files: sortedPaths,
      deps: sortedDeps
    };
    
    return crypto.createHash('md5')
      .update(JSON.stringify(keyData))
      .digest('hex');
  }

  private async calculateFileHash(filePaths: string[], dependencies?: string[]): Promise<string> {
    const hash = crypto.createHash('md5');
    const allPaths = [...filePaths];
    
    if (this.config.trackDependencies && dependencies) {
      allPaths.push(...dependencies);
    }

    // Sort to ensure consistent hash regardless of order
    allPaths.sort();

    for (const filePath of allPaths) {
      try {
        if (fs.existsSync(filePath)) {
          const stats = fs.statSync(filePath);
          // Use file modification time and size for quick change detection
          hash.update(`${filePath}:${stats.mtime.getTime()}:${stats.size}`);
        } else {
          // File doesn't exist - include this in hash
          hash.update(`${filePath}:missing`);
        }
      } catch (error) {
        // If we can't read file stats, include error in hash
        hash.update(`${filePath}:error:${error}`);
      }
    }

    return hash.digest('hex');
  }

  private maintainCacheSize(): void {
    if (this.cache.size <= this.config.maxEntries) return;

    // Remove oldest entries
    const entries = Array.from(this.cache.entries())
      .sort((a, b) => a[1].result.timestamp.getTime() - b[1].result.timestamp.getTime());

    const toRemove = entries.slice(0, entries.length - this.config.maxEntries);
    for (const [key] of toRemove) {
      this.cache.delete(key);
    }

    winston.debug(`Removed ${toRemove.length} old validation cache entries`);
  }

  private cleanupExpiredEntries(): void {
    const now = Date.now();
    let removedCount = 0;

    for (const [key, entry] of this.cache.entries()) {
      const age = now - entry.result.timestamp.getTime();
      if (age > this.config.maxAge) {
        this.cache.delete(key);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      winston.debug(`Removed ${removedCount} expired validation cache entries`);
    }
  }

  invalidateByFile(filePath: string): number {
    let invalidated = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      if (entry.filePaths.includes(filePath) || 
          (entry.dependencies && entry.dependencies.includes(filePath))) {
        this.cache.delete(key);
        invalidated++;
      }
    }

    if (invalidated > 0) {
      winston.debug(`Invalidated ${invalidated} cache entries for file: ${filePath}`);
      if (this.config.enablePersistence) {
        this.saveCache();
      }
    }

    return invalidated;
  }

  invalidateByType(validationType: string): number {
    let invalidated = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      if (entry.validationType === validationType) {
        this.cache.delete(key);
        invalidated++;
      }
    }

    if (invalidated > 0) {
      winston.debug(`Invalidated ${invalidated} cache entries for type: ${validationType}`);
      if (this.config.enablePersistence) {
        this.saveCache();
      }
    }

    return invalidated;
  }

  getStats(): CacheStats {
    const entries = Array.from(this.cache.values());
    const timestamps = entries.map(e => e.result.timestamp.getTime());
    
    return {
      totalEntries: this.cache.size,
      hitRate: this.hits + this.misses > 0 ? this.hits / (this.hits + this.misses) : 0,
      totalHits: this.hits,
      totalMisses: this.misses,
      cacheSize: this.estimateCacheSize(),
      oldestEntry: timestamps.length > 0 ? new Date(Math.min(...timestamps)) : undefined,
      newestEntry: timestamps.length > 0 ? new Date(Math.max(...timestamps)) : undefined
    };
  }

  private estimateCacheSize(): number {
    // Rough estimate of cache size in bytes
    let size = 0;
    for (const entry of this.cache.values()) {
      size += JSON.stringify(entry).length;
    }
    return size;
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    
    if (this.config.enablePersistence) {
      this.saveCache();
    }
    
    winston.info('Validation cache cleared');
  }

  async warmup(filePaths: string[], validationType: string): Promise<boolean> {
    // Pre-calculate hash for commonly validated files
    try {
      await this.calculateFileHash(filePaths);
      return true;
    } catch (error) {
      winston.warn(`Failed to warmup cache for ${filePaths.join(', ')}: ${error}`);
      return false;
    }
  }

  exportCache(): Record<string, CacheEntry> {
    return Object.fromEntries(this.cache.entries());
  }

  importCache(data: Record<string, CacheEntry>): void {
    this.cache.clear();
    for (const [key, entry] of Object.entries(data)) {
      // Ensure timestamp is a Date object
      if (typeof entry.result.timestamp === 'string') {
        entry.result.timestamp = new Date(entry.result.timestamp);
      }
      this.cache.set(key, entry);
    }
    
    this.cleanupExpiredEntries();
    winston.info(`Imported ${this.cache.size} validation cache entries`);
  }

  destroy(): void {
    if (this.config.enablePersistence) {
      this.saveCache();
    }
    this.cache.clear();
  }
}
