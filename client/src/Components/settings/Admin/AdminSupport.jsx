import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { MessageCircle, Phone, Mail, Clock, Users, ArrowRight, Send, FileText, AlertCircle } from 'lucide-react';

const AdminSupport = () => {
  const [ticketForm, setTicketForm] = useState({
    subject: '',
    category: 'technical',
    priority: 'medium',
    description: '',
    clientAffected: ''
  });
  const [loading, setLoading] = useState(false);

  const categories = [
    { value: 'technical', label: 'Technical Issue' },
    { value: 'billing', label: 'Billing & Payments' },
    { value: 'client-management', label: 'Client Management' },
    { value: 'api', label: 'API Support' },
    { value: 'account', label: 'Account Settings' },
    { value: 'feature-request', label: 'Feature Request' }
  ];

  const priorities = [
    { value: 'low', label: 'Low', color: 'text-green-600 bg-green-50' },
    { value: 'medium', label: 'Medium', color: 'text-yellow-600 bg-yellow-50' },
    { value: 'high', label: 'High', color: 'text-orange-600 bg-orange-50' },
    { value: 'urgent', label: 'Urgent', color: 'text-red-600 bg-red-50' }
  ];

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setTicketForm(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      // TODO: Submit support ticket
      console.log('Submitting ticket:', ticketForm);
      await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate API call
      
      // Reset form
      setTicketForm({
        subject: '',
        category: 'technical',
        priority: 'medium',
        description: '',
        clientAffected: ''
      });
      
      alert('Support ticket submitted successfully!');
    } catch (error) {
      console.error('Error submitting ticket:', error);
      alert('Failed to submit ticket. Please try again.');
    } finally {
      setLoading(false);
    }
  };

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
            <MessageCircle className="w-10 h-10 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold mb-2">Agency Support</h1>
            <p className="text-white/80 text-lg">
              Get priority support for your agency and client accounts
            </p>
          </div>
        </div>
      </motion.div>

      {/* Support Options */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.1 }}
        className="grid grid-cols-1 md:grid-cols-3 gap-6"
      >
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
          <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center mb-4">
            <MessageCircle className="w-6 h-6 text-green-600" />
          </div>
          <h3 className="text-lg font-bold text-gray-900 mb-2">Live Chat</h3>
          <p className="text-gray-600 mb-4">Get instant help from our support team</p>
          <div className="flex items-center justify-between">
            <span className="text-sm text-green-600 font-medium">Available 24/7</span>
            <button className="text-green-600 hover:text-green-700 font-medium">
              Start Chat →
            </button>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
          <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center mb-4">
            <Phone className="w-6 h-6 text-blue-600" />
          </div>
          <h3 className="text-lg font-bold text-gray-900 mb-2">Phone Support</h3>
          <p className="text-gray-600 mb-4">Speak directly with our experts</p>
          <div className="flex items-center justify-between">
            <span className="text-sm text-blue-600 font-medium">Mon-Fri 9AM-6PM</span>
            <button className="text-blue-600 hover:text-blue-700 font-medium">
              Call Now →
            </button>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
          <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center mb-4">
            <Mail className="w-6 h-6 text-purple-600" />
          </div>
          <h3 className="text-lg font-bold text-gray-900 mb-2">Email Support</h3>
          <p className="text-gray-600 mb-4">Send detailed inquiries via email</p>
          <div className="flex items-center justify-between">
            <span className="text-sm text-purple-600 font-medium">24h response</span>
            <button className="text-purple-600 hover:text-purple-700 font-medium">
              Send Email →
            </button>
          </div>
        </div>
      </motion.div>

      {/* Create Support Ticket */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.2 }}
        className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8"
      >
        <div className="flex items-center gap-3 mb-6">
          <FileText className="w-6 h-6 text-purple-600" />
          <h2 className="text-2xl font-bold text-gray-900">Create Support Ticket</h2>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Subject *
              </label>
              <input
                type="text"
                name="subject"
                value={ticketForm.subject}
                onChange={handleInputChange}
                required
                className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                placeholder="Brief description of the issue"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Category *
              </label>
              <select
                name="category"
                value={ticketForm.category}
                onChange={handleInputChange}
                required
                className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              >
                {categories.map(cat => (
                  <option key={cat.value} value={cat.value}>{cat.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Priority *
              </label>
              <select
                name="priority"
                value={ticketForm.priority}
                onChange={handleInputChange}
                required
                className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              >
                {priorities.map(priority => (
                  <option key={priority.value} value={priority.value}>{priority.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Client Affected (Optional)
              </label>
              <input
                type="text"
                name="clientAffected"
                value={ticketForm.clientAffected}
                onChange={handleInputChange}
                className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                placeholder="Which client is affected by this issue?"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Description *
            </label>
            <textarea
              name="description"
              value={ticketForm.description}
              onChange={handleInputChange}
              required
              rows={6}
              className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              placeholder="Please provide detailed information about the issue, including steps to reproduce, error messages, and any relevant client information..."
            />
          </div>

          <div className="bg-blue-50 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5" />
              <div>
                <h4 className="font-medium text-blue-900 mb-1">Agency Priority Support</h4>
                <p className="text-blue-700 text-sm">
                  As an agency customer, your tickets receive priority handling with faster response times 
                  and dedicated support for client-related issues.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Clock className="w-4 h-4" />
              <span>Expected response within 2-4 hours</span>
            </div>
            
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-400 text-white px-8 py-3 rounded-lg font-medium transition-colors"
            >
              {loading ? (
                <>
                  <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full"></div>
                  Submitting...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Submit Ticket
                </>
              )}
            </button>
          </div>
        </form>
      </motion.div>

      {/* Agency Support Features */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.3 }}
        className="bg-gradient-to-r from-purple-50 to-indigo-50 rounded-2xl p-8"
      >
        <div className="text-center mb-8">
          <h3 className="text-2xl font-bold text-gray-900 mb-2">Agency Support Benefits</h3>
          <p className="text-gray-600">Exclusive support features for agency customers</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="text-center">
            <div className="w-16 h-16 bg-purple-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Clock className="w-8 h-8 text-purple-600" />
            </div>
            <h4 className="font-bold text-gray-900 mb-2">Priority Response</h4>
            <p className="text-gray-600 text-sm">2-4 hour response time for all tickets</p>
          </div>

          <div className="text-center">
            <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Users className="w-8 h-8 text-blue-600" />
            </div>
            <h4 className="font-bold text-gray-900 mb-2">Dedicated Team</h4>
            <p className="text-gray-600 text-sm">Specialized support team for agencies</p>
          </div>

          <div className="text-center">
            <div className="w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Phone className="w-8 h-8 text-green-600" />
            </div>
            <h4 className="font-bold text-gray-900 mb-2">Phone Support</h4>
            <p className="text-gray-600 text-sm">Direct phone line for urgent issues</p>
          </div>

          <div className="text-center">
            <div className="w-16 h-16 bg-orange-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <FileText className="w-8 h-8 text-orange-600" />
            </div>
            <h4 className="font-bold text-gray-900 mb-2">Account Manager</h4>
            <p className="text-gray-600 text-sm">Personal account manager for onboarding</p>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default AdminSupport;