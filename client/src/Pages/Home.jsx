import React, { useState, useEffect, useRef } from 'react';
import { ChevronRight, Check, X, Search, ChevronDown, BarChart3, TrendingUp, Users, ShieldCheck, Zap, Info, Star, PlayCircle, UserCheck, Briefcase, HelpCircle, Plus, Minus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from '../hooks/useAuth';
import Navbar from '../Components/Navigation/Navbar';
import Footer from '../Components/Navigation/Footer';
import GetIP from '../operations/GetIP';
import axios from 'axios';

export default function SellerQIHomepage() {
  const [asin, setAsin] = useState('');
  const [market, setMarket] = useState('US');
  const [showMarketDropdown, setShowMarketDropdown] = useState(false);
  const [searchesLeft, setSearchesLeft] = useState(0);
  const [openFaqIndex, setOpenFaqIndex] = useState(null);
  const marketDropdownRef = useRef(null);

  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useAuth();

  // Market options
  const marketOptions = [
    { value: 'US', label: 'US - United States' },
    { value: 'CA', label: 'CA - Canada' },
    { value: 'MX', label: 'MX - Mexico' },
    { value: 'BR', label: 'BR - Brazil' },
    { value: 'UK', label: 'UK - United Kingdom' },
    { value: 'DE', label: 'DE - Germany' },
    { value: 'FR', label: 'FR - France' },
    { value: 'IT', label: 'IT - Italy' },
    { value: 'ES', label: 'ES - Spain' },
    { value: 'NL', label: 'NL - Netherlands' },
    { value: 'SE', label: 'SE - Sweden' },
    { value: 'PL', label: 'PL - Poland' },
    { value: 'BE', label: 'BE - Belgium' },
    { value: 'TR', label: 'TR - Turkey' },
    { value: 'AE', label: 'AE - United Arab Emirates' },
    { value: 'SA', label: 'SA - Saudi Arabia' },
    { value: 'EG', label: 'EG - Egypt' },
    { value: 'IN', label: 'IN - India' },
    { value: 'JP', label: 'JP - Japan' },
    { value: 'AU', label: 'AU - Australia' },
    { value: 'SG', label: 'SG - Singapore' },
  ];

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);



  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (marketDropdownRef.current && !marketDropdownRef.current.contains(event.target)) {
        setShowMarketDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);


  let ipToSend=null;
  useEffect(()=>{
    
    GetIP().then((ip)=>{
      ipToSend=ip;
    }).catch((err)=>{
      console.log(err);
    })

    axios.post(`${import.meta.env.VITE_BASE_URI}/app/get-ip-tracking`,{ip:ipToSend})
    .then((res)=>{
    
      setSearchesLeft(res.data.data.searchesLeft);
    })
    .catch((err)=>{
      console.log(err);
    })

  },[])


  const handleAnalyze = async () => {
    // Check if searches are available
    if (searchesLeft <= 0) {
      alert('No free searches remaining. Please upgrade to Seller QI PRO to continue.');
      return;
    }

    // Validate ASIN input
    if (!asin.trim()) {
      alert('Please enter a valid ASIN.');
      return;
    }

    // Proceed with analysis
    navigate(`/loading?asin=${asin}&market=${market}`,{
      state:{
        ip:ipToSend
      }
    });
  }

  const handleStartFreeTrial = () => {
    // Store intended action for after signup
    localStorage.setItem('intendedAction', 'free-trial');
    // Navigate to signup page
    navigate('/sign-up');
  }

  return (
    <div className="min-h-screen w-full bg-white flex flex-col">
      {/* Navbar */}
      <Navbar />

      {/* Hero Section - SaaS Style */}
      <section className="relative bg-gradient-to-b from-gray-50 via-white to-white pt-16 pb-24 px-4 lg:px-6 overflow-hidden">
        {/* Background Elements */}
        <div className="absolute inset-0 bg-grid-slate-100 [mask-image:linear-gradient(0deg,white,rgba(255,255,255,0.6))] dark:bg-grid-slate-700/25 dark:[mask-image:linear-gradient(0deg,rgba(255,255,255,0.1),rgba(255,255,255,0.5))]"></div>
        <div className="absolute top-10 right-10 w-72 h-72 bg-gray-200 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-pulse"></div>
        <div className="absolute top-40 left-10 w-72 h-72 bg-emerald-200 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-pulse animation-delay-2000"></div>
        
        <div className="relative container mx-auto max-w-7xl">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-center mb-12"
          >
            {/* Announcement Bar */}
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-700 rounded-full text-sm font-medium mb-8">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
              New: AI-Powered Competitor Analysis Now Available
            </div>
            
            {/* Main Headline */}
            <h1 className="text-5xl lg:text-7xl font-bold leading-tight text-gray-900 mb-6">
              The Ultimate <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#3B4A6B] to-emerald-600">Amazon Seller</span> Growth Platform
            </h1>
            <p className="text-xl lg:text-2xl text-gray-600 max-w-4xl mx-auto mb-8 leading-relaxed">
              Instantly analyze, optimize, and scale your Amazon business with AI-powered insights. Join 10,000+ sellers who've increased their revenue by an average of <span className="font-semibold text-emerald-600">32%</span> in 90 days.
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
              <button className="bg-[#3B4A6B] text-white px-8 py-4 rounded-lg flex items-center gap-2 mx-auto sm:mx-0 hover:bg-[#2d3a52] transition-all duration-300 font-semibold text-lg shadow-lg hover:shadow-xl">
                Start Free Analysis <ChevronRight className="w-5 h-5" />
              </button>
              <button className="border-2 border-gray-300 text-gray-700 px-8 py-4 rounded-lg flex items-center gap-2 mx-auto sm:mx-0 hover:border-gray-400 transition-all duration-300 font-semibold text-lg">
                Watch Demo <PlayCircle className="w-5 h-5" />
              </button>
            </div>

            {/* Trust Indicators */}
            <div className="flex flex-wrap justify-center gap-6 text-sm text-gray-500 mb-12">
              <span className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-500" /> 7 Days Free Trial</span>
              <span className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-500" /> Free forever plan</span>
              <span className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-500" /> 5-minute setup</span>
              <span className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-[#3B4A6B]" /> SOC 2 Compliant</span>
            </div>

            {/* Input Section */}
            <div className="max-w-3xl mx-auto bg-white rounded-2xl border border-gray-200 shadow-xl p-6 mb-12">
              <div className="flex flex-col lg:flex-row gap-4">
                <div className="relative flex-1">
                  <Search className={`absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 ${searchesLeft <= 0 ? 'text-gray-300' : 'text-gray-400'}`} />
                  <input
                    type="text"
                    value={asin}
                    onChange={(e) => setAsin(e.target.value)}
                    placeholder="Enter Amazon ASIN (e.g., B08N5WRWNW)"
                    className={`w-full pl-12 pr-4 py-4 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3B4A6B] focus:border-transparent text-lg ${
                      searchesLeft <= 0 
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                        : 'bg-white text-gray-900'
                    }`}
                    disabled={searchesLeft <= 0}
                  />
                </div>
                <div className="relative" ref={marketDropdownRef}>
                  <button
                    type="button"
                    className={`flex items-center justify-between gap-2 px-6 py-4 border border-gray-300 rounded-xl focus:outline-none font-medium min-w-[200px] text-lg transition-colors ${
                      searchesLeft <= 0 
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                        : 'bg-white hover:bg-gray-50 text-gray-900'
                    }`}
                    onClick={() => searchesLeft > 0 && setShowMarketDropdown(!showMarketDropdown)}
                    disabled={searchesLeft <= 0}
                  >
                    <span>{marketOptions.find(option => option.value === market)?.label || 'Select Market'}</span>
                    <ChevronDown className={`w-5 h-5 ${searchesLeft <= 0 ? 'text-gray-300' : 'text-gray-400'}`} />
                  </button>
                  <AnimatePresence>
                    {showMarketDropdown && searchesLeft > 0 && (
                      <motion.div
                        className="absolute top-full left-0 w-full bg-white border border-gray-300 rounded-xl shadow-lg z-50 overflow-hidden max-h-60 overflow-y-auto mt-2"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2, ease: "easeInOut" }}
                      >
                        <ul className="py-2 text-sm text-gray-700">
                          {marketOptions.map((option) => (
                            <li
                              key={option.value}
                              className="px-4 py-3 hover:bg-gray-50 hover:text-[#3B4A6B] cursor-pointer transition-colors"
                              onClick={() => {
                                setMarket(option.value);
                                setShowMarketDropdown(false);
                              }}
                            >
                              {option.label}
                            </li>
                          ))}
                        </ul>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                <button
                  className={`px-8 py-4 rounded-xl flex items-center gap-2 font-semibold transition-all duration-300 whitespace-nowrap text-lg ${
                    searchesLeft <= 0 
                      ? 'bg-gray-400 text-gray-200 cursor-not-allowed' 
                      : 'bg-gradient-to-r from-[#3B4A6B] to-[#333651] text-white hover:from-[#2d3a52] hover:to-[#2a2e42] shadow-lg hover:shadow-xl'
                  }`}
                  onClick={handleAnalyze}
                  disabled={searchesLeft <= 0}
                >
                  Analyze Now <Zap className="w-5 h-5" />
                </button>
              </div>
              {searchesLeft > 0 && (
                <p className="text-center text-sm text-gray-500 mt-4">
                  🎉 <span className="font-semibold text-emerald-600">{searchesLeft} free analyses</span> remaining this month
                </p>
              )}
            </div>
          </motion.div>

          {/* Hero Image/Dashboard Preview */}
          <motion.div 
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="relative"
          >
            <div className="bg-[#3c4a6b] rounded-3xl shadow-2xl border p-2 border-gray-200">
              <img
                src="https://res.cloudinary.com/ddoa960le/image/upload/q_auto:good,f_auto,w_1600/v1752527599/accountSummery_l7rk09.png"

                alt="SellerQI Dashboard Preview"
                className="rounded-2xl w-full shadow-lg"
              />
            </div>
            {/* Floating elements */}
            <div className="absolute -top-4 -right-4 bg-emerald-500 text-white px-4 py-2 rounded-full text-sm font-semibold shadow-lg">
              Live Data
            </div>
            <div className="absolute -bottom-4 -left-4 bg-[#3B4A6B] text-white px-4 py-2 rounded-full text-sm font-semibold shadow-lg">
              Real-time Insights
            </div>
          </motion.div>
        </div>
      </section>

      {/* Trusted By Section */}
      <section className="py-16 px-4 lg:px-6 bg-gray-50 border-y border-gray-200">
        <div className="container mx-auto max-w-6xl text-center">
          <p className="text-gray-500 mb-8 text-lg">Trusted by 10,000+ Amazon sellers worldwide</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 items-center opacity-60">
            <div className="text-center">
              <div className="text-3xl font-bold text-[#3B4A6B]">10K+</div>
              <div className="text-sm text-gray-500">Active Users</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-[#3B4A6B]">$50M+</div>
              <div className="text-sm text-gray-500">Sales Optimized</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-[#3B4A6B]">2.5M+</div>
              <div className="text-sm text-gray-500">Products Analyzed</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-[#3B4A6B]">150+</div>
              <div className="text-sm text-gray-500">Countries</div>
            </div>
          </div>
        </div>
      </section>

      {/* Problem/Solution Section */}
      <section className="py-24 px-4 lg:px-6 bg-white">
        <div className="container mx-auto max-w-6xl">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-center mb-16"
          >
            <h2 className="text-4xl lg:text-5xl font-bold text-gray-900 mb-6">
              Stop Guessing. Start <span className="text-[#3B4A6B]">Growing</span>.
            </h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              73% of Amazon sellers struggle with declining sales and don't know why. SellerQI gives you the answers and the roadmap to fix every issue.
            </p>
          </motion.div>

          <div className="grid lg:grid-cols-2 gap-16 items-center">
            {/* Problems */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              <h3 className="text-2xl font-bold text-gray-900 mb-8">Common Amazon Seller Problems</h3>
              <div className="space-y-6">
                {[
                  "Sales dropping without knowing why",
                  "Poor listing performance and low conversion",
                  "Wasted PPC spend on underperforming keywords",
                  "Missing optimization opportunities",
                  "Competitor outranking your products",
                  "Complex data scattered across multiple tools"
                ].map((problem, index) => (
                  <div key={index} className="flex items-start gap-4">
                    <div className="w-6 h-6 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                      <X className="w-4 h-4 text-red-500" />
                    </div>
                    <span className="text-gray-700">{problem}</span>
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Solutions */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.4 }}
            >
              <h3 className="text-2xl font-bold text-gray-900 mb-8">SellerQI Solutions</h3>
              <div className="space-y-6">
                {[
                  "AI-powered root cause analysis",
                  "Comprehensive listing optimization",
                  "Smart PPC waste detection and fixes",
                  "Automated opportunity identification",
                  "Competitive intelligence and monitoring",
                  "All-in-one dashboard with actionable insights"
                ].map((solution, index) => (
                  <div key={index} className="flex items-start gap-4">
                    <div className="w-6 h-6 bg-emerald-100 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                      <Check className="w-4 h-4 text-emerald-500" />
                    </div>
                    <span className="text-gray-700">{solution}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Features Showcase */}
      <section className="py-24 px-4 lg:px-6 bg-gradient-to-b from-gray-50 to-white">
        <div className="container mx-auto max-w-6xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-center mb-16"
          >
            <h2 className="text-4xl lg:text-5xl font-bold text-gray-900 mb-6">
              Everything You Need to Dominate Amazon
            </h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              From product analysis to PPC optimization, SellerQI provides all the tools and insights you need to scale your Amazon business.
            </p>
          </motion.div>

          <div className="grid lg:grid-cols-3 gap-8">
            {[
              {
                icon: BarChart3,
                title: "Smart Analytics",
                description: "Deep dive into your product performance with 100+ data points analyzed in real-time.",
                features: ["Sales trend analysis", "Conversion optimization", "Inventory insights", "Performance benchmarking"],
                color: "blue"
              },
              {
                icon: TrendingUp,
                title: "AI Optimization",
                description: "Get personalized recommendations powered by machine learning and marketplace data.",
                features: ["Listing optimization", "Keyword suggestions", "Pricing strategies", "Content improvements"],
                color: "green"
              },
              {
                icon: ShieldCheck,
                title: "Competitive Intelligence",
                description: "Stay ahead of competitors with automated monitoring and strategic insights.",
                features: ["Competitor tracking", "Market analysis", "Price monitoring", "Share of voice"],
                color: "purple"
              }
            ].map((feature, index) => {
              const Icon = feature.icon;
              const colorClasses = {
                blue: "bg-blue-50 text-[#3B4A6B] border-blue-200",
                green: "bg-emerald-50 text-emerald-600 border-emerald-200",
                purple: "bg-purple-50 text-purple-600 border-purple-200"
              };
              return (
                <motion.div
                  key={feature.title}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.1 * index }}
                  className="bg-white rounded-2xl border border-gray-200 p-8 shadow-lg hover:shadow-xl transition-all duration-300"
                >
                  <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-6 ${colorClasses[feature.color]}`}>
                    <Icon className="w-8 h-8" />
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 mb-4">{feature.title}</h3>
                  <p className="text-gray-600 mb-6">{feature.description}</p>
                  <ul className="space-y-2">
                    {feature.features.map((item, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm text-gray-600">
                        <Check className="w-4 h-4 text-emerald-500" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-24 px-4 lg:px-6 bg-white">
        <div className="container mx-auto max-w-6xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-center mb-16"
          >
            <h2 className="text-4xl lg:text-5xl font-bold text-gray-900 mb-6">
              Get Results in 3 Simple Steps
            </h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              No complex setup. No lengthy onboarding. Start optimizing your Amazon business in minutes.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-12">
            {[
              {
                step: "01",
                title: "Connect Your Amazon Account",
                description: "Simply  connect your Amazon account. Our secure integration takes 30 seconds.",
                icon: Zap,
                color: "blue"
              },
              {
                step: "02", 
                title: "AI Analysis",
                description: "Our AI analyzes 100+ data points and identifies issues, opportunities, and optimization strategies.",
                icon: BarChart3,
                color: "green"
              },
              {
                step: "03",
                title: "Execute & Scale",
                description: "Follow our prioritized action plan and watch your sales grow with data-driven optimization.",
                icon: TrendingUp,
                color: "purple"
              }
            ].map((step, index) => {
              const Icon = step.icon;
              const colorClasses = {
                blue: "from-[#3B4A6B] to-blue-600",
                green: "from-emerald-500 to-emerald-600",
                purple: "from-purple-500 to-purple-600"
              };
              return (
                <motion.div
                  key={step.step}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.1 * index }}
                  className="text-center"
                >
                  <div className={`w-20 h-20 bg-gradient-to-r ${colorClasses[step.color]} rounded-2xl flex items-center justify-center mx-auto mb-6`}>
                    <Icon className="w-10 h-10 text-white" />
                  </div>
                  <div className="text-3xl font-bold text-gray-300 mb-2">{step.step}</div>
                  <h3 className="text-xl font-bold text-gray-900 mb-4">{step.title}</h3>
                  <p className="text-gray-600 leading-relaxed">{step.description}</p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ROI/Benefits Section */}
      <section className="py-24 px-4 lg:px-6 bg-gradient-to-r from-[#3B4A6B] to-[#333651] text-white">
        <div className="container mx-auto max-w-6xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-center mb-16"
          >
            <h2 className="text-4xl lg:text-5xl font-bold mb-6">
              Real Results. Proven ROI.
            </h2>
            <p className="text-xl opacity-90 max-w-3xl mx-auto">
              Our customers see measurable improvements within 30 days. Here's what you can expect.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              { metric: "+32%", label: "Average Revenue Increase", description: "in first 90 days" },
              { metric: "-45%", label: "PPC Waste Reduction", description: "through smart optimization" },
              { metric: "18%", label: "Conversion Rate Boost", description: "with listing improvements" },
              { metric: "5.2x", label: "ROI on SellerQI", description: "average return on investment" }
            ].map((stat, index) => (
              <motion.div
                key={stat.metric}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.1 * index }}
                className="text-center"
              >
                <div className="text-4xl lg:text-5xl font-bold mb-2">{stat.metric}</div>
                <div className="text-lg font-semibold mb-1">{stat.label}</div>
                <div className="text-sm opacity-75">{stat.description}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-24 px-4 lg:px-6 bg-gray-50">
        <div className="container mx-auto max-w-6xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-center mb-16"
          >
            <h2 className="text-4xl lg:text-5xl font-bold text-gray-900 mb-6">
              Loved by Amazon Sellers Worldwide
            </h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              Don't just take our word for it. See what thousands of successful sellers are saying about SellerQI.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                name: "Sarah Chen",
                role: "Private Label Seller",
                company: "TechGadgets Pro",
                text: "SellerQI identified issues I never knew existed. My main product went from page 3 to #1 in 6 weeks. Sales increased 127%!",
                rating: 5,
                revenue: "$2.3M ARR"
              },
              {
                name: "Marcus Rodriguez", 
                role: "Agency Owner",
                company: "Amazon Growth Partners",
                text: "We use SellerQI for all our clients. The ROI reports alone save us 20+ hours per week. Our clients love the transparent insights.",
                rating: 5,
                revenue: "50+ Clients"
              },
              {
                name: "Jennifer Walsh",
                role: "Brand Owner",
                company: "Organic Beauty Co",
                text: "The competitive intelligence feature is game-changing. We can now predict market trends and stay ahead of competitors consistently.",
                rating: 5,
                revenue: "$5.7M ARR"
              }
            ].map((testimonial, index) => (
              <motion.div
                key={testimonial.name}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.1 * index }}
                className="bg-white rounded-2xl p-8 shadow-lg"
              >
                <div className="flex items-center gap-2 mb-4">
                  {[...Array(testimonial.rating)].map((_, i) => (
                    <Star key={i} className="w-5 h-5 text-yellow-400 fill-current" />
                  ))}
                </div>
                <p className="text-gray-700 mb-6 text-lg leading-relaxed">"{testimonial.text}"</p>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-gradient-to-r from-[#3B4A6B] to-[#333651] rounded-full flex items-center justify-center text-white font-bold">
                    {testimonial.name.split(' ').map(n => n[0]).join('')}
                  </div>
                  <div>
                    <div className="font-semibold text-gray-900">{testimonial.name}</div>
                    <div className="text-sm text-gray-600">{testimonial.role} • {testimonial.company}</div>
                    <div className="text-xs text-emerald-600 font-medium">{testimonial.revenue}</div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Use Cases */}
      <section className="py-24 px-4 lg:px-6 bg-white">
        <div className="container mx-auto max-w-6xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-center mb-16"
          >
            <h2 className="text-4xl lg:text-5xl font-bold text-gray-900 mb-6">
              Built for Every Amazon Business
            </h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              Whether you're a solo entrepreneur or managing hundreds of ASINs, SellerQI scales with your business.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              {
                icon: UserCheck,
                title: "Solo Entrepreneurs",
                description: "Perfect for new sellers looking to optimize their first products and scale quickly.",
                benefits: ["Easy setup", "Clear guidance", "Cost-effective"]
              },
              {
                icon: Users,
                title: "Growing Brands", 
                description: "Ideal for established sellers managing multiple products and scaling operations.",
                benefits: ["Multi-ASIN analysis", "Team collaboration", "Advanced insights"]
              },
              {
                icon: Briefcase,
                title: "Agencies & Consultants",
                description: "Comprehensive tools for managing multiple client accounts and delivering results.",
                benefits: ["Client reporting", "White-label options", "Bulk operations"]
              },
              {
                icon: ShieldCheck,
                title: "Enterprise Brands",
                description: "Enterprise-grade features for large organizations with complex requirements.",
                benefits: ["API access", "Custom integrations", "Dedicated support"]
              }
            ].map((useCase, index) => {
              const Icon = useCase.icon;
              return (
                <motion.div
                  key={useCase.title}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.1 * index }}
                  className="bg-gray-50 rounded-2xl p-6 text-center hover:shadow-lg transition-all duration-300"
                >
                  <div className="w-16 h-16 bg-gradient-to-r from-[#3B4A6B] to-[#333651] rounded-2xl flex items-center justify-center mx-auto mb-6">
                    <Icon className="w-8 h-8 text-white" />
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 mb-3">{useCase.title}</h3>
                  <p className="text-gray-600 mb-4">{useCase.description}</p>
                  <ul className="space-y-1">
                    {useCase.benefits.map((benefit, i) => (
                      <li key={i} className="text-sm text-gray-500">• {benefit}</li>
                    ))}
                  </ul>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Pricing Teaser */}
      <section className="py-24 px-4 lg:px-6 bg-gradient-to-b from-gray-50 to-white">
        <div className="container mx-auto max-w-4xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <h2 className="text-4xl lg:text-5xl font-bold text-gray-900 mb-6">
              Start Free, Scale When Ready
            </h2>
            <p className="text-xl text-gray-600 mb-12">
              Try SellerQI risk-free with our generous free plan. Upgrade only when you're seeing results.
            </p>
            
            <div className="grid md:grid-cols-2 gap-8 mb-12">
              <div className="bg-white border-2 border-gray-200 rounded-2xl p-8">
                <h3 className="text-2xl font-bold text-gray-900 mb-4">Free Plan</h3>
                <div className="text-4xl font-bold text-gray-900 mb-6">$0<span className="text-lg text-gray-500">/month</span></div>
                <ul className="space-y-3 mb-8">
                  <li className="flex items-center gap-2"><Check className="w-5 h-5 text-emerald-500" /> product analyses</li>
                  <li className="flex items-center gap-2"><X className="w-5 h-5 text-red-500" /> Basic optimization tips</li>
                  <li className="flex items-center gap-2"><X className="w-5 h-5 text-red-500" /> Download Reports</li>
                  <li className="flex items-center gap-2"><X className="w-5 h-5 text-red-500" /> Track Multiple Products</li>
                  <li className="flex items-center gap-2"><X className="w-5 h-5 text-red-500" /> Issue Breakdown</li>
                </ul>
                <button className="w-full border-2 border-gray-300 text-gray-700 py-3 rounded-lg font-semibold hover:border-gray-400 transition-colors">
                  Get Started Free
                </button>
              </div>
              
              <div className="bg-gradient-to-br from-[#3B4A6B] to-[#333651] text-white rounded-2xl p-8 relative">
                <div className="absolute -top-4 left-1/2 transform -translate-x-1/2 bg-emerald-500 text-white px-4 py-1 rounded-full text-sm font-semibold">
                  Most Popular
                </div>
                <h3 className="text-2xl font-bold mb-4">Pro Plan</h3>
                <div className="text-4xl font-bold mb-6">$99<span className="text-lg opacity-75">/month</span></div>
                <ul className="space-y-3 mb-8">
                  <li className="flex items-center gap-2"><Check className="w-5 h-5 text-emerald-300" /> Product Audit Summary</li>
                  <li className="flex items-center gap-2"><Check className="w-5 h-5 text-emerald-300" /> Download Reports</li>
                  <li className="flex items-center gap-2"><Check className="w-5 h-5 text-emerald-300" /> Fix Recommendations</li>
                  <li className="flex items-center gap-2"><Check className="w-5 h-5 text-emerald-300" /> Track Multiple Products</li>
                  <li className="flex items-center gap-2"><Check className="w-5 h-5 text-emerald-300" /> Issue Breakdown</li>
                </ul>
                <button 
                  onClick={handleStartFreeTrial}
                  className="w-full bg-white text-[#3B4A6B] py-3 rounded-lg font-semibold hover:bg-gray-100 transition-colors"
                >
                  Start 7-Days Free Trial
                </button>
              </div>
            </div>
            
            <p className="text-gray-500">7-days free trial • Cancel anytime • No setup fees</p>
          </motion.div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-24 px-4 lg:px-6 bg-gray-50">
        <div className="container mx-auto max-w-4xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-center mb-16"
          >
            <h2 className="text-4xl lg:text-5xl font-bold text-gray-900 mb-6">
              Frequently Asked Questions
            </h2>
            <p className="text-xl text-gray-600">
              Everything you need to know about SellerQI. Can't find what you're looking for? Contact our support team.
            </p>
          </motion.div>

          <div className="space-y-4">
            {[
              {
                q: "How quickly will I see results?", 
                a: "Most sellers see initial improvements within 7-14 days of implementing our recommendations. Significant results typically occur within 30-60 days, with an average revenue increase of 32% in the first 90 days."
              },
              {
                q: "Do I need to connect my Amazon account?",
                a: "No! You can start with just an ASIN for basic analysis. For deeper insights including sales data, inventory levels, and PPC performance, connecting your account provides more comprehensive recommendations."
              },
              {
                q: "Is my data secure and private?",
                a: "Absolutely. We use bank-level encryption and are SOC 2 compliant. Your data is never shared with competitors or third parties. We only use aggregated, anonymized data for improving our AI models."
              },
              {
                q: "What makes SellerQI different from other tools?",
                a: "SellerQI combines deep AI analysis with actionable recommendations. Unlike tools that just show data, we tell you exactly what to fix and how to fix it. Our 100+ data point analysis and prioritized action plans set us apart."
              },
              {
                q: "Can I cancel anytime?",
                a: "Yes, you can cancel your subscription at any time with no cancellation fees. Your account will remain active until the end of your billing period, and you can continue using the free plan afterward."
              },
              {
                q: "Do you offer support for agencies?",
                a: "Yes! We have special agency plans with features like client management, white-label reporting, and bulk operations. Contact our sales team for custom agency pricing and features."
              }
            ].map((faq, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.1 * index }}
                className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden"
              >
                <button
                  className="w-full p-6 text-left flex items-center justify-between hover:bg-gray-50 transition-colors duration-200"
                  onClick={() => setOpenFaqIndex(openFaqIndex === index ? null : index)}
                >
                  <h3 className="text-lg font-semibold text-gray-900 pr-4">{faq.q}</h3>
                  <div className="flex-shrink-0">
                    {openFaqIndex === index ? (
                      <Minus className="w-5 h-5 text-[#3B4A6B]" />
                    ) : (
                      <Plus className="w-5 h-5 text-[#3B4A6B]" />
                    )}
                  </div>
                </button>
                <AnimatePresence>
                  {openFaqIndex === index && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.3, ease: "easeInOut" }}
                      className="overflow-hidden"
                    >
                      <div className="px-6 pb-6 pt-0">
                        <div className="h-px bg-gray-200 mb-4"></div>
                        <p className="text-gray-600 leading-relaxed">{faq.a}</p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-24 px-4 lg:px-6 bg-gradient-to-r from-[#3B4A6B] via-[#333651] to-[#3B4A6B] text-white relative overflow-hidden">
        <div className="absolute inset-0 bg-black opacity-10"></div>
        <div className="relative container mx-auto max-w-4xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <h2 className="text-4xl lg:text-6xl font-bold mb-6">
              Ready to 10x Your Amazon Business?
            </h2>
            <p className="text-xl lg:text-2xl mb-12 opacity-90">
              Join 10,000+ sellers who've transformed their Amazon business with SellerQI. Start your free analysis now.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
              <button 
                onClick={handleAnalyze}
                disabled={searchesLeft <= 0}
                className="bg-white text-[#3B4A6B] px-8 py-4 rounded-lg flex items-center gap-2 mx-auto sm:mx-0 hover:bg-gray-100 transition-all duration-300 font-semibold text-lg shadow-lg"
              >
                Start Free Analysis <Zap className="w-5 h-5" />
              </button>
              <button className="border-2 border-white text-white px-8 py-4 rounded-lg flex items-center gap-2 mx-auto sm:mx-0 hover:bg-white hover:text-[#3B4A6B] transition-all duration-300 font-semibold text-lg">
                Book Demo Call <PlayCircle className="w-5 h-5" />
              </button>
            </div>
            
            <div className="flex justify-center gap-8 text-sm opacity-75">
              <span>7 Days Free Trial</span>
              <span>✓ 5-minute setup</span>
              <span>✓ Instant results</span>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <Footer />
    </div>
  );
}