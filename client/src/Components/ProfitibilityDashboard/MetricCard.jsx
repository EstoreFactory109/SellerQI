import React from 'react';
import { DollarSign, Percent, List, TrendingUp, TrendingDown } from 'lucide-react';
import { motion } from 'framer-motion';

const MetricCard = ({ label, value, icon }) => {
    const getIconComponent = (iconType) => {
      switch (iconType) {
        case 'dollar-sign': return DollarSign;
        case 'percent': return Percent;
        case 'list': return List;
        case 'trending-up': return TrendingUp;
        case 'trending-down': return TrendingDown;
        default: return DollarSign;
      }
    };

    const getIconColor = (iconType) => {
      switch (iconType) {
        case 'dollar-sign': return 'from-green-500 to-emerald-600';
        case 'percent': return 'from-purple-500 to-purple-600';
        case 'list': return 'from-orange-500 to-red-600';
        case 'trending-up': return 'from-blue-500 to-indigo-600';
        case 'trending-down': return 'from-amber-500 to-orange-600';
        default: return 'from-blue-500 to-blue-600';
      }
    };

    const IconComponent = getIconComponent(icon);
    
    // Determine if this is a negative value
    const isNegative = value && value.includes('-');
    
    return (
      <motion.div 
        whileHover={{ y: -2, scale: 1.02 }}
        transition={{ duration: 0.2 }}
        className="group bg-white rounded-2xl border border-gray-200 p-6 shadow-sm hover:shadow-lg hover:border-gray-300 transition-all duration-300 h-40 flex flex-col"
      >
        <div className="flex items-center justify-between mb-4">
          <div className={`w-12 h-12 bg-gradient-to-br ${getIconColor(icon)} rounded-xl flex items-center justify-center shadow-lg group-hover:shadow-xl transition-shadow duration-300`}>
            <IconComponent className="w-6 h-6 text-white" />
          </div>
          
          {/* Trend indicator based on label */}
          {label.toLowerCase().includes('profit') && (
            <div className={`px-2 py-1 rounded-full text-xs font-medium ${
              isNegative 
                ? 'bg-red-100 text-red-700' 
                : 'bg-green-100 text-green-700'
            }`}>
              {isNegative ? 'Loss' : 'Profit'}
            </div>
          )}
        </div>
        
        <div className="space-y-2 flex-1 flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-medium text-gray-600 uppercase tracking-wide">
              {label}
            </h3>
            <div className="flex items-baseline justify-between mt-2">
              <p className={`text-2xl font-bold transition-colors duration-200 ${
                isNegative 
                  ? 'text-red-600' 
                  : label.toLowerCase().includes('profit') || label.toLowerCase().includes('sales')
                    ? 'text-green-600'
                    : 'text-gray-900'
              }`}>
                {value}
              </p>
              
              {/* Optional percentage change indicator */}
              {label.toLowerCase().includes('margin') && (
                <div className="text-right">
                  <div className="text-xs text-gray-500">Target: 15%+</div>
                </div>
              )}
            </div>
          </div>
          
          {/* Bottom section for additional elements */}
          <div className="space-y-2">
            {/* Progress bar for margin percentage */}
            {label.toLowerCase().includes('margin') && value && (
              <div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div 
                    className={`h-2 rounded-full transition-all duration-500 ${
                      parseFloat(value) >= 15 
                        ? 'bg-gradient-to-r from-green-400 to-green-500' 
                        : parseFloat(value) >= 5 
                          ? 'bg-gradient-to-r from-yellow-400 to-orange-500'
                          : 'bg-gradient-to-r from-red-400 to-red-500'
                    }`}
                    style={{ 
                      width: `${Math.min(Math.max(parseFloat(value) || 0, 0), 100)}%` 
                    }}
                  />
                </div>
              </div>
            )}
            
            {/* Additional context for specific metrics */}
            {label.toLowerCase().includes('fees') && (
              <div className="text-xs text-gray-500">
                <span>Optimize to reduce costs</span>
              </div>
            )}
            
            {label.toLowerCase().includes('spend') && (
              <div className="text-xs text-gray-500">
                <span>Monitor ACOS efficiency</span>
              </div>
            )}
          </div>
        </div>

      </motion.div>
    );
  };

  export default MetricCard;