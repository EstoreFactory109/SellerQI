const {
    toDailySeries,
    judgeMetric,
    nearCutoff,
    formatDays,
    humanizeStatus,
    AHR_AT_RISK_CUTOFF,
} = require('./AccountHealthHistory.js');

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



/**
 * The six statuses read from Amazon's V2 Seller Performance report. Each check is
 * judged over the last days of reports when a history is passed (see
 * AccountHealthHistory), otherwise on the newest report alone, as before.
 */
const V2_CHECKS = [
    {
        key: 'accountStatus',
        field: 'accountStatuses',
        name: 'account status',
        errorMessage: "Your account status is not in normal standing. This can impact your ability to sell, restrict your listings, or even lead to account suspension if not addressed promptly.",
        howToSolve: "Check your Account Health Dashboard in Seller Central to identify any performance issues, policy violations, or pending actions. Address any flagged concerns, such as order defect rate (ODR), late shipments, or intellectual property complaints. If action is required, respond promptly to Amazon’s notifications and provide necessary documentation to resolve the issue.",
        successMessage: "Your account is in good standing! Maintaining a healthy account status helps ensure uninterrupted selling and long-term success on Amazon.",
    },
    {
        key: 'PolicyViolations',
        field: 'listingPolicyViolations',
        name: 'listing policy compliance',
        errorMessage: "Amazon has issued a listing policy violation notification for one or more of your products. Ignoring this could lead to listing suppression, restricted selling privileges, or account suspension.",
        howToSolve: "Open Account Health in Seller Central and review each listing policy violation. Fix or remove the affected listings, then submit a Plan of Action for any violation that requires one. Check for intellectual property, restricted product and listing-content complaints, and respond before any stated deadline.",
        successMessage: "Excellent! You have no listing policy violations, ensuring your products remain active and compliant with Amazon’s marketplace guidelines.",
    },
    {
        key: 'validTrackingRateStatus',
        field: 'validTrackingRateStatus',
        name: 'Valid Tracking Rate',
        errorMessage: "Your Valid Tracking Rate (VTR) is below Amazon's required threshold. A low VTR can result in warnings, restrictions on self-fulfilled shipping methods, and a negative impact on your seller performance metrics.",
        howToSolve: "Ensure that every order you fulfill includes valid tracking information from an Amazon-approved carrier. Double-check that tracking numbers are correctly entered and active. Use Amazon’s Buy Shipping service to automatically provide valid tracking. Regularly monitor your VTR in Account Health and take corrective actions if discrepancies arise.",
        successMessage: "Great job! Your Valid Tracking Rate is in good standing, helping you maintain strong seller performance and ensuring a smooth shipping experience for customers.",
    },
    {
        key: 'orderWithDefectsStatus',
        field: 'orderWithDefectsStatus',
        name: 'Order Defect Rate',
        errorMessage: "Your Order Defect Rate (ODR) is above Amazon's acceptable threshold. A high ODR can lead to listing deactivation, loss of Buy Box eligibility, or even account suspension if not addressed.",
        howToSolve: "Analyze the root causes of defects, such as negative feedback, A-to-Z claims, or chargebacks. Address customer complaints promptly, improve product quality, and ensure accurate product descriptions to set the right expectations. If you receive unjustified negative feedback, request Amazon to remove it. Maintain excellent customer service and fulfillment reliability to lower your ODR over time.",
        successMessage: "Great job! Your Order Defect Rate is within Amazon's acceptable range, ensuring better account health and maintaining strong seller performance.",
    },
    {
        key: 'lateShipmentRateStatus',
        field: 'lateShipmentRateStatus',
        name: 'Late Shipment Rate',
        errorMessage: "Your Late Shipment Rate (LSR) is above Amazon’s acceptable threshold. A high LSR can lead to restrictions on your ability to offer seller-fulfilled shipping options and negatively impact your account health.",
        howToSolve: "Ensure all orders are shipped on or before the expected ship date. Use Amazon’s Buy Shipping service to access reliable carriers and ensure accurate tracking. Optimize your fulfillment process by improving warehouse efficiency, updating handling times accurately, and using faster shipping methods when necessary. Monitor your shipping performance regularly in Account Health and adjust logistics strategies accordingly.",
        successMessage: "Great job! Your Late Shipment Rate is within Amazon’s acceptable range, ensuring smooth order fulfillment and a strong seller performance record.",
    },
    {
        key: 'CancellationRate',
        field: 'CancellationRate',
        name: 'Cancellation Rate',
        // This used to carry the 24-hour message-response copy, which belongs to
        // responseUnder24HoursCount below.
        errorMessage: "Your pre-fulfillment Cancellation Rate is above Amazon's acceptable threshold (2.5%). A high cancellation rate can restrict your ability to sell seller-fulfilled orders and hurts your account health.",
        howToSolve: "Keep inventory counts accurate so you never sell stock you don't have: sync quantities across every sales channel, and set realistic handling times. Review recent seller-cancelled orders in Seller Central to find the cause (out of stock, pricing errors, address issues) and fix it at the source.",
        successMessage: "Great job! Your Cancellation Rate is within Amazon's acceptable range, keeping your seller-fulfilled selling privileges secure.",
    },
];

const V2_FIELDS = V2_CHECKS.map((c) => c.field);

const hasV2Data = (v2Data) =>
    !!v2Data && typeof v2Data === 'object'
    && V2_FIELDS.some((f) => typeof v2Data[f] === 'string' && v2Data[f].trim() !== '' && v2Data[f].trim().toUpperCase() !== 'NONE');

const hasV1Data = (v1Data) => !!v1Data && typeof v1Data === 'object' && Object.keys(v1Data).length > 0;

/**
 * Wording for a status that keeps slipping: which days, what it is today, and — for
 * account status — how close the rating sits to Amazon's At Risk cutoff.
 */
const warningMessage = (check, judged, ahrScore) => {
    const days = judged.badDays.length;
    const values = [...new Set(Object.values(judged.badValues))].map(humanizeStatus).join(' / ');
    const subject = check.key === 'accountStatus' ? 'your account' : `your ${check.name}`;
    let text = `Amazon flagged ${subject} ${values} on ${days} of the last ${judged.daysJudged} daily reports (${formatDays(judged.badDays)}).`;
    text += judged.latestGood
        ? ` It's ${humanizeStatus(judged.latest)} today, but it keeps slipping.`
        : ` It's ${humanizeStatus(judged.latest)} today.`;
    if (check.key === 'accountStatus' && nearCutoff(ahrScore)) {
        const gap = Number(ahrScore) - AHR_AT_RISK_CUTOFF;
        text += ` Your Account Health Rating is ${ahrScore} — just ${gap} ${gap === 1 ? 'point' : 'points'} above the ${AHR_AT_RISK_CUTOFF} cutoff`;
        text += judged.latestGood ? ', so it can tip back at any time.' : '.';
    }
    return text;
};

/**
 * One V2 check's result, in the shape every reader already expects
 * ({status, Message, HowTOSolve}), plus `level` ('error' | 'warning' | 'ok') and,
 * when judged over history, the days Amazon reported a problem.
 */
const judgeV2Check = (check, v2Data, series) => {
    const judged = series && series.length >= 2
        ? judgeMetric(series, check.field)
        : judgeMetric(series && series.length === 1 ? series : (v2Data ? [{ day: null, doc: v2Data }] : []), check.field);

    if (judged.level === 'none') return null;
    // Report days (newest first) and which of them were bad, for the 7-day strip on
    // the Account Health page. Only when there is a history to show.
    const history = judged.daysJudged >= 2
        ? { days: judged.days, badDays: judged.badDays, daysJudged: judged.daysJudged }
        : {};

    if (judged.level === 'error') {
        const sustained = judged.consecutiveBad >= 2
            ? ` Amazon has reported this for ${judged.consecutiveBad} days in a row.`
            : '';
        return { status: 'Error', level: 'error', Message: check.errorMessage + sustained, HowTOSolve: check.howToSolve, ...history };
    }
    if (judged.level === 'warning') {
        return {
            status: 'Error',
            level: 'warning',
            Message: judged.daysJudged >= 2
                ? warningMessage(check, judged, v2Data?.ahrScore)
                : `Amazon rates your ${check.name} ${humanizeStatus(judged.latest)} — below Good. Act now before it slips further.`,
            HowTOSolve: check.howToSolve,
            ...history,
        };
    }
    return { status: 'Success', level: 'ok', Message: check.successMessage, HowTOSolve: '', ...history };
};

/**
 * @param {Object|null} v2Data - newest V2 Seller Performance report
 * @param {Object|null} v1Data - newest V1 report
 * @param {Array|null} [v2History] - V2 reports from the last days (any order). With
 *   2+ distinct days, each V2 status is judged over them; otherwise on v2Data alone.
 */
const checkAccountHealth=(v2Data,v1Data,v2History=null)=>{
    // Each side is judged on its own: a missing V2 report must not turn every V2
    // status into an error (undefined !== 'NORMAL'), and must not stop V1 checks.
    if (!hasV2Data(v2Data) && !hasV1Data(v1Data)) {
        return {};
    }

    let errorCounter=0;
    let result={}

    const series = Array.isArray(v2History) && v2History.length > 0 ? toDailySeries(v2History) : null;
    if (hasV2Data(v2Data) || (series && series.length > 0)) {
        for (const check of V2_CHECKS) {
            const judged = judgeV2Check(check, v2Data, series);
            // No value for this status in any report: no data, not an error.
            if (!judged) continue;
            if (judged.status === 'Error') errorCounter++;
            result[check.key] = judged;
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

module.exports={calculateAccountHealthPercentage,checkAccountHealth,V2_CHECKS}