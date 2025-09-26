import { OrchestratorHub } from '../agents/actions/orchestrator-hub';
import { AgentType, TaskStatus } from '../../../types';

describe('Sub-task Management', () => {
  let hub: OrchestratorHub;

  beforeEach(() => {
    hub = new OrchestratorHub();
  });

  test('decomposeTask creates sub-tasks correctly', () => {
    // Create main task
    const mainId = hub.createTask(AgentType.CODER, 'Main Task', 'Test decomposition', [], []);

    // Decompose
    const subTasks = [
      {
        title: 'Sub1',
        description: 'First sub-task',
        agentType: AgentType.EXPLORER,
        dependencies: [],
        estimatedTurns: 5,
      },
      {
        title: 'Sub2',
        description: 'Second sub-task',
        agentType: AgentType.CODER,
        dependencies: ['sub1'],
        estimatedTurns: 10,
      },
    ];

    const created = hub.decomposeTask(mainId, subTasks);

    expect(created).toHaveLength(2);

    const main = hub.getTask(mainId);
    expect(main.subTasks).toEqual(created);

    const sub1 = hub.getTask(created[0]);
    expect(sub1.title).toBe('Sub1');
    expect(sub1.parentTaskId).toBe(mainId);
    expect(sub1.dependencies).toEqual([]);

    const sub2 = hub.getTask(created[1]);
    expect(sub2.title).toBe('Sub2');
    expect(sub2.dependencies).toEqual(['sub1']);
  });

  test('getReadySubTasks returns correct sub-tasks', () => {
    const mainId = hub.createTask(AgentType.CODER, 'Main', 'Test', [], []);

    const subTasks = [
      {
        title: 'Sub1',
        description: 'First',
        agentType: AgentType.EXPLORER,
        dependencies: [],
      },
      {
        title: 'Sub2',
        description: 'Second',
        agentType: AgentType.CODER,
        dependencies: ['sub1'],
      },
    ];

    hub.decomposeTask(mainId, subTasks);
    const createdIds = hub.getTasks()[mainId].subTasks;

    // Initially, only sub1 ready
    let ready = hub.getReadySubTasks(mainId);
    expect(ready).toEqual([createdIds[0]]);

    // Complete sub1
    hub.updateTaskStatus(createdIds[0], TaskStatus.COMPLETED);

    // Now sub2 ready
    ready = hub.getReadySubTasks(mainId);
    expect(ready).toEqual([createdIds[1]]);
  });

  test('checkParentProgress marks parent complete when all subs done', () => {
    const mainId = hub.createTask(AgentType.CODER, 'Main', 'Test', [], []);

    const subTasks = [
      {
        title: 'Sub1',
        description: 'First',
        agentType: AgentType.EXPLORER,
        dependencies: [],
      },
      {
        title: 'Sub2',
        description: 'Second',
        agentType: AgentType.CODER,
        dependencies: ['sub1'],
      },
    ];

    hub.decomposeTask(mainId, subTasks);
    const subIds = hub.getTasks()[mainId].subTasks;

    hub.updateTaskStatus(subIds[0], TaskStatus.COMPLETED);
    hub.updateTaskStatus(subIds[1], TaskStatus.COMPLETED);

    const main = hub.getTask(mainId);
    expect(main.status).toBe(TaskStatus.COMPLETED);
  });
});
