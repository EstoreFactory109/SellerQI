import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  CheckCircle, 
  XCircle, 
  ChevronDown, 
  ChevronUp,
  AlertCircle,
  BarChart3,
  FileText,
  Tag
} from 'lucide-react';

export default function AnalysisReport({ analysisResults }) {
  const [expandedSections, setExpandedSections] = useState({});

  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  // Helper function to check if a section has errors
  const hasSectionErrors = (sectionData) => {
    if (!sectionData) return false;
    const checks = ['charLim', 'RestictedWords', 'checkSpecialCharacters', 'dublicateWords'];
    return checks.some(check => sectionData[check]?.status === 'Error');
  };

  // Check which sections have errors
  const titleHasErrors = hasSectionErrors(analysisResults?.ranking?.TitleResult);
  const bulletsHasErrors = hasSectionErrors(analysisResults?.ranking?.BulletPoints);
  const descriptionHasErrors = hasSectionErrors(analysisResults?.ranking?.Description);
  const backendKeywordsHasErrors = hasSectionErrors(analysisResults?.backendKeywords);

  if (!analysisResults) return null;

  return (
    <motion.div
      id="analysis-results"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-10 bg-white rounded-3xl border border-gray-200/80 shadow-2xl shadow-gray-900/5 p-8 lg:p-10"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8 pb-6 border-b border-gray-200">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
              analysisResults.totalErrors === 0 
                ? 'bg-gradient-to-br from-green-100 to-emerald-100' 
                : 'bg-gradient-to-br from-red-100 to-pink-100'
            }`}>
              {analysisResults.totalErrors === 0 ? (
                <CheckCircle className="w-6 h-6 text-green-600" />
              ) : (
                <AlertCircle className="w-6 h-6 text-red-600" />
              )}
            </div>
            <h2 className="text-3xl font-bold bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent">
              Analysis Report
            </h2>
          </div>
          <p className="text-gray-600 ml-16">
            {analysisResults.totalErrors === 0 
              ? '🎉 Excellent! Your product listing is fully optimized with no errors.' 
              : `⚠️ Found ${analysisResults.totalErrors} error(s) that need your attention.`}
          </p>
        </div>
        <div className={`px-5 py-2.5 rounded-xl font-bold text-sm shadow-md ${
          analysisResults.totalErrors === 0 
            ? 'bg-gradient-to-r from-green-500 to-emerald-500 text-white' 
            : 'bg-gradient-to-r from-red-500 to-pink-500 text-white'
        }`}>
          {analysisResults.totalErrors === 0 ? '✓ All Good' : `✗ ${analysisResults.totalErrors} Error(s)`}
        </div>
      </div>

      {/* Title Results */}
      {analysisResults.ranking?.TitleResult && (
        <div className={`mb-5 ${titleHasErrors ? 'border-2 border-red-300 rounded-2xl p-1.5 bg-gradient-to-br from-red-50/50 to-pink-50/30' : 'border border-gray-200 rounded-2xl p-1.5 bg-gray-50/30'}`}>
          <button
            onClick={() => toggleSection('title')}
            className={`w-full flex items-center justify-between p-5 rounded-xl transition-all duration-300 ${
              titleHasErrors 
                ? 'bg-gradient-to-r from-red-50 to-pink-50 border-2 border-red-300 hover:from-red-100 hover:to-pink-100 shadow-sm' 
                : 'bg-white border border-gray-200 hover:bg-gray-50 hover:shadow-sm'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                titleHasErrors ? 'bg-red-100' : 'bg-blue-100'
              }`}>
                <FileText className={`w-5 h-5 ${titleHasErrors ? 'text-red-600' : 'text-blue-600'}`} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900">Product Title</h3>
                {titleHasErrors && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-red-500 text-white text-xs font-bold rounded-full mt-1">
                    <XCircle className="w-3 h-3" />
                    Has Errors
                  </span>
                )}
              </div>
            </div>
            {expandedSections.title ? (
              <ChevronUp className={`w-5 h-5 transition-transform ${titleHasErrors ? 'text-red-600' : 'text-gray-600'}`} />
            ) : (
              <ChevronDown className={`w-5 h-5 transition-transform ${titleHasErrors ? 'text-red-600' : 'text-gray-600'}`} />
            )}
          </button>
          {expandedSections.title && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-4 space-y-3 pl-2"
            >
              {['charLim', 'RestictedWords', 'checkSpecialCharacters'].map((check) => {
                const checkResult = analysisResults.ranking.TitleResult[check];
                if (!checkResult) return null;
                const isError = checkResult.status === 'Error';
                return (
                  <motion.div
                    key={check}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={`p-5 rounded-xl border-2 shadow-sm ${
                      isError 
                        ? 'bg-gradient-to-br from-red-50 to-pink-50 border-red-300' 
                        : 'bg-gradient-to-br from-green-50 to-emerald-50 border-green-300'
                    }`}
                  >
                    <div className="flex items-start gap-4">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        isError ? 'bg-red-100' : 'bg-green-100'
                      }`}>
                        {isError ? (
                          <XCircle className="w-5 h-5 text-red-600" />
                        ) : (
                          <CheckCircle className="w-5 h-5 text-green-600" />
                        )}
                      </div>
                      <div className="flex-1">
                        <h4 className="font-bold mb-2 text-gray-900">
                          {check === 'charLim' && 'Character Limit'}
                          {check === 'RestictedWords' && 'Restricted Words'}
                          {check === 'checkSpecialCharacters' && 'Special Characters'}
                        </h4>
                        <p className="text-sm mb-3 text-gray-700 leading-relaxed">{checkResult.Message}</p>
                        {checkResult.HowTOSolve && (
                          <div className="mt-3 pt-3 border-t border-current/30 bg-white/50 rounded-lg p-3">
                            <p className="text-sm font-semibold mb-1.5 text-gray-900">💡 How to Fix:</p>
                            <p className="text-sm text-gray-700 leading-relaxed">{checkResult.HowTOSolve}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          )}
        </div>
      )}

      {/* Bullet Points Results */}
      {analysisResults.ranking?.BulletPoints && (
        <div className={`mb-5 ${bulletsHasErrors ? 'border-2 border-red-300 rounded-2xl p-1.5 bg-gradient-to-br from-red-50/50 to-pink-50/30' : 'border border-gray-200 rounded-2xl p-1.5 bg-gray-50/30'}`}>
          <button
            onClick={() => toggleSection('bullets')}
            className={`w-full flex items-center justify-between p-5 rounded-xl transition-all duration-300 ${
              bulletsHasErrors 
                ? 'bg-gradient-to-r from-red-50 to-pink-50 border-2 border-red-300 hover:from-red-100 hover:to-pink-100 shadow-sm' 
                : 'bg-white border border-gray-200 hover:bg-gray-50 hover:shadow-sm'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                bulletsHasErrors ? 'bg-red-100' : 'bg-emerald-100'
              }`}>
                <FileText className={`w-5 h-5 ${bulletsHasErrors ? 'text-red-600' : 'text-emerald-600'}`} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900">Bullet Points</h3>
                {bulletsHasErrors && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-red-500 text-white text-xs font-bold rounded-full mt-1">
                    <XCircle className="w-3 h-3" />
                    Has Errors
                  </span>
                )}
              </div>
            </div>
            {expandedSections.bullets ? (
              <ChevronUp className={`w-5 h-5 transition-transform ${bulletsHasErrors ? 'text-red-600' : 'text-gray-600'}`} />
            ) : (
              <ChevronDown className={`w-5 h-5 transition-transform ${bulletsHasErrors ? 'text-red-600' : 'text-gray-600'}`} />
            )}
          </button>
          {expandedSections.bullets && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-4 space-y-3 pl-2"
            >
              {['charLim', 'RestictedWords', 'checkSpecialCharacters'].map((check) => {
                const checkResult = analysisResults.ranking.BulletPoints[check];
                if (!checkResult) return null;
                const isError = checkResult.status === 'Error';
                return (
                  <motion.div
                    key={check}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={`p-5 rounded-xl border-2 shadow-sm ${
                      isError 
                        ? 'bg-gradient-to-br from-red-50 to-pink-50 border-red-300' 
                        : 'bg-gradient-to-br from-green-50 to-emerald-50 border-green-300'
                    }`}
                  >
                    <div className="flex items-start gap-4">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        isError ? 'bg-red-100' : 'bg-green-100'
                      }`}>
                        {isError ? (
                          <XCircle className="w-5 h-5 text-red-600" />
                        ) : (
                          <CheckCircle className="w-5 h-5 text-green-600" />
                        )}
                      </div>
                      <div className="flex-1">
                        <h4 className="font-bold mb-2 text-gray-900">
                          {check === 'charLim' && 'Character Limit'}
                          {check === 'RestictedWords' && 'Restricted Words'}
                          {check === 'checkSpecialCharacters' && 'Special Characters'}
                        </h4>
                        <p className="text-sm mb-3 text-gray-700 leading-relaxed">{checkResult.Message}</p>
                        {checkResult.HowTOSolve && (
                          <div className="mt-3 pt-3 border-t border-current/30 bg-white/50 rounded-lg p-3">
                            <p className="text-sm font-semibold mb-1.5 text-gray-900">💡 How to Fix:</p>
                            <p className="text-sm text-gray-700 leading-relaxed">{checkResult.HowTOSolve}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          )}
        </div>
      )}

      {/* Description Results */}
      {analysisResults.ranking?.Description && (
        <div className={`mb-5 ${descriptionHasErrors ? 'border-2 border-red-300 rounded-2xl p-1.5 bg-gradient-to-br from-red-50/50 to-pink-50/30' : 'border border-gray-200 rounded-2xl p-1.5 bg-gray-50/30'}`}>
          <button
            onClick={() => toggleSection('description')}
            className={`w-full flex items-center justify-between p-5 rounded-xl transition-all duration-300 ${
              descriptionHasErrors 
                ? 'bg-gradient-to-r from-red-50 to-pink-50 border-2 border-red-300 hover:from-red-100 hover:to-pink-100 shadow-sm' 
                : 'bg-white border border-gray-200 hover:bg-gray-50 hover:shadow-sm'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                descriptionHasErrors ? 'bg-red-100' : 'bg-amber-100'
              }`}>
                <FileText className={`w-5 h-5 ${descriptionHasErrors ? 'text-red-600' : 'text-amber-600'}`} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900">Product Description</h3>
                {descriptionHasErrors && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-red-500 text-white text-xs font-bold rounded-full mt-1">
                    <XCircle className="w-3 h-3" />
                    Has Errors
                  </span>
                )}
              </div>
            </div>
            {expandedSections.description ? (
              <ChevronUp className={`w-5 h-5 transition-transform ${descriptionHasErrors ? 'text-red-600' : 'text-gray-600'}`} />
            ) : (
              <ChevronDown className={`w-5 h-5 transition-transform ${descriptionHasErrors ? 'text-red-600' : 'text-gray-600'}`} />
            )}
          </button>
          {expandedSections.description && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-4 space-y-3 pl-2"
            >
              {['charLim', 'RestictedWords', 'checkSpecialCharacters'].map((check) => {
                const checkResult = analysisResults.ranking.Description[check];
                if (!checkResult) return null;
                const isError = checkResult.status === 'Error';
                return (
                  <motion.div
                    key={check}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={`p-5 rounded-xl border-2 shadow-sm ${
                      isError 
                        ? 'bg-gradient-to-br from-red-50 to-pink-50 border-red-300' 
                        : 'bg-gradient-to-br from-green-50 to-emerald-50 border-green-300'
                    }`}
                  >
                    <div className="flex items-start gap-4">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        isError ? 'bg-red-100' : 'bg-green-100'
                      }`}>
                        {isError ? (
                          <XCircle className="w-5 h-5 text-red-600" />
                        ) : (
                          <CheckCircle className="w-5 h-5 text-green-600" />
                        )}
                      </div>
                      <div className="flex-1">
                        <h4 className="font-bold mb-2 text-gray-900">
                          {check === 'charLim' && 'Character Limit'}
                          {check === 'RestictedWords' && 'Restricted Words'}
                          {check === 'checkSpecialCharacters' && 'Special Characters'}
                          {checkResult.PointNumber && (
                            <span className="text-gray-500 font-normal"> (Paragraph {checkResult.PointNumber})</span>
                          )}
                        </h4>
                        <p className="text-sm mb-3 text-gray-700 leading-relaxed">{checkResult.Message}</p>
                        {checkResult.HowTOSolve && (
                          <div className="mt-3 pt-3 border-t border-current/30 bg-white/50 rounded-lg p-3">
                            <p className="text-sm font-semibold mb-1.5 text-gray-900">💡 How to Fix:</p>
                            <p className="text-sm text-gray-700 leading-relaxed">{checkResult.HowTOSolve}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          )}
        </div>
      )}

      {/* Backend Keywords Results */}
      {analysisResults.backendKeywords && (
        <div className={backendKeywordsHasErrors ? 'border-2 border-red-300 rounded-2xl p-1.5 bg-gradient-to-br from-red-50/50 to-pink-50/30' : 'border border-gray-200 rounded-2xl p-1.5 bg-gray-50/30'}>
          <button
            onClick={() => toggleSection('backendKeywords')}
            className={`w-full flex items-center justify-between p-5 rounded-xl transition-all duration-300 ${
              backendKeywordsHasErrors 
                ? 'bg-gradient-to-r from-red-50 to-pink-50 border-2 border-red-300 hover:from-red-100 hover:to-pink-100 shadow-sm' 
                : 'bg-white border border-gray-200 hover:bg-gray-50 hover:shadow-sm'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                backendKeywordsHasErrors ? 'bg-red-100' : 'bg-purple-100'
              }`}>
                <Tag className={`w-5 h-5 ${backendKeywordsHasErrors ? 'text-red-600' : 'text-purple-600'}`} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900">Backend Keywords</h3>
                {backendKeywordsHasErrors && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-red-500 text-white text-xs font-bold rounded-full mt-1">
                    <XCircle className="w-3 h-3" />
                    Has Errors
                  </span>
                )}
              </div>
            </div>
            {expandedSections.backendKeywords ? (
              <ChevronUp className={`w-5 h-5 transition-transform ${backendKeywordsHasErrors ? 'text-red-600' : 'text-gray-600'}`} />
            ) : (
              <ChevronDown className={`w-5 h-5 transition-transform ${backendKeywordsHasErrors ? 'text-red-600' : 'text-gray-600'}`} />
            )}
          </button>
          {expandedSections.backendKeywords && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-4 space-y-3 pl-2"
            >
              {['charLim', 'dublicateWords'].map((check) => {
                const checkResult = analysisResults.backendKeywords[check];
                if (!checkResult) return null;
                const isError = checkResult.status === 'Error';
                return (
                  <motion.div
                    key={check}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={`p-5 rounded-xl border-2 shadow-sm ${
                      isError 
                        ? 'bg-gradient-to-br from-red-50 to-pink-50 border-red-300' 
                        : 'bg-gradient-to-br from-green-50 to-emerald-50 border-green-300'
                    }`}
                  >
                    <div className="flex items-start gap-4">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        isError ? 'bg-red-100' : 'bg-green-100'
                      }`}>
                        {isError ? (
                          <XCircle className="w-5 h-5 text-red-600" />
                        ) : (
                          <CheckCircle className="w-5 h-5 text-green-600" />
                        )}
                      </div>
                      <div className="flex-1">
                        <h4 className="font-bold mb-2 text-gray-900">
                          {check === 'charLim' && 'Character Limit'}
                          {check === 'dublicateWords' && 'Duplicate Words'}
                        </h4>
                        <p className="text-sm mb-3 text-gray-700 leading-relaxed">{checkResult.Message}</p>
                        {checkResult.HowTOSolve && (
                          <div className="mt-3 pt-3 border-t border-current/30 bg-white/50 rounded-lg p-3">
                            <p className="text-sm font-semibold mb-1.5 text-gray-900">💡 How to Fix:</p>
                            <p className="text-sm text-gray-700 leading-relaxed">{checkResult.HowTOSolve}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          )}
        </div>
      )}
    </motion.div>
  );
}
