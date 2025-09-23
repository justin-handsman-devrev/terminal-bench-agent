import crypto from 'crypto';

export interface ContextEntry {
  id: string;
  content: string;
  embedding: number[];
  timestamp: Date;
  source: string;
  metadata?: Record<string, any>;
}

export interface SimilarityResult {
  isDuplicate: boolean;
  similarityScore: number;
  existingEntry?: ContextEntry;
  suggestion?: string;
}

export interface DeduplicationConfig {
  similarityThreshold: number; // 0.0 to 1.0
  maxContextEntries: number;
  enableEmbeddings: boolean;
  embeddingDimensions: number;
}

export class ContextDeduplicator {
  private contextEntries: Map<string, ContextEntry> = new Map();
  private readonly config: DeduplicationConfig;

  constructor(config: Partial<DeduplicationConfig> = {}) {
    this.config = {
      similarityThreshold: 0.85,
      maxContextEntries: 1000,
      enableEmbeddings: true,
      embeddingDimensions: 384, // Typical for sentence transformers
      ...config
    };
  }

  async addContext(
    content: string, 
    source: string, 
    metadata?: Record<string, any>
  ): Promise<SimilarityResult> {
    const contentHash = this.hashContent(content);
    
    // Fast exact duplicate check
    if (this.contextEntries.has(contentHash)) {
      const existing = this.contextEntries.get(contentHash)!;
      return {
        isDuplicate: true,
        similarityScore: 1.0,
        existingEntry: existing,
        suggestion: `Exact duplicate found from ${existing.source} at ${existing.timestamp.toISOString()}`
      };
    }

    // Semantic similarity check
    const embedding = this.config.enableEmbeddings 
      ? await this.generateEmbedding(content)
      : [];

    const similarityResult = await this.findSimilarContext(content, embedding);
    
    if (similarityResult.isDuplicate) {
      return similarityResult;
    }

    // Add new context entry
    const entry: ContextEntry = {
      id: contentHash,
      content,
      embedding,
      timestamp: new Date(),
      source,
      metadata
    };

    this.contextEntries.set(contentHash, entry);
    this.maintainMaxEntries();

    return {
      isDuplicate: false,
      similarityScore: 0,
      suggestion: `Added new context from ${source}`
    };
  }

  private async findSimilarContext(
    content: string, 
    embedding: number[]
  ): Promise<SimilarityResult> {
    let bestMatch: ContextEntry | undefined;
    let bestScore = 0;

    for (const entry of this.contextEntries.values()) {
      let score: number;

      if (this.config.enableEmbeddings && embedding.length > 0 && entry.embedding.length > 0) {
        // Use embedding similarity
        score = this.cosineSimilarity(embedding, entry.embedding);
      } else {
        // Fall back to text similarity
        score = this.textSimilarity(content, entry.content);
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = entry;
      }
    }

    const isDuplicate = bestScore >= this.config.similarityThreshold;
    
    return {
      isDuplicate,
      similarityScore: bestScore,
      existingEntry: bestMatch,
      suggestion: isDuplicate 
        ? `Similar content found (${(bestScore * 100).toFixed(1)}% similarity) from ${bestMatch?.source}`
        : undefined
    };
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    // For now, use a simple text-based feature extraction
    // In a real implementation, you'd use a proper embedding model
    return this.simpleTextEmbedding(text);
  }

  private simpleTextEmbedding(text: string): number[] {
    // Create a simple embedding based on text features
    const features = new Array(this.config.embeddingDimensions).fill(0);
    
    // Normalize text
    const normalized = text.toLowerCase().replace(/[^\w\s]/g, ' ');
    const words = normalized.split(/\s+/).filter(w => w.length > 2);
    
    // Character n-gram features
    for (let i = 0; i < text.length - 2; i++) {
      const trigram = text.substring(i, i + 3);
      const hash = this.simpleHash(trigram) % this.config.embeddingDimensions;
      features[hash] += 1;
    }
    
    // Word features
    for (const word of words) {
      const hash = this.simpleHash(word) % this.config.embeddingDimensions;
      features[hash] += 2; // Weight words more than trigrams
    }
    
    // Length features
    features[0] = Math.log(text.length + 1);
    features[1] = words.length;
    
    // Normalize
    const magnitude = Math.sqrt(features.reduce((sum, val) => sum + val * val, 0));
    if (magnitude > 0) {
      for (let i = 0; i < features.length; i++) {
        features[i] /= magnitude;
      }
    }
    
    return features;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  private textSimilarity(text1: string, text2: string): number {
    // Jaccard similarity of word sets
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));
    
    const intersection = new Set([...words1].filter(word => words2.has(word)));
    const union = new Set([...words1, ...words2]);
    
    return union.size === 0 ? 0 : intersection.size / union.size;
  }

  private hashContent(content: string): string {
    return crypto.createHash('md5').update(content).digest('hex');
  }

  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  private maintainMaxEntries(): void {
    if (this.contextEntries.size <= this.config.maxContextEntries) {
      return;
    }

    // Remove oldest entries
    const entries = Array.from(this.contextEntries.values())
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    
    const toRemove = entries.slice(0, entries.length - this.config.maxContextEntries);
    for (const entry of toRemove) {
      this.contextEntries.delete(entry.id);
    }
  }

  getContextSummary(): {
    totalEntries: number;
    oldestEntry: Date | null;
    newestEntry: Date | null;
    averageSimilarity: number;
  } {
    if (this.contextEntries.size === 0) {
      return {
        totalEntries: 0,
        oldestEntry: null,
        newestEntry: null,
        averageSimilarity: 0
      };
    }

    const entries = Array.from(this.contextEntries.values());
    const timestamps = entries.map(e => e.timestamp.getTime());
    
    // Calculate average pairwise similarity for a sample
    let totalSimilarity = 0;
    let comparisons = 0;
    const sampleSize = Math.min(50, entries.length);
    
    for (let i = 0; i < sampleSize; i++) {
      for (let j = i + 1; j < sampleSize; j++) {
        const sim = this.config.enableEmbeddings && entries[i].embedding.length > 0
          ? this.cosineSimilarity(entries[i].embedding, entries[j].embedding)
          : this.textSimilarity(entries[i].content, entries[j].content);
        totalSimilarity += sim;
        comparisons++;
      }
    }

    return {
      totalEntries: this.contextEntries.size,
      oldestEntry: new Date(Math.min(...timestamps)),
      newestEntry: new Date(Math.max(...timestamps)),
      averageSimilarity: comparisons > 0 ? totalSimilarity / comparisons : 0
    };
  }

  findDuplicateClusters(threshold: number = 0.8): Array<ContextEntry[]> {
    const entries = Array.from(this.contextEntries.values());
    const clusters: Array<ContextEntry[]> = [];
    const processed = new Set<string>();

    for (const entry of entries) {
      if (processed.has(entry.id)) continue;

      const cluster = [entry];
      processed.add(entry.id);

      for (const other of entries) {
        if (processed.has(other.id)) continue;

        const similarity = this.config.enableEmbeddings && entry.embedding.length > 0
          ? this.cosineSimilarity(entry.embedding, other.embedding)
          : this.textSimilarity(entry.content, other.content);

        if (similarity >= threshold) {
          cluster.push(other);
          processed.add(other.id);
        }
      }

      if (cluster.length > 1) {
        clusters.push(cluster);
      }
    }

    return clusters.sort((a, b) => b.length - a.length);
  }

  purgeOldContext(maxAge: number = 24 * 60 * 60 * 1000): number {
    const cutoff = new Date(Date.now() - maxAge);
    let removed = 0;

    for (const [id, entry] of this.contextEntries.entries()) {
      if (entry.timestamp < cutoff) {
        this.contextEntries.delete(id);
        removed++;
      }
    }

    return removed;
  }

  clear(): void {
    this.contextEntries.clear();
  }

  exportContext(): ContextEntry[] {
    return Array.from(this.contextEntries.values());
  }

  importContext(entries: ContextEntry[]): void {
    this.clear();
    for (const entry of entries) {
      this.contextEntries.set(entry.id, entry);
    }
  }
}
