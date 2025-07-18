import { store } from '../redux/store/store.js';
import { addAnalysisCompleteNotification, addIssuesFoundNotification } from '../redux/slices/notificationsSlice.js';

// Utility function to trigger analysis completion notification
export const triggerAnalysisCompleteNotification = (isFirstTime = false, accountName = 'Unknown Account') => {
  store.dispatch(addAnalysisCompleteNotification({
    isFirstTime,
    accountName
  }));
};

// Utility function to trigger issues found notification
export const triggerIssuesFoundNotification = (totalIssues, accountName = 'Unknown Account', issueBreakdown = null) => {
  // Only show notification if there are issues
  if (totalIssues > 0) {
    store.dispatch(addIssuesFoundNotification({
      totalIssues,
      accountName,
      issueBreakdown
    }));
  }
};

// Utility function to calculate total issues from dashboard data
export const calculateTotalIssues = (dashboardInfo) => {
  if (!dashboardInfo) return 0;
  
  const {
    TotalRankingerrors = 0,
    totalErrorInConversion = 0,
    totalErrorInAccount = 0,
    totalProfitabilityErrors = 0,
    totalSponsoredAdsErrors = 0,
    totalInventoryErrors = 0
  } = dashboardInfo;
  
  return TotalRankingerrors + totalErrorInConversion + totalErrorInAccount + 
         totalProfitabilityErrors + totalSponsoredAdsErrors + totalInventoryErrors;
};

// Utility function to create issue breakdown string
export const createIssueBreakdown = (dashboardInfo) => {
  if (!dashboardInfo) return null;
  
  const {
    TotalRankingerrors = 0,
    totalErrorInConversion = 0,
    totalErrorInAccount = 0,
    totalProfitabilityErrors = 0,
    totalSponsoredAdsErrors = 0,
    totalInventoryErrors = 0
  } = dashboardInfo;
  
  const issues = [];
  if (TotalRankingerrors > 0) issues.push(`${TotalRankingerrors} ranking`);
  if (totalErrorInConversion > 0) issues.push(`${totalErrorInConversion} conversion`);
  if (totalErrorInAccount > 0) issues.push(`${totalErrorInAccount} account`);
  if (totalProfitabilityErrors > 0) issues.push(`${totalProfitabilityErrors} profitability`);
  if (totalSponsoredAdsErrors > 0) issues.push(`${totalSponsoredAdsErrors} ads`);
  if (totalInventoryErrors > 0) issues.push(`${totalInventoryErrors} inventory`);
  
  return issues.length > 0 ? issues.join(', ') + ' issues' : null;
};

// Combined utility to trigger both notifications based on dashboard data
export const triggerAnalysisNotifications = (dashboardInfo, isFirstTime = false) => {
  const accountName = dashboardInfo?.user?.brand || 'Your Account';
  
  // Always trigger analysis complete notification
  triggerAnalysisCompleteNotification(isFirstTime, accountName);
  
  // Calculate and trigger issues notification if there are issues
  const totalIssues = calculateTotalIssues(dashboardInfo);
  if (totalIssues > 0) {
    const issueBreakdown = createIssueBreakdown(dashboardInfo);
    triggerIssuesFoundNotification(totalIssues, accountName, issueBreakdown);
  }
};

// Note: Demo notifications removed - only real notifications will be shown 