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
  const [currentBar, setCurrentBar] = useState(-1);
  const [isAnimating, setIsAnimating] = useState(false);
  const [animationStarted, setAnimationStarted] = useState(false);

  // Start the animation when component mounts
  useEffect(() => {
    if (!animationStarted) {
      console.log('Starting initial animation');
      setAnimationStarted(true);
      // Trigger the first bar animation by setting to 0
      setTimeout(() => {
        setCurrentBar(0);
      }, 100);
    }
  }, [animationStarted]);

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
    console.log('Animation complete for bar:', index, 'Current bar:', currentBar, 'Is animating:', isAnimating);
    if (index === currentBar && !isAnimating) {
      setIsAnimating(true);
      
      // Small delay to ensure visual completion
      setTimeout(() => {
        setCurrentBar((prev) => {
          console.log('Setting current bar from', prev, 'Data fetched:', isDataFetched);
          if (isDataFetched && prev >= 3) {
            setIsAnimating(false);
            console.log('Stopping at bar 3 because data is fetched');
            return 3; // Stop at the last bar
          }
          setIsAnimating(false);
          // Don't use modulo here - just increment up to 3
          const nextBar = Math.min(prev + 1, 3);
          console.log('Moving to next bar:', nextBar);
          return nextBar;
        });
      }, 50);
    }
  };

  useEffect(() => {
    const analyzeAndNavigate = async () => {
      console.log('Starting analysis for ASIN:', asin, 'Market:', market);
      try {
        // Call AnalyseProduct with asin and market
        const result = await AnalyseProduct(asin, market);
        console.log('Analysis result:', result);
        
        if (result) {
          // Set data as fetched and store result
          console.log('Setting data as fetched with result');
          setIsDataFetched(true);
          setAnalysisResult({
            analysisResult: result,
            asin: asin,
            market: market
          });
        } else {
          // Handle error case
          console.log('Analysis returned false/null');
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
    } else {
      console.log('No ASIN provided, skipping analysis');
    }
  }, [asin, market]);

  // Navigate after animation completes
  useEffect(() => {
    console.log('Navigation check:', {
      isDataFetched,
      analysisResult,
      currentBar,
      shouldNavigate: isDataFetched && analysisResult && currentBar === 3
    });
    
    if (isDataFetched && analysisResult && currentBar === 3) {
      console.log('Navigating to results page...');
      // Wait a bit after the last bar completes
      const navigationDelay = setTimeout(() => {
        console.log('Actually navigating now with state:', analysisResult);
        navigate('/results', { state: analysisResult });
      }, 500);

      return () => clearTimeout(navigationDelay);
    }
  }, [isDataFetched, analysisResult, currentBar, navigate]);

  // Fallback navigation - navigate after data is fetched regardless of animation
  useEffect(() => {
    if (isDataFetched && analysisResult) {
      console.log('Fallback navigation check - data is ready');
      // Give animation some time to complete, but navigate anyway after 5 seconds
      const fallbackTimer = setTimeout(() => {
        console.log('Fallback navigation triggered after 5 seconds');
        navigate('/results', { state: analysisResult });
      }, 5000);

      return () => clearTimeout(fallbackTimer);
    }
  }, [isDataFetched, analysisResult, navigate]);

  const getBarWidth = (index) => {
    // Handle initial state
    if (currentBar === -1) {
      return '0%';
    }
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
              
              {/* Debug button */}
              {isDataFetched && (
                <button 
                  onClick={() => {
                    console.log('Manual navigation triggered');
                    navigate('/results', { state: analysisResult });
                  }}
                  className="bg-red-500 text-white px-4 py-2 rounded mt-2"
                >
                  Debug: Go to Results
                </button>
              )}
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