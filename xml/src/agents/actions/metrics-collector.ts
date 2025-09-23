import winston from 'winston';
import * as fs from 'fs';
import * as path from 'path';
import { ActionType } from './entities/actions';
import { ErrorType } from './error-handler';

export interface ActionMetrics {
  actionType: ActionType | string;
  success: boolean;
  duration: number;
  timestamp: Date;
  errorType?: ErrorType;
  errorMessage?: string;
  retryCount?: number;
  context?: Record<string, any>;
}

export interface AggregatedMetrics {
  totalExecutions: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  averageDuration: number;
  minDuration: number;
  maxDuration: number;
  errorDistribution: Partial<Record<ErrorType, number>>;
  lastFailure?: Date;
  lastSuccess?: Date;
  recentTrend: 'improving' | 'degrading' | 'stable';
}

export interface MetricsSnapshot {
  byAction: Record<string, AggregatedMetrics>;
  overall: AggregatedMetrics;
  topErrors: Array<{ error: string; count: number; lastSeen: Date }>;
  performanceTrends: Array<{ action: string; trend: number; recommendation?: string }>;
  timestamp: Date;
}

export class MetricsCollector {
  private metrics: ActionMetrics[] = [];
  private metricsFilePath?: string;
  private flushInterval?: NodeJS.Timeout;
  private maxInMemoryMetrics = 1000;
  private recentWindowSize = 50; // For trend analysis

  constructor(private config: {
    persistMetrics?: boolean;
    metricsDir?: string;
    flushIntervalMs?: number;
  } = {}) {
    if (config.persistMetrics && config.metricsDir) {
      this.setupPersistence();
    }
  }

  private setupPersistence(): void {
    if (!this.config.metricsDir) return;

    try {
      fs.mkdirSync(this.config.metricsDir, { recursive: true });
      this.metricsFilePath = path.join(
        this.config.metricsDir,
        `metrics_${new Date().toISOString().split('T')[0]}.jsonl`
      );
      
      // Load existing metrics if file exists
      if (fs.existsSync(this.metricsFilePath)) {
        this.loadMetrics();
      }

      // Setup periodic flush
      if (this.config.flushIntervalMs) {
        this.flushInterval = setInterval(
          () => this.flushMetrics(),
          this.config.flushIntervalMs
        );
      }
    } catch (error) {
      winston.error(`Failed to setup metrics persistence: ${error}`);
    }
  }

  private loadMetrics(): void {
    if (!this.metricsFilePath || !fs.existsSync(this.metricsFilePath)) return;

    try {
      const content = fs.readFileSync(this.metricsFilePath, 'utf-8');
      const lines = content.trim().split('\n').filter(line => line);
      
      this.metrics = lines.map(line => {
        const metric = JSON.parse(line);
        metric.timestamp = new Date(metric.timestamp);
        return metric;
      }).slice(-this.maxInMemoryMetrics); // Keep only recent metrics in memory
      
      winston.info(`Loaded ${this.metrics.length} metrics from disk`);
    } catch (error) {
      winston.error(`Failed to load metrics: ${error}`);
    }
  }

  record(metric: ActionMetrics): void {
    this.metrics.push(metric);

    // Keep memory usage bounded
    if (this.metrics.length > this.maxInMemoryMetrics) {
      this.metrics = this.metrics.slice(-this.maxInMemoryMetrics);
    }

    // Immediate flush for important events
    if (metric.errorType === ErrorType.PERMANENT || !metric.success) {
      this.flushMetrics();
    }
  }

  recordAction(
    actionType: ActionType | string,
    success: boolean,
    duration: number,
    error?: { type?: ErrorType; message?: string },
    context?: Record<string, any>
  ): void {
    this.record({
      actionType,
      success,
      duration,
      timestamp: new Date(),
      errorType: error?.type,
      errorMessage: error?.message,
      context
    });
  }

  private flushMetrics(): void {
    if (!this.metricsFilePath || this.metrics.length === 0) return;

    try {
      const newMetrics = this.metrics.filter(m => !m.context?.flushed);
      if (newMetrics.length === 0) return;

      const lines = newMetrics.map(m => {
        m.context = { ...m.context, flushed: true };
        return JSON.stringify(m);
      }).join('\n') + '\n';

      fs.appendFileSync(this.metricsFilePath, lines);
      winston.debug(`Flushed ${newMetrics.length} metrics to disk`);
    } catch (error) {
      winston.error(`Failed to flush metrics: ${error}`);
    }
  }

  getSnapshot(): MetricsSnapshot {
    const byAction: Record<string, AggregatedMetrics> = {};
    const errorCounts: Record<string, { count: number; lastSeen: Date }> = {};

    // Aggregate metrics by action type
    for (const metric of this.metrics) {
      const actionType = metric.actionType;
      
      if (!byAction[actionType]) {
        byAction[actionType] = this.createEmptyAggregatedMetrics();
      }

      const agg = byAction[actionType];
      agg.totalExecutions++;
      
      if (metric.success) {
        agg.successCount++;
        agg.lastSuccess = metric.timestamp;
      } else {
        agg.failureCount++;
        agg.lastFailure = metric.timestamp;
        
        if (metric.errorType) {
          agg.errorDistribution[metric.errorType] = 
            (agg.errorDistribution[metric.errorType] || 0) + 1;
        }

        if (metric.errorMessage) {
          const key = `${metric.errorType}:${metric.errorMessage.slice(0, 100)}`;
          if (!errorCounts[key]) {
            errorCounts[key] = { count: 0, lastSeen: metric.timestamp };
          }
          errorCounts[key].count++;
          errorCounts[key].lastSeen = metric.timestamp;
        }
      }

      // Update duration stats
      agg.averageDuration = 
        (agg.averageDuration * (agg.totalExecutions - 1) + metric.duration) / 
        agg.totalExecutions;
      agg.minDuration = Math.min(agg.minDuration, metric.duration);
      agg.maxDuration = Math.max(agg.maxDuration, metric.duration);
    }

    // Calculate success rates and trends
    for (const [actionType, agg] of Object.entries(byAction)) {
      agg.successRate = agg.totalExecutions > 0 
        ? agg.successCount / agg.totalExecutions 
        : 0;
      
      agg.recentTrend = this.calculateTrend(actionType);
    }

    // Calculate overall metrics
    const overall = this.calculateOverallMetrics(byAction);

    // Get top errors
    const topErrors = Object.entries(errorCounts)
      .map(([error, data]) => ({ error, ...data }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Calculate performance trends
    const performanceTrends = this.calculatePerformanceTrends(byAction);

    return {
      byAction,
      overall,
      topErrors,
      performanceTrends,
      timestamp: new Date()
    };
  }

  private createEmptyAggregatedMetrics(): AggregatedMetrics {
    return {
      totalExecutions: 0,
      successCount: 0,
      failureCount: 0,
      successRate: 0,
      averageDuration: 0,
      minDuration: Infinity,
      maxDuration: 0,
      errorDistribution: {},
      recentTrend: 'stable'
    };
  }

  private calculateTrend(actionType: string): 'improving' | 'degrading' | 'stable' {
    const actionMetrics = this.metrics
      .filter(m => m.actionType === actionType)
      .slice(-this.recentWindowSize);

    if (actionMetrics.length < 10) return 'stable';

    const halfPoint = Math.floor(actionMetrics.length / 2);
    const firstHalf = actionMetrics.slice(0, halfPoint);
    const secondHalf = actionMetrics.slice(halfPoint);

    const firstHalfSuccessRate = firstHalf.filter(m => m.success).length / firstHalf.length;
    const secondHalfSuccessRate = secondHalf.filter(m => m.success).length / secondHalf.length;

    const improvement = secondHalfSuccessRate - firstHalfSuccessRate;
    
    if (improvement > 0.1) return 'improving';
    if (improvement < -0.1) return 'degrading';
    return 'stable';
  }

  private calculateOverallMetrics(byAction: Record<string, AggregatedMetrics>): AggregatedMetrics {
    const overall = this.createEmptyAggregatedMetrics();
    
    for (const agg of Object.values(byAction)) {
      overall.totalExecutions += agg.totalExecutions;
      overall.successCount += agg.successCount;
      overall.failureCount += agg.failureCount;
      
      for (const [errorType, count] of Object.entries(agg.errorDistribution)) {
        overall.errorDistribution[errorType as ErrorType] = 
          (overall.errorDistribution[errorType as ErrorType] || 0) + count;
      }
      
      if (agg.lastSuccess && (!overall.lastSuccess || agg.lastSuccess > overall.lastSuccess)) {
        overall.lastSuccess = agg.lastSuccess;
      }
      
      if (agg.lastFailure && (!overall.lastFailure || agg.lastFailure > overall.lastFailure)) {
        overall.lastFailure = agg.lastFailure;
      }
    }
    
    overall.successRate = overall.totalExecutions > 0 
      ? overall.successCount / overall.totalExecutions 
      : 0;
    
    // Calculate weighted average duration
    let totalDuration = 0;
    for (const agg of Object.values(byAction)) {
      totalDuration += agg.averageDuration * agg.totalExecutions;
    }
    overall.averageDuration = overall.totalExecutions > 0 
      ? totalDuration / overall.totalExecutions 
      : 0;
    
    return overall;
  }

  private calculatePerformanceTrends(
    byAction: Record<string, AggregatedMetrics>
  ): Array<{ action: string; trend: number; recommendation?: string }> {
    const trends: Array<{ action: string; trend: number; recommendation?: string }> = [];

    for (const [action, metrics] of Object.entries(byAction)) {
      if (metrics.totalExecutions < 5) continue;

      const trend = {
        action,
        trend: metrics.successRate,
        recommendation: undefined as string | undefined
      };

      // Add recommendations based on patterns
      if (metrics.successRate < 0.5) {
        trend.recommendation = 'Consider using alternative approaches or investigating root cause';
      } else if (metrics.recentTrend === 'degrading') {
        trend.recommendation = 'Recent performance degradation detected - monitor closely';
      } else if (metrics.averageDuration > 10000) {
        trend.recommendation = 'Long execution time - consider optimization or parallel execution';
      }

      if (trend.recommendation) {
        trends.push(trend);
      }
    }

    return trends.sort((a, b) => a.trend - b.trend).slice(0, 5);
  }

  getActionSuccessRate(actionType: ActionType | string): number {
    const relevantMetrics = this.metrics.filter(m => m.actionType === actionType);
    if (relevantMetrics.length === 0) return 1.0; // Assume success if no data

    const successCount = relevantMetrics.filter(m => m.success).length;
    return successCount / relevantMetrics.length;
  }

  getRecentErrors(limit: number = 10): Array<{
    actionType: string;
    errorType?: ErrorType;
    errorMessage?: string;
    timestamp: Date;
  }> {
    return this.metrics
      .filter(m => !m.success)
      .slice(-limit)
      .reverse()
      .map(m => ({
        actionType: m.actionType,
        errorType: m.errorType,
        errorMessage: m.errorMessage,
        timestamp: m.timestamp
      }));
  }

  generateReport(): string {
    const snapshot = this.getSnapshot();
    const lines: string[] = [
      '=== Action Metrics Report ===',
      `Generated: ${snapshot.timestamp.toISOString()}`,
      '',
      '## Overall Performance',
      `Total Actions: ${snapshot.overall.totalExecutions}`,
      `Success Rate: ${(snapshot.overall.successRate * 100).toFixed(1)}%`,
      `Average Duration: ${snapshot.overall.averageDuration.toFixed(0)}ms`,
      ''
    ];

    // Action breakdown
    lines.push('## Performance by Action Type');
    const sortedActions = Object.entries(snapshot.byAction)
      .sort((a, b) => b[1].totalExecutions - a[1].totalExecutions);

    for (const [action, metrics] of sortedActions) {
      lines.push(`\n### ${action}`);
      lines.push(`Executions: ${metrics.totalExecutions}`);
      lines.push(`Success Rate: ${(metrics.successRate * 100).toFixed(1)}%`);
      lines.push(`Avg Duration: ${metrics.averageDuration.toFixed(0)}ms`);
      
      if (metrics.recentTrend !== 'stable') {
        lines.push(`Trend: ${metrics.recentTrend.toUpperCase()}`);
      }
      
      if (Object.keys(metrics.errorDistribution).length > 0) {
        lines.push('Error Types:');
        for (const [errorType, count] of Object.entries(metrics.errorDistribution)) {
          lines.push(`  - ${errorType}: ${count}`);
        }
      }
    }

    // Top errors
    if (snapshot.topErrors.length > 0) {
      lines.push('\n## Top Errors');
      for (const error of snapshot.topErrors) {
        lines.push(`- ${error.error} (${error.count} times, last: ${error.lastSeen.toISOString()})`);
      }
    }

    // Recommendations
    if (snapshot.performanceTrends.length > 0) {
      lines.push('\n## Recommendations');
      for (const trend of snapshot.performanceTrends) {
        lines.push(`- ${trend.action}: ${trend.recommendation}`);
      }
    }

    return lines.join('\n');
  }

  clear(): void {
    this.metrics = [];
    winston.info('Metrics cleared');
  }

  destroy(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    this.flushMetrics();
  }
}
