import React from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../Components/Navigation/Navbar';
import Footer from '../Components/Navigation/Footer';

const PromotionsPage = () => {
  // Custom styles for animations and complex gradients
  const pulseAnimation = {
    animation: 'pulse 3s ease-in-out infinite'
  };

  const customStyles = `
    @keyframes pulse {
      0%, 100% { transform: scale(1); opacity: 0.5; }
      50% { transform: scale(1.1); opacity: 0.3; }
    }
  `;

  return (
    <>
      <style>{customStyles}</style>
      <div className="min-h-screen bg-white">
        {/* Header */}
        <Navbar />

        {/* Hero Section */}
        <section className="relative bg-gradient-to-br from-green-500 to-blue-600 text-white py-20 overflow-hidden">
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-96 h-96 bg-white/10 rounded-full blur-3xl" style={pulseAnimation}></div>
          </div>
          <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-5xl font-bold mb-5">Promotions & Deals Management</h2>
            <p className="text-xl max-w-3xl mx-auto mb-12 opacity-95">
              Create compelling promotions that drive sales, improve rankings, and build customer loyalty
            </p>
            
            <div className="flex flex-wrap justify-center gap-12 mt-12">
              {[
                { value: '+156%', label: 'Average Sales Increase' },
                { value: '3.2x', label: 'Conversion Rate Boost' },
                { value: '78%', label: 'Repeat Purchase Rate' }
              ].map((stat, index) => (
                <div key={index} className="bg-white/15 backdrop-blur-md rounded-xl px-10 py-6 border border-white/20">
                  <div className="text-4xl font-bold mb-2">{stat.value}</div>
                  <div className="text-sm opacity-90">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Promotion Types */}
        <section className="py-20 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-4xl font-bold text-gray-900 mb-5">Master Every Amazon Promotion Type</h2>
              <p className="text-xl text-gray-600 max-w-2xl mx-auto">
                Leverage the full spectrum of Amazon's promotional tools to maximize your sales potential
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {[
                {
                  icon: '⚡',
                  title: 'Lightning Deals',
                  description: 'Time-sensitive promotions featured on Amazon\'s Deals page for maximum visibility',
                  benefits: ['Deal submission automation', 'Optimal timing recommendations', 'Inventory planning tools', 'Performance forecasting', 'ROI tracking & analysis']
                },
                {
                  icon: '🎟️',
                  title: 'Coupons',
                  description: 'Digital coupons that customers can clip and apply at checkout for instant savings',
                  benefits: ['Bulk coupon creation', 'Targeted customer segments', 'Budget management', 'Redemption tracking', 'A/B testing capabilities']
                },
                {
                  icon: '💰',
                  title: 'Percentage Off',
                  description: 'Simple percentage discounts that automatically apply to eligible customers',
                  benefits: ['Dynamic pricing rules', 'Tiered discount structures', 'Minimum quantity settings', 'Cross-promotion setup', 'Margin protection']
                },
                {
                  icon: '🎁',
                  title: 'Buy One Get One',
                  description: 'Bundle promotions that encourage larger basket sizes and inventory movement',
                  benefits: ['BOGO configuration', 'Bundle optimization', 'Cross-sell opportunities', 'Inventory balancing', 'Profit analysis']
                },
                {
                  icon: '🌟',
                  title: 'Prime Exclusive',
                  description: 'Special discounts for Prime members to increase visibility and conversion',
                  benefits: ['Prime badge optimization', 'Member targeting', 'Subscribe & Save setup', 'Prime Day preparation', 'Performance metrics']
                },
                {
                  icon: '📅',
                  title: 'Seasonal Campaigns',
                  description: 'Strategic promotions aligned with holidays and shopping events',
                  benefits: ['Holiday calendar planning', 'Event-based automation', 'Inventory forecasting', 'Multi-channel coordination', 'Year-over-year analysis']
                }
              ].map((promo, index) => (
                <div key={index} className="group bg-gray-50 rounded-xl p-8 text-center transition-all duration-300 border-2 border-transparent hover:border-orange-400 hover:shadow-xl hover:-translate-y-1 relative overflow-hidden">
                  <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-orange-400 to-green-500 transform scale-x-0 group-hover:scale-x-100 transition-transform duration-300"></div>
                  <div className="text-5xl mb-5">{promo.icon}</div>
                  <h3 className="text-2xl font-semibold text-gray-900 mb-4">{promo.title}</h3>
                  <p className="text-gray-600 mb-5">{promo.description}</p>
                  <ul className="text-left space-y-2">
                    {promo.benefits.map((benefit, i) => (
                      <li key={i} className="text-gray-600 text-sm flex items-start">
                        <span className="text-green-500 font-bold mr-2">→</span>
                        {benefit}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Management Tools */}
        <section className="py-20 bg-gray-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-4xl font-bold text-gray-900 mb-5">Powerful Promotion Management Tools</h2>
              <p className="text-xl text-gray-600 max-w-2xl mx-auto">
                Everything you need to plan, execute, and optimize your promotional strategy
              </p>
            </div>

            {/* Tool Showcase 1 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center mb-20">
              <div>
                <h3 className="text-3xl font-semibold text-gray-900 mb-5">Intelligent Scheduling & Planning</h3>
                <p className="text-gray-600 mb-6 leading-relaxed">
                  Plan your promotional calendar months in advance with our intelligent scheduling system. Our AI analyzes historical data, competitor activity, and market trends to recommend optimal promotion timing.
                </p>
                <p className="text-gray-600 mb-8 leading-relaxed">
                  Visualize your entire promotional strategy on an interactive calendar, avoid conflicts, and ensure consistent deal flow throughout the year.
                </p>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {[
                    { title: 'Smart Scheduling', desc: 'AI-powered timing recommendations based on sales patterns' },
                    { title: 'Conflict Detection', desc: 'Automatic alerts for overlapping or competing promotions' },
                    { title: 'Inventory Sync', desc: 'Real-time inventory checks to ensure deal availability' },
                    { title: 'Budget Tracking', desc: 'Monitor promotional spend and ROI in real-time' }
                  ].map((feature, i) => (
                    <div key={i} className="bg-white p-5 rounded-lg shadow-md">
                      <h4 className="font-semibold text-gray-900 mb-2">{feature.title}</h4>
                      <p className="text-gray-600 text-sm">{feature.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
              
              <div className="bg-white rounded-xl  shadow-lg flex items-center justify-center">
                <img src='https://res.cloudinary.com/ddoa960le/image/upload/v1751103114/feature_lyyrpn.png' className="text-gray-400 text-center rounded-xl"/>
              </div>
            </div>

            {/* Tool Showcase 2 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
              <div className="order-2 lg:order-1 bg-white rounded-xl  shadow-lg  flex items-center justify-center">
                <img src='https://res.cloudinary.com/ddoa960le/image/upload/v1751103009/profitibility_wcmvoe.png' className="text-gray-400 text-center rounded-xl"/>
              </div>
              
              <div className="order-1 lg:order-2">
                <h3 className="text-3xl font-semibold text-gray-900 mb-5">Performance Analytics & Optimization</h3>
                <p className="text-gray-600 mb-6 leading-relaxed">
                  Track every aspect of your promotional performance with granular analytics. Understand what works, what doesn't, and continuously optimize your strategy.
                </p>
                <p className="text-gray-600 mb-8 leading-relaxed">
                  Our machine learning algorithms analyze millions of data points to provide actionable insights and recommendations for future promotions.
                </p>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {[
                    { title: 'Real-time Metrics', desc: 'Live tracking of sales, units, and conversion rates' },
                    { title: 'Profit Analysis', desc: 'True profitability calculations including all fees' },
                    { title: 'Customer Insights', desc: 'Understand who\'s buying and their lifetime value' },
                    { title: 'Competitive Intel', desc: 'Monitor competitor promotions and market positioning' }
                  ].map((feature, i) => (
                    <div key={i} className="bg-white p-5 rounded-lg shadow-md">
                      <h4 className="font-semibold text-gray-900 mb-2">{feature.title}</h4>
                      <p className="text-gray-600 text-sm">{feature.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Strategy Timeline */}
        <section className="py-20 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-4xl font-bold text-gray-900 mb-5">Strategic Promotion Planning Process</h2>
              <p className="text-xl text-gray-600 max-w-2xl mx-auto">
                Follow our proven methodology to maximize promotional success
              </p>
            </div>

            <div className="max-w-4xl mx-auto relative">
              {/* Timeline line */}
              <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-gray-300 transform -translate-x-1/2 hidden lg:block"></div>
              
              {[
                {
                  num: '1',
                  title: 'Market Analysis',
                  desc: 'Analyze market conditions, competitor activity, and seasonal trends to identify optimal promotion opportunities. Our AI scans thousands of data points to surface insights.'
                },
                {
                  num: '2',
                  title: 'Goal Setting',
                  desc: 'Define clear objectives for each promotion - whether it\'s clearing inventory, boosting rankings, or acquiring new customers. Set measurable KPIs to track success.'
                },
                {
                  num: '3',
                  title: 'Promotion Design',
                  desc: 'Create compelling offers that balance customer appeal with profitability. Test different discount levels, promotion types, and messaging to find the sweet spot.'
                },
                {
                  num: '4',
                  title: 'Launch & Monitor',
                  desc: 'Execute promotions with precision timing and monitor performance in real-time. Make adjustments on the fly to maximize results and minimize waste.'
                },
                {
                  num: '5',
                  title: 'Analyze & Iterate',
                  desc: 'Deep dive into promotion results to understand what drove success. Apply learnings to future campaigns and continuously improve your promotional strategy.'
                }
              ].map((item, index) => (
                <div key={index} className={`flex items-center mb-16 ${index % 2 === 0 ? 'lg:flex-row' : 'lg:flex-row-reverse'}`}>
                  <div className={`flex-1 ${index % 2 === 0 ? 'lg:pr-8' : 'lg:pl-8'}`}>
                    <div className="bg-gray-50 rounded-xl p-8 shadow-md">
                      <h4 className="text-2xl font-semibold text-gray-900 mb-4">{item.title}</h4>
                      <p className="text-gray-600 leading-relaxed">{item.desc}</p>
                    </div>
                  </div>
                  <div className="w-10 h-10 bg-orange-400 rounded-full flex items-center justify-center text-white font-bold z-10 mx-8 lg:mx-0">
                    {item.num}
                  </div>
                  <div className="flex-1 hidden lg:block"></div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Analytics Section */}
        <section className="py-20 bg-gray-900 text-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-4xl font-bold mb-5">Comprehensive Promotion Analytics</h2>
              <p className="text-xl opacity-90 max-w-2xl mx-auto">
                Make data-driven decisions with advanced reporting
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {[
                { icon: '📊', title: 'Sales Impact', desc: 'Track incremental sales, units sold, and revenue generated by each promotion' },
                { icon: '💵', title: 'Profitability', desc: 'Calculate true ROI including promotion costs, fees, and opportunity costs' },
                { icon: '👥', title: 'Customer Metrics', desc: 'Analyze new vs. repeat customers, lifetime value, and retention rates' },
                { icon: '📈', title: 'Ranking Impact', desc: 'Monitor BSR improvements and keyword ranking changes from promotions' },
                { icon: '🎯', title: 'Conversion Rates', desc: 'Track how promotions impact conversion rates and customer behavior' },
                { icon: '🔄', title: 'Velocity Metrics', desc: 'Measure sales velocity changes and inventory turnover improvements' }
              ].map((item, index) => (
                <div key={index} className="bg-white/10 backdrop-blur-md rounded-xl p-8 text-center border border-white/20">
                  <div className="text-4xl mb-5 text-orange-400">{item.icon}</div>
                  <h4 className="text-xl font-semibold mb-3">{item.title}</h4>
                  <p className="text-sm opacity-90">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-20 bg-gradient-to-br from-orange-400 to-orange-600 text-white text-center">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-4xl font-bold mb-5">Ready to Supercharge Your Promotions?</h2>
            <p className="text-xl mb-10 max-w-2xl mx-auto">
              Join thousands of sellers using SellerQI to create promotions that drive real results
            </p>
            
            <div className="flex flex-wrap justify-center gap-5">
              <Link to="/sign-up" className="bg-white text-orange-500 px-10 py-4 rounded-full font-semibold text-lg hover:-translate-y-1 hover:shadow-lg transition-all duration-300">
                Start Free Trial
              </Link>
              <Link to="/pricing" className="bg-transparent text-white border-2 border-white px-10 py-4 rounded-full font-semibold text-lg hover:-translate-y-1 hover:shadow-lg transition-all duration-300">
                View Pricing
              </Link>
            </div>
          </div>
        </section>

        {/* Footer */}
        <Footer />
      </div>
    </>
  );
};

export default PromotionsPage;