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
        case 'percent': return 'from-blue-500 to-blue-600';
        case 'list': return 'from-green-500 to-emerald-600';
        case 'trending-up': return 'from-blue-500 to-indigo-600';
        case 'trending-down': return 'from-green-500 to-emerald-600';
        case 'zap': return 'from-blue-500 to-cyan-600';
        case 'target': return 'from-blue-500 to-blue-600';
        default: return 'from-blue-500 to-blue-600';
      }
    };

    const IconComponent = getIconComponent(icon);
    
    const getIconColorClass = (iconType) => {
      // All icons are now blue
      return '#60a5fa';
    };

    return (
      <motion.div 
        whileHover={{ y: -2 }}
        transition={{ duration: 0.2 }}
        className="group rounded-lg transition-all duration-300 flex flex-col w-full"
        style={{ background: '#161b22', border: '1px solid #30363d', padding: '10px' }}
        onMouseEnter={(e) => e.currentTarget.style.borderColor = '#3b82f6'}
        onMouseLeave={(e) => e.currentTarget.style.borderColor = '#30363d'}
      >
        <div className="flex items-center gap-2 mb-1">
          <IconComponent className="w-4 h-4" style={{ color: '#60a5fa' }} />
          <div className="text-[11px] font-medium uppercase tracking-wide" style={{ color: '#ffffff' }}>
            {label}
          </div>
        </div>
        <div className="text-[18px] font-bold transition-colors duration-200 truncate" style={{ color: '#ffffff' }}>
          {value}
        </div>
      </motion.div>
    );
  };

  export default MetricCard;