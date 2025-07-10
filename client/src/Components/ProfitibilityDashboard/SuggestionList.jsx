import React from 'react';
import { useState } from 'react';
import { AlertTriangle, TrendingUp, Lightbulb, ChevronDown, ChevronUp, Target, Zap, Shield, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const SuggestionList = ({ suggestionsData }) => {
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);
  
  // Convert string suggestions to objects with priority if needed
  const suggestions = suggestionsData.map((suggestion, index) => {
    if (typeof suggestion === 'string') {
      // Determine priority based on keywords in the suggestion
      let priority = 'medium';
      let icon = Lightbulb;
      let category = 'General';
      
      if (suggestion.toLowerCase().includes('negative profit') || 
          suggestion.toLowerCase().includes('losing money') ||
          suggestion.toLowerCase().includes('unprofitable') ||
          suggestion.toLowerCase().includes('incurring a loss')) {
        priority = 'critical';
        icon = AlertTriangle;
        category = 'Critical Issue';
      } else if (suggestion.toLowerCase().includes('very low margin') ||
                 suggestion.toLowerCase().includes('low margin') ||
                 suggestion.toLowerCase().includes('below 10%')) {
        priority = 'high';
        icon = TrendingUp;
        category = 'Margin Optimization';
      } else if (suggestion.toLowerCase().includes('optimize') || 
                 suggestion.toLowerCase().includes('consider') ||
                 suggestion.toLowerCase().includes('review')) {
        priority = 'medium';
        icon = Target;
        category = 'Optimization';
      } else if (suggestion.toLowerCase().includes('ppc') ||
                 suggestion.toLowerCase().includes('ad spend') ||
                 suggestion.toLowerCase().includes('campaigns')) {
        priority = 'medium';
        icon = Zap;
        category = 'PPC Optimization';
      }
      
      return {
        message: suggestion,
        priority: priority,
        type: 'profitability',
        icon: icon,
        category: category
      };
    }
    return suggestion;
  });
  
  // Get suggestions to display based on showAllSuggestions state
  const suggestionsToDisplay = showAllSuggestions ? suggestions : suggestions.slice(0, 5);
  
  // Calculate potential impact summary
  const criticalSuggestions = suggestions.filter(s => s.priority === 'critical');
  const highPrioritySuggestions = suggestions.filter(s => s.priority === 'high');
  const mediumPrioritySuggestions = suggestions.filter(s => s.priority === 'medium');

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'critical': return 'from-red-500 to-red-600';
      case 'high': return 'from-amber-500 to-orange-600';
      case 'medium': return 'from-blue-500 to-blue-600';
      default: return 'from-gray-400 to-gray-500';
    }
  };

  const getPriorityBg = (priority) => {
    switch (priority) {
      case 'critical': return 'bg-red-50 border-red-200';
      case 'high': return 'bg-amber-50 border-amber-200';
      case 'medium': return 'bg-blue-50 border-blue-200';
      default: return 'bg-gray-50 border-gray-200';
    }
  };

  const getPriorityText = (priority) => {
    switch (priority) {
      case 'critical': return 'text-red-700';
      case 'high': return 'text-amber-700';
      case 'medium': return 'text-blue-700';
      default: return 'text-gray-700';
    }
  };

  const getPriorityBadge = (priority) => {
    switch (priority) {
      case 'critical': return 'bg-red-100 text-red-800 border-red-200';
      case 'high': return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'medium': return 'bg-blue-100 text-blue-800 border-blue-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };
  
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Enhanced Header */}
      <div className="p-6 bg-gradient-to-r from-slate-50 to-gray-50 border-b border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-green-600 rounded-xl flex items-center justify-center shadow-lg">
              <Lightbulb className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-gray-900">AI-Powered Suggestions</h3>
              <p className="text-sm text-gray-600">Actionable insights to optimize your profitability</p>
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm text-gray-600">Total Suggestions</div>
            <div className="text-2xl font-bold text-gray-900">{suggestions.length}</div>
          </div>
        </div>

        {/* Priority Summary Cards */}
        {suggestions.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {criticalSuggestions.length > 0 && (
              <div className="bg-white p-4 rounded-xl border border-red-200 shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className="w-4 h-4 text-red-600" />
                  <span className="text-xs font-medium text-red-700">Critical Issues</span>
                </div>
                <div className="text-lg font-bold text-red-600">{criticalSuggestions.length}</div>
                <p className="text-xs text-red-600 mt-1">Immediate action required</p>
              </div>
            )}
            
            {highPrioritySuggestions.length > 0 && (
              <div className="bg-white p-4 rounded-xl border border-amber-200 shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="w-4 h-4 text-amber-600" />
                  <span className="text-xs font-medium text-amber-700">High Priority</span>
                </div>
                <div className="text-lg font-bold text-amber-600">{highPrioritySuggestions.length}</div>
                <p className="text-xs text-amber-600 mt-1">Optimize within a week</p>
              </div>
            )}
            
            {mediumPrioritySuggestions.length > 0 && (
              <div className="bg-white p-4 rounded-xl border border-blue-200 shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                  <Target className="w-4 h-4 text-blue-600" />
                  <span className="text-xs font-medium text-blue-700">Medium Priority</span>
                </div>
                <div className="text-lg font-bold text-blue-600">{mediumPrioritySuggestions.length}</div>
                <p className="text-xs text-blue-600 mt-1">Review when convenient</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Suggestions Content */}
      <div className="p-6">
        {suggestionsToDisplay.length > 0 ? (
          <div className="space-y-4">
            <AnimatePresence>
              {suggestionsToDisplay.map((suggestion, index) => {
                const IconComponent = suggestion.icon || Lightbulb;
                return (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ duration: 0.3, delay: index * 0.1 }}
                    className={`p-4 rounded-xl border ${getPriorityBg(suggestion.priority)} hover:shadow-md transition-all duration-200`}
                  >
                    <div className="flex items-start gap-4">
                      {/* Priority Indicator & Icon */}
                      <div className="flex-shrink-0">
                        <div className={`w-10 h-10 bg-gradient-to-br ${getPriorityColor(suggestion.priority)} rounded-lg flex items-center justify-center shadow-sm`}>
                          <IconComponent className="w-5 h-5 text-white" />
                        </div>
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${getPriorityBadge(suggestion.priority)}`}>
                            {suggestion.priority === 'critical' && <AlertCircle className="w-3 h-3 mr-1" />}
                            {suggestion.priority === 'high' && <TrendingUp className="w-3 h-3 mr-1" />}
                            {suggestion.priority === 'medium' && <Target className="w-3 h-3 mr-1" />}
                            {suggestion.priority.charAt(0).toUpperCase() + suggestion.priority.slice(1)}
                          </span>
                          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                            {suggestion.category}
                          </span>
                        </div>
                        
                        <p className={`text-sm leading-relaxed ${getPriorityText(suggestion.priority)}`}>
                          {suggestion.message}
                        </p>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>

            {/* Show More/Less Button */}
            {suggestions.length > 5 && (
              <div className="flex justify-center pt-4">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setShowAllSuggestions(!showAllSuggestions)}
                  className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-50 to-indigo-50 text-blue-700 font-medium rounded-xl border border-blue-200 hover:from-blue-100 hover:to-indigo-100 transition-all duration-200 shadow-sm hover:shadow-md"
                >
                  {showAllSuggestions ? (
                    <>
                      <ChevronUp className="w-4 h-4" />
                      <span>Show Less</span>
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-4 h-4" />
                      <span>Show {suggestions.length - 5} More Suggestions</span>
                    </>
                  )}
                </motion.button>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-12">
            <div className="flex flex-col items-center gap-4">
              <div className="w-16 h-16 bg-gradient-to-br from-green-100 to-emerald-100 rounded-full flex items-center justify-center">
                <Shield className="w-8 h-8 text-green-600" />
              </div>
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">All Good! 🎉</h3>
                <div className="space-y-1 text-sm text-gray-600 max-w-md">
                  <p>No critical optimization suggestions at this time.</p>
                  <p>Your products are performing well within healthy profit margins.</p>
                  <p className="font-medium text-green-600 mt-3">Continue monitoring for future optimization opportunities.</p>
                </div>
              </div>
              
              {/* Motivational Tips */}
              <div className="mt-6 p-4 bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl border border-green-200">
                <h4 className="text-sm font-medium text-green-900 mb-2 flex items-center gap-2">
                  <Lightbulb className="w-4 h-4" />
                  Pro Tips for Continued Success
                </h4>
                <ul className="text-xs text-green-700 space-y-1">
                  <li>• Monitor profit margins regularly to catch issues early</li>
                  <li>• Consider seasonal adjustments to pricing and inventory</li>
                  <li>• Keep optimizing PPC campaigns for better ACOS</li>
                  <li>• Review and update COGS values when supplier costs change</li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SuggestionList;