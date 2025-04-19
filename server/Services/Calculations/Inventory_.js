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

module.exports={replenishmentQty}