const calculateAccountHealthPercentage=(data)=>{
    // Return default result if data is empty or doesn't have ahrScore
    if (!data || Object.keys(data).length === 0 || (data.ahrScore === undefined || data.ahrScore === null)) {
        return {
            status: "Data Not Available",
            Percentage: 0
        };
    }

    let status="";
    let percentage=0;

    const ahrScore = data?.ahrScore || 0;

    if(ahrScore>=800){
        status="Healthy";
        percentage=100;
    }else if(ahrScore<=800 && ahrScore>=200){
        status="Healthy";
        percentage=80;
    }
    else if(ahrScore<=199 && ahrScore>=100){
        status="At Risk";
        percentage=50;
    }else{
        status="Unhealthy";
        percentage=30;
    }
    return{
        status:status,
        Percentage:percentage
    }
}



const checkAccountHealth=(v2Data,v1Data)=>{

    console.log("v2Data: ",v2Data)
  
    // Return empty result if both v2Data and v1Data are empty
    const v2DataHasEmptyFields = v2Data && (
        v2Data==null ||
        v2Data.accountStatuses?.length === 0 ||
        v2Data.listingPolicyViolations?.length === 0 ||
        v2Data.validTrackingRateStatus?.length === 0 ||
        v2Data.orderWithDefectsStatus?.length === 0 ||
        v2Data.lateShipmentRateStatus?.length === 0 ||
        v2Data.CancellationRate?.length === 0
    );
    
    const v1DataHasEmptyCounts = v1Data && (
        v1Data.negativeFeedbacks?.count.length === 0 ||
        v1Data.lateShipmentCount?.count.length === 0 ||
        v1Data.preFulfillmentCancellationCount?.count.length === 0 ||
        v1Data.refundsCount?.count.length === 0 ||
        v1Data.a_z_claims?.count.length === 0 ||
        v1Data.responseUnder24HoursCount.length === 0
    );

 
    
    if ((!v2Data || Object.keys(v2Data).length === 0 || v2DataHasEmptyFields) && (!v1Data || Object.keys(v1Data).length === 0 || v1DataHasEmptyCounts)) {
        return {};
    }

    //All V2 checks

    //account status
    let errorCounter=0;
    let result={}

    if(v2Data?.accountStatuses!=='NORMAL'){
        errorCounter++;
        result.accountStatus={
            status:"Error",
            Message:"Your account status is not in normal standing. This can impact your ability to sell, restrict your listings, or even lead to account suspension if not addressed promptly.",
            HowTOSolve:"Check your Account Health Dashboard in Seller Central to identify any performance issues, policy violations, or pending actions. Address any flagged concerns, such as order defect rate (ODR), late shipments, or intellectual property complaints. If action is required, respond promptly to Amazon’s notifications and provide necessary documentation to resolve the issue."
        }
    }else{
        result.accountStatus={
            status:"Success",
            Message:"Your account is in good standing! Maintaining a healthy account status helps ensure uninterrupted selling and long-term success on Amazon.",
            HowTOSolve:""
        } 
    }

    //policy violations
    if(v2Data?.listingPolicyViolations!=='GOOD'){
        errorCounter++;
        result.PolicyViolations={
            status:"Error",
            Message:"Amazon has issued a listing policy violation notification for one or more of your products. Ignoring this could lead to listing suppression, restricted selling privileges, or account suspension.",
            HowTOSolve:"Amazon has issued a listing policy violation notification for one or more of your products. Ignoring this could lead to listing suppression, restricted selling privileges, or account suspension."
        }
    }else{
        result.PolicyViolations={
            status:"Success",
            Message:"Excellent! You have no listing policy violations, ensuring your products remain active and compliant with Amazon’s marketplace guidelines.",
            HowTOSolve:""
        }
    }
    //valid tracking rate
    if(v2Data?.validTrackingRateStatus!=='GOOD'){
        errorCounter++;
        result.validTrackingRateStatus={
            status:"Error",
            Message:"Your Valid Tracking Rate (VTR) is below Amazon's required threshold. A low VTR can result in warnings, restrictions on self-fulfilled shipping methods, and a negative impact on your seller performance metrics.",
            HowTOSolve:"Ensure that every order you fulfill includes valid tracking information from an Amazon-approved carrier. Double-check that tracking numbers are correctly entered and active. Use Amazon’s Buy Shipping service to automatically provide valid tracking. Regularly monitor your VTR in Account Health and take corrective actions if discrepancies arise."
        }
    }else{
        result.validTrackingRateStatus={
            status:"Success",
            Message:"Great job! Your Valid Tracking Rate is in good standing, helping you maintain strong seller performance and ensuring a smooth shipping experience for customers.",
            HowTOSolve:""
        }
    }
    //order defect rate
    if(v2Data?.orderWithDefectsStatus!=='GOOD'){
        errorCounter++;
        result.orderWithDefectsStatus={
            status:"Error",
            Message:"Your Order Defect Rate (ODR) is above Amazon's acceptable threshold. A high ODR can lead to listing deactivation, loss of Buy Box eligibility, or even account suspension if not addressed.",
            HowTOSolve:"Analyze the root causes of defects, such as negative feedback, A-to-Z claims, or chargebacks. Address customer complaints promptly, improve product quality, and ensure accurate product descriptions to set the right expectations. If you receive unjustified negative feedback, request Amazon to remove it. Maintain excellent customer service and fulfillment reliability to lower your ODR over time."
        }
    }else{
        result.orderWithDefectsStatus={
            status:"Success",
            Message:"Great job! Your Order Defect Rate is within Amazon's acceptable range, ensuring better account health and maintaining strong seller performance.",
            HowTOSolve:""
        }
    }

    //Late Shipment rate

    if(v2Data?.lateShipmentRateStatus!=='GOOD'){
        errorCounter++;
        result.lateShipmentRateStatus={
            status:"Error",
            Message:"Your Late Shipment Rate (LSR) is above Amazon’s acceptable threshold. A high LSR can lead to restrictions on your ability to offer seller-fulfilled shipping options and negatively impact your account health.",
            HowTOSolve:"Ensure all orders are shipped on or before the expected ship date. Use Amazon’s Buy Shipping service to access reliable carriers and ensure accurate tracking. Optimize your fulfillment process by improving warehouse efficiency, updating handling times accurately, and using faster shipping methods when necessary. Monitor your shipping performance regularly in Account Health and adjust logistics strategies accordingly."
        }
    }else{
        result.lateShipmentRateStatus={
            status:"Success",
            Message:"Great job! Your Late Shipment Rate is within Amazon’s acceptable range, ensuring smooth order fulfillment and a strong seller performance record.",
            HowTOSolve:""
        }
    }

    //cancellation rate

    if(v2Data?.CancellationRate!=='GOOD'){
        errorCounter++;
        result.CancellationRate={
            status:"Error",
            Message:"Some customer messages have not been responded to within 24 hours. Delayed responses can negatively impact your seller metrics, customer satisfaction, and account health.",
            HowTOSolve:"Ensure that all customer inquiries are responded to within 24 hours, including weekends and holidays. Use Amazon’s Buyer-Seller Messaging Service to track and manage messages efficiently. Set up automated responses acknowledging inquiries and follow up with a detailed reply as soon as possible. If needed, consider using a virtual assistant or customer support software to handle messages faster."
        }
    }else{
        result.CancellationRate={
            status:"Success",
            Message:"Great job! You are responding to customer messages within 24 hours, maintaining high customer satisfaction and a strong seller performance record.",
            HowTOSolve:""
        }
    }
    
    //all v1 checks

    if(Number(v1Data?.negativeFeedbacks?.count || 0)>0){
        errorCounter++;
        result.negativeFeedbacks={
            status:"Error",
            Message:"Your account has received negative seller feedback. This can affect your seller rating, Buy Box eligibility, and customer trust, potentially impacting sales.",
            HowTOSolve:"Review the negative feedback in Seller Central and identify common issues. If the feedback is related to fulfillment by Amazon (FBA), you may request Amazon to remove it. For valid complaints, reach out to the customer to resolve their concerns professionally. Improving response time, order accuracy, and customer service can help prevent future negative feedback."
        }
    }else{
        result.negativeFeedbacks={}
    }


    const NCX=Number(v1Data?.lateShipmentCount?.count || 0)+Number(v1Data?.preFulfillmentCancellationCount?.count || 0)+Number(v1Data?.refundsCount?.count || 0);
    if(NCX>0){
        errorCounter++;
        result.NCX={
            status:"Error",
            Message:"Your NCX (Negative Customer Experience) score is above 0. A high NCX rate can lead to suppressed listings, reduced visibility, and a decline in customer trust, potentially impacting sales and account health.",
            HowTOSolve:"Analyze the root causes of negative customer experiences through Seller Central. Identify common complaints related to product quality, description accuracy, late shipments, or customer service issues. Address these concerns by improving product listings, ensuring accurate descriptions, enhancing quality control, and optimizing fulfillment processes. Take proactive measures such as responding to negative feedback and improving post-purchase support."
        }
    }else{
        result.NCX={}
    }

    if(Number(v1Data?.a_z_claims?.count || 0)!=0){
        errorCounter++;
        result.a_z_claims={
            status:"Error",
            Message:"An A-to-Z Guarantee Claim has been filed against your order. Unresolved claims can negatively impact your Order Defect Rate (ODR) and may lead to account restrictions if frequent claims occur.",
            HowTOSolve:"Review the claim details in Seller Central > Performance > A-to-Z Guarantee Claims. If the claim is valid, work with the customer to resolve the issue promptly by issuing a refund or replacement. If you believe the claim is unjustified, submit an appeal with supporting evidence, such as tracking details, delivery confirmation, or proof of product quality. Prevent future claims by improving order accuracy, shipping reliability, and customer communication."
        }
    }else{
        result.a_z_claims={}
    }
    
    if(Number(v1Data?.responseUnder24HoursCount || 0)!=0){
        errorCounter++;
        result.responseUnder24HoursCount={
            status:"Error",
            Message:"Some customer messages have not been responded to within 24 hours. Delayed responses can negatively impact your seller metrics, customer satisfaction, and account health.",
            HowTOSolve:"Ensure that all customer inquiries are responded to within 24 hours, including weekends and holidays. Use Amazon’s Buyer-Seller Messaging Service to track and manage messages efficiently. Set up automated responses acknowledging inquiries and follow up with a detailed reply as soon as possible. If needed, consider using a virtual assistant or customer support software to handle messages faster."
        }
    }else{
        result.responseUnder24HoursCount={}
    }

    result.TotalErrors=errorCounter;

 
    return result;
}

module.exports={calculateAccountHealthPercentage,checkAccountHealth}