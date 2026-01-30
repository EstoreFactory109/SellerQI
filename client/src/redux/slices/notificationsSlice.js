import { createSlice } from '@reduxjs/toolkit';

const notificationsSlice = createSlice({
  name: 'notifications',
  initialState: {
    notifications: [],
    unreadCount: 0,
  },
  reducers: {
    addNotification: (state, action) => {
      const notification = {
        id: Date.now(),
        type: action.payload.type, // 'analysis_complete' or 'issues_found'
        title: action.payload.title,
        message: action.payload.message,
        issueCount: action.payload.issueCount || null,
        timestamp: new Date().toISOString(),
        isRead: false,
      };
      
      // Add to beginning of array
      state.notifications.unshift(notification);
      
      // Keep only last 50 notifications
      if (state.notifications.length > 50) {
        state.notifications = state.notifications.slice(0, 50);
      }
      
      // Update unread count
      state.unreadCount = state.notifications.filter(n => !n.isRead).length;
    },
    
    markAsRead: (state, action) => {
      const notification = state.notifications.find(n => n.id === action.payload);
      if (notification) {
        notification.isRead = true;
        state.unreadCount = state.notifications.filter(n => !n.isRead).length;
      }
    },
    
    markAllAsRead: (state) => {
      state.notifications.forEach(n => n.isRead = true);
      state.unreadCount = 0;
    },
    
    clearNotifications: (state) => {
      state.notifications = [];
      state.unreadCount = 0;
    },
    
    // Add analysis completion notification
    addAnalysisCompleteNotification: (state, action) => {
      const { isFirstTime, accountName } = action.payload;
      const notification = {
        id: Date.now(),
        type: 'analysis_complete',
        title: isFirstTime ? 'Initial Analysis Complete' : 'Scheduled Analysis Complete',
        message: isFirstTime 
          ? `Welcome! Your account "${accountName}" has been successfully analyzed for the first time. You can now view your dashboard insights.`
          : `Your account "${accountName}" has been re-analyzed. Dashboard data has been updated with the latest information.`,
        timestamp: new Date().toISOString(),
        isRead: false,
      };
      
      state.notifications.unshift(notification);
      
      if (state.notifications.length > 50) {
        state.notifications = state.notifications.slice(0, 50);
      }
      
      state.unreadCount = state.notifications.filter(n => !n.isRead).length;
    },
    
    // Add issues found notification
    addIssuesFoundNotification: (state, action) => {
      const { totalIssues, accountName, issueBreakdown } = action.payload;
      const notification = {
        id: Date.now(),
        type: 'issues_found',
        title: 'Issues Detected',
        message: `Found ${totalIssues} total issues in your account "${accountName}". ${issueBreakdown ? `Breakdown: ${issueBreakdown}` : 'Check your dashboard for details.'}`,
        issueCount: totalIssues,
        timestamp: new Date().toISOString(),
        isRead: false,
      };
      
      state.notifications.unshift(notification);
      
      if (state.notifications.length > 50) {
        state.notifications = state.notifications.slice(0, 50);
      }
      
      state.unreadCount = state.notifications.filter(n => !n.isRead).length;
    },

    // Set notifications from alerts API (last N alerts for notification dropdown)
    setAlertsFromApi: (state, action) => {
      const alerts = action.payload?.alerts ?? [];
      state.notifications = alerts.map((alert) => ({
        id: alert._id,
        alertId: alert._id,
        type: 'alert',
        alertType: alert.alertType,
        title: alert.message || (alert.alertType === 'ProductContentChange' ? 'Product content change' : alert.alertType === 'BuyBoxMissing' ? 'Buy box missing' : alert.alertType === 'APlusMissing' ? 'A+ content missing' : 'Negative reviews'),
        message: alert.message || '',
        timestamp: alert.createdAt || new Date().toISOString(),
        isRead: alert.viewed === true,
        products: Array.isArray(alert.products) ? alert.products : [],
      }));
      state.unreadCount = state.notifications.filter((n) => !n.isRead).length;
    },
  },
});

export const {
  addNotification,
  markAsRead,
  markAllAsRead,
  clearNotifications,
  addAnalysisCompleteNotification,
  addIssuesFoundNotification,
  setAlertsFromApi,
} = notificationsSlice.actions;

export default notificationsSlice.reducer; 