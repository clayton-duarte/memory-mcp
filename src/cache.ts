import { log } from './logger.js';

export interface CacheEntry {
  content: string;
  sha: string;
}

export interface SearchResult {
  path: string;
  snippet: string;
}

/**
 * In-memory cache for fast reads
 * Cache is populated on startup and updated optimistically on writes
 */
export class MemoryCache {
  private cache: Map<string, CacheEntry> = new Map();

  /**
   * Get a cached entry
   */
  get(path: string): CacheEntry | undefined {
    const entry = this.cache.get(path);
    if (entry) {
      log('cache', `HIT: ${path}`);
    } else {
      log('cache', `MISS: ${path}`);
    }
    return entry;
  }

  /**
   * Set a cache entry
   */
  set(path: string, content: string, sha: string): void {
    this.cache.set(path, { content, sha });
    log('cache', `SET: ${path}`);
  }

  /**
   * Delete a cache entry
   */
  delete(path: string): boolean {
    const deleted = this.cache.delete(path);
    if (deleted) {
      log('cache', `DELETE: ${path}`);
    }
    return deleted;
  }

  /**
   * Check if path exists in cache
   */
  has(path: string): boolean {
    return this.cache.has(path);
  }

  /**
   * Get all cached paths
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Get all entries
   */
  entries(): Array<[string, CacheEntry]> {
    return Array.from(this.cache.entries());
  }

  /**
   * Get unique categories (top-level folders)
   */
  categories(): string[] {
    const categories = new Set<string>();
    for (const path of this.cache.keys()) {
      const parts = path.split('/');
      if (parts.length > 1) {
        categories.add(parts[0]);
      }
    }
    return Array.from(categories).sort();
  }

  /**
   * Search across paths and content
   * Returns matching paths with content snippets
   */
  search(query: string): SearchResult[] {
    const results: SearchResult[] = [];
    const queryLower = query.toLowerCase();

    for (const [path, entry] of this.cache.entries()) {
      // Check path match
      if (path.toLowerCase().includes(queryLower)) {
        results.push({
          path,
          snippet: this.extractSnippet(entry.content, query),
        });
        continue;
      }

      // Check content match
      const contentLower = entry.content.toLowerCase();
      const matchIndex = contentLower.indexOf(queryLower);
      if (matchIndex !== -1) {
        results.push({
          path,
          snippet: this.extractSnippet(entry.content, query, matchIndex),
        });
      }
    }

    log('cache', `SEARCH: "${query}" found ${results.length} results`);
    return results;
  }

  /**
   * Extract a snippet around the match
   */
  private extractSnippet(content: string, query: string, matchIndex?: number): string {
    const maxLength = 150;
    
    if (content.length <= maxLength) {
      return content;
    }

    if (matchIndex === undefined) {
      const contentLower = content.toLowerCase();
      matchIndex = contentLower.indexOf(query.toLowerCase());
    }

    if (matchIndex === -1) {
      return content.slice(0, maxLength) + '...';
    }

    // Calculate start and end positions centered around the match
    const snippetStart = Math.max(0, matchIndex - 50);
    const snippetEnd = Math.min(content.length, matchIndex + query.length + 100);
    
    let snippet = content.slice(snippetStart, snippetEnd);
    
    if (snippetStart > 0) {
      snippet = '...' + snippet;
    }
    if (snippetEnd < content.length) {
      snippet = snippet + '...';
    }

    return snippet;
  }

  /**
   * Clear the entire cache
   */
  clear(): void {
    this.cache.clear();
    log('cache', 'CLEARED');
  }

  /**
   * Get cache size
   */
  get size(): number {
    return this.cache.size;
  }
}

// Global cache instance
export const cache = new MemoryCache();
