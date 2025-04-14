const replenishmentQty = (productArr)=>{
    let replenishmentArr = [];
    productArr.map(elm=>{
        if(elm.RecommendedReplenishmentQty>30){
            let data={
                asin:elm.asin,
                data:elm.RecommendedReplenishmentQty
            }
            replenishmentArr.push(data);
        }
    })
    return replenishmentArr;
}

module.exports={replenishmentQty}