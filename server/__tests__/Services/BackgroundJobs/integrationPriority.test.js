/**
 * Onboarding fetches a seller's main marketplace first and their other marketplaces after.
 *
 * addIntegrationJob takes a priority; the bootstrap job and every phase it chains must keep it,
 * or the extra marketplaces would compete with every new signup's main marketplace from the
 * second phase on.
 */

jest.mock('../../../Services/BackgroundJobs/sharedQueueConnection.js', () => ({ getSharedConnection: jest.fn(() => ({})) }));

const { Queue } = require('bullmq');

const queue = {
  add: jest.fn(async (name, data, opts) => ({ id: opts.jobId })),
  getJob: jest.fn(async () => null),
  getWaitingCount: jest.fn(async () => 0),
  on: jest.fn(),
};

const { addIntegrationJob, addPhaseJob } = require('../../../Services/BackgroundJobs/integrationQueue.js');
const { createNextPhaseJobData } = require('../../../Services/BackgroundJobs/integrationPhases.js');

describe('integration job priority', () => {
  beforeEach(() => {
    // The jest config resets mock implementations before every test, so install the fake
    // queue here (the module caches whichever instance it builds first).
    Queue.mockImplementation(() => queue);
    queue.add.mockImplementation(async (name, data, opts) => ({ id: opts.jobId }));
    queue.getJob.mockResolvedValue(null);
    queue.getWaitingCount.mockResolvedValue(0);
    queue.add.mockClear();
  });

  it('defaults to priority 1, as before', async () => {
    await addIntegrationJob('u1', 'US', 'NA');
    const [, data, opts] = queue.add.mock.calls[0];
    expect(opts.priority).toBe(1);
    expect(data.priority).toBe(1);
  });

  it('starts an extra marketplace at the priority it is given', async () => {
    await addIntegrationJob('u1', 'UK', 'EU', { priority: 5 });
    const [, data, opts] = queue.add.mock.calls[0];
    expect(opts).toMatchObject({ jobId: 'integration-u1-UK-EU', priority: 5 });
    expect(data.priority).toBe(5);
  });

  it('every phase keeps the pipeline priority', async () => {
    const initData = { userId: 'u1', country: 'UK', region: 'EU', phase: 'init', parentJobId: 'integration-u1-UK-EU', priority: 5 };
    const next = createNextPhaseJobData('batch_1_2', initData, {});
    expect(next.priority).toBe(5);

    // Not there yet; then visible as waiting when addPhaseJob verifies the add.
    queue.getJob.mockResolvedValueOnce(null).mockResolvedValue({ getState: async () => 'waiting' });
    await addPhaseJob(next);
    const [, data, opts] = queue.add.mock.calls[0];
    expect(opts.priority).toBe(5);
    expect(data.priority).toBe(5);
  });

  it('a phase from an older job with no priority runs at 1', async () => {
    const next = createNextPhaseJobData('batch_1_2', { userId: 'u1', country: 'US', region: 'NA', parentJobId: 'p' }, {});
    expect(next).not.toHaveProperty('priority');
    // Not there yet; then visible as waiting when addPhaseJob verifies the add.
    queue.getJob.mockResolvedValueOnce(null).mockResolvedValue({ getState: async () => 'waiting' });
    await addPhaseJob(next);
    expect(queue.add.mock.calls[0][2].priority).toBe(1);
  });
});
