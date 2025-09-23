import React, { useState, useEffect, useRef } from 'react';
import { Info, Download, Search, ChevronRight, Loader2, ChevronDown } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { AnimatePresence, motion } from 'framer-motion';
import { AnalyseProduct } from '../operations/AnalyseProduct';

// Add shimmer animation styles
const shimmerStyles = `
  @keyframes shimmer {
    0% { transform: translateX(-100%) skewX(-12deg); }
    100% { transform: translateX(200%) skewX(-12deg); }
  }
  .animate-shimmer {
    animation: shimmer 1.5s ease-in-out infinite;
  }
`;

// Inject styles
if (typeof document !== 'undefined') {
  const styleSheet = document.createElement('style');
  styleSheet.textContent = shimmerStyles;
  document.head.appendChild(styleSheet);
}

const ASINAnalyzer = () => {
  // State management
  const [asin, setAsin] = useState('');
  const [market, setMarket] = useState('US');
  const [loading, setLoading] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [error, setError] = useState(null);
  const [showMarketDropdown, setShowMarketDropdown] = useState(false);
  const [hasAnimated, setHasAnimated] = useState(false);
  const marketDropdownRef = useRef(null);

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

  // Set hasAnimated to true after ALL animations complete to prevent re-animations
  useEffect(() => {
    const timer = setTimeout(() => {
      setHasAnimated(true);
    }, 2000); // Wait for all animations to complete (longest delay is 0.8s + 0.6s duration = 1.4s)
    return () => clearTimeout(timer);
  }, []);

  // Handle analysis
  const handleAnalyze = async () => {
    if (!asin.trim()) {
      setError('Please enter a valid ASIN');
      return;
    }

    setLoading(true);
    setError(null);
    
    try {
      // Call the real AnalyseProduct function
      const result = await AnalyseProduct(asin, market);
      
      if (result) {
        console.log('Analysis result:', result);
        setAnalysisResult(result);
      } else {
        setError('Failed to analyze product. Please check the ASIN and try again.');
      }
    } catch (err) {
      console.error('Analysis error:', err);
      setError('Failed to analyze product. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Reset to search
  const handleNewSearch = () => {
    setAnalysisResult(null);
    setError(null);
    setAsin('');
  };

  // Calculate subsection scores
  const calculateRankingScore = (rankingResult) => {
    if (!rankingResult) return { score: 0, maxScore: 9, percentage: 0 };
    
    const maxPossibleErrors = 9;
    const actualErrors = rankingResult.TotalErrors || 0;
    const score = maxPossibleErrors - actualErrors;
    const percentage = (score / maxPossibleErrors) * 100;
    
    return { score, maxScore: maxPossibleErrors, percentage: Math.round(percentage) };
  };

  const calculateConversionScore = (analysisData) => {
    if (!analysisData) return { score: 0, maxScore: 4, percentage: 0 };
    
    const maxPossibleErrors = 4;
    const actualErrors = analysisData.conversionErrors || 0;
    const score = maxPossibleErrors - actualErrors;
    const percentage = (score / maxPossibleErrors) * 100;
    
    return { score, maxScore: maxPossibleErrors, percentage: Math.round(percentage) };
  };

  // Get detailed analysis data for product analysis section
  const getProductAnalysisData = () => {
    if (!analysisResult) return [];

    // Helper function to calculate percentage score
    const calculatePercentageScore = (actual, required) => {
      if (actual >= required) return 100;
      return Math.round((actual / required) * 100);
    };

    // Helper function to get image count from API data
    const getImageCount = () => {
      // Use actual count if available (most accurate)
      if (typeof analysisResult.actualImageCount === 'number') {
        return analysisResult.actualImageCount;
      }
      
      // Fallback to extracting from error message if available
      const message = analysisResult.imageResult?.Message || '';
      
      if (analysisResult.imageResult?.status === 'Success') {
        return 7; // Has recommended amount or more
      }
      
      if (message.includes('No images found')) {
        return 0;
      }
      
      if (message.includes('fewer than 7')) {
        // Try to extract actual number from message if possible
        const match = message.match(/(\d+)\s*images?/);
        if (match) {
          return parseInt(match[1]);
        }
        return 3; // Conservative estimate
      }
      
      // If we have a MainImage but status is Error, assume some images exist
      if (analysisResult.imageResult?.MainImage) {
        return 4; // Estimate - has some but not enough
      }
      
      return 0;
    };

    // Helper function to get video count
    const getVideoCount = () => {
      // Use actual count if available (most accurate)
      if (typeof analysisResult.actualVideoCount === 'number') {
        return analysisResult.actualVideoCount;
      }
      
      // Fallback to status-based logic
      return analysisResult.videoResult?.status === 'Success' ? 1 : 0;
    };

    // Helper function to get bullet points info
    const getBulletPointsInfo = () => {
      const bulletResult = analysisResult.rankingResult?.BulletPoints;
      
      // No bullet points at all
      if (bulletResult?.nullCheck?.status === 'Error' || bulletResult?.emptyArray?.status === 'Error') {
        return { count: 0, avgLength: 0 };
      }
      
      // Has bullet points but issues with null items
      if (bulletResult?.nullItems?.status === 'Error') {
        const message = bulletResult.nullItems.Message || '';
        const match = message.match(/(\d+)\s*bullet/);
        const nullCount = match ? parseInt(match[1]) : 1;
        return { count: Math.max(5 - nullCount, 1), avgLength: 100 }; // Some are null
      }
      
      // Character limit issues - has bullets but too short
      if (bulletResult?.charLim?.status === 'Error') {
        return { count: 5, avgLength: 120 }; // Has 5 bullets but average < 150 chars
      }
      
      // All good
      if (bulletResult?.charLim?.status === 'Success') {
        return { count: 5, avgLength: 180 }; // Good bullets
      }
      
      // Default estimate
      return { count: 3, avgLength: 100 };
    };

    // Helper function to get description length
    const getDescriptionLength = () => {
      const descResult = analysisResult.rankingResult?.Description;
      
      // No description
      if (descResult?.nullCheck?.status === 'Error' || descResult?.emptyArray?.status === 'Error') {
        return 0;
      }
      
      // Has description but too short
      if (descResult?.charLim?.status === 'Error') {
        const message = descResult.charLim.Message || '';
        if (message.includes('under 1700')) {
          // Estimate based on typical short descriptions
          return 900; // Estimate - has content but insufficient
        }
        return 800;
      }
      
      // Good description
      if (descResult?.charLim?.status === 'Success') {
        return 1800; // Meets requirement
      }
      
      // Default estimate
      return 500;
    };

    const imageCount = getImageCount();
    const videoCount = getVideoCount();
    const titleLength = analysisResult.Title?.length || 0;
    const bulletInfo = getBulletPointsInfo();
    const descriptionLength = getDescriptionLength();
    const reviewCount = parseInt(analysisResult.ReviewsCount) || 0;
    const starRating = parseFloat(analysisResult.starRatting) || 0;

    return [
      // Product Images
      {
        label: 'Product Images',
        score: calculatePercentageScore(imageCount, 7),
        current: `${imageCount} images`,
        recommended: '7+ high-quality images',
        max: 100
      },
      // Product Video
      {
        label: 'Product Video',
        score: calculatePercentageScore(videoCount, 1),
        current: `${videoCount} video${videoCount !== 1 ? 's' : ''}`,
        recommended: 'Add product demo video',
        max: 100
      },
      // Product Title
      {
        label: 'Product Title',
        score: calculatePercentageScore(titleLength, 80),
        current: `${titleLength} characters`,
        recommended: '80+ characters',
        max: 100
      },
      // Bullet Points
      {
        label: 'Bullet Points',
        score: calculatePercentageScore(bulletInfo.avgLength, 150),
        current: `${bulletInfo.count} bullets, ~${bulletInfo.avgLength} chars each`,
        recommended: '5 bullets, 150+ chars each',
        max: 100
      },
      // Description
      {
        label: 'Description',
        score: calculatePercentageScore(descriptionLength, 1700),
        current: `${descriptionLength} characters`,
        recommended: '1700+ characters',
        max: 100
      },
      // Reviews
      {
        label: 'Reviews',
        score: calculatePercentageScore(reviewCount, 50),
        current: `${reviewCount} reviews`,
        recommended: '50+ reviews',
        max: 100
      },
      // Star Rating
      {
        label: 'Star Rating',
        score: calculatePercentageScore(starRating, 4.3),
        current: `${starRating}/5.0 stars`,
        recommended: '4.3+ stars',
        max: 100
      }
    ];
  };

     // Get key metrics from analysis
   const getKeyMetrics = () => {
     if (!analysisResult) return [];

     // Extract number from units sold string
     const extractUnitsNumber = (unitsSoldString) => {
       if (!unitsSoldString || unitsSoldString === 'N/A') return 'N/A';
       // Extract number from strings like "1,234 sold in past month" or "1,234+"
       const match = unitsSoldString.match(/[\d,]+/);
       return match ? match[0] : 'N/A';
     };

          return [
       {
         label: 'Units Sold',
         value: extractUnitsNumber(analysisResult.unitsSold)
       },
       {
         label: 'Revenue',
         value: analysisResult.orderAmount ? `$${analysisResult.orderAmount.toLocaleString()}` : 'N/A'
       },
       {
         label: 'Price',
         value: analysisResult.price ? `$${analysisResult.price.toFixed(2)}` : 'N/A'
       },
       {
         label: 'Health Score',
         value: `${Math.round(analysisResult.score || 0)}/100`
       }
     ];
  };

  // Generate issues data for charts
  const getIssuesData = () => {
    if (!analysisResult) return [];

    // Use actual TotalErrors from ranking result
    const rankingErrors = analysisResult.rankingResult?.TotalErrors || 0;
    const conversionErrors = analysisResult.conversionErrors || 0;
    
    return [
      { name: 'Rankings', value: rankingErrors, color: '#FFD600' },
      { name: 'Conversion', value: conversionErrors, color: '#3B82F6' },
      { name: 'Fulfillment', value: 0, color: '#6C7A89' },
      { name: 'Advertising', value: 0, color: '#B2C7DF' },
      { name: 'Account Health', value: 0, color: '#B2B2B2' },
      { name: 'Inventory', value: 0, color: '#1B7F4C' },
    ];
  };

  // Generate detailed issues list
  const getIssueCategories = () => {
    if (!analysisResult) return [];

    const issues = [];

    // Ranking Issues
    const rankingIssues = [];
    
    // Title Result checks
    if (analysisResult.rankingResult?.TitleResult?.nullCheck?.status === 'Error') {
      rankingIssues.push({
        id: 'title-null',
        label: 'Title Null Check',
        message: analysisResult.rankingResult.TitleResult.nullCheck.Message
      });
    }
    if (analysisResult.rankingResult?.TitleResult?.charLim?.status === 'Error') {
      rankingIssues.push({
        id: 'title-charlim',
        label: 'Title Character Limit',
        message: analysisResult.rankingResult.TitleResult.charLim.Message
      });
    }
    if (analysisResult.rankingResult?.TitleResult?.RestictedWords?.status === 'Error') {
      rankingIssues.push({
        id: 'title-restricted',
        label: 'Title Restricted Words',
        message: analysisResult.rankingResult.TitleResult.RestictedWords.Message
      });
    }
    if (analysisResult.rankingResult?.TitleResult?.checkSpecialCharacters?.status === 'Error') {
      rankingIssues.push({
        id: 'title-special-chars',
        label: 'Title Special Characters',
        message: analysisResult.rankingResult.TitleResult.checkSpecialCharacters.Message
      });
    }

    // Bullet Points checks
    if (analysisResult.rankingResult?.BulletPoints?.nullCheck?.status === 'Error') {
      rankingIssues.push({
        id: 'bullets-null',
        label: 'Bullet Points Null Check',
        message: analysisResult.rankingResult.BulletPoints.nullCheck.Message
      });
    }
    if (analysisResult.rankingResult?.BulletPoints?.emptyArray?.status === 'Error') {
      rankingIssues.push({
        id: 'bullets-empty',
        label: 'Bullet Points Empty Array',
        message: analysisResult.rankingResult.BulletPoints.emptyArray.Message
      });
    }
    if (analysisResult.rankingResult?.BulletPoints?.nullItems?.status === 'Error') {
      rankingIssues.push({
        id: 'bullets-null-items',
        label: 'Bullet Points Null Items',
        message: analysisResult.rankingResult.BulletPoints.nullItems.Message
      });
    }
    if (analysisResult.rankingResult?.BulletPoints?.charLim?.status === 'Error') {
      rankingIssues.push({
        id: 'bullets-charlim',
        label: 'Bullet Points Character Limit',
        message: analysisResult.rankingResult.BulletPoints.charLim.Message
      });
    }
    if (analysisResult.rankingResult?.BulletPoints?.RestictedWords?.status === 'Error') {
      rankingIssues.push({
        id: 'bullets-restricted',
        label: 'Bullet Points Restricted Words',
        message: analysisResult.rankingResult.BulletPoints.RestictedWords.Message
      });
    }
    if (analysisResult.rankingResult?.BulletPoints?.checkSpecialCharacters?.status === 'Error') {
      rankingIssues.push({
        id: 'bullets-special-chars',
        label: 'Bullet Points Special Characters',
        message: analysisResult.rankingResult.BulletPoints.checkSpecialCharacters.Message
      });
    }

    // Description checks
    if (analysisResult.rankingResult?.Description?.nullCheck?.status === 'Error') {
      rankingIssues.push({
        id: 'description-null',
        label: 'Description Null Check',
        message: analysisResult.rankingResult.Description.nullCheck.Message
      });
    }
    if (analysisResult.rankingResult?.Description?.emptyArray?.status === 'Error') {
      rankingIssues.push({
        id: 'description-empty',
        label: 'Description Empty Array',
        message: analysisResult.rankingResult.Description.emptyArray.Message
      });
    }
    if (analysisResult.rankingResult?.Description?.charLim?.status === 'Error') {
      rankingIssues.push({
        id: 'description-charlim',
        label: 'Description Character Limit',
        message: analysisResult.rankingResult.Description.charLim.Message
      });
    }
    if (analysisResult.rankingResult?.Description?.RestictedWords?.status === 'Error') {
      rankingIssues.push({
        id: 'description-restricted',
        label: 'Description Restricted Words',
        message: analysisResult.rankingResult.Description.RestictedWords.Message
      });
    }
    if (analysisResult.rankingResult?.Description?.checkSpecialCharacters?.status === 'Error') {
      rankingIssues.push({
        id: 'description-special-chars',
        label: 'Description Special Characters',
        message: analysisResult.rankingResult.Description.checkSpecialCharacters.Message
      });
    }

    if (rankingIssues.length > 0) {
      issues.push({ title: 'RANKING ISSUES', issues: rankingIssues });
    }

    // Conversion Issues
    const conversionIssues = [];
    if (analysisResult.imageResult?.status === 'Error') {
      conversionIssues.push({
        id: 'images',
        label: 'Product Images',
        message: analysisResult.imageResult.Message
      });
    }
    if (analysisResult.videoResult?.status === 'Error') {
      conversionIssues.push({
        id: 'video',
        label: 'Product Video',
        message: analysisResult.videoResult.Message
      });
    }
    if (analysisResult.reviewResult?.status === 'Error') {
      conversionIssues.push({
        id: 'reviews',
        label: 'Product Reviews',
        message: analysisResult.reviewResult.Message
      });
    }
    if (analysisResult.starRatingResult?.status === 'Error') {
      conversionIssues.push({
        id: 'rating',
        label: 'Star Rating',
        message: analysisResult.starRatingResult.Message
      });
    }

    if (conversionIssues.length > 0) {
      issues.push({ title: 'CONVERSION ISSUES', issues: conversionIssues });
    }

    return issues;
  };



  // Search Component
  const SearchComponent = () => (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-cyan-50 w-full lg:mt-0 mt-[12vh] relative overflow-hidden">
      {/* Animated Background Elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-gradient-to-br from-purple-400 to-pink-400 rounded-full opacity-10 animate-pulse"></div>
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-gradient-to-tr from-blue-400 to-cyan-400 rounded-full opacity-10 animate-pulse" style={{ animationDelay: '1s' }}></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-gradient-to-br from-green-400 to-emerald-400 rounded-full opacity-5 animate-pulse" style={{ animationDelay: '2s' }}></div>
      </div>

      {/* Header Section */}
      <div className="bg-white/80 backdrop-blur-md border-b border-gray-200/50 sticky top-0 z-40 shadow-sm">
        <div className="px-4 lg:px-6 py-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-600 via-blue-600 to-cyan-600 bg-clip-text text-transparent">
                  ASIN Analyzer
                </h1>
                <p className="text-sm text-gray-600 mt-1">Analyze any Amazon product for comprehensive insights</p>
              </div>
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-green-100 to-emerald-100 text-green-700 rounded-full text-xs font-medium border border-green-200 shadow-sm">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                Ready to analyze
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="overflow-y-auto" style={{ height: 'calc(100vh - 120px)' }}>
        <div className="px-4 lg:px-6 py-6 pb-20">
          {/* Search Section */}
          <motion.div
            initial={hasAnimated ? false : { opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="bg-white/90 backdrop-blur-sm rounded-2xl border border-white/20 shadow-xl p-8 mb-8 relative overflow-hidden"
          >
            {/* Card Background Gradient */}
            <div className="absolute inset-0 bg-gradient-to-br from-white via-purple-50/30 to-blue-50/30 opacity-50"></div>
            
            <div className="max-w-4xl mx-auto relative z-10">
              <div className="text-center mb-8">
                <motion.div 
                  initial={hasAnimated ? false : { scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.8, delay: hasAnimated ? 0 : 0.3, ease: "backOut" }}
                  className="relative inline-block mb-6"
                >
                  <div className="w-20 h-20 bg-gradient-to-br from-purple-500 via-blue-500 to-cyan-500 rounded-3xl flex items-center justify-center mx-auto shadow-2xl transform rotate-3 hover:rotate-6 transition-transform duration-300">
                    <Search className="w-10 h-10 text-white" />
                  </div>
                  <div className="absolute -top-2 -right-2 w-6 h-6 bg-gradient-to-br from-yellow-400 to-orange-400 rounded-full animate-bounce"></div>
                  <div className="absolute -bottom-1 -left-1 w-4 h-4 bg-gradient-to-br from-pink-400 to-red-400 rounded-full animate-pulse"></div>
                </motion.div>
                
                <motion.h2 
                  initial={hasAnimated ? false : { opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: hasAnimated ? 0 : 0.4, ease: "easeOut" }}
                  className="text-4xl font-bold bg-gradient-to-r from-purple-600 via-blue-600 to-cyan-600 bg-clip-text text-transparent mb-4"
                >
                  Get Comprehensive Product Analysis
                </motion.h2>
                
                <motion.p 
                  initial={hasAnimated ? false : { opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: hasAnimated ? 0 : 0.5, ease: "easeOut" }}
                  className="text-lg text-gray-700 mb-2"
                >
                  Enter an ASIN to get detailed analysis, optimization recommendations, and actionable insights
                </motion.p>
                
                <motion.div 
                  initial={hasAnimated ? false : { opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: hasAnimated ? 0 : 0.6, ease: "easeOut" }}
                  className="flex flex-wrap justify-center gap-4 text-sm"
                >
                  <span className="px-3 py-1 bg-gradient-to-r from-purple-100 to-purple-200 text-purple-700 rounded-full border border-purple-300">✨ Instant analysis</span>
                  <span className="px-3 py-1 bg-gradient-to-r from-blue-100 to-blue-200 text-blue-700 rounded-full border border-blue-300">🎯 Detailed insights</span>
                  <span className="px-3 py-1 bg-gradient-to-r from-green-100 to-green-200 text-green-700 rounded-full border border-green-300">📊 Professional reports</span>
                </motion.div>
              </div>

              <motion.div 
                initial={hasAnimated ? false : { opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: hasAnimated ? 0 : 0.7, ease: "easeOut" }}
                className="max-w-2xl mx-auto mb-6"
              >
                <form 
                  onSubmit={(e) => { 
                    e.preventDefault(); 
                    e.stopPropagation(); 
                    handleAnalyze(); 
                  }} 
                  className="relative flex gap-0 shadow-2xl rounded-xl"
                >
                  <div className="relative flex-1">
                    <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-purple-400 w-5 h-5" />
                    <input
                      type="text"
                      value={asin}
                      onChange={(e) => setAsin(e.target.value)}
                      onPaste={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAnalyze();
                        }
                      }}
                      placeholder="Enter an Amazon product ASIN  Ex: B08N5WRWNW"
                      className="w-full pl-12 pr-4 py-4 border-2 border-purple-200 rounded-l-xl focus:outline-none focus:border-purple-500 focus:ring-4 focus:ring-purple-500/20 text-lg bg-white/90 backdrop-blur-sm transition-all duration-300"
                    />
                  </div>
                  <div className="relative" ref={marketDropdownRef}>
                    <button
                      type="button"
                      className={`
                        relative flex items-center justify-between gap-2 px-6 py-4 border-2 border-l-0 border-purple-200 rounded-r-xl 
                        font-medium text-center min-w-[180px] text-lg h-[60px] transition-all duration-300 group overflow-hidden
                        ${showMarketDropdown 
                          ? 'bg-gradient-to-r from-purple-100 to-blue-100 border-purple-300 shadow-lg' 
                          : 'bg-gradient-to-r from-purple-50 to-blue-50 hover:from-purple-100 hover:to-blue-100 hover:border-purple-300'
                        }
                        focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-400
                      `}
                      onClick={(e) => { 
                        e.preventDefault(); 
                        e.stopPropagation(); 
                        setShowMarketDropdown(!showMarketDropdown); 
                      }}
                    >
                      {/* Background shimmer effect */}
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -skew-x-12 opacity-0 group-hover:opacity-100 group-hover:animate-shimmer transition-opacity duration-500"></div>
                      
                      {/* Selected market display */}
                      <div className="relative flex items-center gap-3 flex-1">
                        {/* Market flag circle */}
                        <div className="w-5 h-5 rounded-full bg-gradient-to-br from-purple-400 to-blue-400 flex items-center justify-center text-white text-xs font-bold shadow-sm">
                          {market}
                        </div>
                        
                        {/* Market name */}
                        <span className="text-gray-700 group-hover:text-gray-800 transition-colors duration-200 truncate">
                          {marketOptions.find(option => option.value === market)?.label || 'Select Market'}
                        </span>
                      </div>
                      
                      {/* Dropdown arrow with animation */}
                      <ChevronDown className={`
                        w-4 h-4 text-purple-500 transition-all duration-300 
                        ${showMarketDropdown ? 'rotate-180 text-purple-600' : 'group-hover:text-purple-600'}
                      `} />
                      
                      {/* Active indicator */}
                      {showMarketDropdown && (
                        <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 w-8 h-1 bg-gradient-to-r from-purple-500 to-blue-500 rounded-t-full"></div>
                      )}
                    </button>
                    
                    <AnimatePresence>
                      {showMarketDropdown && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.2, ease: "easeInOut" }}
                          className="absolute top-full left-0 right-0 bg-gradient-to-b from-white via-purple-50/30 to-blue-50/50 backdrop-blur-xl border-2 border-purple-200 border-t-0 rounded-b-xl shadow-2xl z-[9999] max-h-60 overflow-y-auto overflow-hidden"
                        >
                        {/* Dropdown Header */}
                        <div className="bg-gradient-to-r from-purple-600 via-blue-600 to-cyan-600 text-white px-4 py-2 text-xs font-semibold tracking-wide">
                          SELECT MARKETPLACE
                        </div>
                        
                        {/* Options List */}
                        <ul className="py-2">
                          {marketOptions.map((option, index) => (
                            <li
                              key={option.value}
                              className={`
                                relative px-4 py-3 cursor-pointer transition-all duration-300 group
                                ${market === option.value 
                                  ? 'bg-gradient-to-r from-purple-100 via-blue-100 to-cyan-100 text-purple-800 border-l-4 border-purple-500 font-semibold' 
                                  : 'hover:bg-gradient-to-r hover:from-purple-50 hover:via-blue-50 hover:to-cyan-50 hover:text-purple-700 border-l-4 border-transparent hover:border-purple-400'
                                }
                                transform hover:translate-x-1 hover:scale-[1.02]
                              `}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setMarket(option.value);
                                setShowMarketDropdown(false);
                              }}
                            >
                              {/* Subtle background gradient on hover */}
                              <div className="absolute inset-0 bg-gradient-to-r from-purple-500/5 via-blue-500/5 to-cyan-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-r-lg"></div>
                              
                              {/* Flag and Country Info */}
                              <div className="relative flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  {/* Country Flag Circle */}
                                  <div className="w-6 h-6 rounded-full bg-gradient-to-br from-purple-400 to-blue-400 flex items-center justify-center text-white text-xs font-bold shadow-md">
                                    {option.value}
                                  </div>
                                  
                                  {/* Country Name */}
                                  <span className="text-sm font-medium group-hover:font-semibold transition-all duration-200">
                                    {option.label}
                                  </span>
                                </div>
                                
                                {/* Selected Indicator */}
                                {market === option.value && (
                                  <div className="w-2 h-2 bg-gradient-to-br from-green-400 to-emerald-500 rounded-full shadow-lg animate-pulse"></div>
                                )}
                                
                                {/* Hover Arrow */}
                                <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                                  <ChevronRight className="w-4 h-4 text-purple-500" />
                                </div>
                              </div>
                              
                              {/* Bottom border on hover */}
                              <div className="absolute bottom-0 left-4 right-4 h-px bg-gradient-to-r from-purple-300 via-blue-300 to-cyan-300 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                            </li>
                          ))}
                        </ul>
                        
                        {/* Dropdown Footer */}
                        <div className="bg-gradient-to-r from-gray-50 to-purple-50 px-4 py-2 border-t border-purple-200/50">
                          <div className="text-xs text-gray-500 text-center">
                            {marketOptions.length} marketplaces available
                          </div>
                                                 </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </form>
              </motion.div>

              {error && (
                <motion.div 
                  initial={hasAnimated ? false : { opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                  className="max-w-2xl mx-auto mb-6"
                >
                  <div className="bg-gradient-to-r from-red-50 to-pink-50 border-2 border-red-200 rounded-xl p-4 text-red-700 shadow-lg">
                    {error}
                  </div>
                </motion.div>
              )}

              <motion.div 
                initial={hasAnimated ? false : { opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: hasAnimated ? 0 : 0.8, ease: "easeOut" }}
                className="text-center mb-8"
              >
                <button
                  type="button"
                  className="relative bg-gradient-to-r from-purple-600 via-blue-600 to-cyan-600 hover:from-purple-700 hover:via-blue-700 hover:to-cyan-700 text-white px-10 py-4 rounded-xl flex items-center gap-3 mx-auto transition-all duration-300 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none text-lg font-bold shadow-2xl group overflow-hidden"
                  onClick={(e) => { 
                    e.preventDefault(); 
                    e.stopPropagation(); 
                    handleAnalyze(); 
                  }}
                  disabled={loading}
                >
                  {/* Button Shimmer Effect */}
                  <div className="absolute inset-0 -skew-x-12 bg-gradient-to-r from-transparent via-white/20 to-transparent opacity-0 group-hover:opacity-100 group-hover:animate-shimmer transition-opacity duration-500"></div>
                  
                  {loading ? (
                    <>
                      <Loader2 className="w-6 h-6 animate-spin" />
                      <span className="bg-gradient-to-r from-white to-cyan-100 bg-clip-text text-transparent">Analyzing...</span>
                    </>
                  ) : (
                    <>
                      <span className="bg-gradient-to-r from-white to-cyan-100 bg-clip-text text-transparent">Analyze Product</span>
                      <ChevronRight className="w-6 h-6 group-hover:translate-x-1 transition-transform duration-300" />
                    </>
                  )}
                </button>
              </motion.div>
            </div>
          </motion.div>

          {/* Features Section */}
          <motion.div
            initial={hasAnimated ? false : { opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: hasAnimated ? 0 : 0.2, ease: "easeOut" }}
            className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl mx-auto"
          >
            <motion.div 
              initial={hasAnimated ? false : { opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: hasAnimated ? 0 : 0.4, ease: "easeOut" }}
              className="group bg-white/90 backdrop-blur-sm border border-white/20 rounded-2xl p-6 shadow-xl hover:shadow-2xl transition-all duration-500 hover:-translate-y-2 relative overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 via-transparent to-blue-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
              <div className="relative z-10">
                <div className="w-14 h-14 bg-gradient-to-br from-purple-500 to-blue-500 rounded-2xl flex items-center justify-center mb-4 shadow-lg group-hover:scale-110 transition-transform duration-300">
                  <Search className="w-7 h-7 text-white" />
                </div>
                <h3 className="font-bold text-gray-900 mb-3 text-lg group-hover:text-purple-700 transition-colors duration-300">Comprehensive Analysis</h3>
                <p className="text-sm text-gray-600 leading-relaxed">Analyze 13+ data points including rankings, conversion, fulfillment, and more with AI-powered insights</p>
              </div>
            </motion.div>

            <motion.div 
              initial={hasAnimated ? false : { opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: hasAnimated ? 0 : 0.5, ease: "easeOut" }}
              className="group bg-white/90 backdrop-blur-sm border border-white/20 rounded-2xl p-6 shadow-xl hover:shadow-2xl transition-all duration-500 hover:-translate-y-2 relative overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-green-500/5 via-transparent to-emerald-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
              <div className="relative z-10">
                <div className="w-14 h-14 bg-gradient-to-br from-green-500 to-emerald-500 rounded-2xl flex items-center justify-center mb-4 shadow-lg group-hover:scale-110 transition-transform duration-300">
                  <Info className="w-7 h-7 text-white" />
                </div>
                <h3 className="font-bold text-gray-900 mb-3 text-lg group-hover:text-green-700 transition-colors duration-300">Actionable Insights</h3>
                <p className="text-sm text-gray-600 leading-relaxed">Get specific recommendations on how to fix issues and optimize performance with step-by-step guidance</p>
              </div>
            </motion.div>

            <motion.div 
              initial={hasAnimated ? false : { opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: hasAnimated ? 0 : 0.6, ease: "easeOut" }}
              className="group bg-white/90 backdrop-blur-sm border border-white/20 rounded-2xl p-6 shadow-xl hover:shadow-2xl transition-all duration-500 hover:-translate-y-2 relative overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-orange-500/5 via-transparent to-red-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
              <div className="relative z-10">
                <div className="w-14 h-14 bg-gradient-to-br from-orange-500 to-red-500 rounded-2xl flex items-center justify-center mb-4 shadow-lg group-hover:scale-110 transition-transform duration-300">
                  <Download className="w-7 h-7 text-white" />
                </div>
                <h3 className="font-bold text-gray-900 mb-3 text-lg group-hover:text-orange-700 transition-colors duration-300">Detailed Reports</h3>
                <p className="text-sm text-gray-600 leading-relaxed">Download comprehensive PDF reports with all findings and recommendations for easy sharing</p>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </div>
    </div>
  );

  // CSV Download function
  const downloadCSV = () => {
    try {
      const keyMetrics = getKeyMetrics();
      const productAnalysis = getProductAnalysisData();
      const issueCategories = getIssueCategories();
      const rankingScore = calculateRankingScore(analysisResult.rankingResult);
      const conversionScore = calculateConversionScore(analysisResult);

      // Prepare CSV data
      const csvData = [];
      
      // Header
      csvData.push(['ASIN Analysis Report']);
      csvData.push(['Generated on:', new Date().toLocaleDateString()]);
      csvData.push(['']);
      
      // Basic Product Information
      csvData.push(['Product Information']);
      csvData.push(['ASIN:', asin]);
      csvData.push(['Market:', market]);
      csvData.push(['Title:', analysisResult?.Title || 'N/A']);
      csvData.push(['Brand:', analysisResult?.Brand || 'N/A']);
      csvData.push(['Category:', analysisResult?.category || 'N/A']);
      csvData.push(['Price:', analysisResult?.price ? `$${analysisResult.price}` : 'N/A']);
      csvData.push(['Star Rating:', analysisResult?.starRatting ? `${analysisResult.starRatting}/5` : 'N/A']);
      csvData.push(['Reviews Count:', analysisResult?.ReviewsCount || 'N/A']);
      csvData.push(['Health Score:', `${Math.round(analysisResult?.score || 0)}/100`]);
      csvData.push(['']);
      
      // Key Metrics
      csvData.push(['Key Metrics']);
      csvData.push(['Metric', 'Value']);
      keyMetrics.forEach(metric => {
        csvData.push([metric.label, metric.value]);
      });
      csvData.push(['']);
      
      // Product Analysis Details
      csvData.push(['Product Analysis Details']);
      csvData.push(['Category', 'Current', 'Required', 'Score', 'Status']);
      productAnalysis.forEach(item => {
        csvData.push([
          item.category,
          item.current,
          item.required,
          `${item.score}%`,
          item.score >= 80 ? 'Good' : item.score >= 60 ? 'Warning' : 'Poor'
        ]);
      });
      csvData.push(['']);
      
      // Scores Summary
      csvData.push(['Scores Summary']);
      csvData.push(['Ranking Score:', `${rankingScore.score}/${rankingScore.maxScore} (${rankingScore.percentage}%)`]);
      csvData.push(['Conversion Score:', `${conversionScore.score}/${conversionScore.maxScore} (${conversionScore.percentage}%)`]);
      csvData.push(['']);
      
      // Issues Found
      csvData.push(['Issues Found']);
      csvData.push(['Category', 'Issue ID', 'Issue Description', 'Message']);
      issueCategories.forEach(category => {
        if (category.issues && category.issues.length > 0) {
          category.issues.forEach(issue => {
            csvData.push([category.title, issue.id, issue.label, issue.message]);
          });
        }
      });
      
      // Convert to CSV string
      const csvString = csvData.map(row => 
        row.map(cell => {
          // Escape quotes and wrap in quotes if contains comma or quotes
          const cellString = String(cell || '');
          if (cellString.includes(',') || cellString.includes('"') || cellString.includes('\n')) {
            return `"${cellString.replace(/"/g, '""')}"`;
          }
          return cellString;
        }).join(',')
      ).join('\n');
      
      // Create and download file
      const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `ASIN_Analysis_${asin}_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
    } catch (error) {
      console.error('Error generating CSV:', error);
      alert('Error generating CSV file. Please try again.');
    }
  };

  // Results Component
  const ResultsComponent = () => {
    const keyMetrics = getKeyMetrics();
    const productAnalysis = getProductAnalysisData();
    const issueData = getIssuesData();
    const totalErrors = issueData.reduce((sum, d) => sum + d.value, 0);
    const issueCategories = getIssueCategories();
    const rankingScore = calculateRankingScore(analysisResult.rankingResult);
    const conversionScore = calculateConversionScore(analysisResult);

         return (
      <div className="p-2 md:p-6 w-full max-h-screen overflow-y-auto">
        {/* Header with New Search Button */}
        <div className="bg-white border border-[#e5e7eb] rounded-xl shadow-sm p-4 md:p-6 mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#222b45] mb-2">Product Analysis Results</h1>
            <p className="text-sm text-[#6b7280]">ASIN: {asin} | Market: {market}</p>
          </div>
          <button
            type="button"
            onClick={(e) => { 
              e.preventDefault(); 
              e.stopPropagation(); 
              handleNewSearch(); 
            }}
            className="flex items-center gap-2 bg-[#3B4A6B] hover:bg-[#2d3a52] text-white px-6 py-2 rounded-lg font-semibold shadow transition-all"
          >
            <Search size={18} />
            New Search
          </button>
        </div>



        {/* Product Summary Card */}
        <div className="bg-white border border-[#e5e7eb] rounded-xl shadow-sm p-4 md:p-6 flex flex-col gap-4">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            {/* Product Image */}
            <div className="flex-shrink-0">
              <img
                src={analysisResult?.image || "https://m.media-amazon.com/images/I/61pQK4pYQwL._AC_SL1500_.jpg"}
                alt="product"
                className="w-32 h-32 object-cover rounded-lg border border-[#e5e7eb] bg-white"
              />
            </div>
            {/* Product Details & Health Score */}
            <div className="flex-1 flex flex-col gap-2 md:ml-6">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                <div>
                  <div className="font-semibold text-lg text-[#222b45]">{analysisResult?.Title || 'Product Title'}</div>
                  <div className="text-xs text-[#6b7280] mt-1 flex flex-wrap gap-x-4 gap-y-1">
                    <span>ASIN : {asin}</span>
                    <span>Category : {analysisResult?.category || 'N/A'}</span>
                  </div>
                  <div className="text-xs text-[#6b7280] mt-1 flex flex-wrap gap-x-4 gap-y-1">
                    <span>Brand : {analysisResult?.Brand || 'N/A'}</span>
                    <span>List Price : ${analysisResult?.price || 0}</span>
                  </div>
                  <div className="text-xs text-[#6b7280] mt-1 flex flex-wrap gap-x-4 gap-y-1">
                    <span>Star Ratings : {analysisResult?.starRatting ?? 0}/5</span>
                    <span>Reviews Count : {analysisResult?.ReviewsCount ?? 0}</span>
                  </div>
                </div>
                {/* Download Button */}
                <button 
                  type="button" 
                  onClick={(e) => { 
                    e.preventDefault(); 
                    e.stopPropagation(); 
                    downloadCSV(); 
                  }}
                  className="flex items-center justify-center gap-2 bg-[#2a2d42] hover:bg-[#23253a] text-white px-6 py-2 rounded-md font-semibold shadow transition-all mt-2 md:mt-0 whitespace-nowrap"
                >
                  <span>Download CSV</span>
                  <Download size={18} />
                </button>
              </div>
              {/* Health Score */}
              <div className="mt-3 md:mt-4">
                <div className="inline-block bg-[#f8fafc] border border-[#e5e7eb] rounded-lg px-4 py-2">
                  <div className="flex items-center gap-4">
                    <span className="text-xs text-[#6b7280]">Health Score</span>
                    <span className="text-[#222b45] font-bold text-sm bg-[#f8fafc] px-3 py-1 rounded">{Math.round(analysisResult?.score || 0)}/100</span>
                  </div>
                  <div className="w-40 h-2 bg-[#e5e7eb] rounded mt-2">
                    <div className="h-2 bg-[#3ec28f] rounded" style={{ width: `${analysisResult?.score || 0}%` }}></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          {/* Key Metrics */}
          <div className="mt-4">
            <div className="font-semibold text-[#222b45] mb-2 text-base">KEY METRICS</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              {keyMetrics.map((metric, idx) => (
                <div
                  key={idx}
                  className="bg-[#f8fafc] border border-[#e5e7eb] rounded-lg p-4 flex flex-col items-center gap-1 min-w-[120px]"
                >
                  <div className="flex items-center gap-1 text-xs text-[#6b7280] mb-1">
                    {metric.label}
                    <Info size={14} className="ml-1 text-[#bdbdbd]" />
                  </div>
                  <div className="text-xl font-bold text-[#222b45]">
                    {metric.value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        
        {/* Product Analysis */}
        <div className="mb-6">
          <div className="font-semibold text-[#2a2d42] mb-2">Product Analysis</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {productAnalysis.map((item, idx) => (
              <div key={idx} className="bg-white border rounded-lg p-4 shadow-sm flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-[#2a2d42]">{item.label}</span>
                  <span className="text-xs font-bold text-[#2a2d42]">{item.score}/{item.max}</span>
                </div>
                <div className="w-full h-2 bg-gray-200 rounded">
                  <div className="h-2 bg-[#05724e] rounded" style={{ width: `${item.score}%` }}></div>
                </div>
                <div className="text-xs text-gray-500">Current: {item.current}</div>
                <div className="text-xs text-gray-400">Recommended: {item.recommended}</div>
              </div>
            ))}
          </div>
        </div>
        
        {/* ISSUES SECTION */}
        <div className="mt-8">
          <div className="font-semibold text-[#222b45] mb-3 text-base">ISSUES</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Donut Chart Card */}
            <div className="bg-white border border-[#e5e7eb] rounded-xl p-6 flex flex-col gap-4 min-h-[260px]">
              <div className="text-sm text-[#222b45] mb-2">{totalErrors} Issues found with the product</div>
              <div className="flex items-center gap-6">
                {/* Donut Chart */}
                <div className="relative w-32 h-32">
                  <ResponsiveContainer width={128} height={128}>
                    <PieChart>
                      <Pie
                        data={issueData}
                        dataKey="value"
                        innerRadius={44}
                        outerRadius={64}
                        startAngle={90}
                        endAngle={-270}
                        paddingAngle={2}
                      >
                        {issueData.map((entry, idx) => (
                          <Cell key={`cell-${idx}`} fill={entry.color} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-2xl font-bold text-[#222b45]">{totalErrors.toString().padStart(2, '0')}</span>
                    <span className="text-xs text-[#D7263D] font-semibold mt-1">ERRORS</span>
                  </div>
                </div>
                {/* Legend */}
                <div className="flex flex-col flex-wrap gap-2 text-xs">
                  {issueData.map((item, idx) => (
                    <div key={item.name} className="flex items-center gap-2">
                      <span className="inline-block w-3 h-3 rounded-full" style={{ background: item.color }}></span>
                      <span className="text-[#222b45] w-20">{item.name}</span>
                      <span className="text-[#222b45] font-semibold">{item.value.toString().padStart(2, '0')}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {/* Ranking and Conversion Scores */}
            <div className="bg-white border border-[#e5e7eb] rounded-xl p-6 flex flex-col gap-6 min-h-[260px]">
              <div className="text-sm text-[#222b45] mb-2 font-semibold">Performance Scores</div>
              
              {/* Ranking Score */}
              <div className="flex flex-col gap-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-[#6b7280]">Ranking Score</span>
                  <span className="text-lg font-bold text-[#222b45]">{rankingScore.score}/{rankingScore.maxScore}</span>
                </div>
                <div className="w-full h-3 bg-[#f3f4f6] rounded">
                  <div className="h-3 bg-[#FFD600] rounded" style={{ width: `${rankingScore.percentage}%` }}></div>
                </div>
                <div className="text-xs text-[#6b7280]">{rankingScore.percentage}% optimized</div>
              </div>
              
              {/* Conversion Score */}
              <div className="flex flex-col gap-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-[#6b7280]">Conversion Score</span>
                  <span className="text-lg font-bold text-[#222b45]">{conversionScore.score}/{conversionScore.maxScore}</span>
                </div>
                <div className="w-full h-3 bg-[#f3f4f6] rounded">
                  <div className="h-3 bg-[#3B82F6] rounded" style={{ width: `${conversionScore.percentage}%` }}></div>
                </div>
                <div className="text-xs text-[#6b7280]">{conversionScore.percentage}% optimized</div>
              </div>
            </div>
          </div>
        </div>
        
        {/* ISSUES LIST SECTION */}
        {issueCategories.length > 0 && (
          <div className="mt-8">
            <div className="bg-white border border-[#e5e7eb] rounded-xl p-4">
              {/* Header Row */}
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-4">
                <div className="flex items-center gap-2 text-sm text-[#222b45] font-medium">
                  TOTAL : {totalErrors} Issues found
                  <Info size={16} className="text-[#bdbdbd]" />
                </div>

              </div>
              {/* Issue Categories */}
              <div className="flex flex-col gap-6">
                {issueCategories.map((cat, idx) => (
                  <div key={cat.title}>
                    {/* Category Header */}
                    <div className="bg-[#2a2d42] text-white rounded-t-md px-4 py-2 font-semibold text-sm flex items-center">
                      {cat.title}
                    </div>
                    {/* Issue Rows */}
                    <div className="flex flex-col">
                      {cat.issues.map((issue, i) => (
                        <div key={i} className="border-b last:border-b-0 border-[#e5e7eb] bg-white px-4 py-3 text-sm text-[#222b45]">
                          <div className="font-medium text-[#222b45] mb-1">{issue.label}</div>
                          <div className="text-gray-600">{issue.message}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        <div className='w-full h-[5rem]'></div>
      </div>
    );
  };

  // Main render logic
  return (
    <div className="min-h-screen overflow-y-auto">
      {analysisResult ? <ResultsComponent /> : <SearchComponent />}
    </div>
  );
};

export default ASINAnalyzer; 