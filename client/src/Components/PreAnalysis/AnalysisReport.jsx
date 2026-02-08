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
      style={{ marginTop: '10px', background: '#161b22', borderRadius: '6px', border: '1px solid #30363d', padding: '12px' }}
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3 pb-3 border-b" style={{ borderColor: '#30363d' }}>
        <div>
          <div className="flex items-center gap-2 mb-1">
            {analysisResults.totalErrors === 0 ? (
              <CheckCircle className="w-4 h-4" style={{ color: '#60a5fa' }} />
            ) : (
              <AlertCircle className="w-4 h-4" style={{ color: '#60a5fa' }} />
            )}
            <h2 className="text-sm font-bold uppercase tracking-wide" style={{ color: '#f3f4f6' }}>
              Analysis Report
            </h2>
          </div>
          <p className="text-[11px] ml-6" style={{ color: '#9ca3af' }}>
            {analysisResults.totalErrors === 0 
              ? '🎉 Excellent! Your product listing is fully optimized with no errors.' 
              : `⚠️ Found ${analysisResults.totalErrors} error(s) that need your attention.`}
          </p>
        </div>
        <div className="px-3 py-1 rounded-lg font-bold text-xs" style={{
          background: analysisResults.totalErrors === 0 
            ? 'rgba(96, 165, 250, 0.2)' 
            : 'rgba(96, 165, 250, 0.2)',
          color: analysisResults.totalErrors === 0 ? '#60a5fa' : '#60a5fa',
          border: `1px solid ${analysisResults.totalErrors === 0 ? 'rgba(96, 165, 250, 0.3)' : 'rgba(96, 165, 250, 0.3)'}`
        }}>
          {analysisResults.totalErrors === 0 ? '✓ All Good' : `✗ ${analysisResults.totalErrors} Error(s)`}
        </div>
      </div>

      {/* Title Results */}
      {analysisResults.ranking?.TitleResult && (
        <div className="mb-2 rounded-lg p-1" style={{ 
          border: `1px solid ${titleHasErrors ? 'rgba(96, 165, 250, 0.3)' : '#30363d'}`, 
          background: titleHasErrors ? 'rgba(96, 165, 250, 0.1)' : '#21262d'
        }}>
          <button
            onClick={() => toggleSection('title')}
            className="w-full flex items-center justify-between p-2 rounded-lg transition-all duration-300"
            style={{ 
              background: titleHasErrors ? 'rgba(96, 165, 250, 0.1)' : '#161b22',
              border: `1px solid ${titleHasErrors ? 'rgba(96, 165, 250, 0.3)' : '#30363d'}`
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = titleHasErrors ? 'rgba(96, 165, 250, 0.15)' : '#21262d'}
            onMouseLeave={(e) => e.currentTarget.style.background = titleHasErrors ? 'rgba(96, 165, 250, 0.1)' : '#161b22'}
          >
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4" style={{ color: titleHasErrors ? '#60a5fa' : '#60a5fa' }} />
              <div>
                <h3 className="text-xs font-bold" style={{ color: '#f3f4f6' }}>Product Title</h3>
                {titleHasErrors && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold mt-0.5" style={{ background: 'rgba(96, 165, 250, 0.2)', color: '#60a5fa' }}>
                    <XCircle className="w-2.5 h-2.5" />
                    Has Errors
                  </span>
                )}
              </div>
            </div>
            {expandedSections.title ? (
              <ChevronUp className="w-3.5 h-3.5 transition-transform" style={{ color: titleHasErrors ? '#60a5fa' : '#9ca3af' }} />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 transition-transform" style={{ color: titleHasErrors ? '#60a5fa' : '#9ca3af' }} />
            )}
          </button>
          {expandedSections.title && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-2 space-y-2 pl-1"
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
                    className="p-2 rounded-lg"
                    style={{ 
                      background: isError ? 'rgba(96, 165, 250, 0.1)' : 'rgba(96, 165, 250, 0.1)',
                      border: `1px solid ${isError ? 'rgba(96, 165, 250, 0.3)' : 'rgba(96, 165, 250, 0.3)'}`
                    }}
                  >
                    <div className="flex items-start gap-2">
                      {isError ? (
                        <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: '#60a5fa' }} />
                      ) : (
                        <CheckCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: '#60a5fa' }} />
                      )}
                      <div className="flex-1">
                        <h4 className="font-bold mb-1 text-xs" style={{ color: '#f3f4f6' }}>
                          {check === 'charLim' && 'Character Limit'}
                          {check === 'RestictedWords' && 'Restricted Words'}
                          {check === 'checkSpecialCharacters' && 'Special Characters'}
                        </h4>
                        <p className="text-[11px] mb-2 leading-relaxed" style={{ color: '#9ca3af' }}>{checkResult.Message}</p>
                        {checkResult.HowTOSolve && (
                          <div className="mt-2 pt-2 rounded-lg p-2" style={{ background: '#21262d', borderTop: '1px solid #30363d' }}>
                            <p className="text-[11px] font-semibold mb-1" style={{ color: '#f3f4f6' }}>💡 How to Fix:</p>
                            <p className="text-[11px] leading-relaxed" style={{ color: '#9ca3af' }}>{checkResult.HowTOSolve}</p>
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
        <div className="mb-2 rounded-lg p-1" style={{ 
          border: `1px solid ${bulletsHasErrors ? 'rgba(96, 165, 250, 0.3)' : '#30363d'}`, 
          background: bulletsHasErrors ? 'rgba(96, 165, 250, 0.1)' : '#21262d'
        }}>
          <button
            onClick={() => toggleSection('bullets')}
            className="w-full flex items-center justify-between p-2 rounded-lg transition-all duration-300"
            style={{ 
              background: bulletsHasErrors ? 'rgba(96, 165, 250, 0.1)' : '#161b22',
              border: `1px solid ${bulletsHasErrors ? 'rgba(96, 165, 250, 0.3)' : '#30363d'}`
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = bulletsHasErrors ? 'rgba(96, 165, 250, 0.15)' : '#21262d'}
            onMouseLeave={(e) => e.currentTarget.style.background = bulletsHasErrors ? 'rgba(96, 165, 250, 0.1)' : '#161b22'}
          >
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4" style={{ color: bulletsHasErrors ? '#60a5fa' : '#60a5fa' }} />
              <div>
                <h3 className="text-xs font-bold" style={{ color: '#f3f4f6' }}>Bullet Points</h3>
                {bulletsHasErrors && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold mt-0.5" style={{ background: 'rgba(96, 165, 250, 0.2)', color: '#60a5fa' }}>
                    <XCircle className="w-2.5 h-2.5" />
                    Has Errors
                  </span>
                )}
              </div>
            </div>
            {expandedSections.bullets ? (
              <ChevronUp className="w-3.5 h-3.5 transition-transform" style={{ color: bulletsHasErrors ? '#60a5fa' : '#9ca3af' }} />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 transition-transform" style={{ color: bulletsHasErrors ? '#60a5fa' : '#9ca3af' }} />
            )}
          </button>
          {expandedSections.bullets && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-2 space-y-2 pl-1"
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
                    className="p-2 rounded-lg"
                    style={{ 
                      background: isError ? 'rgba(96, 165, 250, 0.1)' : 'rgba(96, 165, 250, 0.1)',
                      border: `1px solid ${isError ? 'rgba(96, 165, 250, 0.3)' : 'rgba(96, 165, 250, 0.3)'}`
                    }}
                  >
                    <div className="flex items-start gap-2">
                      {isError ? (
                        <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: '#60a5fa' }} />
                      ) : (
                        <CheckCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: '#60a5fa' }} />
                      )}
                      <div className="flex-1">
                        <h4 className="font-bold mb-1 text-xs" style={{ color: '#f3f4f6' }}>
                          {check === 'charLim' && 'Character Limit'}
                          {check === 'RestictedWords' && 'Restricted Words'}
                          {check === 'checkSpecialCharacters' && 'Special Characters'}
                        </h4>
                        <p className="text-[11px] mb-2 leading-relaxed" style={{ color: '#9ca3af' }}>{checkResult.Message}</p>
                        {checkResult.HowTOSolve && (
                          <div className="mt-2 pt-2 rounded-lg p-2" style={{ background: '#21262d', borderTop: '1px solid #30363d' }}>
                            <p className="text-[11px] font-semibold mb-1" style={{ color: '#f3f4f6' }}>💡 How to Fix:</p>
                            <p className="text-[11px] leading-relaxed" style={{ color: '#9ca3af' }}>{checkResult.HowTOSolve}</p>
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
        <div className="mb-2 rounded-lg p-1" style={{ 
          border: `1px solid ${descriptionHasErrors ? 'rgba(96, 165, 250, 0.3)' : '#30363d'}`, 
          background: descriptionHasErrors ? 'rgba(96, 165, 250, 0.1)' : '#21262d'
        }}>
          <button
            onClick={() => toggleSection('description')}
            className="w-full flex items-center justify-between p-2 rounded-lg transition-all duration-300"
            style={{ 
              background: descriptionHasErrors ? 'rgba(96, 165, 250, 0.1)' : '#161b22',
              border: `1px solid ${descriptionHasErrors ? 'rgba(96, 165, 250, 0.3)' : '#30363d'}`
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = descriptionHasErrors ? 'rgba(96, 165, 250, 0.15)' : '#21262d'}
            onMouseLeave={(e) => e.currentTarget.style.background = descriptionHasErrors ? 'rgba(96, 165, 250, 0.1)' : '#161b22'}
          >
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4" style={{ color: descriptionHasErrors ? '#60a5fa' : '#60a5fa' }} />
              <div>
                <h3 className="text-xs font-bold" style={{ color: '#f3f4f6' }}>Product Description</h3>
                {descriptionHasErrors && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold mt-0.5" style={{ background: 'rgba(96, 165, 250, 0.2)', color: '#60a5fa' }}>
                    <XCircle className="w-2.5 h-2.5" />
                    Has Errors
                  </span>
                )}
              </div>
            </div>
            {expandedSections.description ? (
              <ChevronUp className="w-3.5 h-3.5 transition-transform" style={{ color: descriptionHasErrors ? '#60a5fa' : '#9ca3af' }} />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 transition-transform" style={{ color: descriptionHasErrors ? '#60a5fa' : '#9ca3af' }} />
            )}
          </button>
          {expandedSections.description && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-2 space-y-2 pl-1"
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
                    className="p-2 rounded-lg"
                    style={{ 
                      background: isError ? 'rgba(96, 165, 250, 0.1)' : 'rgba(96, 165, 250, 0.1)',
                      border: `1px solid ${isError ? 'rgba(96, 165, 250, 0.3)' : 'rgba(96, 165, 250, 0.3)'}`
                    }}
                  >
                    <div className="flex items-start gap-2">
                      {isError ? (
                        <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: '#60a5fa' }} />
                      ) : (
                        <CheckCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: '#60a5fa' }} />
                      )}
                      <div className="flex-1">
                        <h4 className="font-bold mb-1 text-xs" style={{ color: '#f3f4f6' }}>
                          {check === 'charLim' && 'Character Limit'}
                          {check === 'RestictedWords' && 'Restricted Words'}
                          {check === 'checkSpecialCharacters' && 'Special Characters'}
                          {checkResult.PointNumber && (
                            <span className="font-normal" style={{ color: '#9ca3af' }}> (Paragraph {checkResult.PointNumber})</span>
                          )}
                        </h4>
                        <p className="text-[11px] mb-2 leading-relaxed" style={{ color: '#9ca3af' }}>{checkResult.Message}</p>
                        {checkResult.HowTOSolve && (
                          <div className="mt-2 pt-2 rounded-lg p-2" style={{ background: '#21262d', borderTop: '1px solid #30363d' }}>
                            <p className="text-[11px] font-semibold mb-1" style={{ color: '#f3f4f6' }}>💡 How to Fix:</p>
                            <p className="text-[11px] leading-relaxed" style={{ color: '#9ca3af' }}>{checkResult.HowTOSolve}</p>
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
        <div className="mb-2 rounded-lg p-1" style={{ 
          border: `1px solid ${backendKeywordsHasErrors ? 'rgba(96, 165, 250, 0.3)' : '#30363d'}`, 
          background: backendKeywordsHasErrors ? 'rgba(96, 165, 250, 0.1)' : '#21262d'
        }}>
          <button
            onClick={() => toggleSection('backendKeywords')}
            className="w-full flex items-center justify-between p-2 rounded-lg transition-all duration-300"
            style={{ 
              background: backendKeywordsHasErrors ? 'rgba(96, 165, 250, 0.1)' : '#161b22',
              border: `1px solid ${backendKeywordsHasErrors ? 'rgba(96, 165, 250, 0.3)' : '#30363d'}`
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = backendKeywordsHasErrors ? 'rgba(96, 165, 250, 0.15)' : '#21262d'}
            onMouseLeave={(e) => e.currentTarget.style.background = backendKeywordsHasErrors ? 'rgba(96, 165, 250, 0.1)' : '#161b22'}
          >
            <div className="flex items-center gap-2">
              <Tag className="w-4 h-4" style={{ color: backendKeywordsHasErrors ? '#60a5fa' : '#60a5fa' }} />
              <div>
                <h3 className="text-xs font-bold" style={{ color: '#f3f4f6' }}>Backend Keywords</h3>
                {backendKeywordsHasErrors && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold mt-0.5" style={{ background: 'rgba(96, 165, 250, 0.2)', color: '#60a5fa' }}>
                    <XCircle className="w-2.5 h-2.5" />
                    Has Errors
                  </span>
                )}
              </div>
            </div>
            {expandedSections.backendKeywords ? (
              <ChevronUp className="w-3.5 h-3.5 transition-transform" style={{ color: backendKeywordsHasErrors ? '#60a5fa' : '#9ca3af' }} />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 transition-transform" style={{ color: backendKeywordsHasErrors ? '#60a5fa' : '#9ca3af' }} />
            )}
          </button>
          {expandedSections.backendKeywords && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-2 space-y-2 pl-1"
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
                    className="p-2 rounded-lg"
                    style={{ 
                      background: isError ? 'rgba(96, 165, 250, 0.1)' : 'rgba(96, 165, 250, 0.1)',
                      border: `1px solid ${isError ? 'rgba(96, 165, 250, 0.3)' : 'rgba(96, 165, 250, 0.3)'}`
                    }}
                  >
                    <div className="flex items-start gap-2">
                      {isError ? (
                        <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: '#60a5fa' }} />
                      ) : (
                        <CheckCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: '#60a5fa' }} />
                      )}
                      <div className="flex-1">
                        <h4 className="font-bold mb-1 text-xs" style={{ color: '#f3f4f6' }}>
                          {check === 'charLim' && 'Character Limit'}
                          {check === 'dublicateWords' && 'Duplicate Words'}
                        </h4>
                        <p className="text-[11px] mb-2 leading-relaxed" style={{ color: '#9ca3af' }}>{checkResult.Message}</p>
                        {checkResult.HowTOSolve && (
                          <div className="mt-2 pt-2 rounded-lg p-2" style={{ background: '#21262d', borderTop: '1px solid #30363d' }}>
                            <p className="text-[11px] font-semibold mb-1" style={{ color: '#f3f4f6' }}>💡 How to Fix:</p>
                            <p className="text-[11px] leading-relaxed" style={{ color: '#9ca3af' }}>{checkResult.HowTOSolve}</p>
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
