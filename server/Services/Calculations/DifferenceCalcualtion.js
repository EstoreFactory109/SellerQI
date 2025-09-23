const getv2SellerPerformanceReportModel = require('../../models/V2_Seller_Performance_ReportModel.js');

const differenceCalculation = async (userId, country, region) => {
    const now = new Date();
    
    console.log("=== DEBUGGING DIFFERENCE CALCULATION ===");
    console.log("Input parameters:");
    console.log("- userId:", userId);
    console.log("- region:", region);
    console.log("- country:", country);
    console.log("- Current date:", now.toISOString());
    
    // Calculate the last full month date range
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1); // First day of last month
    const lastDayOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0); // Last day of last month
    
    // Set time to start and end of day for accurate range
    const startOfLastMonth = new Date(lastMonth.setHours(0, 0, 0, 0));
    const endOfLastMonth = new Date(lastDayOfLastMonth.setHours(23, 59, 59, 999));

    // Calculate current month date range (from 1st till today)
    const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1); // First day of current month
    const endOfCurrentMonth = new Date(now); // Today
    
    // Set time to start and end of day for accurate range
    startOfCurrentMonth.setHours(0, 0, 0, 0);
    endOfCurrentMonth.setHours(23, 59, 59, 999);

    console.log("Date ranges calculated:");
    console.log("- Last month:", startOfLastMonth.toISOString(), "to", endOfLastMonth.toISOString());
    console.log("- Current month:", startOfCurrentMonth.toISOString(), "to", endOfCurrentMonth.toISOString());

    // First, let's check if there's any data for this user at all
    const totalRecordsForUser = await getv2SellerPerformanceReportModel.countDocuments({ User: userId });
    console.log("Total records for user:", totalRecordsForUser);

    // Check records with region and country
    const totalRecordsWithRegionCountry = await getv2SellerPerformanceReportModel.countDocuments({ 
        User: userId, 
        region, 
        country 
    });
    console.log("Total records for user with region/country:", totalRecordsWithRegionCountry);

    // Get a sample of recent records to understand the data structure
    const recentRecords = await getv2SellerPerformanceReportModel.find({ User: userId })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('createdAt ahrScore region country User');
    console.log("Recent records sample:", JSON.stringify(recentRecords, null, 2));

    // Get all records for this user to understand date distribution
    const allUserRecords = await getv2SellerPerformanceReportModel.find({ User: userId, region, country })
        .sort({ createdAt: -1 })
        .select('createdAt ahrScore')
        .limit(20);
    console.log("All user records with region/country (last 20):", JSON.stringify(allUserRecords, null, 2));

    // Check if there are records in a broader date range (last 3 months)
    const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
    const recordsInLast3Months = await getv2SellerPerformanceReportModel.find({
        User: userId,
        region,
        country,
        createdAt: { $gte: threeMonthsAgo }
    }).sort({ createdAt: -1 }).select('createdAt ahrScore');
    console.log("Records in last 3 months:", recordsInLast3Months.length);
    if (recordsInLast3Months.length > 0) {
        console.log("Date range of records:", 
            recordsInLast3Months[recordsInLast3Months.length - 1].createdAt, 
            "to", 
            recordsInLast3Months[0].createdAt);
    }

    // Query v2SellerPerformanceReport documents for the last full month
    const lastMonthQuery = { 
        User: userId, 
        region, 
        country,
        createdAt: {
            $gte: startOfLastMonth,
            $lte: endOfLastMonth
        }
    };
    console.log("Last month query:", JSON.stringify(lastMonthQuery, null, 2));

    const lastMonthReports = await getv2SellerPerformanceReportModel.find(lastMonthQuery).sort({ createdAt: 1 });
    console.log("lastMonthReports count:", lastMonthReports.length);
    console.log("lastMonthReports sample:", JSON.stringify(lastMonthReports.slice(0, 2), null, 2));

    // Query v2SellerPerformanceReport documents for the current month till today
    const currentMonthQuery = { 
        User: userId, 
        region, 
        country,
        createdAt: {
            $gte: startOfCurrentMonth,
            $lte: endOfCurrentMonth
        }
    };
    console.log("Current month query:", JSON.stringify(currentMonthQuery, null, 2));

    const currentMonthReports = await getv2SellerPerformanceReportModel.find(currentMonthQuery).sort({ createdAt: 1 });
    console.log("currentMonthReports count:", currentMonthReports.length);
    console.log("currentMonthReports sample:", JSON.stringify(currentMonthReports.slice(0, 2), null, 2));

    // Let's also check if userId needs to be converted to ObjectId
    const mongoose = require('mongoose');
    let userObjectId;
    try {
        userObjectId = new mongoose.Types.ObjectId(userId);
        console.log("userId converted to ObjectId:", userObjectId);
        
        // Try query with ObjectId
        const testQuery = await getv2SellerPerformanceReportModel.countDocuments({ User: userObjectId });
        console.log("Records found with ObjectId userId:", testQuery);
    } catch (error) {
        console.log("userId is not a valid ObjectId or conversion failed:", error.message);
    }

    // Calculate average ahrScore for last month
    let lastMonthAverage = 0;
    let lastMonthValidScores = [];
    
    if (lastMonthReports && lastMonthReports.length > 0) {
        lastMonthValidScores = lastMonthReports
            .map(report => report.ahrScore)
            .filter(score => score !== null && score !== undefined && !isNaN(score));
        
        if (lastMonthValidScores.length > 0) {
            lastMonthAverage = lastMonthValidScores.reduce((sum, score) => sum + score, 0) / lastMonthValidScores.length;
        }
    }

    // Calculate average ahrScore for current month
    let currentMonthAverage = 0;
    let currentMonthValidScores = [];
    
    if (currentMonthReports && currentMonthReports.length > 0) {
        currentMonthValidScores = currentMonthReports
            .map(report => report.ahrScore)
            .filter(score => score !== null && score !== undefined && !isNaN(score));
        
        if (currentMonthValidScores.length > 0) {
            currentMonthAverage = currentMonthValidScores.reduce((sum, score) => sum + score, 0) / currentMonthValidScores.length;
        }
    }

    // Check if we have valid data for both months
    if (lastMonthValidScores.length === 0) {
        console.log(`No valid ahrScore data found for last full month (${startOfLastMonth.toISOString().split('T')[0]} to ${endOfLastMonth.toISOString().split('T')[0]})`);
        return {
            success: false,
            message: 'No valid ahrScore data found for the last full month',
            percentageDifference: 0,
            lastMonthAverage: 0,
            currentMonthAverage: 0,
            dateRanges: {
                lastMonth: {
                    startDate: startOfLastMonth.toISOString().split('T')[0],
                    endDate: endOfLastMonth.toISOString().split('T')[0]
                },
                currentMonth: {
                    startDate: startOfCurrentMonth.toISOString().split('T')[0],
                    endDate: endOfCurrentMonth.toISOString().split('T')[0]
                }
            }
        };
    }

    if (currentMonthValidScores.length === 0) {
        console.log(`No valid ahrScore data found for current month till today (${startOfCurrentMonth.toISOString().split('T')[0]} to ${endOfCurrentMonth.toISOString().split('T')[0]})`);
        return {
            success: false,
            message: 'No valid ahrScore data found for the current month',
            percentageDifference: 0,
            lastMonthAverage: Math.round(lastMonthAverage * 100) / 100,
            currentMonthAverage: 0,
            dateRanges: {
                lastMonth: {
                    startDate: startOfLastMonth.toISOString().split('T')[0],
                    endDate: endOfLastMonth.toISOString().split('T')[0]
                },
                currentMonth: {
                    startDate: startOfCurrentMonth.toISOString().split('T')[0],
                    endDate: endOfCurrentMonth.toISOString().split('T')[0]
                }
            }
        };
    }

    // Calculate percentage difference: (currentMonthAvg - lastMonthAvg) / lastMonthAvg * 100
    const percentageDifference = ((currentMonthAverage - lastMonthAverage) / lastMonthAverage) * 100;

    console.log(`Last month average ahrScore: ${lastMonthAverage} (from ${lastMonthValidScores.length} records)`);
    console.log(`Current month average ahrScore: ${currentMonthAverage} (from ${currentMonthValidScores.length} records)`);
    console.log(`Percentage difference: ${percentageDifference}%`);

    return {
        success: true,
        message: 'Percentage difference calculated successfully',
        percentageDifference: Math.round(percentageDifference * 100) / 100, // Round to 2 decimal places
        lastMonthAverage: Math.round(lastMonthAverage * 100) / 100,
        currentMonthAverage: Math.round(currentMonthAverage * 100) / 100,
        dateRanges: {
            lastMonth: {
                startDate: startOfLastMonth.toISOString().split('T')[0],
                endDate: endOfLastMonth.toISOString().split('T')[0]
            },
            currentMonth: {
                startDate: startOfCurrentMonth.toISOString().split('T')[0],
                endDate: endOfCurrentMonth.toISOString().split('T')[0]
            }
        },
        recordCounts: {
            lastMonth: {
                total: lastMonthReports.length,
                validScores: lastMonthValidScores.length
            },
            currentMonth: {
                total: currentMonthReports.length,
                validScores: currentMonthValidScores.length
            }
        }
    };
}

module.exports = differenceCalculation;