const express = require('express');
const router = express.Router();
const {
    listMembers,
    inviteMember,
    resendMemberInvite,
    renameMember,
    removeMember,
    getMemberInvite,
    acceptMemberInvite,
    requestMemberLoginLink,
    verifyMemberLoginLink,
} = require('../controllers/user-auth/AccountMemberController.js');
const auth = require('../middlewares/Auth/auth.js');
const { refuseIfOtherSession } = require('../middlewares/Auth/singleSession.js');
const { authRateLimiter, registerRateLimiter } = require('../middlewares/rateLimiting.js');

// Public — the member has no session yet; the invite / sign-in token is the
// credential. The two that sign someone in refuse while this browser is already
// signed in anywhere (middlewares/Auth/singleSession.js).
router.get('/invite/:token', getMemberInvite);
router.post('/invite/:token/accept', registerRateLimiter, refuseIfOtherSession(), acceptMemberInvite);
router.post('/login-link', authRateLimiter, requestMemberLoginLink);
router.post('/login-link/verify', authRateLimiter, refuseIfOtherSession(), verifyMemberLoginLink);

// The account being viewed manages its own members.
router.get('/', auth, listMembers);
router.post('/invite', auth, registerRateLimiter, inviteMember);
router.post('/:memberId/resend', auth, resendMemberInvite);
router.patch('/:memberId', auth, renameMember);
router.delete('/:memberId', auth, removeMember);

module.exports = router;
