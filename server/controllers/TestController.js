const generateReport=require('../Services/Test/Reports.js');
const TotalSales=require('../Services/Sp_API/WeeklySales.js');
const getTemporaryCredentials=require('../utils/GenerateTemporaryCredentials.js');
const getshipment=require('../Services/Sp_API/shipment.js');
const testReport=async(req,res)=>{
    const {accessToken, marketplaceIds, baseURI}=req.body;
    if(!accessToken || !marketplaceIds || !baseURI){
        return res.status(400).json({message:"Credentials are missing"})
    }

    const report= await generateReport(accessToken,marketplaceIds,baseURI);
    if(!report){
        return res.status(408).json({message:"Report did not complete within 5 minutes"})
    }
    return res.status(200).json({message:"Report Requested! Report ID: ",
            data: report})
}

const testNormalEndpoint=async(req,res)=>{
    return res.status(200).json({message:"Normal Endpoint"})
}

const getTotalSales=async(req,res)=>{
    try {
        const temporaryCredentials=await getTemporaryCredentials("us-east-1");

        const dataToSend={
            marketplaceId:"ATVPDKIKX0DER",
            after:"2025-03-01T00:00:00Z",
            before:"2025-03-07T23:59:59Z",
            SessionToken:temporaryCredentials.SessionToken,
            AccessToken:"Atza|IwEBIPpEipI_wTzmJB8Ueu6wcjVMRvGw2Qk_uynf8T26ELJRR6IkTZVFyA7ioyxBf6SOTZNReLxVU1iTBC406CGgbP860LiEEkehgkj6ufLYnY6ufEeGgUD3sxovj0rEdgQ0VYJsbFijwmNMjO6ZK0WHH_cugtN8LkXC9Z7_n74ioDuDsbTBnwiGnd_JRPXcy6IMDCxPDkL7M53nPPhoxhXysBsTCKs_A6xO-xVDKy8kBOzqLN_lypfzPrBfeVzjS-tpl9N4Kj8n_0GuEgUUV-IAPeGocLcknyJ2gL3_8w_URodBlcO3j2Y3jHjm1916cnAPjfZ0kO3YvWYk3Eb2GjkV7Rvl9MD-4aUn9KKgEmd5-H2jnQ"
        }
        const result=await getshipment(dataToSend,"67e2fa4a782037804651ddd3","sellingpartnerapi-na.amazon.com","US","NA");
        //dataToSend,"67e2fa4a782037804651ddd3","sellingpartnerapi-na.amazon.com","US","NA"

        return res.status(200).json({
            data: result})

    } catch (error) {
        throw new Error(error)
    }
}

module.exports={testReport,getTotalSales}