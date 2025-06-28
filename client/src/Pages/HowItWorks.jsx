import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../Components/Navigation/Navbar';
import Footer from '../Components/Navigation/Footer';

const HowItWorksPage = () => {
  const [activeFaq, setActiveFaq] = useState(null);

  const toggleFaq = (index) => {
    setActiveFaq(activeFaq === index ? null : index);
  };

  const faqs = [
    {
      question: 'How long does the setup process take?',
      answer: 'The initial connection takes less than 2 minutes. Basic configuration can be completed in another 3-5 minutes. For advanced features and customization, we provide guided setup wizards that typically take 15-20 minutes to complete fully.'
    },
    {
      question: 'Do I need technical knowledge to use SellerQI?',
      answer: 'No technical knowledge is required! SellerQI is designed for Amazon sellers, not developers. Our intuitive interface and guided setup process make it easy for anyone to get started and see results quickly.'
    },
    {
      question: 'Which Amazon marketplaces are supported?',
      answer: 'SellerQI supports all major Amazon marketplaces including North America (US, CA, MX), Europe (UK, DE, FR, IT, ES, NL, SE, PL, BE), Asia Pacific (JP, AU, SG, IN), and Middle East (AE, SA, TR). We continuously add new marketplaces as Amazon expands.'
    },
    {
      question: 'Can I connect multiple Amazon accounts?',
      answer: 'Yes! SellerQI supports multiple seller accounts and marketplaces. You can manage all your accounts from a single dashboard with consolidated reporting and cross-account insights.'
    },
    {
      question: 'What happens to my data if I cancel?',
      answer: 'Your data remains yours. You can export all your data at any time. If you cancel, we retain your data for 30 days in case you want to reactivate, after which it\'s permanently deleted according to our data retention policy.'
    }
  ];

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <Navbar />

      {/* Hero Section */}
      <section className="bg-gradient-to-br from-gray-900 to-blue-700 text-white py-20 text-center">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-5xl font-bold mb-5">How SellerQI Works</h2>
          <p className="text-xl max-w-3xl mx-auto opacity-95">
            Connect your Amazon Seller account in minutes and start optimizing your business with powerful automation and insights
          </p>
        </div>
      </section>

      {/* Integration Steps */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900 mb-5">Get Started in 3 Simple Steps</h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Our seamless integration process gets you up and running in less than 5 minutes
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-10 mb-20">
            {[
              {
                number: '1',
                icon: '🔗',
                title: 'Connect Your Account',
                description: 'Click "Authorize Now" and securely connect your Amazon Seller account through Amazon\'s official OAuth process. We use Amazon SP-API for secure, real-time data access.'
              },
              {
                number: '2',
                icon: '⚙️',
                title: 'Configure Settings',
                description: 'Set your business rules, automation preferences, and alert thresholds. Our intelligent setup wizard guides you through the process with smart defaults based on your business type.'
              },
              {
                number: '3',
                icon: '🚀',
                title: 'Start Optimizing',
                description: 'That\'s it! SellerQI immediately begins analyzing your data, optimizing campaigns, and providing actionable insights. Watch your metrics improve from day one.'
              }
            ].map((step, index) => (
              <div key={index} className="bg-gray-50 rounded-xl p-10 text-center relative hover:-translate-y-1 hover:shadow-xl transition-all duration-300">
                <div className="absolute -top-5 left-1/2 transform -translate-x-1/2 w-10 h-10 bg-orange-400 rounded-full flex items-center justify-center text-white font-bold text-lg">
                  {step.number}
                </div>
                <div className="text-5xl mb-5 text-blue-700">{step.icon}</div>
                <h3 className="text-2xl font-semibold text-gray-900 mb-4">{step.title}</h3>
                <p className="text-gray-600 leading-relaxed">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Technical Section */}
      <section className="bg-gray-50 py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900 mb-5">Technical Integration Details</h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Built on Amazon's latest SP-API for maximum reliability and performance
            </p>
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div>
              <h3 className="text-3xl font-semibold text-gray-900 mb-5">Amazon SP-API Integration</h3>
              <p className="text-gray-600 mb-5 leading-relaxed">
                SellerQI is built on Amazon's Selling Partner API (SP-API), the latest and most advanced integration platform for Amazon sellers. This ensures real-time data synchronization, maximum reliability, and access to all the latest Amazon features.
              </p>
              <p className="text-gray-600 mb-8 leading-relaxed">
                Our integration is fully compliant with Amazon's data protection policies and follows all best practices for security and performance.
              </p>
              <ul className="space-y-3 mt-8">
                {[
                  'Real-time data synchronization',
                  'OAuth 2.0 secure authentication',
                  'Automatic API rate limit management',
                  'Full marketplace coverage (US, EU, JP, etc.)',
                  'Webhooks for instant updates',
                  'Bulk operations support'
                ].map((feature, i) => (
                  <li key={i} className="flex items-start text-gray-600">
                    <span className="text-green-500 font-bold text-lg mr-3">✓</span>
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-white rounded-xl shadow-lg min-h-[350px] overflow-hidden">
              <img src="https://res.cloudinary.com/ddoa960le/image/upload/v1751097407/flowchart_wpkdxv.png" className="w-full h-full object-cover"/>
              
            </div>
          </div>
        </div>
      </section>

      {/* Security Section */}
      <section className="bg-white py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900 mb-5">Enterprise-Grade Security</h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">Your data security is our top priority</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10">
            {[
              {
                icon: '🔒',
                title: '256-bit Encryption',
                description: 'All data is encrypted in transit and at rest using industry-standard AES-256 encryption'
              },
              {
                icon: '🛡️',
                title: 'SOC 2 Compliant',
                description: 'Our infrastructure and processes are SOC 2 Type II certified for maximum security'
              },
              {
                icon: '🔐',
                title: 'OAuth 2.0',
                description: 'Secure authentication through Amazon\'s official OAuth flow - we never store your passwords'
              },
              {
                icon: '📊',
                title: 'GDPR Compliant',
                description: 'Full compliance with GDPR and other data protection regulations worldwide'
              }
            ].map((security, index) => (
              <div key={index} className="text-center p-8">
                <div className="w-20 h-20 bg-gradient-to-br from-gray-900 to-blue-700 rounded-full flex items-center justify-center text-4xl text-white mx-auto mb-5">
                  {security.icon}
                </div>
                <h4 className="text-xl font-semibold text-gray-900 mb-4">{security.title}</h4>
                <p className="text-gray-600 leading-relaxed">{security.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="bg-gray-50 py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900 mb-5">Frequently Asked Questions</h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Everything you need to know about getting started with SellerQI
            </p>
          </div>
          
          <div className="max-w-3xl mx-auto">
            {faqs.map((faq, index) => (
              <div key={index} className="bg-white rounded-lg mb-5 shadow-sm overflow-hidden">
                <button
                  onClick={() => toggleFaq(index)}
                  className="w-full px-8 py-6 text-left flex justify-between items-center font-semibold text-gray-900 hover:bg-gray-50 transition-colors duration-200"
                >
                  <span>{faq.question}</span>
                  <span className={`text-2xl transition-transform duration-200 ${activeFaq === index ? 'transform rotate-45' : ''}`}>
                    +
                  </span>
                </button>
                <div className={`px-8 transition-all duration-300 ${activeFaq === index ? 'py-6' : 'max-h-0 overflow-hidden'}`}>
                  <p className="text-gray-600 leading-relaxed">{faq.answer}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-gradient-to-br from-orange-400 to-orange-600 text-white py-20 text-center">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-4xl font-bold mb-5">Ready to Get Started?</h2>
          <p className="text-xl mb-10 max-w-2xl mx-auto">
            Join thousands of sellers who are already optimizing their Amazon business with SellerQI
          </p>
          
          <div className="flex flex-wrap justify-center gap-5">
            <Link 
              to="/sign-up" 
              className="bg-white text-orange-500 px-10 py-4 rounded-full font-semibold text-lg hover:-translate-y-1 hover:shadow-lg transition-all duration-300"
            >
              Start Free Trial
            </Link>
            <Link 
              to="/contact-us" 
              className="bg-transparent text-white border-2 border-white px-10 py-4 rounded-full font-semibold text-lg hover:-translate-y-1 hover:shadow-lg transition-all duration-300"
            >
              Contact Us
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <Footer />
    </div>
  );
};

export default HowItWorksPage;