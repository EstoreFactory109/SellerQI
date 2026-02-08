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
    <div className="min-h-screen w-full" style={{ background: '#1a1a1a', padding: '10px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header Section */}
      <div style={{ background: '#161b22', padding: '10px 15px', borderRadius: '6px', border: '1px solid #30363d', marginBottom: '10px' }}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4" style={{ color: '#60a5fa' }} />
            <div>
              <h1 className="text-base font-bold" style={{ color: '#f3f4f6' }}>
                ASIN Analyzer
              </h1>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div>
        {/* Search Section */}
        <motion.div
          initial={hasAnimated ? false : { opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          style={{ background: '#161b22', borderRadius: '6px', border: '1px solid #30363d', padding: '15px', marginBottom: '10px' }}
        >
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-4">
              <motion.p 
                initial={hasAnimated ? false : { opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: hasAnimated ? 0 : 0.5, ease: "easeOut" }}
                className="text-xs mb-3" style={{ color: '#9ca3af' }}
              >
                Enter an ASIN to get detailed analysis and optimization recommendations
              </motion.p>
            </div>

            <motion.div 
              initial={hasAnimated ? false : { opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: hasAnimated ? 0 : 0.7, ease: "easeOut" }}
              className="max-w-2xl mx-auto mb-4"
            >
              <form 
                onSubmit={(e) => { 
                  e.preventDefault(); 
                  e.stopPropagation(); 
                  handleAnalyze(); 
                }} 
                className="relative flex gap-0 rounded-lg"
                style={{ border: '1px solid #30363d' }}
              >
                <div className="relative flex-1">
                  <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5" style={{ color: '#6b7280' }} />
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
                    className="w-full pl-8 pr-3 py-2 rounded-l-lg text-xs transition-all duration-300"
                    style={{ background: '#1a1a1a', border: 'none', color: '#f3f4f6' }}
                    onFocus={(e) => e.target.style.outline = 'none'}
                    onBlur={(e) => e.target.style.outline = 'none'}
                  />
                </div>
                <div className="relative" ref={marketDropdownRef}>
                  <button
                    type="button"
                    className="relative flex items-center justify-between gap-2 px-3 py-2 border-l font-medium text-center min-w-[140px] text-xs transition-all duration-300"
                    style={{ 
                      background: showMarketDropdown ? '#21262d' : '#1a1a1a',
                      borderColor: '#30363d',
                      color: '#f3f4f6',
                      borderRadius: '0 6px 6px 0'
                    }}
                    onMouseEnter={(e) => !showMarketDropdown && (e.target.style.background = '#161b22')}
                    onMouseLeave={(e) => !showMarketDropdown && (e.target.style.background = '#1a1a1a')}
                    onClick={(e) => { 
                      e.preventDefault(); 
                      e.stopPropagation(); 
                      setShowMarketDropdown(!showMarketDropdown); 
                    }}
                  >
                      {/* Selected market display */}
                      <div className="relative flex items-center gap-2 flex-1">
                        {/* Market flag circle */}
                        <div className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ background: 'rgba(59, 130, 246, 0.2)', color: '#60a5fa' }}>
                          {market}
                        </div>
                        
                        {/* Market name */}
                        <span className="truncate text-xs">
                          {marketOptions.find(option => option.value === market)?.label || 'Select Market'}
                        </span>
                      </div>
                      
                      {/* Dropdown arrow with animation */}
                      <ChevronDown className={`w-3.5 h-3.5 transition-all duration-300 ${showMarketDropdown ? 'rotate-180' : ''}`} style={{ color: '#9ca3af' }} />
                    </button>
                    
                    <AnimatePresence>
                      {showMarketDropdown && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.2, ease: "easeInOut" }}
                          className="absolute top-full left-0 right-0 rounded-b-lg z-[9999] max-h-60 overflow-y-auto overflow-hidden"
                          style={{ background: '#161b22', border: '1px solid #30363d', borderTop: 'none' }}
                        >
                        {/* Dropdown Header */}
                        <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide" style={{ background: '#21262d', color: '#9ca3af' }}>
                          SELECT MARKETPLACE
                        </div>
                        
                        {/* Options List */}
                        <ul className="py-1">
                          {marketOptions.map((option, index) => (
                            <li
                              key={option.value}
                              className="relative px-3 py-2 cursor-pointer transition-all duration-300 text-xs"
                              style={{ 
                                background: market === option.value ? '#21262d' : 'transparent',
                                color: market === option.value ? '#60a5fa' : '#f3f4f6',
                                borderLeft: market === option.value ? '2px solid #3b82f6' : '2px solid transparent'
                              }}
                              onMouseEnter={(e) => {
                                if (market !== option.value) {
                                  e.currentTarget.style.background = '#21262d';
                                }
                              }}
                              onMouseLeave={(e) => {
                                if (market !== option.value) {
                                  e.currentTarget.style.background = 'transparent';
                                }
                              }}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setMarket(option.value);
                                setShowMarketDropdown(false);
                              }}
                            >
                              {/* Flag and Country Info */}
                              <div className="relative flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  {/* Country Flag Circle */}
                                  <div className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ background: 'rgba(59, 130, 246, 0.2)', color: '#60a5fa' }}>
                                    {option.value}
                                  </div>
                                  
                                  {/* Country Name */}
                                  <span className="text-xs">
                                    {option.label}
                                  </span>
                                </div>
                                
                                {/* Selected Indicator */}
                                {market === option.value && (
                                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#22c55e' }}></div>
                                )}
                              </div>
                            </li>
                          ))}
                        </ul>
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
                className="max-w-2xl mx-auto mb-3"
              >
                <div className="rounded-lg p-2 text-xs" style={{ background: 'rgba(239, 68, 68, 0.2)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#f87171' }}>
                  {error}
                </div>
              </motion.div>
            )}

            <motion.div 
              initial={hasAnimated ? false : { opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: hasAnimated ? 0 : 0.8, ease: "easeOut" }}
              className="text-center"
            >
              <button
                type="button"
                className="relative px-6 py-2 rounded-lg flex items-center gap-2 mx-auto transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium"
                style={{ background: '#3b82f6', color: 'white' }}
                onMouseEnter={(e) => !loading && (e.target.style.background = '#2563eb')}
                onMouseLeave={(e) => e.target.style.background = '#3b82f6'}
                onClick={(e) => { 
                  e.preventDefault(); 
                  e.stopPropagation(); 
                  handleAnalyze(); 
                }}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Analyzing...</span>
                  </>
                ) : (
                  <>
                    <span>Analyze Product</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </motion.div>
          </div>
        </motion.div>
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
      <div className="w-full" style={{ background: '#1a1a1a', padding: '10px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        {/* Header with New Search Button */}
        <div style={{ background: '#161b22', borderRadius: '6px', border: '1px solid #30363d', padding: '10px 15px', marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4" style={{ color: '#60a5fa' }} />
            <div>
              <h1 className="text-base font-bold" style={{ color: '#f3f4f6' }}>Product Analysis Results</h1>
              <p className="text-xs" style={{ color: '#f3f4f6' }}>ASIN: {asin} | Market: {market}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={(e) => { 
              e.preventDefault(); 
              e.stopPropagation(); 
              handleNewSearch(); 
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
            style={{ background: '#1a1a1a', border: '1px solid #30363d', color: '#f3f4f6' }}
            onMouseEnter={(e) => e.target.style.borderColor = '#3b82f6'}
            onMouseLeave={(e) => e.target.style.borderColor = '#30363d'}
          >
            <Search size={14} />
            New Search
          </button>
        </div>



        {/* Product Summary Card */}
        <div style={{ background: '#161b22', borderRadius: '6px', border: '1px solid #30363d', padding: '12px', marginBottom: '10px' }}>
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
            {/* Product Image */}
            <div className="flex-shrink-0">
              <img
                src={analysisResult?.image || "https://m.media-amazon.com/images/I/61pQK4pYQwL._AC_SL1500_.jpg"}
                alt="product"
                className="w-20 h-20 object-cover rounded-lg"
                style={{ border: '1px solid #30363d' }}
              />
            </div>
            {/* Product Details & Health Score */}
            <div className="flex-1 flex flex-col gap-2 md:ml-4">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                <div>
                  <div className="font-semibold text-sm" style={{ color: '#f3f4f6' }}>{analysisResult?.Title || 'Product Title'}</div>
                  <div className="text-[10px] mt-1 flex flex-wrap gap-x-3 gap-y-0.5" style={{ color: '#f3f4f6' }}>
                    <span>ASIN: {asin}</span>
                    <span>Category: {analysisResult?.category || 'N/A'}</span>
                  </div>
                  <div className="text-[10px] mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5" style={{ color: '#f3f4f6' }}>
                    <span>Brand: {analysisResult?.Brand || 'N/A'}</span>
                    <span>Price: ${analysisResult?.price || 0}</span>
                  </div>
                  <div className="text-[10px] mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5" style={{ color: '#f3f4f6' }}>
                    <span>Rating: {analysisResult?.starRatting ?? 0}/5</span>
                    <span>Reviews: {analysisResult?.ReviewsCount ?? 0}</span>
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
                  className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap"
                  style={{ background: '#1a1a1a', border: '1px solid #30363d', color: '#f3f4f6' }}
                  onMouseEnter={(e) => e.target.style.borderColor = '#3b82f6'}
                  onMouseLeave={(e) => e.target.style.borderColor = '#30363d'}
                >
                  <span>Download CSV</span>
                  <Download size={14} />
                </button>
              </div>
              {/* Health Score */}
              <div className="mt-2">
                <div className="inline-block rounded-lg px-3 py-1.5" style={{ background: '#21262d', border: '1px solid #30363d' }}>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] uppercase tracking-wide" style={{ color: '#f3f4f6' }}>Health Score</span>
                    <span className="font-bold text-sm px-2 py-0.5 rounded" style={{ background: '#1a1a1a', color: '#f3f4f6' }}>{Math.round(analysisResult?.score || 0)}/100</span>
                  </div>
                  <div className="w-32 h-1.5 rounded mt-1.5" style={{ background: '#21262d' }}>
                    <div className="h-1.5 rounded" style={{ width: `${analysisResult?.score || 0}%`, background: '#22c55e' }}></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          {/* Key Metrics */}
          <div className="mt-3">
            <div className="font-semibold text-xs uppercase tracking-wide mb-2" style={{ color: '#f3f4f6' }}>KEY METRICS</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
              {keyMetrics.map((metric, idx) => (
                <div
                  key={idx}
                  className="rounded-lg p-2 flex flex-col items-center gap-1"
                  style={{ background: '#21262d', border: '1px solid #30363d' }}
                >
                  <div className="flex items-center gap-1 text-[10px] mb-0.5" style={{ color: '#f3f4f6' }}>
                    {metric.label}
                    <Info size={12} style={{ color: '#6b7280' }} />
                  </div>
                  <div className="text-base font-bold" style={{ color: '#f3f4f6' }}>
                    {metric.value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        
        {/* Product Analysis */}
        <div style={{ marginBottom: '10px' }}>
          <div className="font-semibold text-xs uppercase tracking-wide mb-2" style={{ color: '#f3f4f6' }}>Product Analysis</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {productAnalysis.map((item, idx) => (
              <div key={idx} className="rounded-lg p-2 flex flex-col gap-1.5" style={{ background: '#161b22', border: '1px solid #30363d' }}>
                <div className="flex items-center justify-between">
                  <span className="font-medium text-xs" style={{ color: '#f3f4f6' }}>{item.label}</span>
                  <span className="text-[10px] font-bold" style={{ color: '#f3f4f6' }}>{item.score}/{item.max}</span>
                </div>
                <div className="w-full h-1.5 rounded" style={{ background: '#21262d' }}>
                  <div className="h-1.5 rounded" style={{ width: `${item.score}%`, background: '#22c55e' }}></div>
                </div>
                <div className="text-[10px]" style={{ color: '#f3f4f6' }}>Current: {item.current}</div>
                <div className="text-[10px]" style={{ color: '#f3f4f6' }}>Recommended: {item.recommended}</div>
              </div>
            ))}
          </div>
        </div>
        
        {/* ISSUES SECTION */}
        <div style={{ marginTop: '10px' }}>
          <div className="font-semibold text-xs uppercase tracking-wide mb-2" style={{ color: '#f3f4f6' }}>ISSUES</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {/* Donut Chart Card */}
            <div className="rounded-lg p-3 flex flex-col gap-3" style={{ background: '#161b22', border: '1px solid #30363d' }}>
              <div className="text-xs" style={{ color: '#f3f4f6' }}>{totalErrors} Issues found with the product</div>
              <div className="flex items-center gap-4">
                {/* Donut Chart */}
                <div className="relative w-24 h-24">
                  <ResponsiveContainer width={96} height={96}>
                    <PieChart>
                      <Pie
                        data={issueData}
                        dataKey="value"
                        innerRadius={32}
                        outerRadius={48}
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
                    <span className="text-lg font-bold" style={{ color: '#f3f4f6' }}>{totalErrors.toString().padStart(2, '0')}</span>
                    <span className="text-[10px] font-semibold mt-0.5" style={{ color: '#f87171' }}>ERRORS</span>
                  </div>
                </div>
                {/* Legend */}
                <div className="flex flex-col flex-wrap gap-1.5 text-[10px]">
                  {issueData.map((item, idx) => (
                    <div key={item.name} className="flex items-center gap-1.5">
                      <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: item.color }}></span>
                      <span className="w-16" style={{ color: '#f3f4f6' }}>{item.name}</span>
                      <span className="font-semibold" style={{ color: '#f3f4f6' }}>{item.value.toString().padStart(2, '0')}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {/* Ranking and Conversion Scores */}
            <div className="rounded-lg p-3 flex flex-col gap-4" style={{ background: '#161b22', border: '1px solid #30363d' }}>
              <div className="text-xs font-semibold" style={{ color: '#f3f4f6' }}>Performance Scores</div>
              
              {/* Ranking Score */}
              <div className="flex flex-col gap-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs" style={{ color: '#f3f4f6' }}>Ranking Score</span>
                  <span className="text-sm font-bold" style={{ color: '#f3f4f6' }}>{rankingScore.score}/{rankingScore.maxScore}</span>
                </div>
                <div className="w-full h-2 rounded" style={{ background: '#21262d' }}>
                  <div className="h-2 rounded" style={{ width: `${rankingScore.percentage}%`, background: '#fbbf24' }}></div>
                </div>
                <div className="text-[10px]" style={{ color: '#f3f4f6' }}>{rankingScore.percentage}% optimized</div>
              </div>
              
              {/* Conversion Score */}
              <div className="flex flex-col gap-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs" style={{ color: '#f3f4f6' }}>Conversion Score</span>
                  <span className="text-sm font-bold" style={{ color: '#f3f4f6' }}>{conversionScore.score}/{conversionScore.maxScore}</span>
                </div>
                <div className="w-full h-2 rounded" style={{ background: '#21262d' }}>
                  <div className="h-2 rounded" style={{ width: `${conversionScore.percentage}%`, background: '#3b82f6' }}></div>
                </div>
                <div className="text-[10px]" style={{ color: '#f3f4f6' }}>{conversionScore.percentage}% optimized</div>
              </div>
            </div>
          </div>
        </div>
        
        {/* ISSUES LIST SECTION */}
        {issueCategories.length > 0 && (
          <div style={{ marginTop: '10px' }}>
            <div className="rounded-lg p-3" style={{ background: '#161b22', border: '1px solid #30363d' }}>
              {/* Header Row */}
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-2">
                <div className="flex items-center gap-1.5 text-xs font-medium" style={{ color: '#f3f4f6' }}>
                  TOTAL : {totalErrors} Issues found
                  <Info size={12} style={{ color: '#6b7280' }} />
                </div>
              </div>
              {/* Issue Categories */}
              <div className="flex flex-col gap-2">
                {issueCategories.map((cat, idx) => (
                  <div key={cat.title}>
                    {/* Category Header */}
                    <div className="rounded-t px-2 py-1.5 font-semibold text-xs flex items-center" style={{ background: '#21262d', color: '#f3f4f6' }}>
                      {cat.title}
                    </div>
                    {/* Issue Rows */}
                    <div className="flex flex-col">
                      {cat.issues.map((issue, i) => (
                        <div key={i} className="border-b last:border-b-0 px-2 py-2 text-xs" style={{ borderColor: '#30363d', background: '#161b22', color: '#f3f4f6' }}>
                          <div className="font-medium mb-0.5" style={{ color: '#f3f4f6' }}>{issue.label}</div>
                          <div style={{ color: '#f3f4f6' }}>{issue.message}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        </div>
      </div>
    );
  };

  // Main render logic
  return (
    <div className="min-h-screen overflow-y-auto" style={{ background: '#1a1a1a' }}>
      {analysisResult ? <ResultsComponent /> : <SearchComponent />}
    </div>
  );
};

export default ASINAnalyzer; 