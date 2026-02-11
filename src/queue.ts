import { readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { log } from './logger.js';

export interface QueueItem {
  path: string;
  content: string;
  operation: 'save' | 'delete';
  timestamp: number;
  retryCount: number;
}

const QUEUE_FILE = join(homedir(), '.memory-mcp-queue.json');
const MAX_RETRIES = 3;

/**
 * Persistent write queue for failed GitHub operations
 * Stores pending writes to disk and retries on next operation
 */
export class WriteQueue {
  private items: QueueItem[] = [];

  constructor() {
    this.load();
  }

  /**
   * Load queue from disk
   */
  private load(): void {
    try {
      if (existsSync(QUEUE_FILE)) {
        const data = readFileSync(QUEUE_FILE, 'utf-8');
        this.items = JSON.parse(data);
        log('queue', `Loaded ${this.items.length} pending items from queue`);
      }
    } catch (error) {
      log('queue', `Failed to load queue file: ${error}`);
      this.items = [];
    }
  }

  /**
   * Persist queue to disk
   */
  private save(): void {
    try {
      writeFileSync(QUEUE_FILE, JSON.stringify(this.items, null, 2));
    } catch (error) {
      log('queue', `Failed to save queue file: ${error}`);
    }
  }

  /**
   * Add an item to the queue
   */
  enqueue(path: string, content: string, operation: 'save' | 'delete'): void {
    // Remove any existing item for the same path
    this.items = this.items.filter((item) => item.path !== path);
    
    this.items.push({
      path,
      content,
      operation,
      timestamp: Date.now(),
      retryCount: 0,
    });
    
    this.save();
    log('queue', `Enqueued ${operation} for: ${path}`);
  }

  /**
   * Get all pending items
   */
  getAll(): QueueItem[] {
    return [...this.items];
  }

  /**
   * Remove an item from the queue (after successful sync)
   */
  remove(path: string): void {
    const before = this.items.length;
    this.items = this.items.filter((item) => item.path !== path);
    
    if (this.items.length < before) {
      this.save();
      log('queue', `Removed from queue: ${path}`);
    }
  }

  /**
   * Increment retry count and remove if max retries exceeded
   */
  incrementRetry(path: string): boolean {
    const item = this.items.find((i) => i.path === path);
    if (!item) return false;

    item.retryCount++;
    
    if (item.retryCount >= MAX_RETRIES) {
      this.items = this.items.filter((i) => i.path !== path);
      log('queue', `Max retries reached, dropping: ${path}`);
      this.save();
      return false;
    }

    this.save();
    log('queue', `Retry ${item.retryCount}/${MAX_RETRIES} for: ${path}`);
    return true;
  }

  /**
   * Check if queue is empty
   */
  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  /**
   * Get queue size
   */
  get size(): number {
    return this.items.length;
  }
}

// Global queue instance
export const writeQueue = new WriteQueue();
