/**
 * Tests for DashboardSlice Redux reducer
 */

import { describe, it, expect } from 'vitest';
import dashboardReducer, {
  setDashboardInfo,
  UpdateDashboardInfo,
  setCalendarMode,
} from '../../redux/slices/DashboardSlice';

describe('DashboardSlice', () => {
  const initialState = {
    DashBoardInfo: null,
  };

  describe('initial state', () => {
    it('should return the initial state', () => {
      expect(dashboardReducer(undefined, { type: 'unknown' })).toEqual(initialState);
    });
  });

  describe('setDashboardInfo', () => {
    it('should set dashboard info', () => {
      const dashboardData = {
        startDate: '2024-01-01',
        endDate: '2024-01-31',
        TotalSales: 10000,
        accountFinance: { revenue: 5000 },
      };

      const state = dashboardReducer(initialState, setDashboardInfo(dashboardData));

      expect(state.DashBoardInfo).toEqual(dashboardData);
    });

    it('should replace existing dashboard info', () => {
      const existingState = {
        DashBoardInfo: { oldData: true },
      };
      const newData = { newData: true };

      const state = dashboardReducer(existingState, setDashboardInfo(newData));

      expect(state.DashBoardInfo).toEqual(newData);
      expect(state.DashBoardInfo.oldData).toBeUndefined();
    });

    it('should handle null payload', () => {
      const existingState = {
        DashBoardInfo: { data: 'existing' },
      };

      const state = dashboardReducer(existingState, setDashboardInfo(null));

      expect(state.DashBoardInfo).toBeNull();
    });
  });

  describe('UpdateDashboardInfo', () => {
    it('should update specific dashboard fields', () => {
      const existingState = {
        DashBoardInfo: {
          startDate: '2024-01-01',
          endDate: '2024-01-31',
          TotalSales: 10000,
          otherData: 'preserved',
        },
      };

      const updatePayload = {
        startDate: '2024-02-01',
        endDate: '2024-02-28',
        financeData: { revenue: 8000 },
        reimburstmentData: { total: 500 },
        WeeklySales: [1000, 2000, 3000],
        TotalSales: 15000,
        GetOrderData: { orders: 100 },
      };

      const state = dashboardReducer(existingState, UpdateDashboardInfo(updatePayload));

      expect(state.DashBoardInfo.startDate).toBe('2024-02-01');
      expect(state.DashBoardInfo.endDate).toBe('2024-02-28');
      expect(state.DashBoardInfo.accountFinance).toEqual({ revenue: 8000 });
      expect(state.DashBoardInfo.reimbustment).toEqual({ total: 500 });
      expect(state.DashBoardInfo.TotalWeeklySale).toEqual([1000, 2000, 3000]);
      expect(state.DashBoardInfo.TotalSales).toBe(15000);
      expect(state.DashBoardInfo.GetOrderData).toEqual({ orders: 100 });
      expect(state.DashBoardInfo.otherData).toBe('preserved');
    });

    it('should set calendarMode to custom by default', () => {
      const existingState = {
        DashBoardInfo: { startDate: '2024-01-01' },
      };

      const updatePayload = {
        startDate: '2024-02-01',
        endDate: '2024-02-28',
      };

      const state = dashboardReducer(existingState, UpdateDashboardInfo(updatePayload));

      expect(state.DashBoardInfo.calendarMode).toBe('custom');
    });

    it('should use provided calendarMode', () => {
      const existingState = {
        DashBoardInfo: { startDate: '2024-01-01' },
      };

      const updatePayload = {
        startDate: '2024-02-01',
        endDate: '2024-02-28',
        calendarMode: 'preset',
      };

      const state = dashboardReducer(existingState, UpdateDashboardInfo(updatePayload));

      expect(state.DashBoardInfo.calendarMode).toBe('preset');
    });

    it('should preserve createdAccountDate when provided', () => {
      const existingState = {
        DashBoardInfo: { startDate: '2024-01-01' },
      };

      const updatePayload = {
        startDate: '2024-02-01',
        endDate: '2024-02-28',
        createdAccountDate: '2023-06-15',
      };

      const state = dashboardReducer(existingState, UpdateDashboardInfo(updatePayload));

      expect(state.DashBoardInfo.createdAccountDate).toBe('2023-06-15');
    });
  });

  describe('setCalendarMode', () => {
    it('should set calendar mode when DashBoardInfo exists', () => {
      const existingState = {
        DashBoardInfo: {
          startDate: '2024-01-01',
          calendarMode: 'custom',
        },
      };

      const state = dashboardReducer(existingState, setCalendarMode('preset'));

      expect(state.DashBoardInfo.calendarMode).toBe('preset');
    });

    it('should not change state when DashBoardInfo is null', () => {
      const state = dashboardReducer(initialState, setCalendarMode('preset'));

      expect(state.DashBoardInfo).toBeNull();
    });

    it('should handle various calendar modes', () => {
      const existingState = {
        DashBoardInfo: { calendarMode: 'custom' },
      };

      const modes = ['custom', 'preset', '7days', '30days', 'mtd', 'ytd'];

      modes.forEach((mode) => {
        const state = dashboardReducer(existingState, setCalendarMode(mode));
        expect(state.DashBoardInfo.calendarMode).toBe(mode);
      });
    });
  });
});
