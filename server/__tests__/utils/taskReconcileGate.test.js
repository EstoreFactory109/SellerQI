const { taskReconcileModeFor } = require('../../utils/taskReconcileGate.js');

const A = '6a57b823571ceb9266953c30';
const B = '6a57b823571ceb9266953c31';

describe('taskReconcileModeFor', () => {
    it('is off by default — the rollback state', () => {
        expect(taskReconcileModeFor(A, {})).toBe('off');
    });

    it('treats an unknown mode as off', () => {
        expect(taskReconcileModeFor(A, { TASK_RECONCILE_MODE: 'yes' })).toBe('off');
    });

    it('applies the mode to everyone when no allowlist is set', () => {
        expect(taskReconcileModeFor(A, { TASK_RECONCILE_MODE: 'dry_run' })).toBe('dry_run');
        expect(taskReconcileModeFor(A, { TASK_RECONCILE_MODE: 'ON' })).toBe('on');
    });

    it('applies the mode only to allowlisted accounts', () => {
        const env = { TASK_RECONCILE_MODE: 'on', TASK_RECONCILE_USER_IDS: A };
        expect(taskReconcileModeFor(A, env)).toBe('on');
        expect(taskReconcileModeFor(B, env)).toBe('off');
    });

    it('fails closed when the allowlist holds no valid id', () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        expect(taskReconcileModeFor(A, { TASK_RECONCILE_MODE: 'on', TASK_RECONCILE_USER_IDS: 'typo' })).toBe('off');
        expect(warn).toHaveBeenCalled();
    });
});
