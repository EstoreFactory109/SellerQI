/**
 * test-schedule-config.js
 * 
 * Test script to see which functions run on which days
 * 
 * Usage:
 *   node test-schedule-config.js [day]
 * 
 * Examples:
 *   node test-schedule-config.js          # Shows today's schedule
 *   node test-schedule-config.js 0        # Shows Sunday's schedule
 *   node test-schedule-config.js monday   # Shows Monday's schedule
 */

require('dotenv').config();
const { getFunctionsForDay } = require('./server/Services/schedule/ScheduleConfig.js');
const { SUNDAY_FUNCTIONS, MON_WED_FRI_FUNCTIONS, SATURDAY_FUNCTIONS, DAILY_FUNCTIONS } = require('./server/Services/schedule/ScheduleConfig.js');

function getDayNumber(dayArg) {
    if (!dayArg) {
        return new Date().getDay();
    }

    const dayLower = dayArg.toLowerCase();
    const dayMap = {
        '0': 0, 'sunday': 0, 'sun': 0,
        '1': 1, 'monday': 1, 'mon': 1,
        '2': 2, 'tuesday': 2, 'tue': 2,
        '3': 3, 'wednesday': 3, 'wed': 3,
        '4': 4, 'thursday': 4, 'thu': 4,
        '5': 5, 'friday': 5, 'fri': 5,
        '6': 6, 'saturday': 6, 'sat': 6
    };

    return dayMap[dayLower] !== undefined ? dayMap[dayLower] : new Date().getDay();
}

function displaySchedule(dayOfWeek) {
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayName = dayNames[dayOfWeek];

    console.log('\n📅 Schedule Configuration');
    console.log('=====================================\n');
    console.log(`Day: ${dayName} (${dayOfWeek})\n`);

    const functions = getFunctionsForDay(dayOfWeek);
    const functionKeys = Object.keys(functions);

    if (functionKeys.length === 0) {
        console.log('❌ No functions scheduled for this day.\n');
        return;
    }

    console.log(`Total Functions: ${functionKeys.length}\n`);

    // Group by schedule type
    const sundayFuncs = [];
    const monWedFriFuncs = [];
    const saturdayFuncs = [];
    const dailyFuncs = [];

    functionKeys.forEach(key => {
        if (SUNDAY_FUNCTIONS[key]) sundayFuncs.push(key);
        else if (MON_WED_FRI_FUNCTIONS[key]) monWedFriFuncs.push(key);
        else if (SATURDAY_FUNCTIONS[key]) saturdayFuncs.push(key);
        else if (DAILY_FUNCTIONS[key]) dailyFuncs.push(key);
    });

    if (sundayFuncs.length > 0) {
        console.log('📆 SUNDAY Functions (Weekly):');
        sundayFuncs.forEach(key => {
            const config = functions[key];
            console.log(`   • ${config.description || key}`);
        });
        console.log('');
    }

    if (monWedFriFuncs.length > 0) {
        console.log('📆 MONDAY/WEDNESDAY/FRIDAY Functions (3x/week):');
        monWedFriFuncs.forEach(key => {
            const config = functions[key];
            console.log(`   • ${config.description || key}`);
        });
        console.log('');
    }

    if (saturdayFuncs.length > 0) {
        console.log('📆 SATURDAY Functions (Weekly):');
        saturdayFuncs.forEach(key => {
            const config = functions[key];
            console.log(`   • ${config.description || key}`);
        });
        console.log('');
    }

    if (dailyFuncs.length > 0) {
        console.log('📆 DAILY Functions (Every Day):');
        dailyFuncs.forEach(key => {
            const config = functions[key];
            console.log(`   • ${config.description || key}`);
        });
        console.log('');
    }

    // Show token requirements
    console.log('🔑 Token Requirements:');
    const needsAccessToken = functionKeys.filter(key => functions[key].requiresAccessToken);
    const needsAdsToken = functionKeys.filter(key => functions[key].requiresAdsToken);
    const needsRefreshToken = functionKeys.filter(key => functions[key].requiresRefreshToken);

    if (needsAccessToken.length > 0) {
        console.log(`   • SP-API Token: ${needsAccessToken.length} functions`);
    }
    if (needsAdsToken.length > 0) {
        console.log(`   • Ads Token: ${needsAdsToken.length} functions`);
    }
    if (needsRefreshToken.length > 0) {
        console.log(`   • Refresh Token: ${needsRefreshToken.length} functions`);
    }
    console.log('');
}

// Main
const dayArg = process.argv[2];
const dayOfWeek = getDayNumber(dayArg);

displaySchedule(dayOfWeek);

// Show all days if no argument
if (!dayArg) {
    console.log('\n💡 Tip: Run with a day argument to see other days:');
    console.log('   node test-schedule-config.js 0    # Sunday');
    console.log('   node test-schedule-config.js 1    # Monday');
    console.log('   node test-schedule-config.js monday  # Monday (by name)');
    console.log('');
}

