import React from 'react';
import { Link, useNavigate } from 'react-router-dom';

export default function Navbar() {
  const navigate = useNavigate();

  const loginNavigate = (e) => {
    e.preventDefault();
    navigate('/log-in');
  }

  return (
    <header className="border-b border-gray-200">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <Link to="/">
              <img src='https://res.cloudinary.com/ddoa960le/image/upload/v1749063777/MainLogo_1_uhcg6o.png' alt='SellerQI' className='w-28 h-9' />
            </Link>
          </div>
          <nav className="hidden md:flex items-center space-x-8">
            <Link to="/pricing" className="text-gray-600 hover:text-gray-900">Pricing</Link>
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