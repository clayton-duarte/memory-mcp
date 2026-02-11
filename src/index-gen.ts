import { GitHubClient } from './github.js';
import { MemoryCache } from './cache.js';
import { log } from './logger.js';

export interface IndexFile {
  categories: string[];
  files: Array<{ path: string; category: string }>;
  lastUpdated: string;
}

const INDEX_PATH = 'index.json';

/**
 * Generate and update index.json based on cache contents
 */
export async function updateIndex(github: GitHubClient, cache: MemoryCache): Promise<void> {
  log('writer', 'Regenerating index.json');

  const files = cache.keys()
    .filter((path) => path !== INDEX_PATH)
    .map((path) => {
      const parts = path.split('/');
      const category = parts.length > 1 ? parts[0] : 'root';
      return { path, category };
    })
    .sort((a, b) => a.path.localeCompare(b.path));

  const categories = [...new Set(files.map((f) => f.category))].sort();

  const index: IndexFile = {
    categories,
    files,
    lastUpdated: new Date().toISOString(),
  };

  const content = JSON.stringify(index, null, 2);

  // Get existing SHA for index.json
  const existingIndex = cache.get(INDEX_PATH);
  
  try {
    const newSha = await github.putFile(INDEX_PATH, content, existingIndex?.sha);
    cache.set(INDEX_PATH, content, newSha);
    log('writer', `Index updated with ${files.length} files in ${categories.length} categories`);
  } catch (error) {
    log('writer', `Failed to update index: ${error}`);
    throw error;
  }
}

/**
 * Parse index.json content
 */
export function parseIndex(content: string): IndexFile {
  return JSON.parse(content) as IndexFile;
}
