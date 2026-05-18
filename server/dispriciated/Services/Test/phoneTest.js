const sendVerificationCode = require('../SMS/sendSMS');

const phoneNumber = '+1818350-5302';
const otp = '92876';

sendVerificationCode(otp,phoneNumber);