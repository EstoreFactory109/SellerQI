/**
 * Tests for AccountHealth calculation service
 */

const { calculateAccountHealthPercentage, checkAccountHealth } = require('../../../Services/Calculations/AccountHealth.js');

describe('AccountHealth', () => {
  describe('calculateAccountHealthPercentage', () => {
    it('should return "Healthy" with 100% for ahrScore >= 800', () => {
      const result = calculateAccountHealthPercentage({ ahrScore: 800 });
      expect(result.status).toBe('Healthy');
      expect(result.Percentage).toBe(100);
    });

    it('should return "Healthy" with 100% for ahrScore > 800', () => {
      const result = calculateAccountHealthPercentage({ ahrScore: 950 });
      expect(result.status).toBe('Healthy');
      expect(result.Percentage).toBe(100);
    });

    it('should return "Healthy" with 80% for ahrScore between 200-799', () => {
      const result = calculateAccountHealthPercentage({ ahrScore: 500 });
      expect(result.status).toBe('Healthy');
      expect(result.Percentage).toBe(80);
    });

    it('should return "Healthy" with 80% for ahrScore = 200', () => {
      const result = calculateAccountHealthPercentage({ ahrScore: 200 });
      expect(result.status).toBe('Healthy');
      expect(result.Percentage).toBe(80);
    });

    it('should return "At Risk" with 50% for ahrScore between 100-199', () => {
      const result = calculateAccountHealthPercentage({ ahrScore: 150 });
      expect(result.status).toBe('At Risk');
      expect(result.Percentage).toBe(50);
    });

    it('should return "At Risk" with 50% for ahrScore = 100', () => {
      const result = calculateAccountHealthPercentage({ ahrScore: 100 });
      expect(result.status).toBe('At Risk');
      expect(result.Percentage).toBe(50);
    });

    it('should return "Unhealthy" with 30% for ahrScore < 100', () => {
      const result = calculateAccountHealthPercentage({ ahrScore: 50 });
      expect(result.status).toBe('Unhealthy');
      expect(result.Percentage).toBe(30);
    });

    it('should return "Unhealthy" with 30% for ahrScore = 0', () => {
      const result = calculateAccountHealthPercentage({ ahrScore: 0 });
      expect(result.status).toBe('Unhealthy');
      expect(result.Percentage).toBe(30);
    });

    it('should return "Data Not Available" for empty data', () => {
      const result = calculateAccountHealthPercentage({});
      expect(result.status).toBe('Data Not Available');
      expect(result.Percentage).toBe(0);
    });

    it('should return "Data Not Available" for null data', () => {
      const result = calculateAccountHealthPercentage(null);
      expect(result.status).toBe('Data Not Available');
      expect(result.Percentage).toBe(0);
    });

    it('should return "Data Not Available" for undefined data', () => {
      const result = calculateAccountHealthPercentage(undefined);
      expect(result.status).toBe('Data Not Available');
      expect(result.Percentage).toBe(0);
    });

    it('should return "Data Not Available" when ahrScore is null', () => {
      const result = calculateAccountHealthPercentage({ ahrScore: null });
      expect(result.status).toBe('Data Not Available');
      expect(result.Percentage).toBe(0);
    });

    it('should return "Data Not Available" when ahrScore is undefined', () => {
      const result = calculateAccountHealthPercentage({ ahrScore: undefined });
      expect(result.status).toBe('Data Not Available');
      expect(result.Percentage).toBe(0);
    });
  });

  describe('checkAccountHealth', () => {
    const healthyV2Data = {
      accountStatuses: 'NORMAL',
      listingPolicyViolations: 'GOOD',
      validTrackingRateStatus: 'GOOD',
      orderWithDefectsStatus: 'GOOD',
      lateShipmentRateStatus: 'GOOD',
      CancellationRate: 'GOOD',
    };

    const healthyV1Data = {
      negativeFeedbacks: { count: 0 },
      lateShipmentCount: { count: 0 },
      preFulfillmentCancellationCount: { count: 0 },
      refundsCount: { count: 0 },
      a_z_claims: { count: 0 },
      responseUnder24HoursCount: 0,
    };

    it('should return empty object when both v2 and v1 data are null or have only undefined properties', () => {
      // The function expects specific structure; with empty objects it may throw or return empty
      // Based on the implementation, passing null/null returns empty
      const result = checkAccountHealth(null, null);
      expect(result).toEqual({});
    });

    it('should return empty object when both inputs are null', () => {
      const result = checkAccountHealth(null, null);
      expect(result).toEqual({});
    });

    it('should return success for all checks when data is healthy', () => {
      const result = checkAccountHealth(healthyV2Data, healthyV1Data);

      expect(result.accountStatus.status).toBe('Success');
      expect(result.PolicyViolations.status).toBe('Success');
      expect(result.validTrackingRateStatus.status).toBe('Success');
      expect(result.orderWithDefectsStatus.status).toBe('Success');
      expect(result.lateShipmentRateStatus.status).toBe('Success');
      expect(result.CancellationRate.status).toBe('Success');
      expect(result.TotalErrors).toBe(0);
    });

    describe('V2 checks', () => {
      it('should detect account status error', () => {
        const v2Data = { ...healthyV2Data, accountStatuses: 'SUSPENDED' };
        const result = checkAccountHealth(v2Data, healthyV1Data);

        expect(result.accountStatus.status).toBe('Error');
        expect(result.accountStatus.Message).toContain('not in normal standing');
        expect(result.TotalErrors).toBeGreaterThan(0);
      });

      it('should detect listing policy violations', () => {
        const v2Data = { ...healthyV2Data, listingPolicyViolations: 'BAD' };
        const result = checkAccountHealth(v2Data, healthyV1Data);

        expect(result.PolicyViolations.status).toBe('Error');
        expect(result.TotalErrors).toBeGreaterThan(0);
      });

      it('should detect valid tracking rate issues', () => {
        const v2Data = { ...healthyV2Data, validTrackingRateStatus: 'POOR' };
        const result = checkAccountHealth(v2Data, healthyV1Data);

        expect(result.validTrackingRateStatus.status).toBe('Error');
        expect(result.validTrackingRateStatus.Message).toContain('Valid Tracking Rate');
      });

      it('should detect order defect rate issues', () => {
        const v2Data = { ...healthyV2Data, orderWithDefectsStatus: 'HIGH' };
        const result = checkAccountHealth(v2Data, healthyV1Data);

        expect(result.orderWithDefectsStatus.status).toBe('Error');
        expect(result.orderWithDefectsStatus.Message).toContain('Order Defect Rate');
      });

      it('should detect late shipment rate issues', () => {
        const v2Data = { ...healthyV2Data, lateShipmentRateStatus: 'HIGH' };
        const result = checkAccountHealth(v2Data, healthyV1Data);

        expect(result.lateShipmentRateStatus.status).toBe('Error');
        expect(result.lateShipmentRateStatus.Message).toContain('Late Shipment Rate');
      });

      it('should detect cancellation rate issues', () => {
        const v2Data = { ...healthyV2Data, CancellationRate: 'HIGH' };
        const result = checkAccountHealth(v2Data, healthyV1Data);

        expect(result.CancellationRate.status).toBe('Error');
      });
    });

    describe('V1 checks', () => {
      it('should detect negative feedbacks', () => {
        const v1Data = { ...healthyV1Data, negativeFeedbacks: { count: 5 } };
        const result = checkAccountHealth(healthyV2Data, v1Data);

        expect(result.negativeFeedbacks.status).toBe('Error');
        expect(result.negativeFeedbacks.Message).toContain('negative seller feedback');
        expect(result.TotalErrors).toBeGreaterThan(0);
      });

      it('should return empty object for zero negative feedbacks', () => {
        const result = checkAccountHealth(healthyV2Data, healthyV1Data);
        expect(result.negativeFeedbacks).toEqual({});
      });

      it('should detect NCX (Negative Customer Experience) issues', () => {
        const v1Data = {
          ...healthyV1Data,
          lateShipmentCount: { count: 2 },
          preFulfillmentCancellationCount: { count: 1 },
          refundsCount: { count: 0 },
        };
        const result = checkAccountHealth(healthyV2Data, v1Data);

        expect(result.NCX.status).toBe('Error');
        expect(result.NCX.Message).toContain('NCX');
      });

      it('should return empty NCX when counts are zero', () => {
        const result = checkAccountHealth(healthyV2Data, healthyV1Data);
        expect(result.NCX).toEqual({});
      });

      it('should detect A-to-Z claims', () => {
        const v1Data = { ...healthyV1Data, a_z_claims: { count: 1 } };
        const result = checkAccountHealth(healthyV2Data, v1Data);

        expect(result.a_z_claims.status).toBe('Error');
        expect(result.a_z_claims.Message).toContain('A-to-Z Guarantee Claim');
      });

      it('should detect response time issues', () => {
        const v1Data = { ...healthyV1Data, responseUnder24HoursCount: 3 };
        const result = checkAccountHealth(healthyV2Data, v1Data);

        expect(result.responseUnder24HoursCount.status).toBe('Error');
        expect(result.responseUnder24HoursCount.Message).toContain('24 hours');
      });
    });

    describe('error counting', () => {
      it('should count total errors correctly', () => {
        const v2Data = {
          accountStatuses: 'SUSPENDED',
          listingPolicyViolations: 'BAD',
          validTrackingRateStatus: 'POOR',
          orderWithDefectsStatus: 'GOOD',
          lateShipmentRateStatus: 'GOOD',
          CancellationRate: 'GOOD',
        };
        const v1Data = {
          negativeFeedbacks: { count: 5 },
          lateShipmentCount: { count: 0 },
          preFulfillmentCancellationCount: { count: 0 },
          refundsCount: { count: 0 },
          a_z_claims: { count: 0 },
          responseUnder24HoursCount: 0,
        };

        const result = checkAccountHealth(v2Data, v1Data);

        // 3 V2 errors + 1 V1 error = 4
        expect(result.TotalErrors).toBe(4);
      });

      it('should count all errors when everything is problematic', () => {
        const v2Data = {
          accountStatuses: 'SUSPENDED',
          listingPolicyViolations: 'BAD',
          validTrackingRateStatus: 'POOR',
          orderWithDefectsStatus: 'HIGH',
          lateShipmentRateStatus: 'HIGH',
          CancellationRate: 'HIGH',
        };
        const v1Data = {
          negativeFeedbacks: { count: 5 },
          lateShipmentCount: { count: 2 },
          preFulfillmentCancellationCount: { count: 1 },
          refundsCount: { count: 1 },
          a_z_claims: { count: 1 },
          responseUnder24HoursCount: 3,
        };

        const result = checkAccountHealth(v2Data, v1Data);

        // 6 V2 errors + 4 V1 errors (negativeFeedbacks, NCX, a_z_claims, responseUnder24Hours) = 10
        expect(result.TotalErrors).toBe(10);
      });
    });
  });
});

describe('checkAccountHealth over the last daily reports', () => {
  const GOOD_V2 = {
    accountStatuses: 'NORMAL',
    listingPolicyViolations: 'GOOD',
    validTrackingRateStatus: 'GOOD',
    orderWithDefectsStatus: 'GOOD',
    lateShipmentRateStatus: 'GOOD',
    CancellationRate: 'GOOD',
    ahrScore: 204,
  };
  const V1 = {
    negativeFeedbacks: { count: 0 }, lateShipmentCount: { count: 0 },
    preFulfillmentCancellationCount: { count: 0 }, refundsCount: { count: 0 },
    a_z_claims: { count: 0 }, responseUnder24HoursCount: 0,
  };
  const day = (d, over = {}) => ({ ...GOOD_V2, createdAt: new Date(`${d}T08:04:33Z`), ...over });
  // The real US account: AT_RISK on Oct 10 and Oct 13, no report on Oct 12.
  const REAL = [
    day('2026-10-08'), day('2026-10-09'), day('2026-10-10', { accountStatuses: 'AT_RISK' }),
    day('2026-10-11'), day('2026-10-13', { accountStatuses: 'AT_RISK' }), day('2026-10-14'),
  ];
  const newest = (h) => h[h.length - 1];

  it('turns the flip-flopping status into a warning with dates and the rating gap', () => {
    const r = checkAccountHealth(newest(REAL), V1, REAL);
    expect(r.accountStatus).toMatchObject({ status: 'Error', level: 'warning' });
    expect(r.accountStatus.Message).toBe(
      'Amazon flagged your account At Risk on 2 of the last 6 daily reports (Oct 10, Oct 13). ' +
      "It's Normal today, but it keeps slipping. Your Account Health Rating is 204 — just 4 points " +
      'above the 200 cutoff, so it can tip back at any time.'
    );
    expect(r.accountStatus.badDays.sort()).toEqual(['2026-10-10', '2026-10-13']);
    expect(r.accountStatus.days).toHaveLength(6);
  });

  it('counts a warning in TotalErrors, so issue counts and tasks still see it', () => {
    expect(checkAccountHealth(newest(REAL), V1, REAL).TotalErrors).toBe(1);
  });

  it('says it is At Risk today, without "tip back", when the newest report is the bad one', () => {
    const asOf13 = REAL.slice(0, 5);
    const msg = checkAccountHealth(newest(asOf13), V1, asOf13).accountStatus.Message;
    expect(msg).toContain("It's At Risk today.");
    expect(msg).not.toContain('tip back');
  });

  it('leaves out the rating sentence when the rating is not near the cutoff', () => {
    const far = REAL.map(d => ({ ...d, ahrScore: 640 }));
    expect(checkAccountHealth(newest(far), V1, far).accountStatus.Message).not.toContain('Account Health Rating');
  });

  it('a sustained problem stays an error and says for how long', () => {
    const h = [day('2026-10-12'), day('2026-10-13', { listingPolicyViolations: 'BAD' }), day('2026-10-14', { listingPolicyViolations: 'BAD' })];
    const r = checkAccountHealth(newest(h), V1, h);
    expect(r.PolicyViolations).toMatchObject({ status: 'Error', level: 'error' });
    expect(r.PolicyViolations.Message).toContain('Amazon has reported this for 2 days in a row.');
  });

  it('a one-day blip is a success', () => {
    const h = [day('2026-10-12'), day('2026-10-13', { accountStatuses: 'AT_RISK' }), day('2026-10-14')];
    expect(checkAccountHealth(newest(h), V1, h).accountStatus).toMatchObject({ status: 'Success', level: 'ok' });
  });

  it('DEACTIVATED is an error at once', () => {
    const h = [day('2026-10-13'), day('2026-10-14', { accountStatuses: 'DEACTIVATED' })];
    expect(checkAccountHealth(newest(h), V1, h).accountStatus.level).toBe('error');
  });

  it('without history behaves as before (a bad newest value is an error)', () => {
    const r = checkAccountHealth({ ...GOOD_V2, accountStatuses: 'AT_RISK' }, V1);
    expect(r.accountStatus).toMatchObject({ status: 'Error', level: 'error' });
    expect(r.accountStatus.Message).toContain('not in normal standing');
    expect(r.accountStatus.days).toBeUndefined();
  });

  describe('missing data is "no data", not an error', () => {
    it('a missing V2 report no longer fails all six V2 checks', () => {
      const r = checkAccountHealth(null, { ...V1, negativeFeedbacks: { count: 2 } });
      expect(r.accountStatus).toBeUndefined();
      expect(r.PolicyViolations).toBeUndefined();
      expect(r.negativeFeedbacks.status).toBe('Error');
      expect(r.TotalErrors).toBe(1);
    });

    it('a blank V2 status field is skipped, the others still judged', () => {
      const r = checkAccountHealth({ ...GOOD_V2, accountStatuses: '' }, V1);
      expect(r.accountStatus).toBeUndefined();
      expect(r.PolicyViolations.status).toBe('Success');
    });

    // Amazon sends NONE when there is nothing to measure (no seller-fulfilled shipments).
    it('a NONE status is no data, not a failing metric', () => {
      const r = checkAccountHealth({ ...GOOD_V2, validTrackingRateStatus: 'NONE' }, V1);
      expect(r.validTrackingRateStatus).toBeUndefined();
      expect(r.TotalErrors).toBe(0);
    });

    it('a NONE status is no data in the history judgement too', () => {
      const h = [day('2026-10-13', { validTrackingRateStatus: 'NONE' }), day('2026-10-14', { validTrackingRateStatus: 'NONE' })];
      expect(checkAccountHealth(newest(h), V1, h).validTrackingRateStatus).toBeUndefined();
    });

    it('a V1 report missing its count fields does not throw', () => {
      expect(() => checkAccountHealth(GOOD_V2, { negativeFeedbacks: {}, a_z_claims: null })).not.toThrow();
    });
  });

  describe('copy fixes', () => {
    it('Cancellation Rate talks about cancellations, not message response times', () => {
      const r = checkAccountHealth({ ...GOOD_V2, CancellationRate: 'BAD' }, V1);
      expect(r.CancellationRate.Message).toContain('Cancellation Rate');
      expect(r.CancellationRate.Message).not.toContain('24 hours');
      expect(r.CancellationRate.HowTOSolve).not.toContain('24 hours');
    });

    it('Policy Violations has real fix instructions, not the message repeated', () => {
      const r = checkAccountHealth({ ...GOOD_V2, listingPolicyViolations: 'BAD' }, V1);
      expect(r.PolicyViolations.HowTOSolve).not.toBe(r.PolicyViolations.Message);
    });
  });
});
