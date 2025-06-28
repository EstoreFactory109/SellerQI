import React, { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

export default function Navbar() {
  const [showSolutionsDropdown, setShowSolutionsDropdown] = useState(false);
  const dropdownRef = useRef(null);
  const navigate = useNavigate();

  const loginNavigate = (e) => {
    e.preventDefault();
    navigate('/log-in');
  }

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowSolutionsDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const solutionsItems = [
    { name: 'Inventory Management', path: '/inventory-management' },
    { name: 'Advertising', path: '/advertisement' },
    { name: 'Promotions', path: '/promotions' }
  ];

  return (
    <header className="border-b border-gray-200">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <Link to="/">
              <img src='https://res.cloudinary.com/ddoa960le/image/upload/v1749063777/MainLogo_1_uhcg6o.png' alt='SellerQI' className='w-28 h-9' />
            </Link>
          </div>
          <nav className="hidden md:flex items-center space-x-6">
            <Link to="/" className="text-gray-600 hover:text-gray-900">Home</Link>
            <Link to="/features" className="text-gray-600 hover:text-gray-900">Features</Link>
            
            {/* Solutions Dropdown */}
            <div className="relative" ref={dropdownRef}>
              <button
                className="flex items-center text-gray-600 hover:text-gray-900 focus:outline-none"
                onClick={() => setShowSolutionsDropdown(!showSolutionsDropdown)}
                onMouseEnter={() => setShowSolutionsDropdown(true)}
              >
                Solutions
                <ChevronDown className={`ml-1 h-4 w-4 transition-transform duration-200 ${showSolutionsDropdown ? 'rotate-180' : ''}`} />
              </button>
              
              <AnimatePresence>
                {showSolutionsDropdown && (
                  <motion.div
                    className="absolute top-full mt-2 w-56 bg-white border border-gray-200 rounded-md shadow-lg z-50 overflow-hidden"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2, ease: "easeInOut" }}
                    onMouseLeave={() => setShowSolutionsDropdown(false)}
                  >
                    <div className="py-1">
                      {solutionsItems.map((item, index) => (
                        <Link
                          key={index}
                          to={item.path}
                          className="block px-4 py-2 text-gray-700 hover:bg-[#333651] hover:text-white cursor-pointer transition-colors"
                          onClick={() => setShowSolutionsDropdown(false)}
                        >
                          {item.name}
                        </Link>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            
            <Link to="/how-it-works" className="text-gray-600 hover:text-gray-900">How It Works</Link>
            <Link to="/pricing" className="text-gray-600 hover:text-gray-900">Pricing</Link>
            <Link to="/contact-us" className="text-gray-600 hover:text-gray-900">Support</Link>
            <button className="bg-gray-900 text-white px-6 py-2 rounded hover:bg-gray-800"
              onClick={loginNavigate}
            >
              Login
            </button>
          </nav>
        </div>
      </div>
    </header>
  );
} 