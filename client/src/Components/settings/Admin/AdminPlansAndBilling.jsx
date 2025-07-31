import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { CreditCard, Crown, Users, BarChart3, Receipt, Download, Calendar, DollarSign } from 'lucide-react';
import { useSelector } from 'react-redux';
import axios from 'axios';

const AdminPlansAndBilling = () => {
  const user = useSelector((state) => state.Auth.user);
  const [billingData, setBillingData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchBillingInfo();
  }, []);

  const fetchBillingInfo = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${import.meta.env.VITE_BASE_URI}/app/admin/billing`, {
        withCredentials: true
      });
      
      if (response.status === 200) {
        setBillingData(response.data.data);
      }
    } catch (error) {
      console.error('Error fetching billing info:', error);
      setError('Failed to load billing information');
    } finally {
      setLoading(false);
    }
  };

  const clientLimits = {
    AGENCY: {
      maxClients: 'Unlimited',
      features: [
        'Unlimited client accounts',
        'White-label reports',
        'Client management dashboard',
        'Bulk operations',
        'Priority support',
        'API access'
      ]
    }
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-gray-200 rounded w-1/3"></div>
            <div className="h-4 bg-gray-200 rounded w-2/3"></div>
            <div className="space-y-3">
              <div className="h-4 bg-gray-200 rounded"></div>
              <div className="h-4 bg-gray-200 rounded w-5/6"></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="bg-white rounded-2xl shadow-lg border border-red-200 p-8">
          <p className="text-red-600">{error}</p>
          <button 
            onClick={fetchBillingInfo}
            className="mt-4 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const billingInfo = billingData?.billingInfo;
  const paymentHistory = billingData?.paymentHistory || [];

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="bg-gradient-to-r from-purple-600 via-indigo-600 to-blue-600 rounded-3xl p-8 text-white"
      >
        <div className="flex items-center gap-6">
          <div className="w-20 h-20 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center">
            <CreditCard className="w-10 h-10 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold mb-2">Agency Billing & Plans</h1>
            <p className="text-white/80 text-lg">
              Manage your agency subscription and billing information
            </p>
          </div>
        </div>
      </motion.div>

      {/* Current Plan */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.1 }}
        className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8"
      >
        <div className="flex items-center gap-3 mb-6">
          <Crown className="w-6 h-6 text-purple-600" />
          <h2 className="text-2xl font-bold text-gray-900">Current Plan</h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="space-y-6">
            <div className="bg-gradient-to-br from-purple-50 to-indigo-50 rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
                    <Users className="w-6 h-6 text-purple-600" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-purple-900">Agency Plan</h3>
                    <p className="text-purple-600">Perfect for agencies</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-3xl font-bold text-purple-900">${billingInfo?.monthlyPrice || 0}</p>
                  <p className="text-purple-600 text-sm">per month</p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-purple-700">Status</span>
                  <span className="font-medium text-purple-900 capitalize">{billingInfo?.status || 'Unknown'}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-purple-700">Next Billing</span>
                  <span className="font-medium text-purple-900">
                    {billingInfo?.nextBillingDate ? new Date(billingInfo.nextBillingDate).toLocaleDateString() : 'N/A'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-purple-700">Payment Method</span>
                  <span className="font-medium text-purple-900">{billingInfo?.paymentMethod || 'Not set'}</span>
                </div>
              </div>
            </div>

            {/* Plan Features */}
            <div className="bg-gray-50 rounded-xl p-6">
              <h4 className="font-bold text-gray-900 mb-4">Plan Features</h4>
              <div className="space-y-3">
                {clientLimits.AGENCY.features.map((feature, index) => (
                  <div key={index} className="flex items-center gap-3">
                    <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                    <span className="text-gray-700">{feature}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            {/* Usage Statistics */}
            <div className="bg-gradient-to-br from-blue-50 to-cyan-50 rounded-xl p-6">
              <h4 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-blue-600" />
                Usage Overview
              </h4>
              
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-blue-700 font-medium">Active Clients</span>
                    <span className="text-blue-900 font-bold">10 / Unlimited</span>
                  </div>
                  <div className="w-full bg-blue-200 rounded-full h-2">
                    <div className="bg-blue-600 h-2 rounded-full" style={{ width: '25%' }}></div>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-blue-700 font-medium">Reports Generated</span>
                    <span className="text-blue-900 font-bold">156 this month</span>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-blue-700 font-medium">API Requests</span>
                    <span className="text-blue-900 font-bold">2,340 / Unlimited</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="space-y-3">
              <button className="w-full bg-purple-600 hover:bg-purple-700 text-white p-4 rounded-xl font-medium transition-colors">
                Update Payment Method
              </button>
              <button className="w-full border border-gray-200 hover:bg-gray-50 text-gray-700 p-4 rounded-xl font-medium transition-colors">
                Download Invoice
              </button>
              <button className="w-full border border-gray-200 hover:bg-gray-50 text-gray-700 p-4 rounded-xl font-medium transition-colors">
                Contact Billing Support
              </button>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Payment History */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.2 }}
        className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden"
      >
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <Receipt className="w-5 h-5 text-purple-600" />
                Payment History
              </h2>
              <p className="text-gray-600 mt-1">View and download your payment history</p>
            </div>
            <button className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg font-medium transition-colors">
              <Download className="w-4 h-4" />
              Export All
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-4 text-left text-sm font-medium text-gray-500 uppercase tracking-wider">
                  Date
                </th>
                <th className="px-6 py-4 text-left text-sm font-medium text-gray-500 uppercase tracking-wider">
                  Amount
                </th>
                <th className="px-6 py-4 text-left text-sm font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-4 text-left text-sm font-medium text-gray-500 uppercase tracking-wider">
                  Invoice
                </th>
                <th className="px-6 py-4 text-left text-sm font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {paymentHistory.map((payment) => (
                <tr key={payment.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-gray-400" />
                      <span className="text-sm text-gray-900">
                        {new Date(payment.date).toLocaleDateString()}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <DollarSign className="w-4 h-4 text-gray-400" />
                      <span className="text-sm font-medium text-gray-900">
                        ${payment.amount}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      payment.status === 'paid' 
                        ? 'bg-green-100 text-green-800' 
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {payment.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm text-gray-900">{payment.invoiceNumber}</span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <button className="text-purple-600 hover:text-purple-700 text-sm font-medium">
                      Download
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.div>
    </div>
  );
};

export default AdminPlansAndBilling;