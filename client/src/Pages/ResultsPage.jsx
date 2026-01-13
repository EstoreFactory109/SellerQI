import React from 'react';
import { Link, useSearchParams, useLocation, useNavigate } from 'react-router-dom';
import { Info, Download, Search, ChevronRight } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import Navbar from '../Components/Navigation/Navbar';
import Footer from '../Components/Navigation/Footer';

function ResultsPage() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  
  // Get data from navigation state or fall back to URL params
  const navigationState = location.state || {};
  const asin = navigationState.asin || searchParams.get('asin') || '';
  const market = navigationState.market || searchParams.get('market') || 'US';
  const analysisResult = navigationState.analysisResult || null;
  const error = navigationState.error || null;

  // Redirect to home if accessing directly without proper analysis data
  React.useEffect(() => {
    // If there's no navigation state (meaning direct URL access) and no analysis result, redirect to home
    if (!location.state && !analysisResult) {
      console.log('Direct URL access without analysis data, redirecting to home');
      navigate('/', { replace: true });
    }
  }, [location.state, analysisResult, navigate]);

  // Don't render anything if we're redirecting due to direct URL access
  if (!location.state && !analysisResult) {
    return null;
  }

  // Extract data from analysis result
  const score = analysisResult?.score || 0;
  const rankingResult = analysisResult?.rankingResult || {};
  const imageResult = analysisResult?.imageResult || {};
  const videoResult = analysisResult?.videoResult || {};
  const starRatingResult = analysisResult?.starRatingResult || {};

  // Calculate health score (inverse of error score)
  const healthScore = analysisResult ? Math.round(score) : 0;

  console.log(analysisResult)

  // Count total errors - using actual TotalErrors from ranking result
  const totalErrors = analysisResult ? (
    (rankingResult.TotalErrors || 0) +
    (imageResult.status === "Error" ? 1 : 0) +
    (videoResult.status === "Error" ? 1 : 0) +
    (starRatingResult.status === "Error" ? 1 : 0)
  ) : 0;

  console.log(analysisResult?.rankingResult?.TitleResult?.RestictedWords?.Message)
  
  // Safe parsing of units sold
  const parseUnitsSold = (unitsSold) => {
    if (!unitsSold || unitsSold === "N/A") return 0;
    const numberStr = unitsSold.split(" ")[0] || "0";
    return parseInt(numberStr.replace(/,/g, ''), 10) || 0;
  };
  
  // Safe formatting of order amount
  const formatOrderAmount = (orderAmount) => {
    if (!orderAmount || orderAmount === "N/A" || orderAmount === 0) return "N/A";
    return `$${orderAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // Helper functions from ASINAnalyzer
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
      }
    ];
  };

  // Get key metrics from analysis
  const getKeyMetrics = () => {
    if (!analysisResult) return [];

    return [
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
      { name: 'Rankings', value: rankingErrors, color: '#fad12a', showValue: true },
      { name: 'Conversion', value: conversionErrors, color: '#b92533', showValue: true },
      { name: 'Inventory', value: 0, color: '#ff6b35', showValue: false },
      { name: 'Account Health', value: 0, color: '#90acc7', showValue: false },
      { name: 'Profitability', value: 0, color: '#05724e', showValue: false },
      { name: 'Sponsored Ads', value: 0, color: '#333651', showValue: false },
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

  // Handle new search
  const handleNewSearch = () => {
    navigate('/');
  };

  // Get calculated data
  const keyMetrics = getKeyMetrics();
  const productAnalysis = getProductAnalysisData();
  const issueData = getIssuesData();
  const totalErrorsFromChart = issueData.reduce((sum, d) => sum + d.value, 0);
  const issueCategories = getIssueCategories();
  const rankingScore = calculateRankingScore(analysisResult?.rankingResult);
  const conversionScore = calculateConversionScore(analysisResult);
  
  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <Navbar />
      
      <main className="container mx-auto px-4 py-6 flex-1">
        {error ? (
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 mb-8">
            <h2 className="text-red-800 font-semibold mb-2">Error Analyzing Product</h2>
            <p className="text-red-600">{error}</p>
            <p className="text-sm text-red-500 mt-2">ASIN: {asin}, Market: {market}</p>
          </div>
        ) : (
          <div className="w-full">
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
            <div className="bg-white border border-[#e5e7eb] rounded-xl shadow-sm p-4 md:p-6 flex flex-col gap-4 mb-6">
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                {/* Product Image */}
                <div className="flex-shrink-0">
                  <img
                    src={analysisResult?.image || '/placeholder-image.png'}
                    alt="Product"
                    className="w-32 h-32 object-cover rounded-lg border border-[#e5e7eb] bg-white"
                    loading="lazy"
                  />
                </div>
                {/* Product Details & Health Score */}
                <div className="flex-1 flex flex-col gap-2 md:ml-6">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                    <div>
                      <div className="font-semibold text-lg text-[#222b45]">{analysisResult?.Title || 'Product Analysis Results'}</div>
                      <div className="text-xs text-[#6b7280] mt-1 flex flex-wrap gap-x-4 gap-y-1">
                        <span>ASIN : {asin}</span>
                        <span>Category : {analysisResult?.category || 'N/A'}</span>
                      </div>
                      <div className="text-xs text-[#6b7280] mt-1 flex flex-wrap gap-x-4 gap-y-1">
                        <span>Brand : {analysisResult?.Brand || 'N/A'}</span>
                        <span>List Price : ${analysisResult?.price ? analysisResult.price.toFixed(2) : 'N/A'}</span>
                      </div>
                      <div className="text-xs text-[#6b7280] mt-1 flex flex-wrap gap-x-4 gap-y-1">
                                            <span>Star Ratings : {analysisResult?.starRatting ?? 0}/5</span>
                    <span>Reviews Count : {analysisResult?.ReviewsCount ?? 0}</span>
                      </div>
                    </div>
                    {/* Upgrade Button instead of Download */}
                    <button 
                      type="button" 
                      className="flex items-center gap-2 bg-[#2a2d42] hover:bg-[#23253a] text-white px-6 py-2 rounded-md font-semibold shadow transition-all mt-2 md:mt-0 whitespace-nowrap"
                      onClick={() => window.open('/pricing', '_blank')}
                    >
                      Upgrade to Pro <ChevronRight size={18} />
                    </button>
                  </div>
                  {/* Health Score */}
                  <div className="mt-3 md:mt-4">
                    <div className="inline-block bg-[#f8fafc] border border-[#e5e7eb] rounded-lg px-4 py-2">
                      <div className="flex items-center gap-4">
                        <span className="text-xs text-[#6b7280]">Health Score</span>
                        <span className="text-[#222b45] font-bold text-sm bg-[#f8fafc] px-3 py-1 rounded">{healthScore}/100</span>
                      </div>
                      <div className="w-40 h-2 bg-[#e5e7eb] rounded mt-2">
                        <div className="h-2 bg-[#3ec28f] rounded" style={{ width: `${healthScore}%` }}></div>
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
                  <div className="text-sm text-[#222b45] mb-2">{totalErrorsFromChart} Issues found with the product</div>
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
                        <span className="text-2xl font-bold text-[#222b45]">{totalErrorsFromChart.toString().padStart(2, '0')}</span>
                        <span className="text-xs text-[#D7263D] font-semibold mt-1">ERRORS</span>
                      </div>
                    </div>
                    {/* Legend */}
                    <div className="flex flex-col flex-wrap gap-2 text-xs">
                      {issueData.map((item, idx) => (
                        <div key={item.name} className="flex items-center gap-2">
                          <span className="inline-block w-3 h-3 rounded-full" style={{ background: item.color }}></span>
                          <span className="text-[#222b45] w-20">{item.name}</span>
                          <span className={`text-[#222b45] font-semibold ${!item.showValue ? 'filter blur-sm' : ''}`}>
                            {item.showValue ? item.value.toString().padStart(2, '0') : '--'}
                          </span>
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
                      <div className="h-3 bg-[#fad12a] rounded" style={{ width: `${rankingScore.percentage}%` }}></div>
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
                      <div className="h-3 bg-[#b92533] rounded" style={{ width: `${conversionScore.percentage}%` }}></div>
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
                      TOTAL : {totalErrorsFromChart} Issues found
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
                            <div key={i} className="border-b last:border-b-0 border-[#e5e7eb] bg-white px-4 py-3 text-sm text-[#222b45] flex justify-between items-center">
                              <div>
                                <div className="font-medium text-[#222b45] mb-1">{issue.label}</div>
                                <div className="text-gray-600">{issue.message}</div>
                              </div>
                              <button className="text-xs bg-gray-100 px-3 py-1 rounded whitespace-nowrap min-w-max" disabled>Pro Access Required 🔒</button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* CTA Section */}
            <div className="mt-20 flex flex-col items-center">
              <div className="mb-6">
               <img src="https://res.cloudinary.com/ddoa960le/image/upload/q_auto:good,f_auto,w_1200/v1749234188/Seller_QI_Logo_Final_1_1_tfybls.png" alt="Seller QI Logo" className='w-20 h-20' loading='eager' />
              </div>
              <h2 className="text-2xl font-bold mb-2 text-center">Want Actionable Fixes for Your Product Issues?</h2>
              <p className="text-gray-600 mb-4 text-center">You're viewing basic audit insights. Pro users get full breakdowns and personalized fixes.</p>
              <button className="bg-[#23253A] text-white px-6 py-2 rounded hover:bg-[#2d3a52] whitespace-nowrap" onClick={() => window.open('/pricing', '_blank')}>Upgrade to Seller QI PRO →</button>
            </div>

            <div className='w-full h-[5rem]'></div>
          </div>
        )}
      </main>
      
      {/* Footer */}
      <Footer />
    </div>
  );
}

export default ResultsPage; 