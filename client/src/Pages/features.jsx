import React from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../Components/Navigation/Navbar';
import Footer from '../Components/Navigation/Footer';

const FeaturesPage = () => {
  const features = [
    {
      icon: '📦',
      title: 'Inventory & Order Management',
      description: 'Streamline your operations with real-time inventory tracking and automated order processing',
      list: [
        'Real-time stock level monitoring',
        'Automated restock alerts',
        'Multi-channel inventory sync',
        'Order fulfillment automation',
        'FBA shipment planning'
      ]
    },
    {
      icon: '📊',
      title: 'Advertising Management',
      description: 'Optimize your Amazon PPC campaigns with AI-driven insights and automation',
      list: [
        'Campaign performance analytics',
        'Keyword research & optimization',
        'Bid management automation',
        'ACOS optimization',
        'Competitor analysis'
      ]
    },
    {
      icon: '🎯',
      title: 'Promotions & Deals',
      description: 'Create and manage promotions to boost sales and improve product visibility',
      list: [
        'Lightning Deal management',
        'Coupon creation & tracking',
        'Discount scheduling',
        'Promotion performance analytics',
        'A/B testing for offers'
      ]
    },
    {
      icon: '📈',
      title: 'Sales Analytics',
      description: 'Comprehensive insights into your business performance and growth opportunities',
      list: [
        'Revenue & profit tracking',
        'Product performance metrics',
        'Market trend analysis',
        'Competitor monitoring',
        'Custom reporting'
      ]
    },
    {
      icon: '🔍',
      title: 'Product Research',
      description: 'Discover profitable products and optimize your listings for maximum visibility',
      list: [
        'Product opportunity finder',
        'Keyword research tools',
        'Listing optimization',
        'Review monitoring',
        'BSR tracking'
      ]
    },
    {
      icon: '🤖',
      title: 'Automation Tools',
      description: 'Save time with intelligent automation for repetitive tasks',
      list: [
        'Automated repricing',
        'Review request automation',
        'Email campaign automation',
        'Report scheduling',
        'Alert notifications'
      ]
    }
  ];

  const detailedFeatures = [
    {
      title: 'Advanced Inventory Management',
      content1: 'Our inventory management system provides real-time visibility into your stock levels across all Amazon marketplaces and fulfillment channels. Track inventory movement, set custom reorder points, and receive intelligent restocking recommendations based on sales velocity and seasonal trends.',
      content2: 'The system automatically calculates optimal reorder quantities, considering lead times, storage fees, and cash flow requirements. Integration with FBA ensures accurate tracking of inbound shipments and available inventory.',
      screenshot: 'https://res.cloudinary.com/ddoa960le/image/upload/v1751096632/featuresOne_wiwsua.png'
    },
    {
      title: 'Intelligent Advertising Optimization',
      content1: 'Take control of your Amazon advertising with our comprehensive PPC management suite. Our AI-powered algorithms continuously optimize your campaigns, adjusting bids based on performance data and your target ACOS.',
      content2: 'Discover high-converting keywords, identify negative keywords automatically, and track competitor advertising strategies. The platform provides detailed analytics on campaign performance, helping you maximize ROI on every advertising dollar spent.',
      screenshot: 'https://res.cloudinary.com/ddoa960le/image/upload/v1751096631/featuresThree_hsssry.png'
    },
    {
      title: 'Strategic Promotions Management',
      content1: 'Create compelling promotions that drive sales and improve your Best Seller Rank. Our promotions engine helps you plan, execute, and analyze various promotional strategies including Lightning Deals, coupons, and percentage-off promotions.',
      content2: 'Track the performance of each promotion in real-time, measure the impact on sales velocity, and calculate the true ROI of your promotional investments. A/B test different offer types to find what resonates best with your customers.',
      screenshot: 'https://res.cloudinary.com/ddoa960le/image/upload/v1751096631/featuresTwo_mwikvp.png'
    }
  ];

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <Navbar />

      {/* Hero Section */}
      <section className="bg-gradient-to-br from-gray-900 to-gray-800 text-white py-16 text-center">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-4xl font-bold mb-5">Powerful Features for Amazon Sellers</h2>
          <p className="text-xl max-w-3xl mx-auto opacity-90">
            Everything you need to manage, optimize, and grow your Amazon business in one comprehensive platform
          </p>
        </div>
      </section>

      {/* Features Grid */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {features.map((feature, index) => (
            <div 
              key={index} 
              className="bg-white rounded-xl p-8 shadow-md hover:-translate-y-1 hover:shadow-xl transition-all duration-300"
            >
              <div className="w-16 h-16 bg-orange-400 rounded-xl flex items-center justify-center text-2xl mb-5">
                {feature.icon}
              </div>
              <h3 className="text-2xl font-semibold text-gray-900 mb-4">{feature.title}</h3>
              <p className="text-gray-600 mb-5">{feature.description}</p>
              <ul className="space-y-2">
                {feature.list.map((item, i) => (
                  <li key={i} className="flex items-start text-gray-600">
                    <span className="text-green-500 font-bold mr-2">✓</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Detailed Features Section */}
      <section className="bg-white py-16 my-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-4xl font-bold text-gray-900 text-center mb-12">Feature Deep Dive</h2>
          
          {detailedFeatures.map((feature, index) => (
            <div 
              key={index} 
              className={`grid grid-cols-1 lg:grid-cols-2 gap-12 items-center mb-20 ${
                index % 2 === 1 ? 'lg:flex-row-reverse' : ''
              }`}
            >
              <div className={`${index % 2 === 1 ? 'lg:order-2' : ''}`}>
                <h3 className="text-3xl font-semibold text-gray-900 mb-5">{feature.title}</h3>
                <p className="text-gray-600 mb-4 leading-relaxed">{feature.content1}</p>
                <p className="text-gray-600 leading-relaxed">{feature.content2}</p>
              </div>
              <div className={`bg-gray-100 rounded-xl overflow-hidden min-h-[300px] shadow-md ${
                index % 2 === 1 ? 'lg:order-1' : ''
              }`}>
                <img className="w-full h-full object-cover" src={feature.screenshot} alt={feature.title} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="bg-gradient-to-br from-orange-400 to-orange-600 text-white py-16 px-8 rounded-xl text-center">
          <h2 className="text-4xl font-bold mb-5">Ready to Transform Your Amazon Business?</h2>
          <p className="text-xl mb-8">
            Join thousands of successful sellers using SellerQI to automate and scale their operations
          </p>
          <Link 
            to="/sign-up" 
            className="inline-block bg-white text-orange-500 px-10 py-4 rounded-full font-semibold text-lg hover:-translate-y-1 hover:shadow-lg transition-all duration-300"
          >
            Start Your Free Trial
          </Link>
        </div>
      </section>

      {/* Footer */}
      <Footer />
    </div>
  );
};

export default FeaturesPage;