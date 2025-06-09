import React from 'react';
import { Link, useSearchParams, useLocation } from 'react-router-dom';
import Navbar from '../Components/Navigation/Navbar';
import Footer from '../Components/Navigation/Footer';

function ResultsPage() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  
  // Get data from navigation state or fall back to URL params
  const navigationState = location.state || {};
  const asin = navigationState.asin || searchParams.get('asin') || '';
  const market = navigationState.market || searchParams.get('market') || 'US';
  const analysisResult = navigationState.analysisResult || null;
  const error = navigationState.error || null;

  // Extract data from analysis result
  const score = analysisResult?.score || 0;
  const rankingResult = analysisResult?.rankingResult || {};
  const imageResult = analysisResult?.imageResult || {};
  const videoResult = analysisResult?.videoResult || {};
  const reviewResult = analysisResult?.reviewResult || {};
  const starRatingResult = analysisResult?.starRatingResult || {};

  // Calculate health score (inverse of error score)
  const healthScore = analysisResult ? Math.round(score) : 0;

  console.log(analysisResult)

  // Count total errors
  const totalErrors = analysisResult ? (
    (rankingResult.TotalErrors || 0) +
    (imageResult.status === "Error" ? 1 : 0) +
    (videoResult.status === "Error" ? 1 : 0) +
    (reviewResult.status === "Error" ? 1 : 0) +
    (starRatingResult.status === "Error" ? 1 : 0)
  ) : 0;

  console.log(analysisResult?.rankingResult?.TitleResult?.RestictedWords?.Message)
  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <Navbar />
      
      <main className="container mx-auto px-4 py-12 flex-1">
        {error ? (
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 mb-8">
            <h2 className="text-red-800 font-semibold mb-2">Error Analyzing Product</h2>
            <p className="text-red-600">{error}</p>
            <p className="text-sm text-red-500 mt-2">ASIN: {asin}, Market: {market}</p>
          </div>
        ) : (
          <>
            <div className="flex flex-col md:flex-row gap-16 md:gap-24 mb-12">
              {/* Product Image */}
              <div className="w-full md:w-1/3 flex justify-center items-start">
                <img src={analysisResult?.image} loading='lazy' alt="Product" className="rounded-lg w-80 h-80 object-cover" />
              </div>
              {/* Product Info */}
              <div className="flex-1 pt-4 md:pt-0">
                <h1 className="text-3xl font-bold mb-4">
                  {analysisResult?.Title || 'Product Analysis Results'}
                </h1>
                <div className="text-gray-600 mb-6 space-y-1">
                  <div>ASIN : <span className="font-medium">{asin || 'B07NKVNWRY'}</span></div>
                  <div>Market : <span className="font-medium">{market}</span></div>
                  <div>Category : {analysisResult?.category || 'N/A'}</div>
                  <div>Brand : {analysisResult?.Brand || 'N/A'}</div>
                  <div>List Price : ${analysisResult?.price || 'N/A'}</div>
                  <div>Star Ratings : {analysisResult?.starRatting || 'N/A'}/5</div>
                  <div>Reviews Count : {analysisResult?.ReviewsCount || 'N/A'}</div>
                </div>
              </div>
            </div>
            {/* At a Glance */}
            <div className="mb-12 grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="bg-white border rounded-lg p-6">
                <div className="font-semibold mb-4">{analysisResult?.rankingErrors+analysisResult?.conversionErrors} Issues found with this product</div>
                <div className="flex items-center gap-4">
                  <svg width="100" height="100" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="40" fill="#f3f4f6" />
                    <circle cx="50" cy="50" r="40" fill="none" stroke="#f87171" strokeWidth="10" strokeDasharray="75 251" />
                    <circle cx="50" cy="50" r="40" fill="none" stroke="#fbbf24" strokeWidth="10" strokeDasharray="50 251" strokeDashoffset="-75" />
                    <circle cx="50" cy="50" r="40" fill="none" stroke="#10b981" strokeWidth="10" strokeDasharray="126 251" strokeDashoffset="-125" />
                    <text x="50" y="55" textAnchor="middle" fill="#111827" fontSize="22" fontWeight="bold">{analysisResult?.rankingErrors+analysisResult?.conversionErrors}</text>
                    <text x="50" y="70" textAnchor="middle" fill="#6b7280" fontSize="8">ERRORS</text>
                  </svg>
                  <div className="text-sm space-y-1">
                    <div><span className="inline-block w-3 h-3 rounded-full bg-yellow-400 mr-2"></span>Rankings ({analysisResult?.rankingErrors || 0})</div>
                    <div><span className="inline-block w-3 h-3 rounded-full bg-green-500 mr-2"></span>Conversion ({
                      analysisResult?.conversionErrors || 0
                    })</div>
                    <div><span className="inline-block w-3 h-3 rounded-full bg-blue-400 mr-2"></span>Fulfillment</div>
                    <div><span className="inline-block w-3 h-3 rounded-full bg-pink-400 mr-2"></span>Advertising</div>
                    <div><span className="inline-block w-3 h-3 rounded-full bg-gray-400 mr-2"></span>Account Health</div>
                    <div><span className="inline-block w-3 h-3 rounded-full bg-purple-400 mr-2"></span>Inventory</div>
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-4">
                <div className="bg-white border rounded-lg p-6">
                  <div className="text-lg font-bold text-gray-900 mb-3">Health Score</div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div 
                        className={`h-2 rounded-full ${healthScore >= 70 ? 'bg-green-500' : healthScore >= 40 ? 'bg-yellow-500' : 'bg-red-500'}`} 
                        style={{ width: `${healthScore}%` }}
                      ></div>
                    </div>
                    <span className="text-xs font-bold bg-gray-100 px-2 py-1 rounded">{healthScore}/100</span>
                  </div>
                </div>
                <div className="bg-white border rounded-lg p-6">
                  <div className="flex items-center justify-between">
                    <div className="text-lg font-bold text-gray-900">Unit Sold</div>
                    <div className="text-base text-gray-600">{parseInt(analysisResult?.unitsSold.split(" ")[0],10) || 'N/A'}</div>
                  </div>
                </div>
                <div className="bg-white border rounded-lg p-6">
                  <div className="flex items-center justify-between">
                    <div className="text-lg font-bold text-gray-900">Sales</div>
                    <div className="text-base text-gray-600">{analysisResult?.orderAmount || "N/A"}</div>
                  </div>
                </div>
              </div>
            </div>
            {/* Issue Tables */}
            <div className="mb-16 space-y-8">
              {/* Ranking Issues */}
              {rankingResult.TotalErrors > 0 && (
                <div>
                  <div className="bg-[#23253A] text-white px-6 py-2 rounded-t-lg font-semibold">RANKING ISSUES</div>
                  <div className="bg-white border-x border-b rounded-b-lg p-4 space-y-2">
                    
                      {analysisResult?.rankingResult?.TitleResult?.nullCheck?.status==="Error" && (
                        <div className="flex justify-between items-center">
                          <span className='w-[80%] text-sm'>{analysisResult?.rankingResult?.TitleResult?.nullCheck?.Message}</span>
                          <button className="text-xs bg-gray-100 px-3 py-1 rounded" disabled>Pro Access Required 🔒</button>
                        </div>
                      )}

                      {analysisResult?.rankingResult?.TitleResult?.RestictedWords?.status==="Error" && (
                        <div className="flex justify-between items-center">
                          <span className='w-[80%] text-sm'>{analysisResult?.rankingResult?.TitleResult?.RestictedWords?.Message}</span>
                          <button className="text-xs bg-gray-100 px-3 py-1 rounded" disabled>Pro Access Required 🔒</button>
                        </div>
                      )}

                      {analysisResult?.rankingResult?.TitleResult?.charLim?.status==="Error" && (
                        <div className="flex justify-between items-center">
                          <span className='w-[80%] text-sm'>{analysisResult?.rankingResult?.TitleResult?.charLim?.Message}</span>
                          <button className="text-xs bg-gray-100 px-3 py-1 rounded" disabled>Pro Access Required 🔒</button>
                        </div>
                      )}

                      {analysisResult?.rankingResult?.TitleResult?.checkSpecialCharacters?.status==="Error" && (
                        <div className="flex justify-between items-center">
                          <span className='w-[80%] text-sm'>{analysisResult?.rankingResult?.TitleResult?.checkSpecialCharacters?.Message}</span>
                          <button className="text-xs bg-gray-100 px-3 py-1 rounded" disabled>Pro Access Required 🔒</button>
                        </div>
                      )}

                      {analysisResult?.rankingResult?.BulletPoints?.nullCheck?.status==="Error" && (
                        <div className="flex justify-between items-center">
                          <span className='w-[80%] text-sm'>{analysisResult?.rankingResult?.BulletPoints?.nullCheck?.Message}</span>
                          <button className="text-xs bg-gray-100 px-3 py-1 rounded" disabled>Pro Access Required 🔒</button>
                        </div>
                      )}

                      {analysisResult?.rankingResult?.BulletPoints?.emptyArray?.status==="Error" && (
                        <div className="flex justify-between items-center">
                          <span className='w-[80%] text-sm'>{analysisResult?.rankingResult?.BulletPoints?.emptyArray?.Message}</span>
                          <button className="text-xs bg-gray-100 px-3 py-1 rounded" disabled>Pro Access Required 🔒</button>
                        </div>
                      )}

                      {analysisResult?.rankingResult?.BulletPoints?.nullItems?.status==="Error" && (
                        <div className="flex justify-between items-center">
                          <span className='w-[80%] text-sm'>{analysisResult?.rankingResult?.BulletPoints?.nullItems?.Message}</span>
                          <button className="text-xs bg-gray-100 px-3 py-1 rounded" disabled>Pro Access Required 🔒</button>
                        </div>
                      )}

                      {analysisResult?.rankingResult?.BulletPoints?.RestictedWords?.status==="Error" && (
                        <div className="flex justify-between items-center">
                          <span className='w-[80%] text-sm'>{analysisResult?.rankingResult?.BulletPoints?.RestictedWords?.Message}</span>
                          <button className="text-xs bg-gray-100 px-3 py-1 rounded" disabled>Pro Access Required 🔒</button>
                        </div>
                      )}

                      {analysisResult?.rankingResult?.BulletPoints?.charLim?.status==="Error" && (
                        <div className="flex justify-between items-center">
                          <span className='w-[80%] text-sm'>{analysisResult?.rankingResult?.BulletPoints?.charLim?.Message}</span>
                          <button className="text-xs bg-gray-100 px-3 py-1 rounded" disabled>Pro Access Required 🔒</button>
                        </div>
                      )}

                      {analysisResult?.rankingResult?.BulletPoints?.checkSpecialCharacters?.status==="Error" && (
                        <div className="flex justify-between items-center">
                          <span className='w-[80%] text-sm'>{analysisResult?.rankingResult?.BulletPoints?.checkSpecialCharacters?.Message}</span>
                          <button className="text-xs bg-gray-100 px-3 py-1 rounded" disabled>Pro Access Required 🔒</button>
                        </div>
                      )}

                      {analysisResult?.rankingResult?.Description?.nullCheck?.status==="Error" && (
                        <div className="flex justify-between items-center">
                          <span className='w-[80%] text-sm'>{analysisResult?.rankingResult?.Description?.nullCheck?.Message}</span>
                          <button className="text-xs bg-gray-100 px-3 py-1 rounded" disabled>Pro Access Required 🔒</button>
                        </div>
                      )}

                      {analysisResult?.rankingResult?.Description?.emptyArray?.status==="Error" && (
                        <div className="flex justify-between items-center">
                          <span className='w-[80%] text-sm'>{analysisResult?.rankingResult?.Description?.emptyArray?.Message}</span>
                          <button className="text-xs bg-gray-100 px-3 py-1 rounded" disabled>Pro Access Required 🔒</button>
                        </div>
                      )}

                      {analysisResult?.rankingResult?.Description?.RestictedWords?.status==="Error" && (
                        <div className="flex justify-between items-center">
                          <span className='w-[80%] text-sm'>{analysisResult?.rankingResult?.Description?.RestictedWords?.Message}</span>
                          <button className="text-xs bg-gray-100 px-3 py-1 rounded" disabled>Pro Access Required 🔒</button>
                        </div>
                      )}

                      {analysisResult?.rankingResult?.Description?.charLim?.status==="Error" && (
                        <div className="flex justify-between items-center">
                          <span className='w-[80%] text-sm'>{analysisResult?.rankingResult?.Description?.charLim?.Message}</span>
                          <button className="text-xs bg-gray-100 px-3 py-1 rounded" disabled>Pro Access Required 🔒</button>
                        </div>
                      )}

                      {analysisResult?.rankingResult?.Description?.checkSpecialCharacters?.status==="Error" && (
                        <div className="flex justify-between items-center">
                          <span className='w-[80%] text-sm'>{analysisResult?.rankingResult?.Description?.checkSpecialCharacters?.Message}</span>
                          <button className="text-xs bg-gray-100 px-3 py-1 rounded" disabled>Pro Access Required 🔒</button>
                        </div>
                      )}
                   
                  </div>
                </div>
              )}
              {/* Conversion Issues */}
              {((imageResult.status === "Error") || (videoResult.status === "Error") || 
                (reviewResult.status === "Error") || (starRatingResult.status === "Error")) && (
                <div>
                  <div className="bg-[#23253A] text-white px-6 py-2 rounded-t-lg font-semibold">CONVERSION ISSUES</div>
                  <div className="bg-white border-x border-b rounded-b-lg p-4 space-y-2">
                    {analysisResult?.imageResult?.status === "Error" && (
                      <div className="flex justify-between items-center">
                        <span className='w-[80%] text-sm'>{analysisResult?.imageResult?.Message || "Image issues detected"}</span>
                        <button className="text-xs bg-gray-100 px-3 py-1 rounded" disabled>Pro Access Required 🔒</button>
                      </div>
                    )}
                    {analysisResult?.videoResult?.status === "Error" && (
                      <div className="flex justify-between items-center">
                        <span className='w-[80%] text-sm'>{analysisResult?.videoResult?.Message || "Video not found"}</span>
                        <button className="text-xs bg-gray-100 px-3 py-1 rounded" disabled>Pro Access Required 🔒</button>
                      </div>
                    )}
                    {analysisResult?.reviewResult?.status === "Error" && (
                      <div className="flex justify-between items-center">
                        <span className='w-[80%] text-sm'>{analysisResult?.reviewResult?.Message || "Review count issues"}</span>
                        <button className="text-xs bg-gray-100 px-3 py-1 rounded" disabled>Pro Access Required 🔒</button>
                      </div>
                    )}
                    {analysisResult?.starRatingResult?.status === "Error" && (
                      <div className="flex justify-between items-center">
                        <span className='w-[80%] text-sm'>{analysisResult?.starRatingResult?.Message || "Star rating issues"}</span>
                        <button className="text-xs bg-gray-100 px-3 py-1 rounded" disabled>Pro Access Required 🔒</button>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {/* Fulfillment Issues */}
              {/* <div>
                <div className="bg-[#23253A] text-white px-6 py-2 rounded-t-lg font-semibold">FULFILLMENT ISSUES</div>
                <div className="bg-white border-x border-b rounded-b-lg p-4 space-y-2">
                  <div className="flex justify-between items-center">
                    <span>Titles is less than 70 characters</span>
                    <button className="text-xs bg-gray-100 px-3 py-1 rounded" disabled>Pro Access Required 🔒</button>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Bullet points</span>
                    <button className="text-xs bg-gray-100 px-3 py-1 rounded" disabled>Pro Access Required 🔒</button>
                  </div>
                </div>
              </div> */}
              {/* Advertising Issues */}
              {/* <div>
                <div className="bg-[#23253A] text-white px-6 py-2 rounded-t-lg font-semibold">ADVERTISING ISSUES</div>
                <div className="bg-white border-x border-b rounded-b-lg p-4 space-y-2">
                  <div className="flex justify-between items-center">
                    <span>Titles is less than 70 characters</span>
                    <button className="text-xs bg-gray-100 px-3 py-1 rounded" disabled>Pro Access Required 🔒</button>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Bullet points</span>
                    <button className="text-xs bg-gray-100 px-3 py-1 rounded" disabled>Pro Access Required 🔒</button>
                  </div>
                </div>
              </div> */}
              {/* Account Health Issues */}
              {/* <div>
                <div className="bg-[#23253A] text-white px-6 py-2 rounded-t-lg font-semibold">ACCOUNT HEALTH ISSUES</div>
                <div className="bg-white border-x border-b rounded-b-lg p-4 space-y-2">
                  <div className="flex justify-between items-center">
                    <span>Titles is less than 70 characters</span>
                    <button className="text-xs bg-gray-100 px-3 py-1 rounded" disabled>Pro Access Required 🔒</button>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Bullet points</span>
                    <button className="text-xs bg-gray-100 px-3 py-1 rounded" disabled>Pro Access Required 🔒</button>
                  </div>
                </div>
              </div> */}
              {/* Inventory Issues */}
              {/* <div>
                <div className="bg-[#23253A] text-white px-6 py-2 rounded-t-lg font-semibold">INVENTORY ISSUES</div>
                <div className="bg-white border-x border-b rounded-b-lg p-4 space-y-2">
                  <div className="flex justify-between items-center">
                    <span>Titles is less than 70 characters</span>
                    <button className="text-xs bg-gray-100 px-3 py-1 rounded" disabled>Pro Access Required 🔒</button>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Bullet points</span>
                    <button className="text-xs bg-gray-100 px-3 py-1 rounded" disabled>Pro Access Required 🔒</button>
                  </div>
                </div>
              </div> */}
            </div>
            {/* CTA Section */}
            <div className="mt-20 flex flex-col items-center">
              <div className="mb-6">
               <img src ="https://res.cloudinary.com/ddoa960le/image/upload/q_auto:good,f_auto,w_1200/v1749234188/Seller_QI_Logo_Final_1_1_tfybls.png" alt="Seller QI Logo" className='w-20 h-20' loading='eager' />
              </div>
              <h2 className="text-2xl font-bold mb-2 text-center">Want Actionable Fixes for Your Product Issues?</h2>
              <p className="text-gray-600 mb-4 text-center">You're viewing basic audit insights. Pro users get full breakdowns and personalized fixes.</p>
              <button className="bg-[#23253A] text-white px-6 py-2 rounded hover:bg-[#2d3a52]">Upgrade to Seller QI PRO →</button>
            </div>
          </>
        )}
      </main>
      
      {/* Footer */}
      <Footer />
    </div>
  );
}

export default ResultsPage; 