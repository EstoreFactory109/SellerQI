import React from 'react';
import { Package, AlertCircle, Database, Wifi, RefreshCw } from 'lucide-react';

const DataFallback = ({ 
  type = 'general', 
  message, 
  showRefresh = true, 
  onRefresh,
  className = '',
  size = 'medium'
}) => {
  const getIcon = () => {
    switch (type) {
      case 'products':
        return <Package className="w-8 h-8 text-gray-400" />;
      case 'network':
        return <Wifi className="w-8 h-8 text-gray-400" />;
      case 'database':
        return <Database className="w-8 h-8 text-gray-400" />;
      case 'error':
        return <AlertCircle className="w-8 h-8 text-red-400" />;
      default:
        return <AlertCircle className="w-8 h-8 text-gray-400" />;
    }
  };

  const getDefaultMessage = () => {
    switch (type) {
      case 'products':
        return 'No products data available at the moment.';
      case 'network':
        return 'Unable to connect to the server. Please check your internet connection.';
      case 'database':
        return 'Data is temporarily unavailable. We\'re working to restore it.';
      case 'error':
        return 'An error occurred while loading the data.';
      default:
        return 'Data is currently unavailable.';
    }
  };

  const getSizeClasses = () => {
    switch (size) {
      case 'small':
        return 'min-h-[200px] p-4';
      case 'large':
        return 'min-h-[500px] p-8';
      default:
        return 'min-h-[300px] p-6';
    }
  };

  return (
    <div className={`flex items-center justify-center ${getSizeClasses()} ${className}`}>
      <div className="text-center max-w-md">
        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
          {getIcon()}
        </div>
        
        <h3 className="text-lg font-medium text-gray-900 mb-2">
          Data Unavailable
        </h3>
        
        <p className="text-gray-600 mb-6">
          {message || getDefaultMessage()}
        </p>

        {type !== 'error' && (
          <p className="text-sm text-gray-500 mb-4">
            We'll continue to show any available data and update this section when more information becomes available.
          </p>
        )}

        {showRefresh && onRefresh && (
          <button
            onClick={onRefresh}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh Data
          </button>
        )}
      </div>
    </div>
  );
};

// Component for when partial data is available
export const PartialDataNotice = ({ 
  missingItems = [], 
  availableItems = [],
  className = '' 
}) => {
  return (
    <div className={`bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4 ${className}`}>
      <div className="flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
        <div>
          <h4 className="text-sm font-medium text-amber-800 mb-1">
            Partial Data Available
          </h4>
          <p className="text-sm text-amber-700 mb-2">
            Some data is currently unavailable, but we're showing what we have.
          </p>
          
          {availableItems.length > 0 && (
            <div className="mb-2">
              <span className="text-xs font-medium text-amber-800">Available: </span>
              <span className="text-xs text-amber-700">
                {availableItems.join(', ')}
              </span>
            </div>
          )}
          
          {missingItems.length > 0 && (
            <div>
              <span className="text-xs font-medium text-amber-800">Unavailable: </span>
              <span className="text-xs text-amber-700">
                {missingItems.join(', ')}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Hook to help components determine what data is available
export const useDataAvailability = (requiredData = {}) => {
  const availability = Object.entries(requiredData).reduce((acc, [key, value]) => {
    acc[key] = {
      available: value !== null && value !== undefined && 
                 (Array.isArray(value) ? value.length > 0 : true),
      value: value
    };
    return acc;
  }, {});

  const availableItems = Object.entries(availability)
    .filter(([_, data]) => data.available)
    .map(([key]) => key);

  const missingItems = Object.entries(availability)
    .filter(([_, data]) => !data.available)
    .map(([key]) => key);

  const hasAnyData = availableItems.length > 0;
  const hasAllData = missingItems.length === 0;

  return {
    availability,
    availableItems,
    missingItems,
    hasAnyData,
    hasAllData
  };
};

export default DataFallback; 