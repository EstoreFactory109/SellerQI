# File Changes Documentation

## Client Directory Changes

### Modified Files
1. `client/package-lock.json` - Package lock file updated
2. `client/package.json` - Package dependencies updated
3. `client/src/App.jsx` - Main application component modified
4. `client/src/Components/Dashboard/SamePageComponents/TotalSales.jsx` - Total sales component updated
5. `client/src/Components/Navigation/LeftNavSection.jsx` - Navigation component modified
6. `client/src/Pages/Login.jsx` - Login page updated
7. `client/src/Pages/ResetPassword.jsx` - Reset password page modified
8. `client/src/operations/analyse.js` - Analysis operations updated

### Newly Added Files
1. `client/src/Components/ProfitibilityDashboard/` - New profitability dashboard components directory
2. `client/src/Pages/EmailVerificationForNewPassword.jsx` - New email verification page for password reset
3. `client/src/Pages/PPCDashboard.jsx` - New PPC (Pay-Per-Click) dashboard page
4. `client/src/Pages/ProfitibilityDashboard.jsx` - New profitability dashboard page
5. `client/src/operations/Profitiblity.js` - New profitability operations file
6. `client/src/operations/sponserdAds.js` - New sponsored ads operations file

### Deleted Files
1. `client/MainPagesLayout.jsx` - Main pages layout component removed
2. `client/src/operations/fetchData.js` - Fetch data operations file removed

## Server Directory Changes

### Modified Files
1. `server/Services/Sp_API/Finance.js` - Finance API service updated
2. `server/Services/Sp_API/GET_V1_SELLER_PERFORMANCE_REPORT.js` - Seller performance report service modified
3. `server/Services/User/userServices.js` - User services updated
4. `server/controllers/AnalysingController.js` - Analysis controller modified
5. `server/controllers/SpApiDataController.js` - SP API data controller updated
6. `server/controllers/TestController.js` - Test controller modified
7. `server/controllers/UserController.js` - User controller updated
8. `server/middlewares/Auth/auth.js` - Authentication middleware modified
9. `server/models/userModel.js` - User model updated
10. `server/routes/testRoutes.js` - Test routes modified
11. `server/routes/user.routes.js` - User routes updated

### Newly Added Files
1. `server/Emails/ResetPasswordEmailTemplate.html` - New email template for password reset
2. `server/Services/AmazonAds/` - New Amazon Ads services directory
3. `server/Services/Calculations/Profitibility.js` - New profitability calculations service
4. `server/Services/Email/SendResetLink.js` - New email service for sending reset links
5. `server/Services/Sp_API/FINANCE_CALCULATIONS_GUIDE.md` - New finance calculations documentation
6. `server/Services/Sp_API/GET_FBA_FULFILLMENT_CUSTOMER_SHIPMENT_SALES_DATA.js` - New FBA fulfillment data service
7. `server/Services/Sp_API/GET_FBA_STORAGE_FEE_CHARGES_DATA.js` - New FBA storage fee service
8. `server/Services/Sp_API/GET_ORDERS_AND_REVENUE_DATA.js` - New orders and revenue data service
9. `server/Services/Sp_API/GetProductWiseFBAData.js` - New product-wise FBA data service
10. `server/Services/Test/TestFinance.js` - New finance testing file
11. `server/Services/Test/TestFinanceCalculations.js` - New finance calculations testing file
12. `server/models/NegetiveKeywords.js` - New negative keywords model
13. `server/models/ProductWiseFBADataModel.js` - New product-wise FBA data model
14. `server/models/ProductWiseFinancialModel.js` - New product-wise financial model
15. `server/models/ProductWiseSponseredAdsModel.js` - New product-wise sponsored ads model
16. `server/models/ProductWiseStorageFees.js` - New product-wise storage fees model

### Deleted Files
1. `server/AccountHistory.routes.js` - Account history routes removed

## Summary

### Client Changes
- **Modified**: 8 files
- **Added**: 6 files/directories
- **Deleted**: 2 files

### Server Changes
- **Modified**: 11 files
- **Added**: 16 files/directories
- **Deleted**: 1 file

### Key Updates
1. **New Features**: Added profitability dashboard, PPC dashboard, and email verification for password reset
2. **Enhanced Services**: Added multiple Amazon SP-API services for FBA data, storage fees, and financial calculations
3. **New Models**: Added several product-wise data models for FBA, financial, and sponsored ads data
4. **Email Functionality**: Added password reset email template and sending service
5. **Testing**: Added test files for finance and finance calculations

---
*Generated on: June 04, 2025* 