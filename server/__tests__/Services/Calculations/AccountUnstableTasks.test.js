/**
 * Account-health tasks for statuses Amazon keeps flipping (checkAccountHealth
 * level 'warning'): their own, lower-priority task type, separate from a
 * sustained problem.
 */
jest.mock('../../../models/MCP/TaskModel.js', () => ({}));
jest.mock('../../../models/MCP/TaskItemModel.js', () => ({}));

const CreateTaskService = require('../../../Services/Calculations/CreateTasksService.js');
const { getTaskPriorityMeta } = require('../../../Services/Calculations/TaskPrioritizationService.js');
const { GROUP_COPY } = require('../../../Services/Calculations/TaskOpportunityGroupsService.js');

const UNSTABLE_KEYS = [
    'accountStatus', 'PolicyViolations', 'orderWithDefectsStatus',
    'lateShipmentRateStatus', 'CancellationRate', 'validTrackingRateStatus',
];

describe('generateAccountTasks', () => {
    it('a warning-level status becomes an _unstable task, labelled as such', () => {
        const [task] = CreateTaskService.generateAccountTasks({
            accountStatus: { status: 'Error', level: 'warning', Message: 'Amazon flagged your account At Risk on 2 of the last 6 daily reports.', HowTOSolve: 'fix' },
            TotalErrors: 1,
        });
        expect(task.errorType).toBe('accountStatus_unstable');
        expect(task.error).toBe('Account | Account Status (unstable): Amazon flagged your account At Risk on 2 of the last 6 daily reports.');
    });

    it('a sustained error keeps the base type and label', () => {
        const [task] = CreateTaskService.generateAccountTasks({
            accountStatus: { status: 'Error', level: 'error', Message: 'not in normal standing', HowTOSolve: 'fix' },
            TotalErrors: 1,
        });
        expect(task.errorType).toBe('accountStatus');
        expect(task.error).toBe('Account | Account Status: not in normal standing');
    });

    it('results with no level (older stored data) are treated as errors, as before', () => {
        const [task] = CreateTaskService.generateAccountTasks({ PolicyViolations: { status: 'Error', Message: 'm' } });
        expect(task.errorType).toBe('PolicyViolations');
    });

    it('successes and no-data entries create no task', () => {
        expect(CreateTaskService.generateAccountTasks({
            accountStatus: { status: 'Success', level: 'ok' }, negativeFeedbacks: {}, TotalErrors: 0,
        })).toEqual([]);
    });
});

describe('priority and dashboard copy for _unstable types', () => {
    it.each(UNSTABLE_KEYS)('%s_unstable is a known task type that sorts below the sustained one', (key) => {
        const unstable = getTaskPriorityMeta({ errorCategory: 'account', errorType: `${key}_unstable` });
        const sustained = getTaskPriorityMeta({ errorCategory: 'account', errorType: key });
        expect(unstable.isKnownTaskType).toBe(true);
        expect(unstable.impactWeight).toBeLessThan(sustained.impactWeight);
    });

    it.each(UNSTABLE_KEYS)('%s_unstable has its own dashboard title', (key) => {
        expect(GROUP_COPY[`account:${key}_unstable`]?.title).toBeTruthy();
        expect(GROUP_COPY[`account:${key}_unstable`].title).not.toBe(GROUP_COPY[`account:${key}`].title);
    });
});
