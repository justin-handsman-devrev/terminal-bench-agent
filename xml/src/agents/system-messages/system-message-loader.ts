import fs from 'fs';
import path from 'path';

const LATEST_SYSTEM_MSGS = {
  orchestrator: 'orchestrator_sys_msg_v0.1.md',
  explorer: 'explorer_sys_msg_v0.1.md',
  coder: 'coder_sys_msg_v0.1.md',
} as const;

const systemMsgsDir = path.join(__dirname, 'md-files');

function loadSystemMessage(agentType: keyof typeof LATEST_SYSTEM_MSGS): string {
  const fileName = LATEST_SYSTEM_MSGS[agentType];
  const filePath = path.join(systemMsgsDir, fileName);

  if (!fs.existsSync(filePath)) {
    throw new Error(`System message file not found: ${filePath}`);
  }

  return fs.readFileSync(filePath, 'utf-8');
}

export function loadOrchestratorSystemMessage(): string {
  return loadSystemMessage('orchestrator');
}

export function loadExplorerSystemMessage(): string {
  const baseMessage = loadSystemMessage('explorer');
  
  const knowledgeBasePath = path.join(systemMsgsDir, 'compatibility_knowledge_base.md');
  const overallBasePath = path.join(systemMsgsDir, 'overall_sys_msg_v0.1.md');
  if (fs.existsSync(knowledgeBasePath)) {
    const knowledgeBase = fs.readFileSync(knowledgeBasePath, 'utf-8');
    return `${baseMessage}\n\n---\n\n${knowledgeBase}`;
  }
  if (fs.existsSync(overallBasePath)) {
    const overallBase = fs.readFileSync(overallBasePath, 'utf-8');
    return `${baseMessage}\n\n---\n\n${overallBase}`;
  }
  
  return baseMessage;
}

export function loadCoderSystemMessage(): string {
  const baseMessage = loadSystemMessage('coder');
  
  const knowledgeBasePath = path.join(systemMsgsDir, 'compatibility_knowledge_base.md');
  const overallBasePath = path.join(systemMsgsDir, 'overall_sys_msg_v0.1.md');
  if (fs.existsSync(knowledgeBasePath)) {
    const knowledgeBase = fs.readFileSync(knowledgeBasePath, 'utf-8');
    return `${baseMessage}\n\n---\n\n${knowledgeBase}`;
  }
  if (fs.existsSync(overallBasePath)) {
    const overallBase = fs.readFileSync(overallBasePath, 'utf-8');
    return `${baseMessage}\n\n---\n\n${overallBase}`;
  }
  
  return baseMessage;
}
