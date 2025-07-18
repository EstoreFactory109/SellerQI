import { triggerAnalysisNotifications } from './notificationUtils.js';

// Example integration for when analysis data is received
export const handleAnalysisComplete = (dashboardData, isFirstTimeAnalysis = false) => {
  try {
    // Trigger the appropriate notifications
    triggerAnalysisNotifications(dashboardData, isFirstTimeAnalysis);
    
    console.log('Analysis notifications triggered successfully');
  } catch (error) {
    console.error('Error triggering analysis notifications:', error);
  }
};

// Example: Integration with existing data fetching
// This could be added to your existing data fetching logic
export const fetchDashboardDataWithNotifications = async () => {
  try {
    // Your existing dashboard data fetching logic here
    // const response = await axios.get('/app/analyse/getData');
    // const dashboardData = response.data;
    
    // For demo purposes, let's simulate:
    // Determine if this is first time analysis (you might store this in localStorage or Redux)
    const isFirstTime = localStorage.getItem('hasAnalyzedBefore') !== 'true';
    
    // After successful data fetch, trigger notifications
    // handleAnalysisComplete(dashboardData, isFirstTime);
    
    // Mark that analysis has been done before
    localStorage.setItem('hasAnalyzedBefore', 'true');
    
    return { success: true };
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    return { success: false, error };
  }
};

// Note: Manual trigger removed - only real analysis data will be processed

// Integration points where you might call these functions:
/* 
1. In your main dashboard data fetching function
2. After successful API calls to /app/analyse/getData
3. In Redux actions that update dashboard data
4. After account switching
5. In scheduled analysis completion handlers
6. After manual refresh actions

Example usage in existing code:

// In your data fetching function:
const fetchData = async () => {
  try {
    setLoading(true);
    const response = await axios.get('/app/analyse/getData');
    
    // Update Redux store
    dispatch(updateDashboardData(response.data));
    
    // Trigger notifications AFTER successful data update
    handleAnalysisComplete(response.data, isFirstTimeUser);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    setLoading(false);
  }
};

*/ 