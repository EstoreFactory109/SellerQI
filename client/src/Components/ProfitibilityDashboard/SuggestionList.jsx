import React from 'react';
import { useState } from 'react';

const SuggestionList = ({ suggestionsData }) => {
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);
  
  // Convert string suggestions to objects with priority if needed
  const suggestions = suggestionsData.map((suggestion, index) => {
    if (typeof suggestion === 'string') {
      // Determine priority based on keywords in the suggestion
      let priority = 'medium';
      if (suggestion.toLowerCase().includes('negative profit') || 
          suggestion.toLowerCase().includes('losing money') ||
          suggestion.toLowerCase().includes('unprofitable')) {
        priority = 'high';
      } else if (suggestion.toLowerCase().includes('optimize') || 
                 suggestion.toLowerCase().includes('consider')) {
        priority = 'low';
      }
      
      return {
        message: suggestion,
        priority: priority,
        type: 'profitability'
      };
    }
    return suggestion;
  });
  
  // Get suggestions to display based on showAllSuggestions state
  const suggestionsToDisplay = showAllSuggestions ? suggestions : suggestions.slice(0, 5);
  
  // Calculate potential impact summary
  const highPrioritySuggestions = suggestions.filter(s => s.priority === 'high');
  const mediumPrioritySuggestions = suggestions.filter(s => s.priority === 'medium');
  
  return (
    <div className="bg-white rounded-xl p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Suggestions</h3>
      {suggestionsToDisplay.length > 0 ? (
        <div>
          {/* Summary of potential impact */}
          {highPrioritySuggestions.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
              <p className="text-sm font-medium text-red-900">
                Critical Issues Found
              </p>
              <div className="text-xs text-red-700 mt-1 space-y-1">
                <p>• {highPrioritySuggestions.length} products with negative profit</p>
                {mediumPrioritySuggestions.length > 0 && (
                  <p>• {mediumPrioritySuggestions.length} products need optimization</p>
                )}
                <p>Immediate action recommended</p>
              </div>
            </div>
          )}
          
          {/* Individual suggestions */}
          <div className="space-y-3">
            {suggestionsToDisplay.map((suggestion, index) => (
              <div key={index} className="flex items-start gap-2 p-3 rounded-lg hover:bg-gray-50 transition-colors">
                <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                  suggestion.priority === 'high' ? 'bg-red-500' : 
                  suggestion.priority === 'medium' ? 'bg-yellow-500' : 'bg-gray-400'
                }`} />
                <div className="flex-1">
                  <p className="text-sm text-gray-600">{suggestion.message}</p>
                </div>
              </div>
            ))}
            {!showAllSuggestions && suggestions.length > 5 && (
              <button 
                onClick={() => setShowAllSuggestions(true)}
                className="text-sm text-blue-600 hover:text-blue-700 mt-3 font-medium transition-colors"
              >
                + {suggestions.length - 5} more suggestions available
              </button>
            )}
            {showAllSuggestions && suggestions.length > 5 && (
              <button 
                onClick={() => setShowAllSuggestions(false)}
                className="text-sm text-gray-600 hover:text-gray-700 mt-3 font-medium transition-colors"
              >
                Show less
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-2 text-sm text-gray-600">
          <p>No specific optimization suggestions at this time.</p>
          <p>Continue monitoring product profitability for optimization opportunities.</p>
        </div>
      )}
    </div>
  );
};

export default SuggestionList;