import React from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../Components/Navigation/Navbar';
import Footer from '../Components/Navigation/Footer';

const InventoryManagementPage = () => {
  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <Navbar />

      {/* Hero Section */}
      <section className="bg-gradient-to-br from-blue-700 to-gray-900 text-white py-20 text-center">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-5xl font-bold mb-5">Inventory & Order Management</h2>
          <p className="text-xl max-w-3xl mx-auto opacity-90">
            Take complete control of your Amazon inventory with real-time tracking, intelligent forecasting, and automated order processing
          </p>
          
          <div className="flex flex-col md:flex-row justify-center items-center gap-8 md:gap-12 mt-10">
            {[
              { number: '99.9%', label: 'Inventory Accuracy' },
              { number: '3x', label: 'Faster Order Processing' },
              { number: '45%', label: 'Reduction in Stockouts' }
            ].map((stat, index) => (
              <div key={index} className="text-center">
                <div className="text-4xl font-bold text-orange-400">{stat.number}</div>
                <div className="text-base opacity-80 mt-2">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900 mb-5">Complete Inventory Control at Your Fingertips</h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Manage your entire Amazon inventory ecosystem from a single, powerful dashboard
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10 mb-20">
            {[
              {
                icon: '📊',
                title: 'Real-Time Tracking',
                description: 'Monitor stock levels across all Amazon marketplaces and warehouses in real-time. Get instant updates on inventory movements, returns, and adjustments.'
              },
              {
                icon: '🔔',
                title: 'Smart Alerts',
                description: 'Receive customizable alerts for low stock, overstock situations, and unusual inventory movements. Never miss a restock opportunity again.'
              },
              {
                icon: '🤖',
                title: 'Automated Reordering',
                description: 'Set custom reorder points and let our AI calculate optimal order quantities based on sales velocity, seasonality, and lead times.'
              },
              {
                icon: '📦',
                title: 'FBA Integration',
                description: 'Seamlessly manage FBA shipments, track inbound inventory, and optimize your FBA storage to minimize fees and maximize availability.'
              },
              {
                icon: '📈',
                title: 'Demand Forecasting',
                description: 'Leverage machine learning to predict future demand based on historical data, trends, and seasonal patterns.'
              },
              {
                icon: '🌍',
                title: 'Multi-Channel Sync',
                description: 'Synchronize inventory across multiple sales channels to prevent overselling and maintain accurate stock levels everywhere.'
              }
            ].map((feature, index) => (
              <div 
                key={index} 
                className="bg-gray-50 rounded-xl p-8 text-center hover:-translate-y-1 hover:shadow-xl transition-all duration-300"
              >
                <div className="text-5xl mb-5 text-blue-700">{feature.icon}</div>
                <h3 className="text-2xl font-semibold text-gray-900 mb-4">{feature.title}</h3>
                <p className="text-gray-600 leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Detailed Features */}
      <section className="bg-gray-50 py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900">Powerful Features That Drive Results</h2>
          </div>
          
          {[
            {
              title: 'Advanced Order Management',
              description1: 'Process orders efficiently with our comprehensive order management system. Handle thousands of orders seamlessly with automated workflows that save time and reduce errors.',
              description2: 'Our system integrates directly with Amazon\'s API to provide real-time order status updates, automated shipping label generation, and intelligent order routing based on inventory location.',
              benefits: [
                'Bulk order processing capabilities',
                'Automated shipping label generation',
                'Custom packing slip templates',
                'Order status tracking and updates',
                'Return and refund management'
              ],
              screenshot: 'https://res.cloudinary.com/ddoa960le/image/upload/v1751106013/efde9b48-2ac2-4b30-a4bd-d8f31df6ad76_gtntkb.png'
            },
            {
              title: 'Intelligent Inventory Analytics',
              description1: 'Make data-driven decisions with comprehensive analytics that provide deep insights into your inventory performance. Identify slow-moving stock, optimize storage costs, and maximize your inventory turnover.',
              description2: 'Our analytics engine processes millions of data points to give you actionable insights on inventory health, aging analysis, and profitability by SKU.',
              benefits: [
                'Inventory turnover analysis',
                'Dead stock identification',
                'Storage cost optimization',
                'Profitability analysis by SKU',
                'Seasonal trend detection'
              ],
              screenshot: 'https://res.cloudinary.com/ddoa960le/image/upload/v1751096632/featuresOne_wiwsua.png'
            },
            {
              title: 'Automated Restock Management',
              description1: 'Never run out of stock again with our intelligent restock management system. Our AI-powered algorithms calculate optimal reorder points and quantities based on multiple factors including sales velocity, lead times, and seasonal variations.',
              description2: 'Create custom restock rules for different product categories, set safety stock levels, and automate purchase order creation to streamline your supply chain.',
              benefits: [
                'Dynamic reorder point calculation',
                'Lead time management',
                'Supplier performance tracking',
                'Purchase order automation',
                'Cost optimization algorithms'
              ],
              screenshot: 'https://res.cloudinary.com/ddoa960le/image/upload/v1751106014/1b23514f-87bf-4416-bedc-aeee008e9068_eserki.png'
            }
          ].map((feature, index) => (
            <div 
              key={index} 
              className={`grid grid-cols-1 lg:grid-cols-2 gap-16 items-center mb-20 ${
                index % 2 === 1 ? 'lg:flex-row-reverse' : ''
              }`}
            >
              <div className={`${index % 2 === 1 ? 'lg:order-2' : ''}`}>
                <h3 className="text-3xl font-semibold text-gray-900 mb-5">{feature.title}</h3>
                <p className="text-gray-600 mb-5 leading-relaxed">{feature.description1}</p>
                <p className="text-gray-600 mb-8 leading-relaxed">{feature.description2}</p>
                <ul className="space-y-3 mt-8">
                  {feature.benefits.map((benefit, i) => (
                    <li key={i} className="flex items-start text-gray-600">
                      <span className="text-blue-700 font-bold text-lg mr-3">→</span>
                      {benefit}
                    </li>
                  ))}
                </ul>
              </div>
              <div className={`bg-white rounded-xl  shadow-lg flex items-center justify-center ${
                index % 2 === 1 ? 'lg:order-1' : ''
              }`}>
                <img className="text-gray-400 text-center rounded-xl" src={feature.screenshot}/>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Use Cases */}
      <section className="bg-white py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900 mb-5">Built for Every Type of Amazon Seller</h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Whether you're managing 10 SKUs or 10,000, our platform scales with your business
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              {
                icon: '🏪',
                title: 'Private Label Sellers',
                description: 'Manage product launches, monitor inventory velocity, and optimize reorder timing for maximum profitability'
              },
              {
                icon: '🏭',
                title: 'Wholesale Sellers',
                description: 'Track inventory across multiple suppliers, manage bulk orders, and maintain optimal stock levels for high-volume sales'
              },
              {
                icon: '🛍️',
                title: 'Retail Arbitrage',
                description: 'Quick inventory entry, profit tracking by source, and fast-moving stock alerts for time-sensitive opportunities'
              },
              {
                icon: '🌐',
                title: 'Multi-Channel Sellers',
                description: 'Sync inventory across Amazon, your website, and other marketplaces to prevent overselling'
              }
            ].map((useCase, index) => (
              <div 
                key={index} 
                className="border-2 border-gray-200 rounded-xl p-8 text-center hover:border-blue-700 hover:-translate-y-1 transition-all duration-300"
              >
                <div className="text-4xl mb-5 text-orange-400">{useCase.icon}</div>
                <h4 className="text-xl font-semibold text-gray-900 mb-4">{useCase.title}</h4>
                <p className="text-gray-600 text-sm">{useCase.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Integration Section */}
      <section className="bg-gray-900 text-white py-16 text-center">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold mb-5">Seamless Integration with Your Existing Tools</h2>
          <p className="text-xl mb-10 opacity-90">SellerQI integrates with the platforms you already use</p>
          
          <div className="flex flex-wrap justify-center items-center gap-6">
            {['Amazon SP-API', 'QuickBooks', 'ShipStation', '3PL Partners'].map((integration, index) => (
              <div key={index} className="bg-white text-gray-900 px-8 py-5 rounded-lg font-semibold">
                {integration}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-gradient-to-br from-orange-400 to-orange-600 text-white py-20 text-center">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-4xl font-bold mb-5">Start Managing Your Inventory Like a Pro</h2>
          <p className="text-xl mb-10 max-w-2xl mx-auto">
            Join thousands of sellers who've transformed their inventory management with SellerQI
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

export default InventoryManagementPage;