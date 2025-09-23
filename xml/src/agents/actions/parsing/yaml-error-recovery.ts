import * as yaml from 'js-yaml';

export interface YamlRecoveryResult {
  success: boolean;
  data?: any;
  originalError?: yaml.YAMLException;
  recoveryAttempts?: string[];
  suggestion?: string;
}

export interface YamlErrorPattern {
  pattern: RegExp;
  recovery: (content: string, match: RegExpMatchArray) => string;
  description: string;
}

export class YamlErrorRecovery {
  private static readonly ERROR_PATTERNS: YamlErrorPattern[] = [
    {
      pattern: /^(.+?):\s*([^'"\n]*[@#%&*!?\[\]{}|><=`].*)$/gm,
      recovery: (content, match) => {
        const [full, key, value] = match;
        if (/^["'].*["']$/.test(value.trim()) || /^(true|false|null|\d+\.?\d*)$/.test(value.trim())) {
          return full;
        }
        return `${key}: "${value.trim()}"`;
      },
      description: 'Adding quotes to values with special characters'
    },
    {
      pattern: /^\t+/gm,
      recovery: (content, match) => {
        return match[0].replace(/\t/g, '  ');
      },
      description: 'Converting tabs to spaces'
    },
    {
      pattern: /,\s*$/gm,
      recovery: (content, match) => {
        return '';
      },
      description: 'Removing trailing commas'
    },
    {
      pattern: /^(\s*)([^:\n]+):([^\s\n])/gm,
      recovery: (content, match) => {
        const [full, indent, key, value] = match;
        if (key.match(/^(https?|ftp|ssh|git)/)) {
          return full;
        }
        return `${indent}${key}: ${value}`;
      },
      description: 'Adding space after colons'
    },
    {
      pattern: /^(\s*)([^:\n]+):\s*(["'])([^"'\n]*?)$/gm,
      recovery: (content, match) => {
        const [full, indent, key, quote, value] = match;
        return `${indent}${key}: ${quote}${value}${quote}`;
      },
      description: 'Closing unclosed quotes'
    },
    {
      pattern: /:\s*(True|TRUE|False|FALSE|None|NONE|Null|NULL)\s*$/gm,
      recovery: (content, match) => {
        const value = match[0].substring(1).trim().toLowerCase();
        const mapping: Record<string, string> = {
          'true': 'true',
          'false': 'false',
          'none': 'null',
          'null': 'null'
        };
        return `: ${mapping[value] || value}`;
      },
      description: 'Fixing boolean/null case sensitivity'
    },
    {
      pattern: /^(\s*)-([^\s])/gm,
      recovery: (content, match) => {
        const [full, indent, firstChar] = match;
        return `${indent}- ${firstChar}`;
      },
      description: 'Adding space after list dashes'
    },
    {
      pattern: /^(\s*)([^:\n]+):\s*$/gm,
      recovery: (content, match) => {
        const [full, indent, key] = match;
        return `${indent}${key}: ""`;
      },
      description: 'Setting empty values to empty strings'
    },
    {
      pattern: /:\s*([^'"\n]*\\[^'"\n]*)$/gm,
      recovery: (content, match) => {
        const [full, value] = match;
        if (!/^["'].*["']$/.test(value.trim())) {
          return `: "${value.replace(/\\/g, '\\\\')}"`;
        }
        return full;
      },
      description: 'Escaping backslashes in values'
    },
    {
      pattern: /^(\s*)([^:\n]+):\s*([^'"\n]{50,})$/gm,
      recovery: (content, match) => {
        const [full, indent, key, value] = match;
        return `${indent}${key}: |\n${indent}  ${value.trim()}`;
      },
      description: 'Converting long strings to block scalars'
    }
  ];

  static async tryRecover(content: string, originalError?: yaml.YAMLException): Promise<YamlRecoveryResult> {
    const attempts: string[] = [];
    let currentContent = content;
    let lastError = originalError;
    
    try {
      const data = yaml.load(currentContent);
      return { success: true, data };
    } catch (error) {
      lastError = error as yaml.YAMLException;
    }
    
    for (const pattern of this.ERROR_PATTERNS) {
      const matches = currentContent.matchAll(pattern.pattern);
      let modified = currentContent;
      let hasChanges = false;
      
      for (const match of matches) {
        const recovered = pattern.recovery(currentContent, match);
        if (recovered !== match[0]) {
          modified = modified.replace(match[0], recovered);
          hasChanges = true;
        }
      }
      
      if (hasChanges) {
        attempts.push(pattern.description);
        currentContent = modified;
        
        try {
          const data = yaml.load(currentContent);
          return {
            success: true,
            data,
            originalError,
            recoveryAttempts: attempts,
            suggestion: `YAML parsing succeeded after: ${attempts.join(', ')}`
          };
        } catch (error) {
          lastError = error as yaml.YAMLException;
        }
      }
    }
    
    const aggressiveResult = await this.tryAggressiveRecovery(content, originalError);
    if (aggressiveResult.success) {
      return aggressiveResult;
    }
    
    const suggestion = this.generateErrorSuggestion(content, lastError || originalError);
    
    return {
      success: false,
      originalError: originalError || lastError,
      recoveryAttempts: attempts,
      suggestion
    };
  }
  
  private static async tryAggressiveRecovery(content: string, originalError?: yaml.YAMLException): Promise<YamlRecoveryResult> {
    const attempts: string[] = [];
    
    try {
      const lines = content.split('\n').filter(line => line.trim());
      const simpleObj: Record<string, any> = {};
      
      for (const line of lines) {
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
          const key = line.substring(0, colonIndex).trim();
          const value = line.substring(colonIndex + 1).trim();
          
          try {
            simpleObj[key] = JSON.parse(value);
          } catch {
            if (value === 'true' || value === 'false') {
              simpleObj[key] = value === 'true';
            } else if (value === 'null' || value === '') {
              simpleObj[key] = null;
            } else if (/^\d+$/.test(value)) {
              simpleObj[key] = parseInt(value);
            } else if (/^\d+\.\d+$/.test(value)) {
              simpleObj[key] = parseFloat(value);
            } else {
              simpleObj[key] = value.replace(/^["']|["']$/g, '');
            }
          }
        }
      }
      
      if (Object.keys(simpleObj).length > 0) {
        attempts.push('Parsing as simple key-value pairs');
        return {
          success: true,
          data: simpleObj,
          originalError,
          recoveryAttempts: attempts,
          suggestion: 'YAML was simplified to basic key-value format'
        };
      }
    } catch (error) {
      // Continue to next strategy
    }
    
    if (content.includes('cmd:') || content.includes('command:')) {
      try {
        const cmdMatch = content.match(/(?:cmd|command)\s*:\s*(.+?)(?:\n|$)/s);
        if (cmdMatch) {
          let cmd = cmdMatch[1].trim();
          if (cmd.startsWith('|') || cmd.startsWith('>')) {
            const lines = content.split('\n');
            const cmdIndex = lines.findIndex(l => l.includes('cmd:') || l.includes('command:'));
            const cmdLines = [];
            for (let i = cmdIndex + 1; i < lines.length; i++) {
              const line = lines[i];
              if (line.match(/^\s+/)) {
                cmdLines.push(line.trimStart());
              } else {
                break;
              }
            }
            cmd = cmdLines.join('\n');
          }
          
          attempts.push('Extracting command from malformed YAML');
          return {
            success: true,
            data: { cmd: cmd.replace(/^["']|["']$/g, '') },
            originalError,
            recoveryAttempts: attempts,
            suggestion: 'Extracted command from malformed YAML structure'
          };
        }
      } catch (error) {
        // Continue
      }
    }
    
    return {
      success: false,
      originalError,
      recoveryAttempts: attempts
    };
  }
  
  private static generateErrorSuggestion(content: string, error?: yaml.YAMLException): string {
    const suggestions: string[] = [];
    
    if (error?.message) {
      if (error.message.includes('end of the stream')) {
        suggestions.push('Check for unclosed quotes or brackets');
        suggestions.push('Ensure all indented blocks are properly aligned');
      } else if (error.message.includes('indentation')) {
        suggestions.push('Use consistent indentation (2 or 4 spaces, not tabs)');
        suggestions.push('Ensure child elements are indented more than their parents');
      } else if (error.message.includes('duplicate key')) {
        const keyMatch = error.message.match(/Key "([^"]+)"/);
        if (keyMatch) {
          suggestions.push(`Remove duplicate key: ${keyMatch[1]}`);
        }
      } else if (error.message.includes('unexpected')) {
        suggestions.push('Check for missing colons after keys');
        suggestions.push('Ensure proper spacing after colons and dashes');
      }
    }
    
    if (content.includes('\t')) {
      suggestions.push('Replace tabs with spaces');
    }
    
    if (content.match(/:\S/)) {
      suggestions.push('Add space after colons');
    }
    
    if (content.match(/-\S/)) {
      suggestions.push('Add space after list dashes');
    }
    
    const lines = content.split('\n');
    const hasLongLines = lines.some(line => line.length > 80 && line.includes(':'));
    if (hasLongLines) {
      suggestions.push('Consider using block scalars (|) for long strings');
    }
    
    suggestions.push('\nExample of correct YAML structure:');
    suggestions.push('key: value');
    suggestions.push('list:');
    suggestions.push('  - item1');
    suggestions.push('  - item2');
    suggestions.push('multiline: |');
    suggestions.push('  Line 1');
    suggestions.push('  Line 2');
    
    return suggestions.join('\n');
  }
  
  static validateYamlStructure(data: any, expectedKeys?: string[]): string[] {
    const issues: string[] = [];
    
    if (!data || typeof data !== 'object') {
      issues.push('YAML should produce an object, not a primitive value');
      return issues;
    }
    
    if (expectedKeys) {
      const actualKeys = Object.keys(data);
      const missingKeys = expectedKeys.filter(key => !actualKeys.includes(key));
      const extraKeys = actualKeys.filter(key => !expectedKeys.includes(key));
      
      if (missingKeys.length > 0) {
        issues.push(`Missing required keys: ${missingKeys.join(', ')}`);
      }
      
      if (extraKeys.length > 0) {
        issues.push(`Unexpected keys: ${extraKeys.join(', ')}`);
        issues.push('Did you mean: ' + extraKeys.map(key => {
          const closest = expectedKeys.reduce((best, expected) => {
            const distance = this.levenshteinDistance(key, expected);
            return distance < best.distance ? { key: expected, distance } : best;
          }, { key: '', distance: Infinity });
          return `${key} → ${closest.key}`;
        }).join(', '));
      }
    }
    
    return issues;
  }
  
  private static levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];
    
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[b.length][a.length];
  }
}
