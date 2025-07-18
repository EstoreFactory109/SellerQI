import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Mail, 
  MapPin, 
  Clock, 
  Phone, 
  MessageCircle, 
  Send, 
  CheckCircle,
  ArrowRight,
  Shield,
  Zap,
  Users,
  HelpCircle
} from 'lucide-react';

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

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    // Simulate API call
    setTimeout(() => {
      setSubmitted(true);
      setIsSubmitting(false);
    }, 1500);
  };

  const contactMethods = [
    {
      icon: Mail,
      title: "Email Support",
      description: "Get help from our support team",
      contact: "support@sellerqi.com",
      action: "mailto:support@sellerqi.com",
      color: "blue"
    },
    {
      icon: MessageCircle,
      title: "Live Chat",
      description: "Chat with us in real-time",
      contact: "Available 24/7",
      action: "#",
      color: "green"
    },
    {
      icon: Phone,
      title: "Phone Support",
      description: "Speak with our experts",
      contact: "+1 818 350 5203",
      action: "tel:+18183505203",
      color: "purple"
    }
  ];

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

        {/* Quick Contact Methods */}
        <div className="p-6">
          <div className="grid md:grid-cols-3 gap-6 mb-8">
            {contactMethods.map((method, index) => {
              const Icon = method.icon;
              const colorClasses = {
                blue: "bg-blue-50 text-[#3B4A6B] border-blue-200 hover:bg-blue-100",
                green: "bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100",
                purple: "bg-purple-50 text-purple-600 border-purple-200 hover:bg-purple-100"
              };
              
              return (
                <motion.a
                  key={method.title}
                  href={method.action}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.1 * index }}
                  className={`bg-white rounded-2xl border-2 p-6 text-center hover:shadow-lg transition-all duration-300 group ${colorClasses[method.color]}`}
                >
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform duration-300">
                    <Icon className="w-6 h-6" />
                  </div>
                  <h3 className="font-semibold text-gray-900 mb-2">{method.title}</h3>
                  <p className="text-sm text-gray-600 mb-2">{method.description}</p>
                  <p className="text-sm font-medium">{method.contact}</p>
                </motion.a>
              );
            })}
          </div>

          <div className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-700 rounded-full text-sm font-medium mb-6">
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
            Average response time: Under 2 hours
          </div>
        </div>
      </div>

      {/* Contact Form Section */}
      <div className="grid lg:grid-cols-2 gap-8">
        
        {/* Contact Form */}
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
                  <div>
                    <label className="block text-gray-700 font-medium mb-2">
                      How can we help you? *
                    </label>
                    <select
                      name="helpType"
                      value={form.helpType}
                      onChange={handleChange}
                      className="w-full border border-gray-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#3B4A6B] focus:border-transparent transition-all duration-300"
                      required
                    >
                      <option value="">Select a topic...</option>
                      {helpTopics.map((topic, index) => (
                        <option key={index} value={topic}>{topic}</option>
                      ))}
                    </select>
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

        {/* Contact Information */}
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden">
            <div className="p-6">
              <h3 className="text-2xl font-bold text-gray-900 mb-6">Get in Touch</h3>
              <p className="text-lg text-gray-600 mb-8">
                Our team is here to help you succeed with your Amazon business. Whether you need technical support, have questions about features, or want to discuss custom solutions, we're ready to assist.
              </p>

              {/* Contact Details */}
              <div className="space-y-4">
                <div className="flex items-start gap-4 p-4 bg-gray-50 rounded-xl">
                  <div className="w-10 h-10 bg-[#3B4A6B] rounded-lg flex items-center justify-center flex-shrink-0">
                    <Mail className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-1">Email</h4>
                    <a href="mailto:support@sellerqi.com" className="text-[#3B4A6B] hover:text-[#2d3a52] transition-colors">
                      support@sellerqi.com
                    </a>
                  </div>
                </div>

                <div className="flex items-start gap-4 p-4 bg-gray-50 rounded-xl">
                  <div className="w-10 h-10 bg-emerald-500 rounded-lg flex items-center justify-center flex-shrink-0">
                    <MapPin className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-1">Address</h4>
                    <p className="text-gray-600">
                      15233 Ventura Blvd Suite 500<br />
                      Sherman Oaks, CA 91403
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-4 p-4 bg-gray-50 rounded-xl">
                  <div className="w-10 h-10 bg-purple-500 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Clock className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-1">Support Hours</h4>
                    <p className="text-gray-600">
                      Monday - Friday: 9:00 AM - 6:00 PM PST<br />
                      Weekend: 10:00 AM - 4:00 PM PST
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Why Contact Us */}
          <div className="bg-gradient-to-br from-[#3B4A6B] to-[#333651] rounded-2xl p-6 text-white">
            <h4 className="text-xl font-bold mb-4">Why Choose SellerQI Support?</h4>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Zap className="w-5 h-5 text-emerald-300 flex-shrink-0" />
                <span>Fast response times</span>
              </div>
              <div className="flex items-center gap-3">
                <Users className="w-5 h-5 text-emerald-300 flex-shrink-0" />
                <span>Expert Amazon specialists</span>
              </div>
              <div className="flex items-center gap-3">
                <Shield className="w-5 h-5 text-emerald-300 flex-shrink-0" />
                <span>100% confidential and secure</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* FAQ Quick Links */}
      <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden">
        <div className="p-6">
          <div className="text-center mb-8">
            <h3 className="text-2xl font-bold text-gray-900 mb-4">
              Need Quick Answers?
            </h3>
            <p className="text-lg text-gray-600 mb-6">
              Check out our most frequently asked questions or browse our comprehensive help center.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <a
                href="/pricing#faq"
                className="bg-[#3B4A6B] text-white px-8 py-3 rounded-lg hover:bg-[#2d3a52] transition-all duration-300 font-semibold inline-flex items-center justify-center gap-2"
              >
                View FAQ
                <ArrowRight className="w-4 h-4" />
              </a>
              <a
                href="#"
                className="border-2 border-gray-300 text-gray-700 px-8 py-3 rounded-lg hover:border-gray-400 hover:bg-gray-50 transition-all duration-300 font-semibold"
              >
                Help Center
              </a>
            </div>
          </div>

          {/* Common Questions */}
          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                question: "How do I get started?",
                answer: "Simply enter an ASIN on our homepage to get your first free analysis. No account required!"
              },
              {
                question: "What's included in Pro?",
                answer: "Unlimited analyses, detailed reports, fix recommendations, and priority support."
              },
              {
                question: "Can I cancel anytime?",
                answer: "Yes! Cancel your subscription anytime with no cancellation fees or penalties."
              }
            ].map((item, index) => (
              <div
                key={index}
                className="bg-gray-50 rounded-xl p-6"
              >
                <h4 className="font-semibold text-gray-900 mb-3">{item.question}</h4>
                <p className="text-gray-600 text-sm">{item.answer}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Support; 