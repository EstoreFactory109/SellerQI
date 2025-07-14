import React, { useState, useEffect } from 'react';
import { Download, CreditCard, Check, X, RefreshCw, Crown, Zap, Star, Shield, HelpCircle } from 'lucide-react';
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
      icon: Shield,
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
      icon: Crown,
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
      icon: Zap,
      features: [
        'Product Audit Summary',
        'Download Reports',
        'Fix Recommendations',
        'Expert Consultation',
        'Track Multiple Products',
        'Issue Breakdown'
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
      <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm overflow-hidden">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <BeatLoader color="#3b82f6" size={10} />
            <p className="text-gray-600 mt-4">Loading subscription data...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm overflow-hidden">
        <div className="p-6">
          <div className="bg-red-50 border border-red-200 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center">
                <X className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-red-800">Error Loading Data</h3>
                <p className="text-red-600 text-sm mt-1">{error}</p>
              </div>
            </div>
            <button 
              onClick={() => {
                setError(null);
                fetchSubscriptionData();
                fetchBillingHistory();
              }}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
            >
              <RefreshCw className="w-4 h-4" />
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header Section */}
      <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden">
        <div className="bg-gradient-to-r from-slate-900 via-purple-900 to-slate-900 px-6 py-8 text-white relative overflow-hidden">
          <div className="absolute inset-0 opacity-20" style={{backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.05'%3E%3Ccircle cx='30' cy='30' r='2'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")"}}></div>
          <div className="relative z-10">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
              <div className="space-y-2">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-2 h-8 bg-gradient-to-b from-blue-400 to-purple-500 rounded-full"></div>
                  <div className="flex items-center gap-3">
                    <CreditCard className="w-6 h-6 text-white" />
                    <h2 className="text-2xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                      Plans & Billing
                    </h2>
                  </div>
                </div>
                <p className="text-gray-300 text-sm">Manage your subscription and billing information</p>
              </div>
              
              <div className="flex gap-3">
                {subscriptionData?.hasSubscription && (
                  <button
                    onClick={handleManageBilling}
                    className="flex items-center gap-2 px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-colors font-medium border border-white/20"
                  >
                    <CreditCard className="w-4 h-4" />
                    Manage Billing
                  </button>
                )}
                <button
                  onClick={() => {
                    fetchSubscriptionData();
                    fetchBillingHistory();
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-colors font-medium border border-white/20"
                  title="Refresh"
                >
                  <RefreshCw className="w-4 h-4" />
                  Refresh
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Current Subscription Content */}
        <div className="p-6">
          {subscriptionData ? (
            <>
              {/* Subscription Status Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-4 border border-blue-200">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center">
                      <Crown className="w-4 h-4 text-white" />
                    </div>
                    <p className="text-xs font-medium text-blue-700 uppercase tracking-wide">Plan</p>
                  </div>
                  <p className="text-xl font-bold text-blue-900">{subscriptionData.currentPlan}</p>
                </div>

                <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-4 border border-green-200">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-8 h-8 bg-green-500 rounded-lg flex items-center justify-center">
                      <RefreshCw className="w-4 h-4 text-white" />
                    </div>
                    <p className="text-xs font-medium text-green-700 uppercase tracking-wide">Billing Cycle</p>
                  </div>
                  <p className="text-xl font-bold text-green-900">{subscriptionData.billingCycle}</p>
                </div>

                <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-4 border border-purple-200">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-8 h-8 bg-purple-500 rounded-lg flex items-center justify-center">
                      <CreditCard className="w-4 h-4 text-white" />
                    </div>
                    <p className="text-xs font-medium text-purple-700 uppercase tracking-wide">Amount</p>
                  </div>
                  <p className="text-xl font-bold text-purple-900">{subscriptionData.amount}</p>
                </div>

                <div className={`bg-gradient-to-br rounded-xl p-4 border ${
                  subscriptionData.status === 'Active' 
                    ? 'from-emerald-50 to-emerald-100 border-emerald-200' 
                    : subscriptionData.status === 'Trial'
                    ? 'from-blue-50 to-blue-100 border-blue-200'
                    : 'from-red-50 to-red-100 border-red-200'
                }`}>
                  <div className="flex items-center gap-3 mb-2">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      subscriptionData.status === 'Active' 
                        ? 'bg-emerald-500' 
                        : subscriptionData.status === 'Trial'
                        ? 'bg-blue-500'
                        : 'bg-red-500'
                    }`}>
                      <Shield className="w-4 h-4 text-white" />
                    </div>
                    <p className={`text-xs font-medium uppercase tracking-wide ${
                      subscriptionData.status === 'Active' 
                        ? 'text-emerald-700' 
                        : subscriptionData.status === 'Trial'
                        ? 'text-blue-700'
                        : 'text-red-700'
                    }`}>Status</p>
                  </div>
                  <p className={`text-xl font-bold ${
                    subscriptionData.status === 'Active' 
                      ? 'text-emerald-900' 
                      : subscriptionData.status === 'Trial'
                      ? 'text-blue-900'
                      : 'text-red-900'
                  }`}>
                    {subscriptionData.status}
                  </p>
                </div>
              </div>

              {/* Next Billing Date */}
              {subscriptionData.nextBillingDate !== 'N/A' && (
                <div className="bg-gray-50 rounded-xl p-4 mb-6">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-gray-500 rounded-lg flex items-center justify-center">
                      <CreditCard className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-700">Next Billing Date</p>
                      <p className="text-lg font-bold text-gray-900">{subscriptionData.nextBillingDate}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Subscription Actions */}
              {subscriptionData.hasSubscription && subscriptionData.planType !== 'LITE' && (
                <div className="flex gap-3 flex-wrap mb-6">
                  {subscriptionData.cancelAtPeriodEnd ? (
                    <button
                      onClick={handleReactivateSubscription}
                      className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-emerald-600 to-emerald-700 text-white font-medium rounded-xl hover:from-emerald-700 hover:to-emerald-800 transition-all duration-200 shadow-lg hover:shadow-xl"
                      disabled={loading}
                    >
                      {loading ? <BeatLoader color="#fff" size={6} /> : (
                        <>
                          <Check className="w-4 h-4" />
                          Reactivate Subscription
                        </>
                      )}
                    </button>
                  ) : (
                    <button
                      onClick={handleCancelSubscription}
                      className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-red-600 to-red-700 text-white font-medium rounded-xl hover:from-red-700 hover:to-red-800 transition-all duration-200 shadow-lg hover:shadow-xl"
                      disabled={loading}
                    >
                      {loading ? <BeatLoader color="#fff" size={6} /> : (
                        <>
                          <X className="w-4 h-4" />
                          Cancel Subscription
                        </>
                      )}
                    </button>
                  )}
                </div>
              )}

              {/* Cancellation Notice */}
              {subscriptionData.cancelAtPeriodEnd && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 mb-6">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 bg-yellow-100 rounded-xl flex items-center justify-center flex-shrink-0">
                      <HelpCircle className="w-5 h-5 text-yellow-600" />
                    </div>
                    <div>
                      <h4 className="text-yellow-800 font-semibold mb-2">Subscription Scheduled for Cancellation</h4>
                      <p className="text-yellow-700 text-sm">
                        Your subscription will cancel at the end of the current billing period ({subscriptionData.nextBillingDate}).
                        You'll continue to have access to all features until then.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-12">
              <div className="w-20 h-20 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <CreditCard className="w-10 h-10 text-gray-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No subscription information available</h3>
              <button
                onClick={() => {
                  fetchSubscriptionData();
                  fetchBillingHistory();
                }}
                className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white font-medium rounded-xl hover:from-blue-700 hover:to-blue-800 transition-all duration-200 shadow-lg hover:shadow-xl mx-auto"
              >
                <RefreshCw className="w-4 h-4" />
                Retry Loading
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Plan Features Section */}
      {subscriptionData && (
        <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden">
          <div className="p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl flex items-center justify-center">
                <Star className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-gray-900">Your Plan Features</h3>
                <p className="text-sm text-gray-600">Features included in your current plan</p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {subscriptionData.features.map((feature, index) => (
                <div key={index} className="flex items-center gap-3 p-3 bg-green-50 rounded-xl border border-green-200">
                  <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0">
                    <Check className="w-4 h-4 text-white" />
                  </div>
                  <span className="text-gray-800 font-medium">{feature}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Available Plans Section */}
      <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl flex items-center justify-center">
              <Crown className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-xl font-semibold text-gray-900">Available Plans</h3>
              <p className="text-sm text-gray-600">Choose the plan that fits your business needs</p>
            </div>
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {Object.entries(planConfigs).map(([planType, config]) => {
              const isCurrentPlan = subscriptionData?.planType === planType;
              const isRecommended = config.isRecommended;
              const IconComponent = config.icon;
              
              return (
                <div 
                  key={planType}
                  className={`group relative rounded-2xl border p-6 transition-all duration-300 hover:shadow-lg ${
                    isRecommended 
                      ? 'border-2 border-blue-500 bg-gradient-to-b from-blue-50 to-white' 
                      : 'border border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  {isRecommended && (
                    <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                      <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white px-4 py-1.5 text-sm font-semibold rounded-full shadow-lg">
                        ⭐ Recommended
                      </div>
                    </div>
                  )}
                  
                  <div className="text-center mb-6">
                    <div className={`w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center ${
                      isRecommended 
                        ? 'bg-gradient-to-br from-blue-500 to-purple-600' 
                        : 'bg-gradient-to-br from-gray-500 to-gray-600'
                    }`}>
                      <IconComponent className="w-8 h-8 text-white" />
                    </div>
                    <h4 className="text-2xl font-bold text-gray-900 mb-2">{config.name}</h4>
                    <div className="mb-3">
                      <div>
                        <span className="text-4xl font-bold text-gray-900">{config.displayPrice}</span>
                        {planType !== 'LITE' && <span className="text-gray-600 text-lg">/month</span>}
                      </div>
                      {planType === 'AGENCY' && <div className="text-sm font-normal text-gray-600">(Minimum 5 Accounts)</div>}
                    </div>
                    <p className="text-gray-600 text-sm">{config.description}</p>
                  </div>
                  
                  <div className="space-y-3 mb-8">
                    {config.features.map((feature, index) => (
                      <div key={index} className="flex items-center gap-3">
                        <div className="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0">
                          <Check className="w-3 h-3 text-white" />
                        </div>
                        <span className="text-gray-700 text-sm">{feature}</span>
                      </div>
                    ))}
                    {config.excludedFeatures && config.excludedFeatures.map((feature, index) => (
                      <div key={`excluded-${index}`} className="flex items-center gap-3 opacity-50">
                        <div className="w-5 h-5 bg-red-400 rounded-full flex items-center justify-center flex-shrink-0">
                          <X className="w-3 h-3 text-white" />
                        </div>
                        <span className="text-gray-500 text-sm line-through">{feature}</span>
                      </div>
                    ))}
                  </div>
                  
                  <button
                    onClick={() => handleUpgrade(planType)}
                    disabled={isCurrentPlan}
                    className={`w-full py-3 px-4 rounded-xl font-medium transition-all duration-200 ${
                      isCurrentPlan
                        ? 'bg-gray-100 text-gray-500 cursor-not-allowed border border-gray-200'
                        : isRecommended
                        ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:from-blue-700 hover:to-purple-700 shadow-lg hover:shadow-xl'
                        : 'bg-gray-900 text-white hover:bg-gray-800 shadow-md hover:shadow-lg'
                    }`}
                  >
                    {isCurrentPlan ? 'Current Plan' : 'Subscribe Now'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Billing History Section */}
      <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-xl flex items-center justify-center">
              <Download className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-xl font-semibold text-gray-900">Billing History</h3>
              <p className="text-sm text-gray-600">Download and view your past invoices</p>
            </div>
          </div>
          
          {invoicesLoading ? (
            <div className="flex items-center justify-center h-32">
              <div className="text-center">
                <BeatLoader color="#3b82f6" size={8} />
                <p className="text-gray-600 mt-4 text-sm">Loading billing history...</p>
              </div>
            </div>
          ) : billingHistory.length > 0 ? (
            <div className="overflow-hidden rounded-xl border border-gray-200">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Date & Time</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Amount</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Status</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Invoice</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {billingHistory.map((invoice, index) => (
                      <tr key={index} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">{invoice.date}</div>
                          <div className="text-xs text-gray-500">{invoice.time}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-semibold text-gray-900">{invoice.amount}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
                            invoice.status === 'Paid' 
                              ? 'bg-green-100 text-green-800'
                              : invoice.status === 'Pending'
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {invoice.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <button 
                            onClick={() => handleDownload(invoice)}
                            className="flex items-center gap-2 text-blue-600 hover:text-blue-800 transition-colors text-sm font-medium"
                          >
                            <Download className="w-4 h-4" />
                            Download
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Download className="w-8 h-8 text-gray-400" />
              </div>
              <h4 className="text-lg font-semibold text-gray-900 mb-2">No billing history</h4>
              <p className="text-gray-600">Your invoices will appear here once you start subscribing to paid plans.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PlansAndBilling; 