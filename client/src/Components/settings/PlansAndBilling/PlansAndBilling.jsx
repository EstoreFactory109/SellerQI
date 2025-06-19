import React, { useState, useEffect } from 'react';
import { Download } from 'lucide-react';
import stripeService from '../../../services/stripeService.js';
import BeatLoader from 'react-spinners/BeatLoader';

const PlansAndBilling = () => {
  const [subscriptionData, setSubscriptionData] = useState(null);
  const [billingHistory, setBillingHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [error, setError] = useState(null);

  // Plan configurations
  const planConfigs = {
    LITE: {
      name: 'LITE',
      price: '$0',
      displayPrice: 'Free',
      description: 'Perfect for new Amazon sellers who want a quick health check.',
      features: [
        'Product Audit Summary'
      ],
      excludedFeatures: [
        'Download Reports',
        'Fix Recommendations',
        'Expert Consultation',
        'Track Multiple Products',
        'Issue Breakdown'
      ]
    },
    PRO: {
      name: 'PRO',
      price: '$99',
      displayPrice: '$99',
      description: 'Recommended for serious sellers who want full visibility, fixes, and growth.',
      isRecommended: true,
      features: [
        'Product Audit Summary',
        'Download Reports',
        'Fix Recommendations',
        'Expert Consultation',
        'Track Multiple Products',
        'Issue Breakdown'
      ]
    },
    AGENCY: {
      name: 'AGENCY',
      price: '$49',
      displayPrice: '$49',
      description: 'Great for first time audits or early stage sellers.',
      features: [
        'Product Audit Summary',
        'Download Reports',
        'Fix Recommendations',
        'Expert Consultation',
        'Track Multiple Products',
        'Issue Breakdown',
        'Minimum 5 Accounts'
      ]
    }
  };

  useEffect(() => {
    fetchSubscriptionData();
    fetchBillingHistory();
  }, []);

  const fetchSubscriptionData = async () => {
    try {
      setLoading(true);
      const response = await stripeService.getSubscriptionStatus();
      
      if (response) {
        const planType = response.plan || 'LITE';
        const planConfig = planConfigs[planType] || planConfigs.LITE;
        
        setSubscriptionData({
          currentPlan: planConfig.name,
          planType: planType,
          billingCycle: response.stripeData?.id ? 'Monthly' : 'N/A',
          nextBillingDate: response.currentPeriodEnd 
            ? new Date(response.currentPeriodEnd).toLocaleDateString() 
            : 'N/A',
          amount: planType === 'LITE' ? 'Free' : `${planConfig.displayPrice}/month`,
          status: response.status === 'active' ? 'Active' : 
                  response.status === 'trialing' ? 'Trial' :
                  response.status === 'canceled' ? 'Canceled' : 'Inactive',
          features: planConfig.features,
          cancelAtPeriodEnd: response.cancelAtPeriodEnd || false,
          hasSubscription: response.hasSubscription || false
        });
      }
    } catch (error) {
      console.error('Error fetching subscription data:', error);
      setError('Failed to load subscription data');
    } finally {
      setLoading(false);
    }
  };

  const fetchBillingHistory = async () => {
    try {
      setInvoicesLoading(true);
      const invoices = await stripeService.getInvoices(10);
      
      if (invoices && invoices.data) {
        const formattedInvoices = invoices.data.map(invoice => ({
          date: new Date(invoice.created * 1000).toLocaleDateString(),
          time: new Date(invoice.created * 1000).toLocaleTimeString(),
          amount: `$${(invoice.amount_paid / 100).toFixed(2)}`,
          status: invoice.status === 'paid' ? 'Paid' : 
                   invoice.status === 'open' ? 'Pending' : 
                   invoice.status === 'draft' ? 'Draft' : 'Failed',
          invoiceNumber: invoice.number || invoice.id,
          invoiceUrl: invoice.hosted_invoice_url,
          downloadUrl: invoice.invoice_pdf
        }));
        setBillingHistory(formattedInvoices);
      }
    } catch (error) {
      console.error('Error fetching billing history:', error);
      // Don't set error for billing history, just log it
    } finally {
      setInvoicesLoading(false);
    }
  };

  const handleDownload = (invoice) => {
    if (invoice.downloadUrl) {
      window.open(invoice.downloadUrl, '_blank');
    } else if (invoice.invoiceUrl) {
      window.open(invoice.invoiceUrl, '_blank');
    } else {
      console.log(`Downloading invoice: ${invoice.invoiceNumber}`);
      // Fallback for invoices without direct download links
    }
  };

  const handleUpgrade = async (planType) => {
    try {
      setError(null);
      if (planType === 'LITE') {
        const response = await stripeService.createCheckoutSession('LITE');
        if (response.url) {
          window.location.href = response.url;
        }
      } else {
        const response = await stripeService.createCheckoutSession(planType);
        if (response.url) {
          window.location.href = response.url;
        }
      }
    } catch (error) {
      console.error('Error creating checkout session:', error);
      setError('Failed to initiate upgrade process. Please try again.');
    }
  };

  const handleManageBilling = async () => {
    try {
      setError(null);
      const response = await stripeService.createPortalSession();
      if (response.url) {
        window.open(response.url, '_blank');
      }
    } catch (error) {
      console.error('Error opening billing portal:', error);
      setError('Failed to open billing portal. Please try again.');
    }
  };

  const handleCancelSubscription = async () => {
    if (!window.confirm('Are you sure you want to cancel your subscription? It will remain active until the end of your current billing period.')) {
      return;
    }

    try {
      setError(null);
      setLoading(true);
      await stripeService.cancelSubscription();
      await fetchSubscriptionData(); // Refresh data
    } catch (error) {
      console.error('Error canceling subscription:', error);
      setError('Failed to cancel subscription. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleReactivateSubscription = async () => {
    try {
      setError(null);
      setLoading(true);
      await stripeService.reactivateSubscription();
      await fetchSubscriptionData(); // Refresh data
    } catch (error) {
      console.error('Error reactivating subscription:', error);
      setError('Failed to reactivate subscription. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <BeatLoader color="#333651" size={10} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-md p-4">
        <div className="text-red-800">
          <h3 className="text-lg font-medium">Error</h3>
          <p className="mt-2">{error}</p>
          <button 
            onClick={() => {
              setError(null);
              fetchSubscriptionData();
              fetchBillingHistory();
            }}
            className="mt-3 bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700 transition"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Current Subscription Section */}
      <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-[#333651]">Current Subscription</h2>
          <div className="flex gap-2">
            {subscriptionData?.hasSubscription && (
              <button
                onClick={handleManageBilling}
                className="bg-gray-100 text-[#333651] px-4 py-2 rounded-md hover:bg-gray-200 transition"
              >
                Manage Billing
              </button>
            )}
            <button
              onClick={() => {
                fetchSubscriptionData();
                fetchBillingHistory();
              }}
              className="bg-gray-100 text-[#333651] px-3 py-2 rounded-md hover:bg-gray-200 transition"
              title="Refresh"
            >
              🔄
            </button>
          </div>
        </div>
        
        {subscriptionData && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <p className="text-sm text-gray-500">Plan</p>
                <p className="text-lg font-medium text-[#333651]">{subscriptionData.currentPlan}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Billing Cycle</p>
                <p className="text-lg font-medium text-[#333651]">{subscriptionData.billingCycle}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Next Billing Date</p>
                <p className="text-lg font-medium text-[#333651]">{subscriptionData.nextBillingDate}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Amount</p>
                <p className="text-lg font-medium text-[#333651]">{subscriptionData.amount}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Status</p>
                <p className={`text-lg font-medium ${
                  subscriptionData.status === 'Active' ? 'text-[#05724e]' : 
                  subscriptionData.status === 'Trial' ? 'text-blue-600' :
                  'text-red-600'
                }`}>
                  {subscriptionData.status}
                </p>
              </div>
            </div>

            {/* Subscription Actions */}
            {subscriptionData.hasSubscription && subscriptionData.planType !== 'LITE' && (
              <div className="mt-6 flex gap-3 flex-wrap">
                {subscriptionData.cancelAtPeriodEnd ? (
                  <button
                    onClick={handleReactivateSubscription}
                    className="bg-[#05724e] text-white px-4 py-2 rounded-md hover:bg-[#046039] transition"
                    disabled={loading}
                  >
                    {loading ? <BeatLoader color="#fff" size={6} /> : 'Reactivate Subscription'}
                  </button>
                ) : (
                  <button
                    onClick={handleCancelSubscription}
                    className="bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700 transition"
                    disabled={loading}
                  >
                    {loading ? <BeatLoader color="#fff" size={6} /> : 'Cancel Subscription'}
                  </button>
                )}
              </div>
            )}

            {subscriptionData.cancelAtPeriodEnd && (
              <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-md">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-yellow-800 font-medium">Subscription Scheduled for Cancellation</p>
                    <p className="text-yellow-700 text-sm mt-1">
                      Your subscription will cancel at the end of the current billing period ({subscriptionData.nextBillingDate}).
                      You'll continue to have access to all features until then.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        
        {!subscriptionData && !loading && (
          <div className="text-center py-8">
            <p className="text-gray-500 mb-4">No subscription information available</p>
            <button
              onClick={() => {
                fetchSubscriptionData();
                fetchBillingHistory();
              }}
              className="bg-[#333651] text-white px-4 py-2 rounded-md hover:bg-[#2a2d42] transition"
            >
              Retry Loading
            </button>
          </div>
        )}
      </div>

      {/* Plan Features Section */}
      {subscriptionData && (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <h2 className="text-xl font-semibold text-[#333651] mb-4">Plan Features</h2>
          <ul className="space-y-3">
            {subscriptionData.features.map((feature, index) => (
              <li key={index} className="flex items-center text-gray-700">
                <svg className="w-5 h-5 text-[#05724e] mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                </svg>
                {feature}
              </li>
            ))}
          </ul>
        </div>
      )}

             {/* Available Plans Section */}
       <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
         <h2 className="text-xl font-semibold text-[#333651] mb-4">Available Plans</h2>
         <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
           {Object.entries(planConfigs).map(([planType, config]) => {
             const isCurrentPlan = subscriptionData?.planType === planType;
             const isRecommended = config.isRecommended;
             
             return (
               <div 
                 key={planType}
                 className={`border rounded-lg p-6 hover:shadow-md transition ${
                   isRecommended ? 'border-2 border-[#333651] relative' : 'border border-gray-200'
                 }`}
               >
                 {isRecommended && (
                   <div className="absolute top-0 right-0 bg-[#05724e] text-white px-3 py-1 text-sm rounded-bl-lg">
                     Recommended
                   </div>
                 )}
                 
                 <h3 className="text-lg font-semibold text-[#333651] mb-2">{config.name}</h3>
                 <p className="text-3xl font-bold text-[#333651] mb-2">
                   {config.displayPrice}
                   {planType !== 'LITE' && <span className="text-sm text-gray-500">/month</span>}
                 </p>
                 <p className="text-sm text-gray-500 mb-4">{config.description}</p>
                 
                 <ul className="space-y-2 mb-6">
                   {config.features.map((feature, index) => (
                     <li key={index} className="flex items-center text-gray-700">
                       <svg className="w-5 h-5 text-[#05724e] mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                       </svg>
                       {feature}
                     </li>
                   ))}
                   {config.excludedFeatures && config.excludedFeatures.map((feature, index) => (
                     <li key={`excluded-${index}`} className="flex items-center text-gray-400">
                       <svg className="w-5 h-5 text-red-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                       </svg>
                       {feature}
                     </li>
                   ))}
                 </ul>
                 
                 <button
                   onClick={() => handleUpgrade(planType)}
                   disabled={isCurrentPlan}
                   className={`w-full py-2 px-4 rounded-md transition ${
                     isCurrentPlan
                       ? 'bg-gray-100 text-gray-500 cursor-not-allowed'
                       : isRecommended
                       ? 'bg-[#333651] text-white hover:bg-[#2a2d42]'
                       : 'bg-gray-100 text-[#333651] hover:bg-gray-200'
                   }`}
                 >
                   {isCurrentPlan ? 'Current Plan' : 'Subscribe'}
                 </button>
               </div>
             );
           })}
         </div>
       </div>

      {/* Billing History Section */}
      <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
        <h2 className="text-xl font-semibold text-[#333651] mb-4">Billing History</h2>
        
        {invoicesLoading ? (
          <div className="flex items-center justify-center h-32">
            <BeatLoader color="#333651" size={8} />
          </div>
        ) : billingHistory.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date & Time</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Invoice</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {billingHistory.map((invoice, index) => (
                  <tr key={index}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-[#333651]">
                      <div>{invoice.date}</div>
                      <div className="text-gray-500">{invoice.time}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-[#333651]">{invoice.amount}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        invoice.status === 'Paid' 
                          ? 'bg-[#edfef0] text-[#05724e]'
                          : invoice.status === 'Pending'
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {invoice.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <button 
                        onClick={() => handleDownload(invoice)}
                        className="flex items-center gap-2 text-[#333651] hover:text-[#2a2d42] transition"
                      >
                        <Download className="w-4 h-4" />
                        <span>Download</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-8">
            <p className="text-gray-500">No billing history available</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default PlansAndBilling; 