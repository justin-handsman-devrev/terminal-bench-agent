import { z } from 'zod';
import { Tool, ToolContext, ToolResult } from '../types';

export abstract class BaseTool implements Tool {
  abstract name: string;
  abstract description: string;
  abstract parameters: z.ZodSchema;

  abstract execute(params: any, context: ToolContext): Promise<ToolResult>;

  protected createSuccessResult(data: any, message?: string): ToolResult {
    return {
      success: true,
      data,
      message
    };
  }

  protected createErrorResult(error: string, data?: any): ToolResult {
    return {
      success: false,
      data: data || null,
      error
    };
  }

  protected validateParams<T>(params: unknown): T {
    try {
      // Convert string booleans and numbers before validation
      const convertedParams = this.convertStringParams(params);
      return this.parameters.parse(convertedParams) as T;
    } catch (error: any) {
      throw new Error(`Invalid parameters: ${error.message}`);
    }
  }

  private convertStringParams(params: any): any {
    if (!params || typeof params !== 'object') return params;
    
    const converted: any = Array.isArray(params) ? [...params] : { ...params };
    
    // Get the expected parameter types from the schema
    const schemaShape = this.getSchemaShape();
    
    for (const [key, value] of Object.entries(converted)) {
      const expectedType = schemaShape[key];
      
      if (typeof value === 'string' && expectedType) {
        // Only convert if we know the expected type
        if (expectedType === 'boolean') {
          if (value === 'true') {
            converted[key] = true;
          } else if (value === 'false') {
            converted[key] = false;
          }
        } else if (expectedType === 'number') {
          if (/^\d+$/.test(value)) {
            converted[key] = parseInt(value, 10);
          } else if (/^\d*\.\d+$/.test(value)) {
            converted[key] = parseFloat(value);
          }
        }
        // If expectedType is 'string', leave it as string
      } else if (typeof value === 'object' && value !== null) {
        // Recursively convert nested objects
        converted[key] = this.convertStringParams(value);
      }
    }
    
    return converted;
  }

  private getSchemaShape(): Record<string, string> {
    // This is a simplified version - in a full implementation you'd parse the Zod schema
    // For now, return common parameter types for our tools
    const commonTypes: Record<string, string> = {
      'recursive': 'boolean',
      'max_depth': 'number',
      'max_size': 'number',
      'create_directories': 'boolean',
      'staged': 'boolean',
      'add_all': 'boolean',
      'max_count': 'number',
      'all': 'boolean',
      'extract_functions': 'boolean',
      'extract_classes': 'boolean',
      'extract_imports': 'boolean',
      'extract_types': 'boolean',
      'start_line': 'number',
      'end_line': 'number',
      'prettyPrint': 'boolean'
    };
    return commonTypes;
  }

  toOpenAIToolSpec() {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters: this.zodToJsonSchema(this.parameters)
      }
    };
  }

  private zodToJsonSchema(schema: z.ZodSchema): any {
    // Basic conversion from Zod to JSON Schema
    // This is a simplified version - you might want to use a proper library like zod-to-json-schema
    
    if (schema instanceof z.ZodObject) {
      const shape = schema._def.shape();
      const properties: any = {};
      const required: string[] = [];

      for (const [key, value] of Object.entries(shape)) {
        properties[key] = this.zodToJsonSchema(value as z.ZodSchema);
        if (!(value as any)._def.defaultValue) {
          required.push(key);
        }
      }

      return {
        type: 'object',
        properties,
        required
      };
    }

    if (schema instanceof z.ZodString) {
      return { type: 'string' };
    }

    if (schema instanceof z.ZodNumber) {
      return { type: 'number' };
    }

    if (schema instanceof z.ZodBoolean) {
      return { type: 'boolean' };
    }

    if (schema instanceof z.ZodArray) {
      return {
        type: 'array',
        items: this.zodToJsonSchema(schema._def.type)
      };
    }

    if (schema instanceof z.ZodOptional) {
      return this.zodToJsonSchema(schema._def.innerType);
    }

    return { type: 'string' }; // fallback
  }
}
