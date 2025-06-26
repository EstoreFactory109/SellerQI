import React, { useState, useEffect, useRef } from 'react';
import { Info, Download, Search, ChevronRight, Loader2, ChevronDown } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { AnimatePresence, motion } from 'framer-motion';
import { AnalyseProduct } from '../operations/AnalyseProduct';

const ASINAnalyzer = () => {
  // State management
  const [asin, setAsin] = useState('');
  const [market, setMarket] = useState('US');
  const [loading, setLoading] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [error, setError] = useState(null);
  const [showMarketDropdown, setShowMarketDropdown] = useState(false);
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
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 flex flex-col overflow-y-auto">
      <div className="flex-1 flex items-center justify-center py-20 px-4 max-w-full">
        <div className="w-full max-w-4xl text-center">
          <div className="mb-12">
            <h1 className="text-5xl font-bold mb-6 leading-tight text-[#222b45]">
              Analyze Any Amazon Product
            </h1>
            <p className="text-xl text-[#6b7280] mb-2">
              Get a <span className="text-red-500 font-semibold">Comprehensive Health Check</span> of Any Amazon Product
            </p>
            <p className="text-[#6b7280]">
              Enter an ASIN to get detailed analysis, optimization recommendations, and actionable insights
            </p>
          </div>

          <div className="max-w-2xl mx-auto mb-6">
            <div className="relative flex gap-0 shadow-lg">
              <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                <input
                  type="text"
                  value={asin}
                  onChange={(e) => setAsin(e.target.value)}
                  placeholder="Enter an Amazon product ASIN  Ex: B08N5WRWNW"
                  className="w-full pl-12 pr-4 py-4 border border-gray-300 rounded-l-lg focus:outline-none focus:border-[#3B4A6B] focus:ring-2 focus:ring-[#3B4A6B]/20 text-lg"
                  onKeyPress={(e) => e.key === 'Enter' && handleAnalyze()}
                />
              </div>
              <div className="relative" ref={marketDropdownRef}>
                <button
                  type="button"
                  className="flex items-center justify-between gap-2 px-6 py-4 border border-l-0 border-gray-300 rounded-r-lg bg-white hover:bg-gray-50 focus:outline-none font-medium text-center min-w-[180px] text-lg h-[60px]"
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

          {error && (
            <div className="max-w-2xl mx-auto mb-6">
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
                {error}
              </div>
            </div>
          )}

          <div className="max-w-2xl mx-auto mb-8">
            <p className="text-gray-600 mb-6 text-sm">
              Instant analysis • Detailed insights • Professional recommendations • Comprehensive reports
            </p>

            <button
              type="button"
              className="bg-[#3B4A6B] text-white px-8 py-4 rounded-lg flex items-center gap-2 mx-auto hover:bg-[#2d3a52] transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none text-lg font-semibold shadow-lg"
              onClick={handleAnalyze}
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  Analyze Product <ChevronRight className="w-5 h-5" />
                </>
              )}
            </button>
          </div>

          {/* Features */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow">
              <div className="w-12 h-12 bg-[#3B4A6B]/10 rounded-lg flex items-center justify-center mb-4 mx-auto">
                <Search className="w-6 h-6 text-[#3B4A6B]" />
              </div>
              <h3 className="font-semibold text-[#222b45] mb-2">Comprehensive Analysis</h3>
              <p className="text-sm text-[#6b7280]">Analyze 13+ data points including rankings, conversion, fulfillment, and more</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow">
              <div className="w-12 h-12 bg-[#3B4A6B]/10 rounded-lg flex items-center justify-center mb-4 mx-auto">
                <Info className="w-6 h-6 text-[#3B4A6B]" />
              </div>
              <h3 className="font-semibold text-[#222b45] mb-2">Actionable Insights</h3>
              <p className="text-sm text-[#6b7280]">Get specific recommendations on how to fix issues and optimize performance</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow">
              <div className="w-12 h-12 bg-[#3B4A6B]/10 rounded-lg flex items-center justify-center mb-4 mx-auto">
                <Download className="w-6 h-6 text-[#3B4A6B]" />
              </div>
              <h3 className="font-semibold text-[#222b45] mb-2">Detailed Reports</h3>
              <p className="text-sm text-[#6b7280]">Download comprehensive PDF reports with all findings and recommendations</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

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
            onClick={handleNewSearch}
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
                <button type="button" className="flex items-center gap-2 bg-[#2a2d42] hover:bg-[#23253a] text-white px-6 py-2 rounded-md font-semibold shadow transition-all mt-2 md:mt-0">
                  Download PDF <Download size={18} />
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