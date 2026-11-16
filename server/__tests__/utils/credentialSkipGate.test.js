const { credentialSkipModeFor } = require('../../utils/credentialSkipGate.js');

const A = '6a57b823571ceb9266953c30';
const B = '6a57b823571ceb9266953c31';

describe('credentialSkipModeFor', () => {
    it('is off by default — the rollback state', () => {
        expect(credentialSkipModeFor(A, {})).toBe('off');
    });

    it('treats an unknown mode as off', () => {
        expect(credentialSkipModeFor(A, { CREDENTIAL_SKIP_MODE: 'yes' })).toBe('off');
    });

    it('applies the mode to everyone when no allowlist is set', () => {
        expect(credentialSkipModeFor(A, { CREDENTIAL_SKIP_MODE: 'dry_run' })).toBe('dry_run');
        expect(credentialSkipModeFor(A, { CREDENTIAL_SKIP_MODE: 'ON' })).toBe('on');
    });

    it('applies the mode only to allowlisted accounts', () => {
        const env = { CREDENTIAL_SKIP_MODE: 'on', CREDENTIAL_SKIP_USER_IDS: A };
        expect(credentialSkipModeFor(A, env)).toBe('on');
        expect(credentialSkipModeFor(B, env)).toBe('off');
    });

    it('fails closed when the allowlist holds no valid id', () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        expect(credentialSkipModeFor(A, { CREDENTIAL_SKIP_MODE: 'on', CREDENTIAL_SKIP_USER_IDS: 'typo' })).toBe('off');
        expect(warn).toHaveBeenCalled();
    });
});
