import React, { useState, useEffect } from 'react';
import { ChevronRight, Check, X, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { LuFacebook } from "react-icons/lu";
import { BsTwitterX } from "react-icons/bs";
import { AiOutlineLinkedin } from "react-icons/ai";
import Logo from "../assets/Icons/MainLogo.png"
import { useNavigate } from 'react-router-dom';

function ResultsPage({ asin, market }) {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-200">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="text-2xl font-bold">
            Seller<span className="text-blue-600">QI</span>
          </div>
          <nav className="hidden md:flex items-center space-x-8">
            <Link to="/pricing" className="text-gray-600 hover:text-gray-900">Pricing</Link>
            <button className="bg-gray-900 text-white px-6 py-2 rounded hover:bg-gray-800">Login</button>
          </nav>
        </div>
      </header>
      <main className="container mx-auto px-4 py-12 flex-1">
        <div className="flex flex-col md:flex-row gap-16 md:gap-24 mb-12">
          {/* Product Image */}
          <div className="w-full md:w-1/3 flex justify-center items-start">
            <img src="https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=400&q=80" alt="Product" className="rounded-lg w-80 h-80 object-cover" />
          </div>
          {/* Product Info */}
          <div className="flex-1 pt-4 md:pt-0">
            <h1 className="text-3xl font-bold mb-4">Bluetooth Wireless Earbuds with Noise Cancellation</h1>
            <div className="text-gray-600 mb-6 space-y-1">
              <div>ASIN : <span className="font-medium">B07NKVNWRY</span></div>
              <div>Category : Electronics</div>
              <div>Brand : Beats</div>
              <div>List Price : $100</div>
              <div>Star Ratings : 3.8/5</div>
              <div>Reviews Count : 1284</div>
            </div>
            <div className="bg-white border rounded-lg p-4 w-64 mb-4">
              <div className="text-sm font-semibold mb-2">Health Score</div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-2 bg-green-500 rounded-full" style={{ width: '80%' }}></div>
                </div>
                <span className="text-xs font-bold bg-gray-100 px-2 py-1 rounded">50/100</span>
              </div>
            </div>
          </div>
        </div>
        {/* At a Glance */}
        <div className="mb-12 grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="bg-white border rounded-lg p-6 text-center">
            <div className="text-gray-500 text-xs mb-1">Unit Sold</div>
            <div className="text-2xl font-bold">900 <span className="text-green-500 text-xs align-top">↑2.5%</span></div>
          </div>
          <div className="bg-white border rounded-lg p-6 text-center">
            <div className="text-gray-500 text-xs mb-1">Sales</div>
            <div className="text-2xl font-bold">$10,822.06 <span className="text-green-500 text-xs align-top">↑2.5%</span></div>
          </div>
          <div className="bg-white border rounded-lg p-6 text-center">
            <div className="text-gray-500 text-xs mb-1">Orders</div>
            <div className="text-2xl font-bold">100 <span className="text-green-500 text-xs align-top">↑2.5%</span></div>
          </div>
          <div className="bg-white border rounded-lg p-6 text-center">
            <div className="text-gray-500 text-xs mb-1">Average Order Value</div>
            <div className="text-2xl font-bold">100 <span className="text-red-500 text-xs align-top">↓2.5%</span></div>
          </div>
        </div>
        {/* Issues Section */}
        <div className="mb-12 grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="bg-white border rounded-lg p-6">
            <div className="font-semibold mb-4">12 Issues found with this product</div>
            <div className="flex items-center gap-4">
              <svg width="100" height="100" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="40" fill="#f3f4f6" />
                <circle cx="50" cy="50" r="40" fill="none" stroke="#f87171" strokeWidth="10" strokeDasharray="75 251" />
                <circle cx="50" cy="50" r="40" fill="none" stroke="#fbbf24" strokeWidth="10" strokeDasharray="50 251" strokeDashoffset="-75" />
                <circle cx="50" cy="50" r="40" fill="none" stroke="#10b981" strokeWidth="10" strokeDasharray="126 251" strokeDashoffset="-125" />
                <text x="50" y="58" textAnchor="middle" fill="#111827" fontSize="28" fontWeight="bold">12</text>
                <text x="50" y="78" textAnchor="middle" fill="#6b7280" fontSize="12">ERRORS</text>
              </svg>
              <div className="text-sm space-y-1">
                <div><span className="inline-block w-3 h-3 rounded-full bg-yellow-400 mr-2"></span>Rankings</div>
                <div><span className="inline-block w-3 h-3 rounded-full bg-green-500 mr-2"></span>Conversion</div>
                <div><span className="inline-block w-3 h-3 rounded-full bg-blue-400 mr-2"></span>Fulfillment</div>
                <div><span className="inline-block w-3 h-3 rounded-full bg-pink-400 mr-2"></span>Advertising</div>
                <div><span className="inline-block w-3 h-3 rounded-full bg-gray-400 mr-2"></span>Account Health</div>
                <div><span className="inline-block w-3 h-3 rounded-full bg-purple-400 mr-2"></span>Inventory</div>
              </div>
            </div>
          </div>
          <div className="bg-white border rounded-lg p-6">
            <div className="font-semibold mb-4">Optimize the errors and increase your organic traffic by upto <span className="text-green-600 font-bold">400%</span></div>
            <div className="mb-2 text-sm">Current Traffic</div>
            <div className="w-full h-2 bg-gray-200 rounded-full mb-2">
              <div className="h-2 bg-[#23253A] rounded-full" style={{ width: '24%' }}></div>
            </div>
            <div className="mb-2 text-sm">Potential Traffic</div>
            <div className="w-full h-2 bg-gray-200 rounded-full">
              <div className="h-2 bg-[#23253A] rounded-full" style={{ width: '100%' }}></div>
            </div>
          </div>
        </div>
        {/* Issue Tables */}
        <div className="mb-16 space-y-8">
          {/* Ranking Issues */}
          <div>
            <div className="bg-[#23253A] text-white px-6 py-2 rounded-t-lg font-semibold">RANKING ISSUES</div>
            <div className="bg-white border-x border-b rounded-b-lg p-4 space-y-2">
              <div className="flex justify-between items-center">
                <span>Titles is less than 70 characters</span>
                <button className="text-xs bg-gray-100 px-3 py-1 rounded">View Fix →</button>
              </div>
              <div className="flex justify-between items-center">
                <span>Bullet points</span>
                <button className="text-xs bg-gray-100 px-3 py-1 rounded">View Fix →</button>
              </div>
            </div>
          </div>
          {/* Conversion Issues */}
          <div>
            <div className="bg-[#23253A] text-white px-6 py-2 rounded-t-lg font-semibold">CONVERSION ISSUES</div>
            <div className="bg-white border-x border-b rounded-b-lg p-4 space-y-2">
              <div className="flex justify-between items-center">
                <span>Titles is less than 70 characters</span>
                <button className="text-xs bg-gray-100 px-3 py-1 rounded">View Fix →</button>
              </div>
              <div className="flex justify-between items-center">
                <span>Bullet points</span>
                <button className="text-xs bg-gray-100 px-3 py-1 rounded">View Fix →</button>
              </div>
            </div>
          </div>
          {/* Fulfillment Issues */}
          <div>
            <div className="bg-[#23253A] text-white px-6 py-2 rounded-t-lg font-semibold">FULFILLMENT ISSUES</div>
            <div className="bg-white border-x border-b rounded-b-lg p-4 space-y-2">
              <div className="flex justify-between items-center">
                <span>Titles is less than 70 characters</span>
                <button className="text-xs bg-gray-100 px-3 py-1 rounded" disabled>Pro Access Required 🔒</button>
              </div>
              <div className="flex justify-between items-center">
                <span>Bullet points</span>
                <button className="text-xs bg-gray-100 px-3 py-1 rounded" disabled>Pro Access Required 🔒</button>
              </div>
            </div>
          </div>
          {/* Advertising Issues */}
          <div>
            <div className="bg-[#23253A] text-white px-6 py-2 rounded-t-lg font-semibold">ADVERTISING ISSUES</div>
            <div className="bg-white border-x border-b rounded-b-lg p-4 space-y-2">
              <div className="flex justify-between items-center">
                <span>Titles is less than 70 characters</span>
                <button className="text-xs bg-gray-100 px-3 py-1 rounded" disabled>Pro Access Required 🔒</button>
              </div>
              <div className="flex justify-between items-center">
                <span>Bullet points</span>
                <button className="text-xs bg-gray-100 px-3 py-1 rounded" disabled>Pro Access Required 🔒</button>
              </div>
            </div>
          </div>
          {/* Account Health Issues */}
          <div>
            <div className="bg-[#23253A] text-white px-6 py-2 rounded-t-lg font-semibold">ACCOUNT HEALTH ISSUES</div>
            <div className="bg-white border-x border-b rounded-b-lg p-4 space-y-2">
              <div className="flex justify-between items-center">
                <span>Titles is less than 70 characters</span>
                <button className="text-xs bg-gray-100 px-3 py-1 rounded" disabled>Pro Access Required 🔒</button>
              </div>
              <div className="flex justify-between items-center">
                <span>Bullet points</span>
                <button className="text-xs bg-gray-100 px-3 py-1 rounded" disabled>Pro Access Required 🔒</button>
              </div>
            </div>
          </div>
          {/* Inventory Issues */}
          <div>
            <div className="bg-[#23253A] text-white px-6 py-2 rounded-t-lg font-semibold">INVENTORY ISSUES</div>
            <div className="bg-white border-x border-b rounded-b-lg p-4 space-y-2">
              <div className="flex justify-between items-center">
                <span>Titles is less than 70 characters</span>
                <button className="text-xs bg-gray-100 px-3 py-1 rounded" disabled>Pro Access Required 🔒</button>
              </div>
              <div className="flex justify-between items-center">
                <span>Bullet points</span>
                <button className="text-xs bg-gray-100 px-3 py-1 rounded" disabled>Pro Access Required 🔒</button>
              </div>
            </div>
          </div>
        </div>
        {/* CTA Section */}
        <div className="mt-20 flex flex-col items-center">
          <div className="mb-6">
            <svg width="60" height="60" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="30" fill="none" stroke="#FCD34D" strokeWidth="6" strokeDasharray="47 141" />
              <circle cx="50" cy="50" r="30" fill="none" stroke="#EF4444" strokeWidth="6" strokeDasharray="47 141" strokeDashoffset="-47" />
              <circle cx="50" cy="50" r="30" fill="none" stroke="#10B981" strokeWidth="6" strokeDasharray="47 141" strokeDashoffset="-94" />
              <circle cx="50" cy="50" r="30" fill="none" stroke="#FFFFFF" strokeWidth="6" strokeDasharray="47 141" strokeDashoffset="-141" />
              <text x="50" y="58" textAnchor="middle" fill="#23253A" fontSize="24" fontWeight="bold">Q</text>
            </svg>
          </div>
          <h2 className="text-2xl font-bold mb-2 text-center">Want Actionable Fixes for Your Product Issues?</h2>
          <p className="text-gray-600 mb-4 text-center">You're viewing basic audit insights. Pro users get full breakdowns and personalized fixes.</p>
          <button className="bg-[#23253A] text-white px-6 py-2 rounded hover:bg-[#2d3a52]">Upgrade to Seller QI PRO →</button>
        </div>
      </main>
      {/* Footer */}
      <footer className="bg-[#23253A] text-white py-12 mt-16">
        <div className="container mx-auto px-4">
          <div className="mb-8">
            <div className="text-2xl font-bold mb-4">
              Seller<span className="text-blue-400">QI</span>
            </div>
          </div>
          <div className="grid md:grid-cols-5 gap-8 mb-8">
            <div>
              <h4 className="font-semibold mb-4">Column One</h4>
              <ul className="space-y-2 text-gray-400">
                <li>Twenty One</li>
                <li>Thirty Two</li>
                <li>Fourty Three</li>
                <li>Fifty Four</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Column Two</h4>
              <ul className="space-y-2 text-gray-400">
                <li>Sixty Five</li>
                <li>Seventy Six</li>
                <li>Eighty Seven</li>
                <li>Ninety Eight</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Column Two</h4>
              <ul className="space-y-2 text-gray-400">
                <li>Terms of Use</li>
                <li>Refund Policy</li>
                <li>Privacy Policy</li>
                <li>Ninety Eight</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Join Us</h4>
              <div className="flex gap-4 mt-2">
                <span className="text-gray-400 hover:text-white"><svg width="24" height="24" fill="currentColor"><rect width="24" height="24" rx="4" /></svg></span>
                <span className="text-gray-400 hover:text-white"><svg width="24" height="24" fill="currentColor"><circle cx="12" cy="12" r="10" /></svg></span>
                <span className="text-gray-400 hover:text-white"><svg width="24" height="24" fill="currentColor"><rect width="24" height="24" rx="4" /></svg></span>
                <span className="text-gray-400 hover:text-white"><svg width="24" height="24" fill="currentColor"><rect width="24" height="24" rx="4" /></svg></span>
              </div>
            </div>
          </div>
          <div className="border-t border-gray-800 pt-8 flex items-center justify-between text-sm text-gray-400">
            <p>© Copyright 2014 - 2024. All Rights Reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function LoadingPage({ asin, market, onDone }) {
  useEffect(() => {
    const timer = setTimeout(onDone, 2000);
    return () => clearTimeout(timer);
  }, [onDone]);
  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* Header */}
      <header className="border-b border-gray-200">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="text-2xl font-bold">
            Seller<span className="text-blue-600">QI</span>
          </div>
          <nav className="hidden md:flex items-center space-x-8">
            <Link to="/pricing" className="text-gray-600 hover:text-gray-900">Pricing</Link>
            <button className="bg-gray-900 text-white px-6 py-2 rounded hover:bg-gray-800">Login</button>
          </nav>
        </div>
      </header>
      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center py-16 px-4">
        <div className="flex flex-col md:flex-row gap-12 w-full max-w-5xl items-center justify-center">
          <div className="w-80 h-80 bg-gray-100 rounded-lg" />
          <div className="flex-1 max-w-lg">
            <h2 className="text-3xl font-bold mb-2">Analyzing your product...</h2>
            <div className="text-gray-500 mb-6">{asin}({market})</div>
            <div className="mb-8">
              <div className="text-gray-700 mb-2">Adding job to queue</div>
              <div className="flex items-center gap-2">
                <div className="h-2 w-24 bg-gray-400 rounded-full" />
                <div className="h-2 w-24 bg-gray-200 rounded-full" />
                <div className="h-2 w-24 bg-gray-200 rounded-full" />
                <div className="h-2 w-24 bg-gray-200 rounded-full" />
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg p-6 flex flex-col gap-2">
              <div className="font-semibold">Want deeper insights ?</div>
              <div className="text-gray-600 text-sm mb-2">Unlock product-specific issues with full solutions in Seller QI Pro</div>
              <button className="bg-[#3B4A6B] text-white px-6 py-2 rounded hover:bg-[#2d3a52] w-max">Get Seller QI Now</button>
            </div>
          </div>
        </div>
      </main>
      {/* Footer */}
      <footer className="bg-[#23253A] text-white py-12 mt-16">
        <div className="container mx-auto px-4">
          <div className="mb-8">
            <div className="text-2xl font-bold mb-4">
              Seller<span className="text-blue-400">QI</span>
            </div>
          </div>
          <div className="grid md:grid-cols-5 gap-8 mb-8">
            <div>
              <h4 className="font-semibold mb-4">Column One</h4>
              <ul className="space-y-2 text-gray-400">
                <li>Twenty One</li>
                <li>Thirty Two</li>
                <li>Fourty Three</li>
                <li>Fifty Four</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Column Two</h4>
              <ul className="space-y-2 text-gray-400">
                <li>Sixty Five</li>
                <li>Seventy Six</li>
                <li>Eighty Seven</li>
                <li>Ninety Eight</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Column Two</h4>
              <ul className="space-y-2 text-gray-400">
                <li>Terms of Use</li>
                <li>Refund Policy</li>
                <li>Privacy Policy</li>
                <li>Ninety Eight</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Join Us</h4>
              <div className="flex gap-4 mt-2">
                <span className="text-gray-400 hover:text-white"><svg width="24" height="24" fill="currentColor"><rect width="24" height="24" rx="4" /></svg></span>
                <span className="text-gray-400 hover:text-white"><svg width="24" height="24" fill="currentColor"><circle cx="12" cy="12" r="10" /></svg></span>
                <span className="text-gray-400 hover:text-white"><svg width="24" height="24" fill="currentColor"><rect width="24" height="24" rx="4" /></svg></span>
                <span className="text-gray-400 hover:text-white"><svg width="24" height="24" fill="currentColor"><rect width="24" height="24" rx="4" /></svg></span>
              </div>
            </div>
          </div>
          <div className="border-t border-gray-800 pt-8 flex items-center justify-between text-sm text-gray-400">
            <p>© Copyright 2014 - 2024. All Rights Reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default function SellerQIHomepage() {
  const [asin, setAsin] = useState('');
  const [market, setMarket] = useState('US');
  const [page, setPage] = useState('home');

  const navigate = useNavigate();

  const loginNavigate = (e) => {
    e.preventDefault();
    navigate('/log-in');
  }

  if (page === 'loading') {
    return <LoadingPage asin={asin} market={market} onDone={() => setPage('results')} />;
  }
  if (page === 'results') {
    return <ResultsPage asin={asin} market={market} />;
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b border-gray-200">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <img src={Logo} alt='SellerQI' className='w-28 h-9' />
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

      {/* Hero Section */}
      <section className="py-20 px-4 bg-gray-50">
        <div className="container mx-auto max-w-4xl text-center">
          <h1 className="text-5xl font-bold mb-12 leading-tight">
            Get a <span className="text-red-500">Free Health Check</span> of Your<br />
            Amazon Product
          </h1>

          <div className="max-w-2xl mx-auto mb-4">
            <div className="relative flex gap-0">
              <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                <input
                  type="text"
                  value={asin}
                  onChange={(e) => setAsin(e.target.value)}
                  placeholder="Enter an Amazon product ASIN  Ex: B08N5WRWNW (US)"
                  className="w-full pl-12 pr-4 py-4 border border-gray-300 rounded-l-lg focus:outline-none focus:border-blue-500"
                />
              </div>
              <select
                className="px-6 py-4 border border-l-0 border-gray-300 rounded-r-lg bg-white focus:outline-none focus:border-blue-500 font-medium"
                value={market}
                onChange={e => setMarket(e.target.value)}
              >
                <option>US</option>
                <option>UK</option>
                <option>CA</option>
              </select>
            </div>
          </div>

          <p className="text-gray-600 mb-8 text-sm">
            Instant analysis • No credit card required • Trusted by 1000+ sellers
          </p>

          <button
            className="bg-[#3B4A6B] text-white px-8 py-3 rounded-lg flex items-center gap-2 mx-auto hover:bg-[#2d3a52] transition-colors"
            onClick={() => setPage('loading')}
          >
            Analyze <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </section>

      {/* Dashboard Preview with iBEX branding */}
      <section className="py-16 bg-white">
        <div className="container mx-auto px-4">
          <div className="bg-white rounded-lg shadow-2xl max-w-6xl mx-auto overflow-hidden">
            {/* Dashboard Image Placeholder */}
            <img
              src="https://res.cloudinary.com/ddoa960le/image/upload/q_auto:good,f_auto,w_1600/v1749025193/Frame_427321615_iltpbn.png"
              alt="Hero Section Banner"
              loading="eager"
              className="w-full h-auto"
            />
          </div>
        </div>
      </section>

      {/* Want the Full Picture Section */}
      <section className="py-20 text-center relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-gray-50 via-white to-gray-50"></div>
        <div className="container mx-auto px-4 relative z-10">
          <h2 className="text-4xl font-bold mb-4">Want the Full Picture?</h2>
          <h3 className="text-3xl mb-6">Unlock <span className="text-red-500">Seller QI PRO</span></h3>
          <p className="text-gray-600 mb-8 max-w-2xl mx-auto text-lg">
            Get detailed issue breakdowns, smart recommendations, and a<br />
            complete Amazon growth toolkit.
          </p>
          <button className="bg-[#3B4A6B] text-white px-8 py-3 rounded-lg flex items-center gap-2 mx-auto hover:bg-[#2d3a52] transition-colors">
            Upgrade to Seller QI PRO <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </section>

      {/* Features Section - Instant Diagnosis */}
      <section className="py-16 bg-gray-50">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-2 gap-12 items-center mb-20">
            <div>
              <h3 className="text-4xl font-bold mb-6 leading-tight">
                Get an instant diagnosis of what's<br />
                hurting your product's<br />
                performance.
              </h3>
              <p className="text-gray-600 mb-6 text-lg">
                SELLER QI scans 100+ data points in seconds and shows exactly what's broken -<br />
                from missing keywords to poor CTR to compliance issues.
              </p>
              <ul className="space-y-3 text-gray-700">
                <li className="flex items-center gap-2">
                  <Check className="w-5 h-5 text-green-500 flex-shrink-0" />
                  Missing bullet points
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-5 h-5 text-green-500 flex-shrink-0" />
                  Low CTR
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-5 h-5 text-green-500 flex-shrink-0" />
                  Keyword indexing errors
                </li>
              </ul>
            </div>

            {/* Dashboard Mockup Image */}
            <div className="bg-white rounded-lg shadow-xl overflow-hidden">
              <img
                src="https://res.cloudinary.com/ddoa960le/image/upload/q_auto:good,f_auto,w_1600/v1749025906/Dashboard_Mockup_k6kxzu.png"
                alt="Dashboard Mockup"
                loading="eager"
                className="w-full h-auto"
              />

            </div>
          </div>

          {/* How to Fix Section */}
          <div className="grid md:grid-cols-2 gap-12 items-center mb-20">
            <div className="bg-white rounded-lg shadow-xl overflow-hidden">
              <img
                src="https://res.cloudinary.com/ddoa960le/image/upload/q_auto:good,f_auto,w_1200/v1749025905/Error_detyz1.png"
                alt="Error Illustration"
                loading="eager"
                className="w-full h-auto"
              />

            </div>

            <div>
              <h3 className="text-4xl font-bold mb-6 leading-tight">
                We don't just show problems,<br />
                We tell you how to fix them.
              </h3>
              <p className="text-gray-600 mb-6 text-lg">
                Every issue comes with a guided fix. Whether it's a listing problem or PPC leak, we<br />
                explain the exact steps to solve it.
              </p>
              <button className="bg-[#3B4A6B] text-white px-6 py-3 rounded-lg flex items-center gap-2 hover:bg-[#2d3a52] transition-all">
                Turn Insights Into Actions Instantly <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Export Insights Section */}
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h3 className="text-4xl font-bold mb-6 leading-tight">
                Export Insights That Matter
              </h3>
              <p className="text-gray-600 mb-6 text-lg">
                Want to track your product performance during Prime Day? Or compare last<br />
                month vs this month? Seller QI lets you select your own date ranges and<br />
                download detailed reports in seconds.
              </p>
              <ul className="space-y-3 text-gray-700">
                <li className="flex items-center gap-2">
                  <Check className="w-5 h-5 text-green-500 flex-shrink-0" />
                  Choose exact date range
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-5 h-5 text-green-500 flex-shrink-0" />
                  Download in 1-click
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-5 h-5 text-green-500 flex-shrink-0" />
                  Perfect for client sharing or internal tracking
                </li>
              </ul>
            </div>

            <div className="bg-white rounded-lg shadow-xl overflow-hidden">
              <img
                src="https://res.cloudinary.com/ddoa960le/image/upload/q_auto:good,f_auto,w_1200/v1749026727/Reports_2_c6clpn.png"
                alt="Reports Section"
                loading="eager"
                className="w-full h-auto"
              />

            </div>
          </div>
        </div>
      </section>

      {/* Pricing Comparison */}
      <section className="py-20 bg-gray-50">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold text-center mb-12">Seller QI LITE vs PRO</h2>

          <div className="max-w-3xl mx-auto">
            <table className="w-full bg-white rounded-lg overflow-hidden shadow-lg">
              <thead>
                <tr className="bg-[#3B4A6B] text-white">
                  <th className="py-4 px-6 text-left">FEATURE</th>
                  <th className="py-4 px-6 text-center">IBEX LITE</th>
                  <th className="py-4 px-6 text-center">IBEX PRO</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b">
                  <td className="py-4 px-6">Product-Level Metrics</td>
                  <td className="py-4 px-6 text-center">
                    <Check className="w-6 h-6 text-green-500 mx-auto" />
                  </td>
                  <td className="py-4 px-6 text-center">
                    <Check className="w-6 h-6 text-green-500 mx-auto" />
                  </td>
                </tr>
                <tr className="border-b bg-gray-50">
                  <td className="py-4 px-6">Account-Level Audit</td>
                  <td className="py-4 px-6 text-center">
                    <X className="w-6 h-6 text-red-500 mx-auto" />
                  </td>
                  <td className="py-4 px-6 text-center">
                    <Check className="w-6 h-6 text-green-500 mx-auto" />
                  </td>
                </tr>
                <tr className="border-b">
                  <td className="py-4 px-6">Issue Breakdown</td>
                  <td className="py-4 px-6 text-center">
                    <X className="w-6 h-6 text-red-500 mx-auto" />
                  </td>
                  <td className="py-4 px-6 text-center">
                    <Check className="w-6 h-6 text-green-500 mx-auto" />
                  </td>
                </tr>
                <tr className="border-b bg-gray-50">
                  <td className="py-4 px-6">"How to Fix" Guides</td>
                  <td className="py-4 px-6 text-center">
                    <X className="w-6 h-6 text-red-500 mx-auto" />
                  </td>
                  <td className="py-4 px-6 text-center">
                    <Check className="w-6 h-6 text-green-500 mx-auto" />
                  </td>
                </tr>
                <tr className="border-b">
                  <td className="py-4 px-6">PDF Reports</td>
                  <td className="py-4 px-6 text-center">
                    <X className="w-6 h-6 text-red-500 mx-auto" />
                  </td>
                  <td className="py-4 px-6 text-center">
                    <Check className="w-6 h-6 text-green-500 mx-auto" />
                  </td>
                </tr>
                <tr className="border-b bg-gray-50">
                  <td className="py-4 px-6">Full Dashboard Access</td>
                  <td className="py-4 px-6 text-center">
                    <X className="w-6 h-6 text-red-500 mx-auto" />
                  </td>
                  <td className="py-4 px-6 text-center">
                    <Check className="w-6 h-6 text-green-500 mx-auto" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* CTA Section with Logo */}
      <section className="py-20 bg-white">
        <div className="container mx-auto px-4 text-center">
          {/* Logo */}
          <div className="mb-8">
            <div className="w-24 h-24 mx-auto bg-black rounded-full flex items-center justify-center">
              <svg className="w-16 h-16" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="30" fill="none" stroke="#FCD34D" strokeWidth="6" strokeDasharray="47 141" />
                <circle cx="50" cy="50" r="30" fill="none" stroke="#EF4444" strokeWidth="6" strokeDasharray="47 141" strokeDashoffset="-47" />
                <circle cx="50" cy="50" r="30" fill="none" stroke="#10B981" strokeWidth="6" strokeDasharray="47 141" strokeDashoffset="-94" />
                <circle cx="50" cy="50" r="30" fill="none" stroke="#FFFFFF" strokeWidth="6" strokeDasharray="47 141" strokeDashoffset="-141" />
                <text x="50" y="58" textAnchor="middle" fill="white" fontSize="24" fontWeight="bold">Q</text>
              </svg>
            </div>
          </div>

          <h2 className="text-3xl font-bold mb-8">
            Start Free, Upgrade Only When You're<br />
            Ready
          </h2>
          <button className="bg-[#3B4A6B] text-white px-8 py-3 rounded-lg flex items-center gap-2 mx-auto hover:bg-[#2d3a52] transition-colors">
            Upgrade to Seller QI PRO <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-12">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-5 gap-8 mb-8">
            <div>
              <h3 className="text-2xl font-bold mb-4">
                Seller<span className="text-blue-400">QI</span>
              </h3>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Product Info</h4>
              <ul className="space-y-2 text-gray-400">
                <li><a href="#" className="hover:text-white">Features</a></li>
                <li><a href="#" className="hover:text-white">Pricing</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Contact Info</h4>
              <ul className="space-y-2 text-gray-400">
                <li><a href="#" className="hover:text-white">About Us</a></li>
                <li><a href="#" className="hover:text-white">Contact</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Column One</h4>
              <ul className="space-y-2 text-gray-400">
                <li>Twenty One</li>
                <li>Thirty Two</li>
                <li>Fourty Three</li>
                <li>Fifty Four</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Column Two</h4>
              <ul className="space-y-2 text-gray-400">
                <li>Sixty Five</li>
                <li>Seventy Six</li>
                <li>Eighty Seven</li>
                <li>Ninety Eight</li>
              </ul>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-4 py-8 border-t border-gray-800 text-sm text-gray-400">
            <div><a href="#" className="hover:text-white">Terms of Use</a></div>
            <div><a href="#" className="hover:text-white">Refund Policy</a></div>
            <div><a href="#" className="hover:text-white">Privacy Policy</a></div>
          </div>

          <div className="border-t border-gray-800 pt-8 flex items-center justify-between">
            <p className="text-gray-400">
              © Copyright 2014 - 2024. All Rights Reserved.
            </p>
            <div className="flex gap-4">
              <a href="#" className="text-gray-400 hover:text-white">
                <LuFacebook className="w-5 h-5" />
              </a>
              <a href="#" className="text-gray-400 hover:text-white">
                <BsTwitterX className="w-5 h-5" />
              </a>
              <a href="#" className="text-gray-400 hover:text-white">
                <AiOutlineLinkedin className="w-5 h-5" />
              </a>
            </div>
          </div>
        </div>
      </footer>

      {/* Help Widget */}
      <div className="fixed bottom-8 right-8">
        <button className="w-14 h-14 bg-yellow-400 rounded-full shadow-lg hover:bg-yellow-500 transition-colors flex items-center justify-center group">
          <span className="text-2xl font-bold text-gray-900">?</span>
        </button>
      </div>
    </div>
  );
}