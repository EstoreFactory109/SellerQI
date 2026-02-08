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
        name: form.name.trim(),
        email: form.email.trim(),
        subject: form.subject.trim(),
        message: form.message.trim(),
        topic: form.helpType.trim() // Backend expects 'topic', frontend uses 'helpType'
      };

      // Validate required fields before sending
      if (!supportTicketData.name || !supportTicketData.email || !supportTicketData.subject || !supportTicketData.message || !supportTicketData.topic) {
        setError('Please fill in all required fields.');
        setIsSubmitting(false);
        return;
      }

      console.log('Submitting support ticket:', supportTicketData);

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
        // Check if there are validation errors
        if (error.response?.data?.errors && Array.isArray(error.response.data.errors)) {
          // Extract validation error messages
          const validationErrors = error.response.data.errors.map(err => err.msg || err.message).join(', ');
          setError(`Validation error: ${validationErrors}`);
        } else if (error.response?.data?.message) {
          setError(error.response.data.message);
        } else {
          setError('Please fill in all required fields correctly.');
        }
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
    <div className="space-y-4">
      {/* Header Section */}
      <div className="bg-[#161b22] rounded-2xl border border-[#30363d] shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden">
        <div className="bg-blue-600 px-4 py-5 text-white relative overflow-hidden">
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-1">
              <div className="w-2 h-6 bg-blue-400 rounded-full"></div>
              <div className="flex items-center gap-3">
                <HelpCircle className="w-5 h-5 text-white" />
                <h2 className="text-xl font-bold text-white">
                  Support
                </h2>
              </div>
            </div>
            <p className="text-gray-200 text-xs">Get help and support for your SellerQI account</p>
          </div>
        </div>
      </div>

      {/* Contact Form Section */}
      <div className="bg-[#161b22] rounded-2xl border border-[#30363d] shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden">
          <div className="p-4">
            <h3 className="text-xl font-bold text-gray-100 mb-1">Send us a Message</h3>
            <p className="text-gray-400 mb-4 text-sm">
              Fill out the form below and we'll get back to you within 24 hours.
            </p>
            
            <AnimatePresence mode="wait">
              {submitted ? (
                <motion.div
                  key="success"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="text-center py-8"
                >
                  <div className="w-14 h-14 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-3 border border-emerald-500/40">
                    <CheckCircle className="w-7 h-7 text-emerald-400" />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-100 mb-1">Message Sent!</h3>
                  <p className="text-gray-400 mb-4 text-sm">
                    Thank you for reaching out. We've received your message and will get back to you soon.
                  </p>
                  <button
                    onClick={() => {
                      setSubmitted(false);
                      setError('');
                      setForm({ name: '', email: '', subject: '', message: '', helpType: '' });
                    }}
                    className="text-blue-400 hover:text-blue-300 font-medium text-sm"
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
                  className="space-y-4"
                >
                  {/* Error Message */}
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-red-500/10 border border-red-500/40 rounded-xl p-3 flex items-start gap-3"
                    >
                      <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <h4 className="text-red-400 font-medium mb-1">Error</h4>
                        <p className="text-red-300 text-sm">{error}</p>
                      </div>
                    </motion.div>
                  )}
                  
                  <div className="relative" ref={dropdownRef}>
                    <label className="block text-gray-200 font-medium mb-1 text-sm">
                      How can we help you? *
                    </label>
                    <button
                      type="button"
                      onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                      className={`w-full border border-[#30363d] rounded-xl px-3 py-2.5 bg-[#1a1a1a] text-left focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all duration-300 flex items-center justify-between ${
                        !form.helpType ? 'text-gray-400' : 'text-gray-100'
                      }`}
                    >
                      <span>{form.helpType || 'Select a topic...'}</span>
                      <ChevronDown 
                        className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${
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
                          className="absolute z-50 w-full mt-2 bg-[#161b22] border border-[#30363d] rounded-xl shadow-lg overflow-hidden"
                        >
                          <div className="max-h-60 overflow-y-auto">
                            {helpTopics.map((topic, index) => (
                              <button
                                key={index}
                                type="button"
                                onClick={() => handleTopicSelect(topic)}
                                className={`w-full px-3 py-2.5 text-left hover:bg-[#21262d] transition-colors duration-150 ${
                                  form.helpType === topic 
                                    ? 'bg-blue-600 text-white hover:bg-blue-700' 
                                    : 'text-gray-100'
                                } ${index !== helpTopics.length - 1 ? 'border-b border-[#30363d]' : ''}`}
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
                  
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-gray-200 font-medium mb-1 text-sm">
                        Name *
                      </label>
                      <input
                        type="text"
                        name="name"
                        value={form.name}
                        onChange={handleChange}
                        required
                        className="w-full border border-[#30363d] rounded-xl px-3 py-2 bg-[#1a1a1a] text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all duration-300"
                        placeholder="Your full name"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-200 font-medium mb-1 text-sm">
                        Email *
                      </label>
                      <input
                        type="email"
                        name="email"
                        value={form.email}
                        onChange={handleChange}
                        required
                        className="w-full border border-[#30363d] rounded-xl px-3 py-2 bg-[#1a1a1a] text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all duration-300"
                        placeholder="your.email@example.com"
                      />
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-gray-200 font-medium mb-1 text-sm">
                      Subject *
                    </label>
                    <input
                      type="text"
                      name="subject"
                      value={form.subject}
                      onChange={handleChange}
                      required
                      className="w-full border border-[#30363d] rounded-xl px-3 py-2 bg-[#1a1a1a] text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all duration-300"
                      placeholder="Brief description of your inquiry"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-gray-200 font-medium mb-1 text-sm">
                      Message *
                    </label>
                    <textarea
                      name="message"
                      value={form.message}
                      onChange={handleChange}
                      required
                      rows={5}
                      className="w-full border border-[#30363d] rounded-xl px-3 py-2 bg-[#1a1a1a] text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all duration-300 resize-none"
                      placeholder="Please provide as much detail as possible..."
                    />
                  </div>
                  
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className={`w-full py-3 px-4 rounded-xl font-semibold text-base transition-all duration-300 flex items-center justify-center gap-2 ${
                      isSubmitting
                        ? 'bg-gray-600 text-gray-300 cursor-not-allowed'
                        : 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg hover:shadow-xl'
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
                        <Send className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </motion.form>
              )}
            </AnimatePresence>
          </div>
        </div>

      {/* Use Cases */}
      <div className="bg-[#161b22] rounded-2xl border border-[#30363d] shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden">
        <div className="p-4">
          <div className="text-center mb-4">
            <h3 className="text-xl font-bold text-gray-100 mb-2">
              Need Quick Answers?
            </h3>
            <p className="text-sm text-gray-400 mb-4">
              Discover how SellerQI can help you optimize your Amazon business and drive growth.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <a
                href="https://www.sellerqi.com/use-cases"
                target="_blank"
                rel="noopener noreferrer"
                className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-all duration-300 font-semibold inline-flex items-center justify-center gap-2 text-sm"
              >
                View Use Cases
                <ArrowRight className="w-4 h-4" />
              </a>
              <Link
                to="/seller-central-checker/consultation"
                className="border-2 border-[#30363d] text-gray-200 px-6 py-2 rounded-lg hover:border-[#21262d] hover:bg-[#21262d] transition-all duration-300 font-semibold text-center text-sm"
              >
                Need Help?
              </Link>
            </div>
          </div>

          {/* Use Cases Preview */}
          <div className="grid md:grid-cols-3 gap-4">
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
                className="bg-[#1a1a1a] rounded-xl p-4 border border-[#30363d] hover:border-blue-500/40 hover:shadow-md transition-all duration-300"
              >
                <h4 className="font-semibold text-gray-100 mb-2 text-base">{useCase.title}</h4>
                <p className="text-gray-400 text-sm leading-relaxed">{useCase.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Support; 