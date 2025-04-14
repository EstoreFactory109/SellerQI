const bcrypt = require('bcryptjs');

const hashPassword = async (password) => {
    const saltRounds = 10;
    const generateSalt = await bcrypt.genSalt(saltRounds); // ✅ Add `await` here
    let hashedPassword = await bcrypt.hash(password, generateSalt); 
    //console.log(hashedPassword); // ✅ Log hashedPassword instead of function
    return hashedPassword;
};

const verifyPassword = async (password, hashedPassword) => {
    const verifyStatus = await bcrypt.compare(password, hashedPassword);
    return verifyStatus;
};

module.exports = { hashPassword, verifyPassword };
