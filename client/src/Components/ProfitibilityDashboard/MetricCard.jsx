import React from 'react';
import { DollarSign, Percent, List, X, AlertTriangle } from 'lucide-react';

const MetricCard = ({ label, value, icon }) => {
    const IconComponent = icon === 'dollar-sign' ? DollarSign : 
                         icon === 'percent' ? Percent : 
                         icon === 'list' ? List : DollarSign;
    
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 rounded-full">
            <IconComponent className="w-4 h-4 text-blue-600" />
          </div>
          <div className="flex-1">
            <p className="text-xs text-gray-600 mb-1">{label}</p>
            <p className="text-xl font-semibold text-gray-900">{value}</p>
          </div>
        </div>
      </div>
    );
  };

  export default MetricCard;