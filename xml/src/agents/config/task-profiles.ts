import { LLMClient } from '../../core/llm/client';
import { LLMMessage } from '../../types';
import { z } from 'zod'; 

const ValidationConfigSchema = z.object({
  blockOnCritical: z.boolean(),
  blockOnWarnings: z.boolean(),
  runTests: z.boolean().optional(),
  checkCoverage: z.boolean().optional(),
  timeout: z.number().optional(),
  requireVerification: z.boolean().optional(),
  verificationTypes: z.array(z.enum(['compile', 'runtime', 'static_analysis'])).optional(),
});


const SubagentDefaultsSchema = z.object({
  explorerMaxTurns: z.number(),
  coderMaxTurns: z.number(),
});

const TaskProfileSchema = z.object({
  name: z.string(),
  description: z.string(),
  maxTurns: z.number(),
  subagentDefaults: SubagentDefaultsSchema,
  adaptiveTurnLimit: z.boolean(),
  checkpointInterval: z.number().optional(),
  allowQuestions: z.boolean(),
  buildValidation: ValidationConfigSchema,
  contextStrategy: z.enum(['semantic', 'conservative', 'aggressive']),
  parallelExecution: z.boolean(),
  errorRecovery: z.enum(['strict', 'lenient', 'aggressive']),
  compatibilityLanguage: z.string(),
});


export interface ValidationConfig {
  blockOnCritical: boolean;
  blockOnWarnings: boolean;
  runTests?: boolean;
  checkCoverage?: boolean;
  timeout?: number;
  requireVerification?: boolean; 
  verificationTypes?: ('compile' | 'runtime' | 'static_analysis')[]; 
}

export interface TaskProfile {
  name: string;
  description: string;
  maxTurns: number;
  subagentDefaults: {
    explorerMaxTurns: number;
    coderMaxTurns: number;
  };
  adaptiveTurnLimit: boolean;
};

export async function detectProfile(taskDescription: string, llmClient: LLMClient): Promise<TaskProfile> {
  const systemPrompt = `
You are an expert task classifier and profile selector. Based on the user's input, return the most appropriate TaskProfile or generate a new one if necessary.

Available Profiles:
1. CHALLENGE_PROFILE:
   - Name: challenge
   - Description: Optimized for code challenges and competitions
   - maxTurns: 20
   - subagentDefaults: { explorerMaxTurns: 20, coderMaxTurns: 20 }
   - adaptiveTurnLimit: true

2. BUGFIX_PROFILE:
   - Name: bugfix
   - Description: Optimized for debugging and fixing issues
   - maxTurns: 25
   - subagentDefaults: { explorerMaxTurns: 25, coderMaxTurns: 25 }
   - adaptiveTurnLimit: true

3. FEATURE_PROFILE:
   - Name: feature
   - Description: Optimized for implementing new features
   - maxTurns: 45
   - subagentDefaults: { explorerMaxTurns: 15, coderMaxTurns: 35 }
   - adaptiveTurnLimit: true

4. PRODUCTION_PROFILE:
   - Name: production
   - Description: Optimized for production-quality code
   - maxTurns: 30
   - subagentDefaults: { explorerMaxTurns: 15, coderMaxTurns: 30 }
   - adaptiveTurnLimit: false

5. EXPLORATION_PROFILE:
   - Name: exploration
   - Description: Optimized for research and exploration
   - maxTurns: 20
   - subagentDefaults: { explorerMaxTurns: 20, coderMaxTurns: 20 }
   - adaptiveTurnLimit: true

6. PROTOTYPE_PROFILE:
   - Name: prototype
   - Description: Optimized for quick prototypes and MVPs
   - maxTurns: 25
   - subagentDefaults: { explorerMaxTurns: 10, coderMaxTurns: 25 }
   - adaptiveTurnLimit: false

7. COMPATIBILITY_PROFILE:
   - Name: compatibility
   - Description: Optimized for compatibility analysis and migration tasks
   - maxTurns: 25
   - subagentDefaults: { explorerMaxTurns: 25, coderMaxTurns: 20 }
   - adaptiveTurnLimit: false

Instructions:
- If the task mentions images, analysis of visuals, diagrams, or multimodal content, use VISION_PROFILE.
- If the task clearly matches one of these profiles, return that profile.
- If the task does not exactly match any of them but still fits a general pattern, generate a new custom profile with a unique name and description.
- Output must be in valid JSON format matching the TaskProfile schema.

Return only the JSON object for the selected or generated profile.
`;

  const userPrompt = `Task Description: ${taskDescription}`;

  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  const response = await llmClient.getResponse(messages);

  try {
    // First parse as raw object
    const rawProfile = JSON.parse(response.content.trim());
    
    // Validate with Zod schema
    const validatedProfile = TaskProfileSchema.parse(rawProfile);
    
    return validatedProfile;
  } catch (e) {
    console.error('Failed to parse or validate profile from LLM response:', e);
    
    if (e instanceof z.ZodError) {
      console.error('Zod validation errors:', e.errors);
    }
    
    throw new Error(`LLM did not return a valid JSON profile. Error: ${e}`);
  }
}


/**
 * Merge a profile with custom overrides
 */
export function mergeProfile(profile: TaskProfile, overrides: Partial<TaskProfile>): TaskProfile {
  return {
    ...profile,
    ...overrides,
    subagentDefaults: {
      ...profile.subagentDefaults,
      ...(overrides.subagentDefaults || {}),
    },
  };
}
