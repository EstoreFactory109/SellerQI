import React from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../Components/Navigation/Navbar';
import Footer from '../Components/Navigation/Footer';

const AdvertisingPage = () => {
  const campaignTypes = [
    {
      icon: '🎯',
      title: 'Sponsored Products',
      description: 'Optimize your core PPC campaigns with advanced keyword targeting, bid optimization, and competitor analysis.',
      features: [
        'Automatic & manual campaign management',
        'Dynamic bid adjustments by placement',
        'Negative keyword harvesting',
        'Search term analysis & optimization',
        'Product targeting strategies'
      ]
    },
    {
      icon: '🏢',
      title: 'Sponsored Brands',
      description: 'Build brand awareness and drive traffic to your Store or custom landing pages with headline search ads.',
      features: [
        'Store spotlight campaigns',
        'Video ad campaign management',
        'Brand keyword protection',
        'Custom image creative testing',
        'Landing page optimization'
      ]
    },
    {
      icon: '📱',
      title: 'Sponsored Display',
      description: 'Reach customers on and off Amazon with display advertising powered by Amazon\'s shopping insights.',
      features: [
        'Audience targeting optimization',
        'Product retargeting campaigns',
        'Views remarketing',
        'Contextual targeting',
        'Creative optimization'
      ]
    }
  ];

  const optimizationTools = [
    {
      icon: '🔍',
      title: 'Keyword Research & Discovery',
      description: 'Uncover high-converting keywords your competitors are missing. Our advanced algorithms analyze search volume, competition, and relevance to find golden opportunities.',
      features: [
        'Reverse ASIN lookup',
        'Search volume trends',
        'Keyword difficulty scores',
        'Long-tail suggestions',
        'Competitor gap analysis',
        'Seasonal keyword alerts'
      ]
    },
    {
      icon: '💰',
      title: 'Intelligent Bid Management',
      description: 'Our AI-powered bid optimizer adjusts your bids in real-time based on performance data, competition, and your target ACOS to maximize profitability.',
      features: [
        'Dayparting optimization',
        'Placement bid modifiers',
        'Rule-based automation',
        'Budget pacing',
        'Competitor bid tracking',
        'Profit-based bidding'
      ]
    },
    {
      icon: '📊',
      title: 'Performance Analytics',
      description: 'Get deep insights into your advertising performance with customizable dashboards, advanced metrics, and actionable recommendations.',
      features: [
        'Custom KPI dashboards',
        'Attribution modeling',
        'Cohort analysis',
        'Share of voice tracking',
        'Conversion path analysis',
        'Competitive benchmarking'
      ]
    },
    {
      icon: '🎨',
      title: 'Creative Testing & Optimization',
      description: 'Test different ad creatives, headlines, and images to find the combinations that drive the highest CTR and conversions.',
      features: [
        'A/B testing framework',
        'Image performance analysis',
        'Headline optimization',
        'Video ad analytics',
        'Creative fatigue alerts',
        'Brand consistency checks'
      ]
    }
  ];

  const reportingFeatures = [
    { icon: '📈', title: 'Performance Reports', description: 'Track ACOS, ROAS, CTR, CVR, and custom KPIs across all campaigns with historical comparisons' },
    { icon: '🎯', title: 'Search Term Reports', description: 'Analyze search term performance to discover new keywords and identify wasted spend' },
    { icon: '🏆', title: 'Competitive Analysis', description: 'Monitor competitor ad strategies, share of voice, and market positioning' },
    { icon: '💡', title: 'Attribution Reports', description: 'Understand the full customer journey and the true impact of your advertising' },
    { icon: '📊', title: 'Custom Dashboards', description: 'Build personalized dashboards with the metrics that matter most to your business' },
    { icon: '📧', title: 'Automated Alerts', description: 'Get notified of important changes, opportunities, and performance anomalies' }
  ];

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <Navbar />

      {/* Hero Section */}
      <section className="bg-gradient-to-br from-orange-400 to-blue-700 text-white py-20 text-center">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-5xl font-bold mb-5">Amazon Advertising Management</h2>
          <p className="text-xl max-w-3xl mx-auto mb-10 opacity-95">
            Maximize your ROAS with AI-powered PPC optimization, intelligent bid management, and comprehensive campaign analytics
          </p>
          
          <div className="flex flex-col md:flex-row justify-center items-center gap-8 md:gap-16 mt-12">
            {[
              { value: '-35%', label: 'Average ACOS Reduction' },
              { value: '2.8x', label: 'ROAS Improvement' },
              { value: '60%', label: 'Time Saved on PPC' }
            ].map((metric, index) => (
              <div key={index} className="bg-white/10 backdrop-blur-md rounded-xl px-10 py-6 border border-white/20">
                <div className="text-4xl font-bold mb-2">{metric.value}</div>
                <div className="text-base opacity-90">{metric.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Campaign Types Section */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900 mb-5">Master Every Amazon Advertising Campaign Type</h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Comprehensive tools for Sponsored Products, Sponsored Brands, Sponsored Display, and DSP campaigns
            </p>
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
            {campaignTypes.map((campaign, index) => (
              <div 
                key={index} 
                className="bg-gray-50 rounded-xl p-10 border-2 border-transparent hover:border-orange-400 hover:-translate-y-1 hover:shadow-xl transition-all duration-300"
              >
                <div className="w-20 h-20 bg-gradient-to-br from-orange-400 to-orange-600 rounded-xl flex items-center justify-center text-3xl text-white mb-6">
                  {campaign.icon}
                </div>
                <h3 className="text-2xl font-semibold text-gray-900 mb-4">{campaign.title}</h3>
                <p className="text-gray-600 mb-5 leading-relaxed">{campaign.description}</p>
                <ul className="space-y-2">
                  {campaign.features.map((feature, i) => (
                    <li key={i} className="flex items-start text-gray-600">
                      <span className="text-orange-400 font-bold text-lg mr-2">•</span>
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Optimization Tools Section */}
      <section className="bg-gray-50 py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900 mb-5">Advanced Optimization Tools</h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Leverage cutting-edge technology to stay ahead of the competition
            </p>
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
            {optimizationTools.map((tool, index) => (
              <div key={index} className="bg-white rounded-xl p-10 shadow-md">
                <div className="flex items-center gap-5 mb-6">
                  <div className="w-16 h-16 bg-blue-700 rounded-full flex items-center justify-center text-2xl text-white">
                    {tool.icon}
                  </div>
                  <h3 className="text-2xl font-semibold text-gray-900">{tool.title}</h3>
                </div>
                <p className="text-gray-600 mb-6 leading-relaxed">{tool.description}</p>
                <div className="grid grid-cols-2 gap-4">
                  {tool.features.map((feature, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-gray-600">
                      <span className="text-green-500 font-bold">✓</span>
                      {feature}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Automation Section */}
      <section className="bg-white py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900">Powerful Automation That Works 24/7</h2>
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div>
              <h3 className="text-3xl font-semibold text-gray-900 mb-5">Set It and Optimize It</h3>
              <p className="text-gray-600 mb-5 leading-relaxed">
                Our intelligent automation continuously optimizes your campaigns based on real-time performance data. Set your goals, and let our AI handle the heavy lifting while you focus on growing your business.
              </p>
              <p className="text-gray-600 mb-10 leading-relaxed">
                From automatic negative keyword harvesting to dynamic bid adjustments, our platform makes thousands of micro-optimizations daily to improve your advertising efficiency.
              </p>
              
              <div className="grid grid-cols-2 gap-6">
                {[
                  { number: '10,000+', label: 'Daily Optimizations' },
                  { number: '24/7', label: 'Monitoring' },
                  { number: '5 min', label: 'Setup Time' },
                  { number: '0', label: 'Manual Work' }
                ].map((stat, i) => (
                  <div key={i} className="bg-gray-50 rounded-lg p-6 text-center">
                    <div className="text-3xl font-bold text-orange-400 mb-2">{stat.number}</div>
                    <div className="text-sm text-gray-600">{stat.label}</div>
                  </div>
                ))}
              </div>
            </div>
            
            <div className="bg-gray-50 rounded-xl  flex items-center justify-center shadow-lg ">
              <img src="https://res.cloudinary.com/ddoa960le/image/upload/v1751101084/accountSummery_l7rk09.png" className="text-gray-400 text-center bg-cover rounded-xl"/>
            </div>
          </div>
        </div>
      </section>

      {/* Reporting Section */}
      <section className="bg-gray-900 text-white py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold mb-5">Comprehensive Reporting & Insights</h2>
            <p className="text-xl opacity-90 max-w-2xl mx-auto">
              Make data-driven decisions with advanced reporting capabilities
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10">
            {reportingFeatures.map((report, index) => (
              <div key={index} className="text-center">
                <div className="w-20 h-20 bg-orange-400/20 rounded-full flex items-center justify-center text-4xl mx-auto mb-5">
                  {report.icon}
                </div>
                <h4 className="text-xl font-semibold mb-3">{report.title}</h4>
                <p className="text-sm opacity-90 leading-relaxed">{report.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ROI CTA Section */}
      <section className="bg-gradient-to-br from-orange-400 to-orange-600 text-white py-20 text-center">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-4xl font-bold mb-5">See the ROI for Yourself</h2>
          <p className="text-xl mb-10 max-w-2xl mx-auto">
            Our average customer sees a 35% reduction in ACOS within the first 30 days
          </p>
          
          <div className="bg-white/10 backdrop-blur-md rounded-xl p-10 max-w-lg mx-auto mb-10 border border-white/20">
            <h3 className="text-2xl font-semibold mb-5">Quick ROI Calculator</h3>
            <p className="mb-4">If you spend $10,000/month on Amazon ads with 30% ACOS:</p>
            <div className="text-4xl font-bold my-5">Save $1,050/month</div>
            <p>That's $12,600 in annual savings!</p>
          </div>
          
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

export default AdvertisingPage;