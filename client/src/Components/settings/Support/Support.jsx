import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import { 
  Send, 
  CheckCircle,
  ArrowRight,
  HelpCircle,
  AlertCircle,
  ChevronDown
} from 'lucide-react';
import axiosInstance from '../../../config/axios.config';

const Support = () => {
  const [form, setForm] = useState({ 
    name: '', 
    email: '', 
    subject: '', 
    message: '', 
    helpType: '' 
  });
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
    // Clear error when user starts typing
    if (error) {
      setError('');
    }
  };

  const handleTopicSelect = (topic) => {
    setForm({ ...form, helpType: topic });
    setIsDropdownOpen(false);
    if (error) {
      setError('');
    }
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');
    
    try {
      // Prepare the data for the backend
      const supportTicketData = {
        name: form.name,
        email: form.email,
        subject: form.subject,
        message: form.message,
        topic: form.helpType // Backend expects 'topic', frontend uses 'helpType'
      };

      // Send data to the backend
      const response = await axiosInstance.post('/app/support', supportTicketData);
      
      if (response.status === 201) {
        setSubmitted(true);
        // Reset form
        setForm({ name: '', email: '', subject: '', message: '', helpType: '' });
      }
    } catch (error) {
      console.error('Error submitting support ticket:', error);
      
      // Handle different types of errors
      if (error.response?.status === 401) {
        setError('Please log in to submit a support ticket.');
      } else if (error.response?.status === 400) {
        setError('Please fill in all required fields correctly.');
      } else if (error.response?.data?.message) {
        setError(error.response.data.message);
      } else {
        setError('Something went wrong. Please try again or contact us directly at support@sellerqi.com');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const helpTopics = [
    "I need product optimization help", 
    "SellerQI fails to analyze my product",
    "I want to report a bug",
    "Billing and subscription questions",
    "Partnership opportunities",
    "Suggest new feature",
    "Other"
  ];

  return (
    <div className="space-y-8">
      {/* Header Section */}
      <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden">
        <div className="bg-gradient-to-r from-slate-900 via-purple-900 to-slate-900 px-6 py-8 text-white relative overflow-hidden">
          <div className="absolute inset-0 opacity-20" style={{backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.05'%3E%3Ccircle cx='30' cy='30' r='2'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")"}}></div>
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-2 h-8 bg-gradient-to-b from-blue-400 to-purple-500 rounded-full"></div>
              <div className="flex items-center gap-3">
                <HelpCircle className="w-6 h-6 text-white" />
                <h2 className="text-2xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                  Support
                </h2>
              </div>
            </div>
            <p className="text-gray-300 text-sm">Get help and support for your SellerQI account</p>
          </div>
        </div>
      </div>

      {/* Contact Form Section */}
      <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden">
          <div className="p-6">
            <h3 className="text-2xl font-bold text-gray-900 mb-2">Send us a Message</h3>
            <p className="text-gray-600 mb-8">
              Fill out the form below and we'll get back to you within 24 hours.
            </p>
            
            <AnimatePresence mode="wait">
              {submitted ? (
                <motion.div
                  key="success"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="text-center py-12"
                >
                  <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle className="w-8 h-8 text-emerald-600" />
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">Message Sent!</h3>
                  <p className="text-gray-600 mb-6">
                    Thank you for reaching out. We've received your message and will get back to you soon.
                  </p>
                  <button
                    onClick={() => {
                      setSubmitted(false);
                      setError('');
                      setForm({ name: '', email: '', subject: '', message: '', helpType: '' });
                    }}
                    className="text-[#3B4A6B] hover:text-[#2d3a52] font-medium"
                  >
                    Send Another Message
                  </button>
                </motion.div>
              ) : (
                <motion.form
                  key="form"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onSubmit={handleSubmit}
                  className="space-y-6"
                >
                  {/* Error Message */}
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3"
                    >
                      <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <h4 className="text-red-800 font-medium mb-1">Error</h4>
                        <p className="text-red-700 text-sm">{error}</p>
                      </div>
                    </motion.div>
                  )}
                  
                  <div className="relative" ref={dropdownRef}>
                    <label className="block text-gray-700 font-medium mb-2">
                      How can we help you? *
                    </label>
                    <button
                      type="button"
                      onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                      className={`w-full border border-gray-300 rounded-xl px-4 py-3 bg-white text-left focus:outline-none focus:ring-2 focus:ring-[#3B4A6B] focus:border-transparent transition-all duration-300 flex items-center justify-between ${
                        !form.helpType ? 'text-gray-400' : 'text-gray-900'
                      }`}
                    >
                      <span>{form.helpType || 'Select a topic...'}</span>
                      <ChevronDown 
                        className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${
                          isDropdownOpen ? 'transform rotate-180' : ''
                        }`} 
                      />
                    </button>
                    
                    <AnimatePresence>
                      {isDropdownOpen && (
                        <motion.div
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          transition={{ duration: 0.2 }}
                          className="absolute z-50 w-full mt-2 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden"
                        >
                          <div className="max-h-60 overflow-y-auto">
                            {helpTopics.map((topic, index) => (
                              <button
                                key={index}
                                type="button"
                                onClick={() => handleTopicSelect(topic)}
                                className={`w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors duration-150 ${
                                  form.helpType === topic 
                                    ? 'bg-[#3B4A6B] text-white hover:bg-[#2d3a52]' 
                                    : 'text-gray-900'
                                } ${index !== helpTopics.length - 1 ? 'border-b border-gray-100' : ''}`}
                              >
                                {topic}
                              </button>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                    
                    {/* Hidden input for form validation */}
                    <input
                      type="hidden"
                      name="helpType"
                      value={form.helpType}
                      required
                    />
                  </div>
                  
                  <div className="grid md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-gray-700 font-medium mb-2">
                        Name *
                      </label>
                      <input
                        type="text"
                        name="name"
                        value={form.name}
                        onChange={handleChange}
                        required
                        className="w-full border border-gray-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#3B4A6B] focus:border-transparent transition-all duration-300"
                        placeholder="Your full name"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-700 font-medium mb-2">
                        Email *
                      </label>
                      <input
                        type="email"
                        name="email"
                        value={form.email}
                        onChange={handleChange}
                        required
                        className="w-full border border-gray-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#3B4A6B] focus:border-transparent transition-all duration-300"
                        placeholder="your.email@example.com"
                      />
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-gray-700 font-medium mb-2">
                      Subject *
                    </label>
                    <input
                      type="text"
                      name="subject"
                      value={form.subject}
                      onChange={handleChange}
                      required
                      className="w-full border border-gray-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#3B4A6B] focus:border-transparent transition-all duration-300"
                      placeholder="Brief description of your inquiry"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-gray-700 font-medium mb-2">
                      Message *
                    </label>
                    <textarea
                      name="message"
                      value={form.message}
                      onChange={handleChange}
                      required
                      rows={6}
                      className="w-full border border-gray-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#3B4A6B] focus:border-transparent transition-all duration-300 resize-none"
                      placeholder="Please provide as much detail as possible..."
                    />
                  </div>
                  
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className={`w-full py-4 px-6 rounded-xl font-semibold text-lg transition-all duration-300 flex items-center justify-center gap-2 ${
                      isSubmitting
                        ? 'bg-gray-400 text-gray-200 cursor-not-allowed'
                        : 'bg-gradient-to-r from-[#3B4A6B] to-[#333651] text-white hover:from-[#2d3a52] hover:to-[#2a2e42] shadow-lg hover:shadow-xl'
                    }`}
                  >
                    {isSubmitting ? (
                      <>
                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        Sending...
                      </>
                    ) : (
                      <>
                        Send Message
                        <Send className="w-5 h-5" />
                      </>
                    )}
                  </button>
                </motion.form>
              )}
            </AnimatePresence>
          </div>
        </div>

      {/* Use Cases */}
      <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden">
        <div className="p-6">
          <div className="text-center mb-8">
            <h3 className="text-2xl font-bold text-gray-900 mb-4">
              Need Quick Answers?
            </h3>
            <p className="text-lg text-gray-600 mb-6">
              Discover how SellerQI can help you optimize your Amazon business and drive growth.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <a
                href="https://www.sellerqi.com/use-cases"
                target="_blank"
                rel="noopener noreferrer"
                className="bg-[#3B4A6B] text-white px-8 py-3 rounded-lg hover:bg-[#2d3a52] transition-all duration-300 font-semibold inline-flex items-center justify-center gap-2"
              >
                View Use Cases
                <ArrowRight className="w-4 h-4" />
              </a>
              <Link
                to="/seller-central-checker/consultation"
                className="border-2 border-gray-300 text-gray-700 px-8 py-3 rounded-lg hover:border-gray-400 hover:bg-gray-50 transition-all duration-300 font-semibold text-center"
              >
                Need Help?
              </Link>
            </div>
          </div>

          {/* Use Cases Preview */}
          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                title: "Account Health Monitoring",
                description: "Stay ahead of account health issues and avoid penalties with real-time monitoring and early alerts."
              },
              {
                title: "PPC Optimization",
                description: "Reduce wasted spend, identify high-performing keywords, and optimize your campaigns for better ROI."
              },
              {
                title: "Profitability Analysis",
                description: "Get detailed per-ASIN profitability breakdowns to focus on winners and fix underperformers."
              }
            ].map((useCase, index) => (
              <div
                key={index}
                className="bg-gradient-to-br from-gray-50 to-white rounded-xl p-6 border border-gray-100 hover:border-[#3B4A6B] hover:shadow-md transition-all duration-300"
              >
                <h4 className="font-semibold text-gray-900 mb-3 text-lg">{useCase.title}</h4>
                <p className="text-gray-600 text-sm leading-relaxed">{useCase.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Support; 