import React from 'react';
import { useState } from 'react';

const SuggestionList = ({ suggestionsData }) => {
  console.log("suggestionsData: ",suggestionsData)
  const [visibleCount, setVisibleCount] = useState(5);
  
  // Show suggestions up to visibleCount
  const visibleSuggestions = suggestionsData.slice(0, visibleCount);
  const remainingSuggestions = suggestionsData.length - visibleCount;
  const hasMoreSuggestions = remainingSuggestions > 0;
  
  const handleViewMore = () => {
    // Add 5 more suggestions to the visible count
    setVisibleCount(prevCount => Math.min(prevCount + 5, suggestionsData.length));
  };
  
  const handleViewLess = () => {
    // Reset to show only first 5
    setVisibleCount(5);
  };
  
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h3 className="text-base font-semibold text-gray-900 mb-3">Suggestions</h3>
      <ul className="space-y-2">
        {visibleSuggestions.map((suggestion, index) => (
          <li key={index} className="flex items-start">
            <span className="text-gray-900 mr-2">•</span>
            <span className="text-sm text-gray-700">{suggestion}</span>
          </li>
        ))}
      </ul>
      {(hasMoreSuggestions || visibleCount > 5) && (
        <div className="mt-3 flex gap-3">
          {hasMoreSuggestions && (
            <button
              onClick={handleViewMore}
              className="text-sm text-blue-600 hover:text-blue-800 font-medium focus:outline-none transition-colors"
            >
              View more ({Math.min(remainingSuggestions, 5)} more)
            </button>
          )}
          {visibleCount > 5 && (
            <button
              onClick={handleViewLess}
              className="text-sm text-gray-600 hover:text-gray-800 font-medium focus:outline-none transition-colors"
            >
              View less
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default SuggestionList;