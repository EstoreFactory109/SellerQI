const calculateTotalReimbursement = (data,products) => {

    let reimburstmentArr=[];
    let totalReimbursement=0;
    
    data.forEach((items)=>{
        const shipmentName=items.shipmentName;
        const match = shipmentName.match(/\((\d{2}\/\d{2}\/\d{4})/);
        if (match) {
            const dateStr = match[1]; // "01/18/2024"
            
            // Step 2: Convert to Date object
            const shipmentDate = new Date(dateStr);
          
            // Step 3: Get today's date
            const today = new Date();
          
            // Step 4: Add 3 months to the shipment date
            const threeMonthsLater = new Date(shipmentDate);
            threeMonthsLater.setMonth(threeMonthsLater.getMonth() + 3);
          
            // Step 5: Compare dates
            const hasThreeMonthsPassed = today >= threeMonthsLater;


          
            if(!hasThreeMonthsPassed){
                items.itemDetails.forEach(elm=>{
                    const product=products.find(product=>product.sku===elm.SellerSKU);
                    const price=product.price;
                    const asin=product.asin;
                    const reimbustment=price*(elm.QuantityShipped-elm.QuantityReceived);
                    totalReimbursement+=reimbustment;
                    reimburstmentArr.push({
                        asin:asin,
                        amount:reimbustment,
                        sku:elm.SellerSKU
                    })
                })
            }
          } 
    })

    return {
        productWiseReimburstment:reimburstmentArr,
        totalReimbursement:totalReimbursement
    };
  };

  module.exports=calculateTotalReimbursement