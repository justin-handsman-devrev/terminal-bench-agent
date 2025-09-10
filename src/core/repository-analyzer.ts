import * as fs from 'fs-extra';
import * as path from 'path';
import { glob } from 'glob';
import ignore from 'ignore';
import simpleGit from 'simple-git';
import { RepositoryContext, FileInfo, DirectoryTree, GitInfo, PackageInfo } from '../types';
import { ConsoleLogger } from './logger';

export class RepositoryAnalyzer {
  private logger: ConsoleLogger;
  private git: any;

  constructor(logger: ConsoleLogger) {
    this.logger = logger;
  }

  async analyzeRepository(rootPath: string): Promise<RepositoryContext> {
    this.logger.info(`Analyzing repository at ${rootPath}`);
    this.git = simpleGit(rootPath);

    const [files, structure, gitInfo, dependencies, technologies] = await Promise.all([
      this.scanFiles(rootPath),
      this.buildDirectoryTree(rootPath),
      this.getGitInfo(rootPath),
      this.analyzeDependencies(rootPath),
      this.detectTechnologies(rootPath)
    ]);

    const context: RepositoryContext = {
      rootPath,
      files,
      structure,
      gitInfo,
      dependencies,
      technologies
    };

    this.logger.success(`Repository analysis complete: ${files.length} files, ${technologies.length} technologies`);
    return context;
  }

  private async scanFiles(rootPath: string): Promise<FileInfo[]> {
    const files: FileInfo[] = [];
    const ignoreRules = ignore();

    // Load common ignore patterns
    const gitignorePath = path.join(rootPath, '.gitignore');
    if (await fs.pathExists(gitignorePath)) {
      const gitignoreContent = await fs.readFile(gitignorePath, 'utf-8');
      ignoreRules.add(gitignoreContent);
    }

    // Add common patterns
    ignoreRules.add([
      'node_modules/**',
      '.git/**',
      'dist/**',
      'build/**',
      '*.log',
      '.env*',
      '*.tmp',
      '*.temp',
      '.DS_Store'
    ]);

    try {
      const globPattern = path.join(rootPath, '**/*');
      const foundFiles = await glob(globPattern, { 
        dot: false,
        ignore: ['node_modules/**', '.git/**']
      });

      for (const filePath of foundFiles) {
        try {
          const relativePath = path.relative(rootPath, filePath);
          
          // Skip ignored files
          if (ignoreRules.ignores(relativePath)) {
            continue;
          }

          const stats = await fs.stat(filePath);
          
          if (stats.isFile()) {
            const fileInfo: FileInfo = {
              path: relativePath,
              type: 'file',
              size: stats.size,
              lastModified: stats.mtime,
              language: this.detectLanguage(filePath),
              importance: this.calculateImportance(relativePath, stats.size)
            };
            files.push(fileInfo);
          }
        } catch (error) {
          // Skip files that can't be accessed
          continue;
        }
      }
    } catch (error: any) {
      this.logger.warn('Error scanning files:', error.message);
    }

    return files.sort((a, b) => b.importance - a.importance);
  }

  private detectLanguage(filePath: string): string | undefined {
    const ext = path.extname(filePath).toLowerCase();
    const languageMap: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.py': 'python',
      '.java': 'java',
      '.cpp': 'cpp',
      '.c': 'c',
      '.h': 'c',
      '.cs': 'csharp',
      '.php': 'php',
      '.rb': 'ruby',
      '.go': 'go',
      '.rs': 'rust',
      '.swift': 'swift',
      '.kt': 'kotlin',
      '.scala': 'scala',
      '.html': 'html',
      '.css': 'css',
      '.scss': 'scss',
      '.less': 'less',
      '.json': 'json',
      '.yaml': 'yaml',
      '.yml': 'yaml',
      '.xml': 'xml',
      '.md': 'markdown',
      '.sh': 'shell',
      '.bash': 'shell',
      '.zsh': 'shell',
      '.sql': 'sql'
    };

    return languageMap[ext];
  }

  private calculateImportance(filePath: string, fileSize: number): number {
    let score = 1;

    // File type importance
    if (filePath.includes('package.json') || filePath.includes('requirements.txt') || 
        filePath.includes('Cargo.toml') || filePath.includes('go.mod')) {
      score += 10;
    }

    if (filePath.includes('README') || filePath.includes('CHANGELOG')) {
      score += 8;
    }

    if (filePath.includes('.config') || filePath.includes('tsconfig') || 
        filePath.includes('webpack') || filePath.includes('vite.config')) {
      score += 6;
    }

    // Directory importance
    if (filePath.includes('src/') || filePath.includes('lib/')) {
      score += 5;
    }

    if (filePath.includes('test/') || filePath.includes('spec/')) {
      score += 2;
    }

    // File size (larger files might be more important)
    if (fileSize > 10000) score += 3;
    else if (fileSize > 5000) score += 2;
    else if (fileSize > 1000) score += 1;

    return score;
  }

  private async buildDirectoryTree(rootPath: string): Promise<DirectoryTree> {
    const buildTree = async (currentPath: string): Promise<DirectoryTree> => {
      const stats = await fs.stat(currentPath);
      const name = path.basename(currentPath);
      const relativePath = path.relative(rootPath, currentPath);

      if (stats.isDirectory()) {
        const children: DirectoryTree[] = [];
        try {
          const entries = await fs.readdir(currentPath);
          for (const entry of entries) {
            if (entry.startsWith('.') && entry !== '.gitignore') continue;
            if (entry === 'node_modules') continue;
            
            const entryPath = path.join(currentPath, entry);
            const child = await buildTree(entryPath);
            children.push(child);
          }
        } catch (error) {
          // Skip directories we can't read
        }

        return {
          name,
          type: 'directory',
          path: relativePath || '.',
          children: children.sort((a, b) => {
            if (a.type !== b.type) {
              return a.type === 'directory' ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
          })
        };
      } else {
        return {
          name,
          type: 'file',
          path: relativePath
        };
      }
    };

    return buildTree(rootPath);
  }

  private async getGitInfo(rootPath: string): Promise<GitInfo | undefined> {
    try {
      const git = simpleGit(rootPath);
      
      const [status, log, remotes] = await Promise.all([
        git.status(),
        git.log({ maxCount: 1 }),
        git.getRemotes(true)
      ]);

      const hasUncommittedChanges = !status.isClean();
      const lastCommit = log.latest;
      const origin = remotes.find(r => r.name === 'origin');

      return {
        branch: status.current || 'unknown',
        hasUncommittedChanges,
        remoteUrl: origin?.refs?.fetch,
        lastCommit: {
          hash: lastCommit?.hash || '',
          message: lastCommit?.message || '',
          author: lastCommit?.author_name || '',
          date: lastCommit?.date ? new Date(lastCommit.date) : new Date()
        }
      };
    } catch (error) {
      this.logger.debug('Git info not available:', error);
      return undefined;
    }
  }

  private async analyzeDependencies(rootPath: string): Promise<PackageInfo[]> {
    const dependencies: PackageInfo[] = [];

    // Package.json (npm/yarn)
    const packageJsonPath = path.join(rootPath, 'package.json');
    if (await fs.pathExists(packageJsonPath)) {
      const packageJson = await fs.readJson(packageJsonPath);
      dependencies.push({
        type: 'npm',
        file: 'package.json',
        dependencies: packageJson.dependencies || {},
        devDependencies: packageJson.devDependencies || {}
      });
    }

    // Requirements.txt (pip)
    const requirementsPath = path.join(rootPath, 'requirements.txt');
    if (await fs.pathExists(requirementsPath)) {
      const content = await fs.readFile(requirementsPath, 'utf-8');
      const deps: Record<string, string> = {};
      content.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const [name, version] = trimmed.split('==');
          deps[name] = version || 'latest';
        }
      });
      dependencies.push({
        type: 'pip',
        file: 'requirements.txt',
        dependencies: deps
      });
    }

    return dependencies;
  }

  private async detectTechnologies(rootPath: string): Promise<string[]> {
    const technologies = new Set<string>();

    // Check for specific files
    const fileIndicators: Record<string, string[]> = {
      'package.json': ['Node.js', 'npm'],
      'yarn.lock': ['Yarn'],
      'requirements.txt': ['Python', 'pip'],
      'Cargo.toml': ['Rust', 'Cargo'],
      'go.mod': ['Go'],
      'pom.xml': ['Java', 'Maven'],
      'build.gradle': ['Java', 'Gradle'],
      'Dockerfile': ['Docker'],
      'docker-compose.yml': ['Docker Compose'],
      'tsconfig.json': ['TypeScript'],
      'webpack.config.js': ['Webpack'],
      'vite.config.js': ['Vite'],
      'next.config.js': ['Next.js'],
      'nuxt.config.js': ['Nuxt.js'],
      'angular.json': ['Angular'],
      'vue.config.js': ['Vue.js'],
      'svelte.config.js': ['Svelte']
    };

    for (const [file, techs] of Object.entries(fileIndicators)) {
      if (await fs.pathExists(path.join(rootPath, file))) {
        techs.forEach(tech => technologies.add(tech));
      }
    }

    return Array.from(technologies);
  }
}
