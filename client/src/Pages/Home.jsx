import React, { useState, useEffect, useRef } from 'react';
import { ChevronRight, Check, X, Search, ChevronDown, AlertTriangle, Info } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from '../hooks/useAuth';
import axiosInstance from '../config/axios.config';
import Navbar from '../Components/Navigation/Navbar';
import Footer from '../Components/Navigation/Footer';

export default function SellerQIHomepage() {
  const [asin, setAsin] = useState('');
  const [market, setMarket] = useState('US');
  const [showMarketDropdown, setShowMarketDropdown] = useState(false);
  const [searchLimit, setSearchLimit] = useState(null);
  const [limitError, setLimitError] = useState(null);
  const [isCheckingLimit, setIsCheckingLimit] = useState(false);
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
    
    // Refresh search limit when user focuses back on the page
    const handleFocus = () => {
      if (!isLoading && !isAuthenticated) {
        const refreshLimit = async () => {
          try {
            console.log('Page focused - refreshing search limit...');
            const response = await axiosInstance.get('/app/check-search-limit?checkOnly=true');
            if (response.status === 200) {
              console.log('Refreshed search limit:', response.data.data);
              setSearchLimit(response.data.data);
              setLimitError(null);
            }
          } catch (error) {
            if (error.response?.status === 429) {
              setSearchLimit(error.response.data.data);
              setLimitError(error.response.data.message);
            }
          }
        };
        refreshLimit();
      }
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [isLoading, isAuthenticated]);

  // Check IP-based search limit every time homepage loads
  useEffect(() => {
    const checkIPSearchStatus = async () => {
      if (!isLoading && !isAuthenticated) {
        try {
          console.log('🔍 Checking IP search status on homepage load...');
          
          // Get current IP's search status from database
          const response = await axiosInstance.get('/app/check-search-limit?checkOnly=true');
          
          if (response.status === 200) {
            const { remainingSearches, maxSearches, currentIP, searchCount, lastResetDate } = response.data.data;
            console.log(`✅ IP Search Status for ${currentIP}:`);
            console.log(`   📊 Searches: ${remainingSearches}/${maxSearches} remaining (used: ${searchCount})`);
            console.log(`   📅 Last Reset: ${lastResetDate}`);
            
            setSearchLimit(response.data.data);
            setLimitError(null);
            
            // Show appropriate message based on remaining searches
            if (remainingSearches === 0) {
              setLimitError(response.data.message || 'Search limit exceeded');
            }
          }
        } catch (error) {
          console.error('❌ Error checking IP search status:', error);
          
          if (error.response?.status === 429) {
            // IP has exceeded search limit
            const { currentIP, searchCount, maxSearches, lastResetDate } = error.response.data.data;
            console.log(`🚫 IP ${currentIP} has exceeded search limit:`);
            console.log(`   📊 Used: ${searchCount}/${maxSearches} searches`);
            console.log(`   📅 Last Reset: ${lastResetDate}`);
            setSearchLimit(error.response.data.data);
            setLimitError(error.response.data.message);
          } else {
            // Network or other error
            console.error('🌐 Network error checking search status');
            setLimitError('Unable to check search status. Please try again.');
          }
        }
      }
    };

    // Run immediately when component mounts
    checkIPSearchStatus();
    
    // Set up periodic refresh every 30 seconds to keep search count updated
    const refreshInterval = setInterval(() => {
      if (!isLoading && !isAuthenticated) {
        console.log('🔄 Periodic refresh of search status...');
        checkIPSearchStatus();
      }
    }, 30000); // 30 seconds
    
    // Cleanup interval on unmount
    return () => clearInterval(refreshInterval);
  }, [isAuthenticated, isLoading]);

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

  // Check search limit for non-authenticated users
  const checkSearchLimit = async () => {
    try {
      setIsCheckingLimit(true);
      console.log('Checking search limit...');
      const response = await axiosInstance.post('/app/check-search-limit');
      
      if (response.status === 200) {
        console.log('Search allowed, updating limit:', response.data.data);
        setSearchLimit(response.data.data);
        setLimitError(null);
        return true;
      }
    } catch (error) {
      console.error('Search limit check error:', error);
      if (error.response?.status === 429) {
        // Rate limit exceeded
        console.log('Search limit exceeded:', error.response.data);
        setLimitError(error.response.data.message);
        setSearchLimit(error.response.data.data);
        return false;
      } else {
        console.error('Error checking search limit:', error);
        setLimitError('Unable to verify search limit. Please try again.');
        return false;
      }
    } finally {
      setIsCheckingLimit(false);
    }
  };

  const handleAnalyze = async () => {
    // Clear previous errors
    setLimitError(null);

    // Validate ASIN input
    if (!asin.trim()) {
      setLimitError('Please enter a valid ASIN.');
      return;
    }

    // If user is not authenticated, check search limit
    if (!isAuthenticated) {
      const limitCheckPassed = await checkSearchLimit();
      if (!limitCheckPassed) {
        return; // Don't proceed if limit exceeded
      }
    }

    // Proceed with analysis
    navigate(`/loading?asin=${asin}&market=${market}`);
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <Navbar />

      {/* Hero Section */}
      <section className="py-20 px-4 bg-gray-50">
        <div className="container mx-auto max-w-4xl text-center">
          <h1 className="text-5xl font-bold mb-12 leading-tight">
            Get a <span className="text-red-500">Free Health Check</span> of Your<br />
            Amazon Product
          </h1>

          <div className="max-w-2xl mx-auto mb-4">
            <div className="relative flex gap-0">
              <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                <input
                  type="text"
                  value={asin}
                  onChange={(e) => setAsin(e.target.value)}
                  placeholder="Enter an Amazon product ASIN  Ex: B08N5WRWNW (US)"
                  className="w-full pl-12 pr-4 py-4 border border-gray-300 rounded-l-lg focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="relative" ref={marketDropdownRef}>
                <button
                  type="button"
                  className="flex items-center justify-between gap-2 px-6 py-4 border border-l-0 border-gray-300 rounded-r-lg bg-white hover:bg-gray-50 focus:outline-none font-medium text-center min-w-[180px]"
                  onClick={() => setShowMarketDropdown(!showMarketDropdown)}
                >
                  <span>{marketOptions.find(option => option.value === market)?.label || 'Select Market'}</span>
                  <ChevronDown className="w-4 h-4 text-gray-400" />
                </button>
                
                <AnimatePresence>
                  {showMarketDropdown && (
                    <motion.div
                      className="absolute top-full -mt-px w-full bg-white border border-gray-300 border-t-white rounded-b-md shadow-lg z-50 overflow-hidden max-h-60 overflow-y-auto"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2, ease: "easeInOut" }}
                    >
                      <ul className="py-1 text-sm text-gray-700">
                        {marketOptions.map((option) => (
                          <li
                            key={option.value}
                            className="px-4 py-2 hover:bg-[#333651] hover:text-white cursor-pointer transition-colors"
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
            </div>
          </div>

          <p className="text-gray-600 mb-4 text-sm">
            Instant analysis • No credit card required • Trusted by 1000+ sellers
          </p>

          {/* Search Limit Information */}
          {!isLoading && !isAuthenticated && searchLimit && !limitError && (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-center max-w-md mx-auto">
              <Info className="w-4 h-4 text-blue-600 inline mr-2" />
              <div className="text-blue-700 text-sm">
                <div className="font-medium">
                  {searchLimit.remainingSearches} free search{searchLimit.remainingSearches !== 1 ? 'es' : ''} remaining out of {searchLimit.maxSearches}
                </div>
                {searchLimit.currentIP && (
                  <div className="text-xs mt-1 opacity-70">
                    IP: {searchLimit.currentIP.replace('localhost-testing', 'localhost')}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Error Message */}
          {limitError && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-center max-w-lg mx-auto">
              <AlertTriangle className="w-5 h-5 text-red-600 inline mr-2" />
              <div className="text-red-700">
                <p className="font-medium">{limitError}</p>
                {searchLimit && searchLimit.remainingSearches === 0 && (
                  <div className="mt-2">
                    <Link 
                      to="/sign-up" 
                      className="text-blue-600 underline hover:text-blue-800 font-medium"
                    >
                      Sign up for free
                    </Link>
                    <span className="text-gray-600"> to continue analyzing products</span>
                  </div>
                )}
              </div>
            </div>
          )}

          <button
            className="bg-[#3B4A6B] text-white px-8 py-3 rounded-lg flex items-center gap-2 mx-auto hover:bg-[#2d3a52] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleAnalyze}
            disabled={isCheckingLimit || (limitError && searchLimit?.remainingSearches === 0)}
          >
            {isCheckingLimit ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Checking...
              </>
            ) : (
              <>
                Analyze <ChevronRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </section>

      {/* Dashboard Preview with iBEX branding */}
      <section className="py-16 bg-white">
        <div className="container mx-auto px-4">
          <div className="bg-white rounded-lg shadow-2xl max-w-6xl mx-auto overflow-hidden">
            {/* Dashboard Image Placeholder */}
            <img
              src="https://res.cloudinary.com/ddoa960le/image/upload/q_auto:good,f_auto,w_1600/v1749221237/Dashboard_ziqkui.png"
              alt="Hero Section Banner"
              loading="eager"
              className="w-full h-auto"
            />
          </div>
        </div>
      </section>

      {/* Want the Full Picture Section */}
      <section className="py-20 text-center relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-gray-50 via-white to-gray-50"></div>
        <div className="container mx-auto px-4 relative z-10">
          <h2 className="text-4xl font-bold mb-4">Want the Full Picture?</h2>
          <h3 className="text-3xl mb-6">Unlock <span className="text-red-500">Seller QI PRO</span></h3>
          <p className="text-gray-600 mb-8 max-w-2xl mx-auto text-lg">
            Get detailed issue breakdowns, smart recommendations, and a<br />
            complete Amazon growth toolkit.
          </p>
          <button className="bg-[#3B4A6B] text-white px-8 py-3 rounded-lg flex items-center gap-2 mx-auto hover:bg-[#2d3a52] transition-colors whitespace-nowrap">
            Upgrade to Seller QI PRO <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </section>

      {/* Features Section - Instant Diagnosis */}
      <section className="py-16 bg-gray-50">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-2 gap-12 items-center mb-20">
            <div>
              <h3 className="text-4xl font-bold mb-6 leading-tight">
                Get an instant diagnosis of what's<br />
                hurting your product's<br />
                performance.
              </h3>
              <p className="text-gray-600 mb-6 text-lg">
                SELLER QI scans 100+ data points in seconds and shows exactly what's broken -<br />
                from missing keywords to poor CTR to compliance issues.
              </p>
              <ul className="space-y-3 text-gray-700">
                <li className="flex items-center gap-2">
                  <Check className="w-5 h-5 text-green-500 flex-shrink-0" />
                  Missing bullet points
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-5 h-5 text-green-500 flex-shrink-0" />
                  Low CTR
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-5 h-5 text-green-500 flex-shrink-0" />
                  Keyword indexing errors
                </li>
              </ul>
            </div>

            {/* Dashboard Mockup Image */}
            <div className="bg-white rounded-lg shadow-xl overflow-hidden">
              <img
                src="https://res.cloudinary.com/ddoa960le/image/upload/q_auto:good,f_auto,w_1600/v1749657988/Issues_zkmc4i.png"
                alt="Dashboard Mockup"
                loading="eager"
                className="w-full h-auto"
              />

            </div>
          </div>

          {/* How to Fix Section */}
          <div className="grid md:grid-cols-2 gap-12 items-center mb-20">
            <div className="bg-white rounded-lg shadow-xl overflow-hidden">
              <img
                src="https://res.cloudinary.com/ddoa960le/image/upload/q_auto:good,f_auto,w_1200/v1749658154/product_uwjfki.png"
                alt="Error Illustration"
                loading="eager"
                className="w-full h-auto"
              />

            </div>

            <div>
              <h3 className="text-4xl font-bold mb-6 leading-tight">
                We don't just show problems,<br />
                We tell you how to fix them.
              </h3>
              <p className="text-gray-600 mb-6 text-lg">
                Every issue comes with a guided fix. Whether it's a listing problem or PPC leak, we<br />
                explain the exact steps to solve it.
              </p>
              <button className="bg-[#3B4A6B] text-white px-6 py-3 rounded-lg flex items-center gap-2 hover:bg-[#2d3a52] transition-all">
                Turn Insights Into Actions Instantly <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Export Insights Section */}
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h3 className="text-4xl font-bold mb-6 leading-tight">
                Export Insights That Matter
              </h3>
              <p className="text-gray-600 mb-6 text-lg">
                Want to track your product performance during Prime Day? Or compare last<br />
                month vs this month? Seller QI lets you select your own date ranges and<br />
                download detailed reports in seconds.
              </p>
              <ul className="space-y-3 text-gray-700">
                <li className="flex items-center gap-2">
                  <Check className="w-5 h-5 text-green-500 flex-shrink-0" />
                  Choose exact date range
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-5 h-5 text-green-500 flex-shrink-0" />
                  Download in 1-click
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-5 h-5 text-green-500 flex-shrink-0" />
                  Perfect for client sharing or internal tracking
                </li>
              </ul>
            </div>

            <div className="bg-white rounded-lg shadow-xl overflow-hidden">
              <img
                src="https://res.cloudinary.com/ddoa960le/image/upload/q_auto:good,f_auto,w_1200/v1749658291/reports_r4erus.png"
                alt="Reports Section"
                loading="eager"
                className="w-full h-auto"
              />

            </div>
          </div>
        </div>
      </section>

      {/* Pricing Comparison */}
      <section className="py-20 bg-gray-50">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold text-center mb-12">Seller QI LITE vs PRO</h2>

          <div className="max-w-3xl mx-auto">
            <table className="w-full bg-white rounded-lg overflow-hidden shadow-lg">
              <thead>
                <tr className="bg-[#3B4A6B] text-white">
                  <th className="py-4 px-6 text-left">FEATURE</th>
                  <th className="py-4 px-6 text-center">Seller QI LITE</th>
                  <th className="py-4 px-6 text-center">Seller QI PRO</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b">
                  <td className="py-4 px-6">Product-Level Metrics</td>
                  <td className="py-4 px-6 text-center">
                    <Check className="w-6 h-6 text-green-500 mx-auto" />
                  </td>
                  <td className="py-4 px-6 text-center">
                    <Check className="w-6 h-6 text-green-500 mx-auto" />
                  </td>
                </tr>
                <tr className="border-b bg-gray-50">
                  <td className="py-4 px-6">Account-Level Audit</td>
                  <td className="py-4 px-6 text-center">
                    <X className="w-6 h-6 text-red-500 mx-auto" />
                  </td>
                  <td className="py-4 px-6 text-center">
                    <Check className="w-6 h-6 text-green-500 mx-auto" />
                  </td>
                </tr>
                <tr className="border-b">
                  <td className="py-4 px-6">Issue Breakdown</td>
                  <td className="py-4 px-6 text-center">
                    <X className="w-6 h-6 text-red-500 mx-auto" />
                  </td>
                  <td className="py-4 px-6 text-center">
                    <Check className="w-6 h-6 text-green-500 mx-auto" />
                  </td>
                </tr>
                <tr className="border-b bg-gray-50">
                  <td className="py-4 px-6">"How to Fix" Guides</td>
                  <td className="py-4 px-6 text-center">
                    <X className="w-6 h-6 text-red-500 mx-auto" />
                  </td>
                  <td className="py-4 px-6 text-center">
                    <Check className="w-6 h-6 text-green-500 mx-auto" />
                  </td>
                </tr>
                <tr className="border-b">
                  <td className="py-4 px-6">PDF Reports</td>
                  <td className="py-4 px-6 text-center">
                    <X className="w-6 h-6 text-red-500 mx-auto" />
                  </td>
                  <td className="py-4 px-6 text-center">
                    <Check className="w-6 h-6 text-green-500 mx-auto" />
                  </td>
                </tr>
                <tr className="border-b bg-gray-50">
                  <td className="py-4 px-6">Full Dashboard Access</td>
                  <td className="py-4 px-6 text-center">
                    <X className="w-6 h-6 text-red-500 mx-auto" />
                  </td>
                  <td className="py-4 px-6 text-center">
                    <Check className="w-6 h-6 text-green-500 mx-auto" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* CTA Section with Logo */}
      <section className="py-20 bg-white">
        <div className="container mx-auto px-4 text-center">
          {/* Logo */}
          <div className="mb-8">
            <div className="w-24 h-24 mx-auto bg-black rounded-full flex items-center justify-center">
              <img src="https://res.cloudinary.com/ddoa960le/image/upload/q_auto:good,f_auto,w_1200/v1749657303/Seller_QI_Logo_Final_1_1_tfybls.png" alt="Seller QI Logo" loading="eager" />
            </div>
          </div>

          <h2 className="text-3xl font-bold mb-8">
            Start Free, Upgrade Only When You're<br />
            Ready
          </h2>
          <button className="bg-[#3B4A6B] text-white px-8 py-3 rounded-lg flex items-center gap-2 mx-auto hover:bg-[#2d3a52] transition-colors whitespace-nowrap">
            Upgrade to Seller QI PRO <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </section>

      {/* Footer */}
      <Footer />
    </div>
  );
}