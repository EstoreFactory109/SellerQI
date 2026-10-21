/**
 * The RapidAPI key comes from the environment: X-RAPIDAPI-KEY (the name already in
 * .env), or RAPIDAPI_KEY. It used to be hard-coded in NumberOfProductReviews.js;
 * without either variable the run stops before any request rather than saving a
 * snapshot in which no listing has content.
 */

jest.mock('axios', () => {
    const request = jest.fn();
    const axios = { request, interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } } };
    axios.default = axios;
    return axios;
});
jest.mock('axios-retry', () => {
    const fn = jest.fn();
    fn.exponentialDelay = jest.fn();
    fn.isNetworkError = jest.fn();
    fn.isRetryableError = jest.fn();
    return { default: fn };
});
jest.mock('../../../models/user-auth/userModel.js', () => ({}));
jest.mock('../../../models/seller-performance/NumberOfProductReviewsModel.js', () => ({}));
jest.mock('../../../models/seller-performance/APlusContentModel.js', () => ({}));
jest.mock('../../../utils/Logger.js', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const logger = require('../../../utils/Logger.js');
const { addReviewDataTODatabase } = require('../../../Services/Sp_API/NumberOfProductReviews.js');

describe('NumberOfProductReviews RapidAPI key', () => {
    const NAMES = ['X-RAPIDAPI-KEY', 'RAPIDAPI_KEY'];
    const saved = Object.fromEntries(NAMES.map((n) => [n, process.env[n]]));
    afterEach(() => {
        for (const n of NAMES) {
            if (saved[n] === undefined) delete process.env[n];
            else process.env[n] = saved[n];
        }
    });

    it('stops with a clear error and makes no request when no key is set', async () => {
        for (const n of NAMES) delete process.env[n];
        const result = await addReviewDataTODatabase(['B000000001'], 'US', 'user1', 'NA');
        expect(result).toEqual({ success: false, error: 'X-RAPIDAPI-KEY is not set' });
        expect(axios.request).not.toHaveBeenCalled();
        expect(logger.error.mock.calls[0][0]).toMatch(/X-RAPIDAPI-KEY is not set/);
    });

    it('has no key literal in the source', () => {
        const source = fs.readFileSync(path.join(__dirname, '../../../Services/Sp_API/NumberOfProductReviews.js'), 'utf8');
        expect(source).toMatch(/process\.env\["X-RAPIDAPI-KEY"\] \|\| process\.env\.RAPIDAPI_KEY/);
        expect(source).not.toMatch(/msh[0-9a-f]{10,}/);
    });
});
