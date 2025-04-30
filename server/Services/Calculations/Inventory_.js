const replenishmentQty = (productArr)=>{
    let replenishmentArr = [];
    productArr.map(elm=>{
        if(elm.RecommendedReplenishmentQty>30){
            let data={
                asin:elm.asin,
                data:elm.RecommendedReplenishmentQty,
                status:"Success",
                Message:"Great job maintaining healthy inventory levels! Keeping your inventory well-stocked ensures that you can continuously meet customer demand and sustain your sales momentum on Amazon.",
                HowToSolve:""
            }
            replenishmentArr.push(data);
        }else{
            let data={
                asin:elm.asin,
                data:elm.RecommendedReplenishmentQty,
                status:"Error",
                Message:"Your inventory levels for specific products are low, which risks stockouts that could lead to missed sales opportunities and potential damage to your ranking and Buy Box eligibility.",
                HowToSolve:"Act quickly to replenish your inventory. Analyze your sales data to forecast demand more accurately and plan your inventory levels accordingly. Consider setting up automatic restocking alerts in Amazon Seller Central to maintain optimal inventory levels and prevent future stockouts. Evaluate your supply chain for any bottlenecks and seek to improve efficiency in areas like manufacturing lead times and shipping."
            }
            replenishmentArr.push(data);
        }
    })
    return replenishmentArr;
}

const inventoryPlanningData=(data)=>{
    let longTermStorageFees={};
    const Total=Number(data.quantity_to_be_charged_ais_181_210_days)+Number(data.quantity_to_be_charged_ais_211_240_days)+Number(data.quantity_to_be_charged_ais_241_270_days)+Number(data.quantity_to_be_charged_ais_271_300_days)+Number(data.quantity_to_be_charged_ais_301_330_days)+Number(data.quantity_to_be_charged_ais_331_365_days)+Number(data.quantity_to_be_charged_ais_365_plus_days);

    if(Total!==0){
        longTermStorageFees.status="Error";
        longTermStorageFees.Message="Your inventory has been stored in FBA for a long period, making it eligible for Long-Term Storage Fees (LTSF). These fees can significantly increase your operating costs, reducing profit margins.";
        longTermStorageFees.HowToSolve="Review your inventory levels and sales velocity to identify slow-moving or stagnant stock. Consider running promotions or lowering prices to increase sales and reduce inventory levels. Alternatively, remove excess inventory from FBA to avoid additional LTSF. Strategically plan your inventory replenishment based on demand forecasts to prevent future stock from becoming eligible for LTSF.";
    }else{
        longTermStorageFees.status="Success";
        longTermStorageFees.Message="Great job managing your FBA inventory efficiently! Keeping your inventory levels optimized helps avoid Long-Term Storage Fees and maximizes your profitability." ;
        longTermStorageFees.HowToSolve="";
    }
    
    let unfulfillable={}

    if(Number(data.unfulfillable_quantity)>0){
        unfulfillable.status="Error";
        unfulfillable.Message="You have unfulfillable inventory in FBA, which can tie up resources and increase operational costs due to items that cannot be sold in their current condition.";
        unfulfillable.HowToSolve="Review the details of your unfulfillable inventory through your Amazon Seller Central account to understand the reasons for its status (such as damaged, customer returns, etc.). Decide whether to have the inventory returned to you for assessment, refurbishing, or disposal. If the items are repairable or repackageable, consider doing so to move them back to fulfillable status. Implement strategies to reduce future occurrences, such as improving packaging or quality control processes.";
    }else{
        unfulfillable.status="Success";
        unfulfillable.Message="Excellent! Your FBA inventory is fully fulfillable, which maximizes your sales potential and operational efficiency. Continue to maintain high quality and packaging standards to keep your inventory in sellable condition." ;
        unfulfillable.HowToSolve="";
    }
    
    return {
        asin: data.asin,
        longTermStorageFees,
        unfulfillable
    }

}


module.exports={replenishmentQty,inventoryPlanningData}