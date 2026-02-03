/**
 * Tests for notificationsSlice Redux reducer
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import notificationsReducer, {
  addNotification,
  markAsRead,
  markAllAsRead,
  clearNotifications,
  addAnalysisCompleteNotification,
  addIssuesFoundNotification,
  setAlertsFromApi,
} from '../../redux/slices/notificationsSlice';

describe('notificationsSlice', () => {
  const initialState = {
    notifications: [],
    unreadCount: 0,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T10:00:00Z'));
  });

  describe('initial state', () => {
    it('should return the initial state', () => {
      expect(notificationsReducer(undefined, { type: 'unknown' })).toEqual(initialState);
    });
  });

  describe('addNotification', () => {
    it('should add a notification with auto-generated fields', () => {
      const state = notificationsReducer(
        initialState,
        addNotification({
          type: 'analysis_complete',
          title: 'Test Title',
          message: 'Test message',
        })
      );

      expect(state.notifications).toHaveLength(1);
      expect(state.notifications[0].type).toBe('analysis_complete');
      expect(state.notifications[0].title).toBe('Test Title');
      expect(state.notifications[0].message).toBe('Test message');
      expect(state.notifications[0].isRead).toBe(false);
      expect(state.notifications[0].id).toBeDefined();
      expect(state.notifications[0].timestamp).toBeDefined();
      expect(state.unreadCount).toBe(1);
    });

    it('should add notification to beginning of array', () => {
      const existingState = {
        notifications: [{ id: 1, title: 'Old', isRead: false }],
        unreadCount: 1,
      };

      const state = notificationsReducer(
        existingState,
        addNotification({
          type: 'issues_found',
          title: 'New',
          message: 'New message',
        })
      );

      expect(state.notifications[0].title).toBe('New');
      expect(state.notifications[1].title).toBe('Old');
    });

    it('should keep only last 50 notifications', () => {
      const existingState = {
        notifications: Array(50).fill(null).map((_, i) => ({
          id: i,
          title: `Notification ${i}`,
          isRead: true,
        })),
        unreadCount: 0,
      };

      const state = notificationsReducer(
        existingState,
        addNotification({
          type: 'test',
          title: 'New Notification',
          message: 'Test',
        })
      );

      expect(state.notifications).toHaveLength(50);
      expect(state.notifications[0].title).toBe('New Notification');
    });

    it('should handle issueCount', () => {
      const state = notificationsReducer(
        initialState,
        addNotification({
          type: 'issues_found',
          title: 'Issues',
          message: 'Found issues',
          issueCount: 5,
        })
      );

      expect(state.notifications[0].issueCount).toBe(5);
    });
  });

  describe('markAsRead', () => {
    it('should mark a notification as read', () => {
      const existingState = {
        notifications: [
          { id: 1, title: 'Test', isRead: false },
          { id: 2, title: 'Test 2', isRead: false },
        ],
        unreadCount: 2,
      };

      const state = notificationsReducer(existingState, markAsRead(1));

      expect(state.notifications.find(n => n.id === 1).isRead).toBe(true);
      expect(state.notifications.find(n => n.id === 2).isRead).toBe(false);
      expect(state.unreadCount).toBe(1);
    });

    it('should not change anything for non-existent id', () => {
      const existingState = {
        notifications: [{ id: 1, title: 'Test', isRead: false }],
        unreadCount: 1,
      };

      const state = notificationsReducer(existingState, markAsRead(999));

      expect(state.notifications[0].isRead).toBe(false);
      expect(state.unreadCount).toBe(1);
    });
  });

  describe('markAllAsRead', () => {
    it('should mark all notifications as read', () => {
      const existingState = {
        notifications: [
          { id: 1, isRead: false },
          { id: 2, isRead: false },
          { id: 3, isRead: true },
        ],
        unreadCount: 2,
      };

      const state = notificationsReducer(existingState, markAllAsRead());

      expect(state.notifications.every(n => n.isRead)).toBe(true);
      expect(state.unreadCount).toBe(0);
    });

    it('should handle empty notifications', () => {
      const state = notificationsReducer(initialState, markAllAsRead());

      expect(state.notifications).toEqual([]);
      expect(state.unreadCount).toBe(0);
    });
  });

  describe('clearNotifications', () => {
    it('should clear all notifications', () => {
      const existingState = {
        notifications: [
          { id: 1, isRead: false },
          { id: 2, isRead: true },
        ],
        unreadCount: 1,
      };

      const state = notificationsReducer(existingState, clearNotifications());

      expect(state.notifications).toEqual([]);
      expect(state.unreadCount).toBe(0);
    });
  });

  describe('addAnalysisCompleteNotification', () => {
    it('should add first-time analysis notification', () => {
      const state = notificationsReducer(
        initialState,
        addAnalysisCompleteNotification({
          isFirstTime: true,
          accountName: 'My Store',
        })
      );

      expect(state.notifications[0].type).toBe('analysis_complete');
      expect(state.notifications[0].title).toBe('Initial Analysis Complete');
      expect(state.notifications[0].message).toContain('Welcome');
      expect(state.notifications[0].message).toContain('My Store');
      expect(state.unreadCount).toBe(1);
    });

    it('should add scheduled analysis notification', () => {
      const state = notificationsReducer(
        initialState,
        addAnalysisCompleteNotification({
          isFirstTime: false,
          accountName: 'My Store',
        })
      );

      expect(state.notifications[0].title).toBe('Scheduled Analysis Complete');
      expect(state.notifications[0].message).toContain('re-analyzed');
    });
  });

  describe('addIssuesFoundNotification', () => {
    it('should add issues notification', () => {
      const state = notificationsReducer(
        initialState,
        addIssuesFoundNotification({
          totalIssues: 15,
          accountName: 'My Store',
          issueBreakdown: '5 inventory, 10 listing',
        })
      );

      expect(state.notifications[0].type).toBe('issues_found');
      expect(state.notifications[0].title).toBe('Issues Detected');
      expect(state.notifications[0].message).toContain('15 total issues');
      expect(state.notifications[0].message).toContain('My Store');
      expect(state.notifications[0].message).toContain('5 inventory, 10 listing');
      expect(state.notifications[0].issueCount).toBe(15);
    });

    it('should handle missing issueBreakdown', () => {
      const state = notificationsReducer(
        initialState,
        addIssuesFoundNotification({
          totalIssues: 10,
          accountName: 'My Store',
        })
      );

      expect(state.notifications[0].message).toContain('Check your dashboard');
    });
  });

  describe('setAlertsFromApi', () => {
    it('should set notifications from API alerts', () => {
      const alerts = [
        {
          _id: 'alert1',
          alertType: 'ProductContentChange',
          message: 'Product changed',
          createdAt: '2024-01-15T09:00:00Z',
          viewed: false,
          products: [{ asin: 'B001' }],
        },
        {
          _id: 'alert2',
          alertType: 'BuyBoxMissing',
          viewed: true,
          products: [],
        },
      ];

      const state = notificationsReducer(initialState, setAlertsFromApi({ alerts }));

      expect(state.notifications).toHaveLength(2);
      expect(state.notifications[0].alertId).toBe('alert1');
      expect(state.notifications[0].type).toBe('alert');
      expect(state.notifications[0].alertType).toBe('ProductContentChange');
      expect(state.notifications[0].isRead).toBe(false);
      expect(state.notifications[0].products).toHaveLength(1);
      expect(state.notifications[1].isRead).toBe(true);
      expect(state.unreadCount).toBe(1);
    });

    it('should handle empty alerts array', () => {
      const state = notificationsReducer(initialState, setAlertsFromApi({ alerts: [] }));

      expect(state.notifications).toEqual([]);
      expect(state.unreadCount).toBe(0);
    });

    it('should handle null/undefined payload', () => {
      const state = notificationsReducer(initialState, setAlertsFromApi({}));

      expect(state.notifications).toEqual([]);
      expect(state.unreadCount).toBe(0);
    });

    it('should generate default title based on alertType', () => {
      const alerts = [
        { _id: '1', alertType: 'ProductContentChange', viewed: false },
        { _id: '2', alertType: 'BuyBoxMissing', viewed: false },
        { _id: '3', alertType: 'APlusMissing', viewed: false },
        { _id: '4', alertType: 'NegativeReview', viewed: false },
      ];

      const state = notificationsReducer(initialState, setAlertsFromApi({ alerts }));

      expect(state.notifications[0].title).toBe('Product content change');
      expect(state.notifications[1].title).toBe('Buy box missing');
      expect(state.notifications[2].title).toBe('A+ content missing');
      expect(state.notifications[3].title).toBe('Negative reviews');
    });
  });
});
