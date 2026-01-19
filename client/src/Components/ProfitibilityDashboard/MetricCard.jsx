import React from 'react';
import { DollarSign, Percent, List, TrendingUp, TrendingDown, Zap, Target } from 'lucide-react';
import { motion } from 'framer-motion';

const MetricCard = ({ label, value, icon }) => {
    const getIconComponent = (iconType) => {
      switch (iconType) {
        case 'dollar-sign': return DollarSign;
        case 'percent': return Percent;
        case 'list': return List;
        case 'trending-up': return TrendingUp;
        case 'trending-down': return TrendingDown;
        case 'zap': return Zap;
        case 'target': return Target;
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
        case 'zap': return 'from-blue-500 to-cyan-600';
        case 'target': return 'from-purple-500 to-pink-600';
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
        className="group bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:shadow-lg hover:border-gray-300 transition-all duration-300 h-36 flex flex-col w-full"
      >
        <div className="flex items-center justify-between mb-2">
          <div className={`w-10 h-10 bg-gradient-to-br ${getIconColor(icon)} rounded-lg flex items-center justify-center shadow-md group-hover:shadow-lg transition-shadow duration-300`}>
            <IconComponent className="w-5 h-5 text-white" />
          </div>
          
          {/* Trend indicator based on label */}
          {label.toLowerCase().includes('profit') && (
            <div className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
              isNegative 
                ? 'bg-red-100 text-red-700' 
                : 'bg-green-100 text-green-700'
            }`}>
              {isNegative ? 'Loss' : 'Profit'}
            </div>
          )}
        </div>
        
        <div className="space-y-1 flex-1 flex flex-col justify-between">
          <div>
            <h3 className="text-[11px] font-medium text-gray-600 uppercase tracking-wide leading-tight">
              {label}
            </h3>
            <div className="flex items-baseline justify-between mt-1">
              <p className={`text-lg font-bold transition-colors duration-200 truncate ${
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
                  <div className="text-[10px] text-gray-500">Target: 15%+</div>
                </div>
              )}
            </div>
          </div>
          
          {/* Bottom section for additional elements */}
          <div className="space-y-1">
            {/* Progress bar for margin percentage */}
            {label.toLowerCase().includes('margin') && value && (
              <div>
                <div className="w-full bg-gray-200 rounded-full h-1.5">
                  <div 
                    className={`h-1.5 rounded-full transition-all duration-500 ${
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
          </div>
        </div>

      </motion.div>
    );
  };

  export default MetricCard;