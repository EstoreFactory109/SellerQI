const AccountHistory = require('../../models/user-auth/AccountHistory.js')
const dbConnect = require('../../config/dbConn.js')

const addAccountHistory = async(userId,country,region,HealthScore,TotalProducts,ProductsWithIssues,TotalNumberOfIssues)=>{

    await dbConnect();

    const getAccountHistory=await AccountHistory.findOne({User:userId,country:country,region:region});
    const today = new Date();

    if(!getAccountHistory){
        // Create expiry date without mutating today
        const expireDate = new Date();
        expireDate.setDate(expireDate.getDate() + 7);
        
        const createAccountHistory=await AccountHistory.create({
            User:userId,
            country:country,
            region:region,
            accountHistory:[{
                Date:today,
                HealthScore:HealthScore,
                TotalProducts:TotalProducts,
                ProductsWithIssues:ProductsWithIssues,
                TotalNumberOfIssues:TotalNumberOfIssues,
                expireDate:expireDate
            }]
        });
    
        if(!createAccountHistory){
            throw new Error("Error in creating account history");
        }
    
        return createAccountHistory.accountHistory;
    }

    
    const getAccountHistoryExpireDate = getAccountHistory.accountHistory[getAccountHistory.accountHistory.length - 1].expireDate;

    const ExpireDate = new Date(getAccountHistoryExpireDate);

    if(today > ExpireDate){
        // Create expiry date without mutating today
        const expireDate = new Date();
        expireDate.setDate(expireDate.getDate() + 7);
        
        const newHistory = {
            Date:today,
            HealthScore:HealthScore,
            TotalProducts:TotalProducts,
            ProductsWithIssues:ProductsWithIssues,
            TotalNumberOfIssues:TotalNumberOfIssues,
            expireDate: expireDate
        }

        getAccountHistory.accountHistory.push(newHistory);

        await getAccountHistory.save();

        return getAccountHistory;
    }

    return getAccountHistory;
}



module.exports = {addAccountHistory}