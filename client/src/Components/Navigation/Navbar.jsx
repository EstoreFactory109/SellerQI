import React, { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronDown, Menu, X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

export default function Navbar() {
  const [showSolutionsDropdown, setShowSolutionsDropdown] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [showMobileSolutions, setShowMobileSolutions] = useState(false);
  const dropdownRef = useRef(null);
  const mobileMenuRef = useRef(null);
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
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(event.target)) {
        setShowMobileMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (showMobileMenu) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [showMobileMenu]);

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
              <img src='https://res.cloudinary.com/ddoa960le/image/upload/v1752478546/Seller_QI_Logo___V1_1_t9s3kh.png' alt='SellerQI' className='h-9' />
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
          
          {/* Mobile Menu Button */}
          <button
            className="md:hidden p-2 rounded-lg hover:bg-gray-100 transition-colors"
            onClick={() => setShowMobileMenu(!showMobileMenu)}
            aria-label="Toggle mobile menu"
          >
            {showMobileMenu ? (
              <X className="w-6 h-6 text-gray-600" />
            ) : (
              <Menu className="w-6 h-6 text-gray-600" />
            )}
          </button>
        </div>
      </div>

      {/* Mobile Menu Overlay */}
      <AnimatePresence>
        {showMobileMenu && (
          <>
            {/* Backdrop */}
            <motion.div
              className="fixed inset-0 bg-black bg-opacity-50 z-40 md:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setShowMobileMenu(false)}
            />
            
            {/* Mobile Menu */}
            <motion.div
              ref={mobileMenuRef}
              className="fixed top-0 right-0 h-full w-80 bg-white shadow-2xl z-50 md:hidden overflow-y-auto"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'tween', duration: 0.3, ease: 'easeInOut' }}
            >
              <div className="p-6">
                {/* Close Button */}
                <div className="flex justify-end mb-8">
                  <button
                    onClick={() => setShowMobileMenu(false)}
                    className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                    aria-label="Close mobile menu"
                  >
                    <X className="w-6 h-6 text-gray-600" />
                  </button>
                </div>

                {/* Mobile Navigation Items */}
                <nav className="space-y-6">
                  <Link 
                    to="/" 
                    className="block text-lg font-medium text-gray-900 hover:text-blue-600 transition-colors"
                    onClick={() => setShowMobileMenu(false)}
                  >
                    Home
                  </Link>
                  
                  <Link 
                    to="/features" 
                    className="block text-lg font-medium text-gray-900 hover:text-blue-600 transition-colors"
                    onClick={() => setShowMobileMenu(false)}
                  >
                    Features
                  </Link>
                  
                  {/* Mobile Solutions Dropdown */}
                  <div className="space-y-3">
                    <button
                      className="flex items-center justify-between w-full text-lg font-medium text-gray-900 hover:text-blue-600 transition-colors"
                      onClick={() => setShowMobileSolutions(!showMobileSolutions)}
                    >
                      Solutions
                      <ChevronDown className={`w-5 h-5 transition-transform duration-200 ${showMobileSolutions ? 'rotate-180' : ''}`} />
                    </button>
                    
                    <AnimatePresence>
                      {showMobileSolutions && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.2, ease: "easeInOut" }}
                          className="ml-4 space-y-3 overflow-hidden"
                        >
                          {solutionsItems.map((item, index) => (
                            <Link
                              key={index}
                              to={item.path}
                              className="block text-base text-gray-700 hover:text-blue-600 transition-colors"
                              onClick={() => {
                                setShowMobileSolutions(false);
                                setShowMobileMenu(false);
                              }}
                            >
                              {item.name}
                            </Link>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                  
                  <Link 
                    to="/how-it-works" 
                    className="block text-lg font-medium text-gray-900 hover:text-blue-600 transition-colors"
                    onClick={() => setShowMobileMenu(false)}
                  >
                    How It Works
                  </Link>
                  
                  <Link 
                    to="/pricing" 
                    className="block text-lg font-medium text-gray-900 hover:text-blue-600 transition-colors"
                    onClick={() => setShowMobileMenu(false)}
                  >
                    Pricing
                  </Link>
                  
                  <Link 
                    to="/contact-us" 
                    className="block text-lg font-medium text-gray-900 hover:text-blue-600 transition-colors"
                    onClick={() => setShowMobileMenu(false)}
                  >
                    Support
                  </Link>
                </nav>

                {/* Mobile Login Button */}
                <div className="mt-8 pt-6 border-t border-gray-200">
                  <button 
                    className="w-full bg-gray-900 text-white px-6 py-3 rounded-lg hover:bg-gray-800 transition-colors font-medium"
                    onClick={(e) => {
                      loginNavigate(e);
                      setShowMobileMenu(false);
                    }}
                  >
                    Login
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </header>
  );
} 