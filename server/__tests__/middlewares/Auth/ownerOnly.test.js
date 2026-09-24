/**
 * Members have full access to the account they belong to, except the owner's own
 * details (name, phone, photo, emails, password).
 */
const ownerOnly = require('../../../middlewares/Auth/ownerOnly.js');

const run = (req) => {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  const next = jest.fn();
  ownerOnly({ method: 'PUT', originalUrl: '/app/updateDetails', userId: 'owner', ...req }, res, next);
  return { res, next };
};

describe('ownerOnly', () => {
  it('lets the owner change their details', () => {
    const { next, res } = run({});
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("refuses a member changing the owner's details", () => {
    const { next, res } = run({ memberId: 'member-1' });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
