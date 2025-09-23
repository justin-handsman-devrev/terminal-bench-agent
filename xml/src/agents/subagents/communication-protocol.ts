export enum MessageType {
  REQUEST = 'request',
  RESPONSE = 'response',
  UPDATE = 'update',
  QUERY = 'query',
  NOTIFICATION = 'notification',
  COORDINATION = 'coordination'
}

export enum Priority {
  LOW = 0,
  NORMAL = 1,
  HIGH = 2,
  URGENT = 3
}

export interface Message {
  id: string;
  from: string;
  to: string;
  type: MessageType;
  priority: Priority;
  timestamp: Date;
  content: any;
  metadata?: Record<string, any>;
  threadId?: string; // For conversation threading
  replyTo?: string; // For response chaining
}

export interface SubagentCapability {
  name: string;
  description: string;
  inputTypes: string[];
  outputTypes: string[];
  expertise: string[];
  estimatedDuration?: number;
}

export interface SubagentStatus {
  agentId: string;
  agentType: 'explorer' | 'coder' | 'orchestrator';
  status: 'idle' | 'busy' | 'error' | 'offline';
  currentTask?: string;
  capabilities: SubagentCapability[];
  workload: number; // 0-100
  lastSeen: Date;
  performance?: {
    tasksCompleted: number;
    averageResponseTime: number;
    successRate: number;
  };
}

export interface CoordinationRequest {
  requestType: 'assistance' | 'information' | 'delegation' | 'synchronization';
  taskDescription: string;
  requiredCapabilities: string[];
  urgency: Priority;
  context?: Record<string, any>;
  deadline?: Date;
}

export interface CoordinationResponse {
  accepted: boolean;
  estimatedCompletion?: Date;
  alternativeAgent?: string;
  reason?: string;
  counterProposal?: CoordinationRequest;
}

export class MessageBus {
  private messages: Map<string, Message> = new Map();
  private subscribers: Map<string, Set<(message: Message) => void>> = new Map();
  private agentStatuses: Map<string, SubagentStatus> = new Map();
  private messageHistory: Message[] = [];
  private maxHistorySize = 1000;

  subscribe(agentId: string, callback: (message: Message) => void): void {
    if (!this.subscribers.has(agentId)) {
      this.subscribers.set(agentId, new Set());
    }
    this.subscribers.get(agentId)!.add(callback);
  }

  unsubscribe(agentId: string, callback: (message: Message) => void): void {
    const agentSubscribers = this.subscribers.get(agentId);
    if (agentSubscribers) {
      agentSubscribers.delete(callback);
    }
  }

  sendMessage(message: Omit<Message, 'id' | 'timestamp'>): string {
    const fullMessage: Message = {
      ...message,
      id: this.generateMessageId(),
      timestamp: new Date()
    };

    this.messages.set(fullMessage.id, fullMessage);
    this.messageHistory.push(fullMessage);
    
    // Maintain history size
    if (this.messageHistory.length > this.maxHistorySize) {
      this.messageHistory = this.messageHistory.slice(-this.maxHistorySize);
    }

    // Deliver to target agent
    const targetSubscribers = this.subscribers.get(message.to);
    if (targetSubscribers) {
      targetSubscribers.forEach(callback => {
        try {
          callback(fullMessage);
        } catch (error) {
          console.error(`Error delivering message to ${message.to}:`, error);
        }
      });
    }

    return fullMessage.id;
  }

  broadcastMessage(message: Omit<Message, 'id' | 'timestamp' | 'to'>): string[] {
    const messageIds: string[] = [];
    
    for (const agentId of this.subscribers.keys()) {
      if (agentId !== message.from) {
        const id = this.sendMessage({
          ...message,
          to: agentId
        });
        messageIds.push(id);
      }
    }
    
    return messageIds;
  }

  getMessage(messageId: string): Message | undefined {
    return this.messages.get(messageId);
  }

  getMessages(agentId: string, since?: Date): Message[] {
    return this.messageHistory.filter(msg => 
      (msg.to === agentId || msg.from === agentId) &&
      (!since || msg.timestamp > since)
    );
  }

  getConversationThread(threadId: string): Message[] {
    return this.messageHistory
      .filter(msg => msg.threadId === threadId)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  updateAgentStatus(agentId: string, status: Partial<SubagentStatus>): void {
    const existing = this.agentStatuses.get(agentId);
    const updated: SubagentStatus = {
      agentId,
      agentType: 'explorer',
      status: 'idle',
      capabilities: [],
      workload: 0,
      lastSeen: new Date(),
      ...existing,
      ...status
    };
    
    updated.lastSeen = new Date();
    
    this.agentStatuses.set(agentId, updated);

    this.broadcastMessage({
      from: 'system',
      type: MessageType.UPDATE,
      priority: Priority.LOW,
      content: {
        type: 'status_update',
        agentId,
        status: updated
      }
    });
  }

  getAgentStatus(agentId: string): SubagentStatus | undefined {
    return this.agentStatuses.get(agentId);
  }

  getAllAgentStatuses(): SubagentStatus[] {
    return Array.from(this.agentStatuses.values());
  }

  findCapableAgents(requiredCapabilities: string[]): SubagentStatus[] {
    return this.getAllAgentStatuses()
      .filter(agent => 
        agent.status === 'idle' && 
        requiredCapabilities.every(req =>
          agent.capabilities.some(cap => 
            cap.expertise.includes(req) || cap.name === req
          )
        )
      )
      .sort((a, b) => a.workload - b.workload);
  }

  requestCoordination(
    from: string,
    request: CoordinationRequest
  ): Promise<Map<string, CoordinationResponse>> {
    const capableAgents = this.findCapableAgents(request.requiredCapabilities);
    const responses = new Map<string, CoordinationResponse>();
    const promises: Promise<void>[] = [];

    const threadId = this.generateMessageId();

    for (const agent of capableAgents) {
      const promise = new Promise<void>((resolve) => {
        const timeoutId = setTimeout(() => {
          responses.set(agent.agentId, {
            accepted: false,
            reason: 'Timeout - no response received'
          });
          resolve();
        }, 5000);

        const messageId = this.sendMessage({
          from,
          to: agent.agentId,
          type: MessageType.COORDINATION,
          priority: request.urgency,
          content: request,
          threadId
        });

        // Listen for response
        const responseHandler = (message: Message) => {
          if (message.replyTo === messageId && message.type === MessageType.RESPONSE) {
            clearTimeout(timeoutId);
            responses.set(agent.agentId, message.content as CoordinationResponse);
            this.unsubscribe(agent.agentId, responseHandler);
            resolve();
          }
        };

        this.subscribe(agent.agentId, responseHandler);
      });
      
      promises.push(promise);
    }

    return Promise.all(promises).then(() => responses);
  }

  getMessageStats(): {
    totalMessages: number;
    messagesByType: Record<MessageType, number>;
    messagesByPriority: Record<Priority, number>;
    activeAgents: number;
    averageResponseTime: number;
  } {
    const messagesByType: Record<MessageType, number> = {
      [MessageType.REQUEST]: 0,
      [MessageType.RESPONSE]: 0,
      [MessageType.UPDATE]: 0,
      [MessageType.QUERY]: 0,
      [MessageType.NOTIFICATION]: 0,
      [MessageType.COORDINATION]: 0
    };

    const messagesByPriority: Record<Priority, number> = {
      [Priority.LOW]: 0,
      [Priority.NORMAL]: 0,
      [Priority.HIGH]: 0,
      [Priority.URGENT]: 0
    };

    for (const message of this.messageHistory) {
      messagesByType[message.type]++;
      messagesByPriority[message.priority]++;
    }

    let totalResponseTime = 0;
    let responseCount = 0;

    for (const response of this.messageHistory.filter(m => m.type === MessageType.RESPONSE)) {
      if (response.replyTo) {
        const request = this.getMessage(response.replyTo);
        if (request) {
          totalResponseTime += response.timestamp.getTime() - request.timestamp.getTime();
          responseCount++;
        }
      }
    }

    return {
      totalMessages: this.messageHistory.length,
      messagesByType,
      messagesByPriority,
      activeAgents: this.agentStatuses.size,
      averageResponseTime: responseCount > 0 ? totalResponseTime / responseCount : 0
    };
  }

  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  clear(): void {
    this.messages.clear();
    this.messageHistory = [];
    this.agentStatuses.clear();
  }

  destroy(): void {
    this.clear();
    this.subscribers.clear();
  }
}
