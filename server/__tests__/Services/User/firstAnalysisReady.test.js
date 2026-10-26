/**
 * The dashboard unlocks when the data is ready, not when the "ready" email is sent.
 *
 * Before, FirstAnalysisDone was set only after a successful send, so a failed send or a user
 * without an email / first name stayed on "analysing your account" with their data in place.
 */

jest.mock('../../../models/user-auth/userModel.js', () => ({ findById: jest.fn() }));
jest.mock('../../../Services/Email/SendAnalysisReadyEmail.js', () => ({ sendAnalysisReadyEmail: jest.fn() }));
jest.mock('../../../Services/User/userServices.js', () => ({ markFirstAnalysisDone: jest.fn() }));

const userModel = require('../../../models/user-auth/userModel.js');
const { sendAnalysisReadyEmail } = require('../../../Services/Email/SendAnalysisReadyEmail.js');
const { markFirstAnalysisDone } = require('../../../Services/User/userServices.js');
const { completeFirstAnalysis } = require('../../../Services/User/firstAnalysisReady.js');

const userWith = (fields) => {
  const user = { analyseAccountSuccess: 1, email: 'a@b.com', firstName: 'Ann', save: jest.fn(), ...fields };
  userModel.findById.mockReturnValue({ select: () => Promise.resolve(user) });
  return user;
};

describe('completeFirstAnalysis', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    markFirstAnalysisDone.mockResolvedValue(true);
  });

  it('unlocks the dashboard and sends the email the first time', async () => {
    const user = userWith({});
    sendAnalysisReadyEmail.mockResolvedValue(true);

    expect(await completeFirstAnalysis('u1')).toEqual({ marked: true, emailSent: true });
    expect(markFirstAnalysisDone).toHaveBeenCalledWith('u1');
    expect(user.analyseAccountSuccess).toBe(0);
    expect(user.save).toHaveBeenCalled();
  });

  it('unlocks the dashboard even when the email fails, and keeps the email owed', async () => {
    const user = userWith({});
    sendAnalysisReadyEmail.mockResolvedValue(false);

    expect(await completeFirstAnalysis('u1')).toEqual({ marked: true, emailSent: false });
    expect(markFirstAnalysisDone).toHaveBeenCalled();
    expect(user.analyseAccountSuccess).toBe(1);
    expect(user.save).not.toHaveBeenCalled();
  });

  it('unlocks the dashboard when the email throws', async () => {
    userWith({});
    sendAnalysisReadyEmail.mockRejectedValue(new Error('SMTP down'));
    expect(await completeFirstAnalysis('u1')).toEqual({ marked: true, emailSent: false });
  });

  it('unlocks the dashboard for a user with no first name or email on record', async () => {
    userWith({ firstName: '', email: null });
    expect(await completeFirstAnalysis('u1')).toEqual({ marked: true, emailSent: false });
    expect(sendAnalysisReadyEmail).not.toHaveBeenCalled();
  });

  it('does nothing once the first analysis has been completed', async () => {
    userWith({ analyseAccountSuccess: 0 });
    expect(await completeFirstAnalysis('u1')).toEqual({ marked: false, emailSent: false });
    expect(markFirstAnalysisDone).not.toHaveBeenCalled();
    expect(sendAnalysisReadyEmail).not.toHaveBeenCalled();
  });
});
