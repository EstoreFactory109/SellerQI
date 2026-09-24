const { splitStaffName } = require('../../../Services/User/staffName.js');

describe('splitStaffName', () => {
  it('splits a full name so it round-trips through My profile', () => {
    expect(splitStaffName('Priya Sharma')).toEqual({ firstName: 'Priya', lastName: 'Sharma' });
  });

  it('keeps everything after the first space as the last name', () => {
    expect(splitStaffName('Mary  Jane Watson')).toEqual({ firstName: 'Mary', lastName: 'Jane Watson' });
  });

  it('keeps a single word, or a name with a too-short half, whole', () => {
    expect(splitStaffName('J.P.')).toEqual({ firstName: 'J.P.', lastName: null });
    expect(splitStaffName('A Sharma')).toEqual({ firstName: 'A Sharma', lastName: null });
  });

  it('clears both for an empty name', () => {
    expect(splitStaffName('  ')).toEqual({ firstName: null, lastName: null });
    expect(splitStaffName(undefined)).toEqual({ firstName: null, lastName: null });
  });
});
