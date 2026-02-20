const { body } = require('express-validator');
const { handleValidationResult } = require('./validationResultHandler.js');

/** POST /app/accountHistory/addAccountHistory - body: Date, HealthScore, TotalProducts, ProductsWithIssues, TotalNumberOfIssues, expireDate */
const validateAddAccountHistory = [
    body('Date')
        .notEmpty().withMessage('Date is required'),
    body('HealthScore')
        .notEmpty().withMessage('HealthScore is required'),
    body('TotalProducts')
        .notEmpty().withMessage('TotalProducts is required'),
    body('ProductsWithIssues')
        .notEmpty().withMessage('ProductsWithIssues is required'),
    body('TotalNumberOfIssues')
        .notEmpty().withMessage('TotalNumberOfIssues is required'),
    body('expireDate')
        .notEmpty().withMessage('expireDate is required'),
    handleValidationResult
];

module.exports = {
    validateAddAccountHistory
};
