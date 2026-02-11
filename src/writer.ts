import { GitHubClient } from './github.js';
import { cache, CacheEntry } from './cache.js';
import { writeQueue } from './queue.js';
import { updateIndex } from './index-gen.js';
import { log } from './logger.js';

// Maximum file size: 1MB (GitHub API limit for base64 content)
const MAX_FILE_SIZE = 1 * 1024 * 1024;

/**
 * Async writer manager - handles non-blocking GitHub operations
 * Updates cache immediately, returns to agent, syncs GitHub in background
 */
export class AsyncWriter {
  private github: GitHubClient;
  private pendingWrites: Set<string> = new Set();

  constructor(github: GitHubClient) {
    this.github = github;
  }

  /**
   * Save a file - updates cache immediately, syncs GitHub async
   * Returns immediately after cache update
   */
  async save(category: string, name: string, content: string): Promise<{ success: boolean; path: string; error?: string }> {
    // Validate file size
    const contentSize = Buffer.byteLength(content, 'utf-8');
    if (contentSize > MAX_FILE_SIZE) {
      return {
        success: false,
        path: '',
        error: `File size (${Math.round(contentSize / 1024)}KB) exceeds maximum allowed size (${MAX_FILE_SIZE / 1024}KB)`,
      };
    }

    // Normalize category and name
    const normalizedCategory = category.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const normalizedName = name.endsWith('.md') || name.endsWith('.yaml') || name.endsWith('.json') 
      ? name 
      : `${name}.md`;
    
    const path = `${normalizedCategory}/${normalizedName}`;

    // Get existing SHA if file exists in cache
    const existing = cache.get(path);
    const sha = existing?.sha;

    // Update cache immediately (optimistic)
    cache.set(path, content, sha ?? 'pending');

    // Fire-and-forget GitHub sync
    this.syncToGitHub(path, content, sha);

    return { success: true, path };
  }

  /**
   * Delete a file - removes from cache immediately, syncs GitHub async
   */
  async delete(path: string): Promise<{ success: boolean; error?: string }> {
    const existing = cache.get(path);
    
    if (!existing) {
      return { success: false, error: `File not found: ${path}` };
    }

    // Remove from cache immediately
    cache.delete(path);

    // Fire-and-forget GitHub delete
    this.deleteFromGitHub(path, existing.sha);

    return { success: true };
  }

  /**
   * Sync a file to GitHub (async, non-blocking)
   */
  private async syncToGitHub(path: string, content: string, sha?: string): Promise<void> {
    // Prevent duplicate syncs
    if (this.pendingWrites.has(path)) {
      log('writer', `Sync already pending for: ${path}`);
      return;
    }

    this.pendingWrites.add(path);

    try {
      log('writer', `Starting async sync: ${path}`);
      const newSha = await this.github.putFile(path, content, sha);
      
      // Update cache with real SHA
      cache.set(path, content, newSha);
      
      // Update index
      await this.updateIndexSafe();
      
      // Remove from queue if it was there
      writeQueue.remove(path);
      
      log('writer', `Sync complete: ${path}`);
    } catch (error) {
      log('writer', `Sync failed for ${path}: ${error}`);
      
      // Add to queue for retry
      writeQueue.enqueue(path, content, 'save');
    } finally {
      this.pendingWrites.delete(path);
    }
  }

  /**
   * Delete a file from GitHub (async, non-blocking)
   */
  private async deleteFromGitHub(path: string, sha: string): Promise<void> {
    if (this.pendingWrites.has(path)) {
      return;
    }

    this.pendingWrites.add(path);

    try {
      log('writer', `Starting async delete: ${path}`);
      await this.github.deleteFile(path, sha);
      
      // Update index
      await this.updateIndexSafe();
      
      // Remove from queue if it was there
      writeQueue.remove(path);
      
      log('writer', `Delete complete: ${path}`);
    } catch (error) {
      log('writer', `Delete failed for ${path}: ${error}`);
      
      // Add to queue for retry
      writeQueue.enqueue(path, '', 'delete');
    } finally {
      this.pendingWrites.delete(path);
    }
  }

  /**
   * Update index without blocking on errors
   */
  private async updateIndexSafe(): Promise<void> {
    try {
      await updateIndex(this.github, cache);
    } catch (error) {
      log('writer', `Index update failed: ${error}`);
    }
  }

  /**
   * Drain the write queue - called on startup and after successful operations
   */
  async drainQueue(): Promise<void> {
    const items = writeQueue.getAll();
    
    if (items.length === 0) {
      return;
    }

    log('queue', `Draining ${items.length} queued items`);

    for (const item of items) {
      try {
        if (item.operation === 'save') {
          const existing = cache.get(item.path);
          await this.github.putFile(item.path, item.content, existing?.sha);
          writeQueue.remove(item.path);
          log('queue', `Drained: ${item.path}`);
        } else if (item.operation === 'delete') {
          const existing = cache.get(item.path);
          if (existing) {
            await this.github.deleteFile(item.path, existing.sha);
          }
          writeQueue.remove(item.path);
          log('queue', `Drained delete: ${item.path}`);
        }
      } catch (error) {
        log('queue', `Failed to drain ${item.path}: ${error}`);
        writeQueue.incrementRetry(item.path);
      }
    }

    // Update index after draining
    await this.updateIndexSafe();
  }
}
