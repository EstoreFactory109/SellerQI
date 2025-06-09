import React, { useEffect, useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { AnalyseProduct } from '../operations/AnalyseProduct';
import Navbar from '../Components/Navigation/Navbar';
import Footer from '../Components/Navigation/Footer';
import { motion } from 'framer-motion';

function LoadingPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const asin = searchParams.get('asin') || '';
  const market = searchParams.get('market') || 'US';
  const [isDataFetched, setIsDataFetched] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [currentBar, setCurrentBar] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);

  // Handle the sequential bar animation
  useEffect(() => {
    if (!isAnimating && currentBar < 4) {
      // Only proceed if not currently animating
      const shouldStop = isDataFetched && currentBar >= 3;
      if (!shouldStop) {
        // Will be triggered by onAnimationComplete
      }
    }
  }, [currentBar, isDataFetched, isAnimating]);

  const handleAnimationComplete = (index) => {
    if (index === currentBar && !isAnimating) {
      setIsAnimating(true);
      
      // Small delay to ensure visual completion
      setTimeout(() => {
        setCurrentBar((prev) => {
          if (isDataFetched && prev >= 3) {
            setIsAnimating(false);
            return 3; // Stop at the last bar
          }
          setIsAnimating(false);
          return (prev + 1) % 4;
        });
      }, 50);
    }
  };

  useEffect(() => {
    const analyzeAndNavigate = async () => {
      try {
        // Call AnalyseProduct with asin and market
        const result = await AnalyseProduct(asin, market);
        
        if (result) {
          // Set data as fetched and store result
          setIsDataFetched(true);
          setAnalysisResult({
            analysisResult: result,
            asin: asin,
            market: market
          });
        } else {
          // Handle error case
          setIsDataFetched(true);
          setAnalysisResult({
            error: 'Failed to analyze product',
            asin: asin,
            market: market
          });
        }
      } catch (error) {
        console.error('Error analyzing product:', error);
        // Set error state
        setIsDataFetched(true);
        setAnalysisResult({
          error: 'An error occurred while analyzing the product',
          asin: asin,
          market: market
        });
      }
    };

    // Start the analysis when component mounts
    if (asin) {
      analyzeAndNavigate();
    }
  }, [asin, market]);

  // Navigate after animation completes
  useEffect(() => {
    if (isDataFetched && analysisResult && currentBar === 3) {
      // Wait a bit after the last bar completes
      const navigationDelay = setTimeout(() => {
        navigate('/results', { state: analysisResult });
      }, 500);

      return () => clearTimeout(navigationDelay);
    }
  }, [isDataFetched, analysisResult, currentBar, navigate]);

  const getBarWidth = (index) => {
    // Only fill if it's a completed bar or currently filling
    if (index < currentBar) {
      return '100%'; // Already filled bars stay filled
    } else if (index === currentBar) {
      return '100%'; // Currently filling bar animates to 100%
    } else {
      return '0%'; // Future bars stay at 0%
    }
  };

  const getTransitionDuration = (index) => {
    // Only animate the current bar
    if (index === currentBar) {
      return isDataFetched ? 0.3 : 2; // Fast when data fetched, slow otherwise
    }
    return 0; // No transition for other bars
  };

  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* Header */}
      <Navbar />
      
      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center py-16 px-4">
        <div className="flex flex-col md:flex-row gap-12 w-full max-w-5xl items-center justify-center">
          <div className="w-80 h-80 bg-gray-100 rounded-lg" />
          <div className="flex-1 max-w-lg">
            <h2 className="text-3xl font-bold mb-2">Analyzing your product...</h2>
            <div className="text-gray-500 mb-6">{asin}({market})</div>
            <div className="mb-8">
              <div className="text-gray-700 mb-2">Adding job to queue</div>
              <div className="flex items-center gap-2">
                {[0, 1, 2, 3].map((index) => (
                  <div key={index} className="h-2 w-24 bg-gray-200 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-[#333651] rounded-full"
                      initial={{ width: '0%' }}
                      animate={{ 
                        width: getBarWidth(index)
                      }}
                      transition={{
                        duration: getTransitionDuration(index),
                        delay: 0,
                        ease: "easeInOut"
                      }}
                      onAnimationComplete={() => handleAnimationComplete(index)}
                    />
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg p-6 flex flex-col gap-2">
              <div className="font-semibold">Want deeper insights ?</div>
              <div className="text-gray-600 text-sm mb-2">Unlock product-specific issues with full solutions in Seller QI Pro</div>
              <button className="bg-[#3B4A6B] text-white px-6 py-2 rounded hover:bg-[#2d3a52] w-max">Get Seller QI Now</button>
            </div>
          </div>
        </div>
      </main>
      
      {/* Footer */}
      <Footer />
    </div>
  );
}

export default LoadingPage; 