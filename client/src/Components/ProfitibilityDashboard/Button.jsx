import React from 'react';
import { ChevronDown } from 'lucide-react';

const Button = ({ children, className = '', ...props }) => {
    return (
      <button 
        className={`px-4 py-2 font-medium rounded-lg border border-gray-300 bg-white hover:bg-gray-50 transition-colors flex items-center gap-2 text-sm text-gray-700 ${className}`}
        {...props}
      >
        {children}
        <ChevronDown className="w-4 h-4" />
      </button>
    );
  };

  export default Button;