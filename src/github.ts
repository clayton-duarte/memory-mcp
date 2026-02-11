import { Octokit } from '@octokit/rest';
import { log } from './logger.js';

export interface GitHubFile {
  path: string;
  content: string;
  sha: string;
}

export interface GitHubConfig {
  token: string;
  repo: string; // format: "owner/repo"
}

export class GitHubClient {
  private octokit: Octokit;
  private owner: string;
  private repo: string;

  constructor(config: GitHubConfig) {
    const [owner, repo] = config.repo.split('/');
    if (!owner || !repo) {
      throw new Error(`Invalid repo format: "${config.repo}". Expected "owner/repo".`);
    }
    this.owner = owner;
    this.repo = repo;
    this.octokit = new Octokit({ auth: config.token });
  }

  /**
   * Get the latest commit SHA on the default branch
   */
  async getLatestCommitSha(): Promise<string | null> {
    try {
      const { data: repoData } = await this.octokit.repos.get({
        owner: this.owner,
        repo: this.repo,
      });
      
      const { data: ref } = await this.octokit.git.getRef({
        owner: this.owner,
        repo: this.repo,
        ref: `heads/${repoData.default_branch}`,
      });
      
      return ref.object.sha.substring(0, 7); // Short SHA
    } catch {
      return null;
    }
  }

  /**
   * List all files in the repository
   */
  async listTree(): Promise<Array<{ path: string; sha: string }>> {
    log('github', `Fetching tree for ${this.owner}/${this.repo}`);
    
    try {
      // Get the default branch
      const { data: repoData } = await this.octokit.repos.get({
        owner: this.owner,
        repo: this.repo,
      });
      
      const defaultBranch = repoData.default_branch;
      
      // Get the tree recursively
      const { data: treeData } = await this.octokit.git.getTree({
        owner: this.owner,
        repo: this.repo,
        tree_sha: defaultBranch,
        recursive: 'true',
      });

      return treeData.tree
        .filter((item) => item.type === 'blob' && item.path && item.sha)
        .map((item) => ({ path: item.path!, sha: item.sha! }));
    } catch (error: unknown) {
      if (error instanceof Error && 'status' in error && (error.status === 404 || error.status === 409)) {
        log('github', 'Repository is empty or not found, returning empty tree');
        return [];
      }
      throw error;
    }
  }

  /**
   * Get file content by path
   */
  async getFile(path: string): Promise<GitHubFile | null> {
    log('github', `Fetching file: ${path}`);
    
    try {
      const { data } = await this.octokit.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path,
      });

      if (Array.isArray(data) || data.type !== 'file') {
        return null;
      }

      const content = Buffer.from(data.content, 'base64').toString('utf-8');
      return {
        path,
        content,
        sha: data.sha,
      };
    } catch (error: unknown) {
      if (error instanceof Error && 'status' in error && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Create or update a file
   */
  async putFile(path: string, content: string, sha?: string): Promise<string> {
    log('github', `${sha ? 'Updating' : 'Creating'} file: ${path}`);
    
    const message = sha ? `Update ${path}` : `Create ${path}`;
    
    const { data } = await this.octokit.repos.createOrUpdateFileContents({
      owner: this.owner,
      repo: this.repo,
      path,
      message,
      content: Buffer.from(content).toString('base64'),
      sha,
    });

    return data.content?.sha ?? '';
  }

  /**
   * Delete a file
   */
  async deleteFile(path: string, sha: string): Promise<void> {
    log('github', `Deleting file: ${path}`);
    
    await this.octokit.repos.deleteFile({
      owner: this.owner,
      repo: this.repo,
      path,
      message: `Delete ${path}`,
      sha,
    });
  }

  /**
   * Check if repository exists and is accessible
   */
  async validateAccess(): Promise<boolean> {
    try {
      await this.octokit.repos.get({
        owner: this.owner,
        repo: this.repo,
      });
      return true;
    } catch {
      return false;
    }
  }
}
