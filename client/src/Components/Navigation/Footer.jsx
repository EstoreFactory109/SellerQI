import React from 'react';
import { Link } from 'react-router-dom';
import { LuFacebook } from "react-icons/lu";
import { BsTwitterX } from "react-icons/bs";
import { AiOutlineLinkedin } from "react-icons/ai";

export default function Footer() {
  return (
    <footer className="bg-gray-900 text-white py-12">
      <div className="container mx-auto px-4">
        <div className="grid md:grid-cols-4 gap-8 mb-8">
          <div>
            <img 
              src="https://res.cloudinary.com/ddoa960le/image/upload/v1749393210/bg-white-logo_xrtck2.png"
              alt="SellerQI Logo"
              className="h-10 w-auto"
              loading="lazy"
              width="120"
              height="40"
            />
          </div>
          <div>
            <h4 className="font-semibold mb-4">Product Info</h4>
            <ul className="space-y-2 text-gray-400">
              <li><Link to="/features" className="hover:text-white">Features</Link></li>
              <li><Link to="/pricing" className="hover:text-white">Pricing</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold mb-4">Contact Info</h4>
            <ul className="space-y-2 text-gray-400">
              <li><Link to="/about-us" className="hover:text-white">About Us</Link></li>
              <li><Link to="/contact-us" className="hover:text-white">Contact</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold mb-4">Follow Us</h4>
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

        <div className="flex justify-center items-center gap-8 py-8 border-t border-gray-800 text-sm text-gray-400">
          <Link to="/terms-of-use" className="hover:text-white">Terms of Use</Link>
          <span className="text-gray-600">|</span>
          <Link to="/refund-policy" className="hover:text-white">Refund Policy</Link>
          <span className="text-gray-600">|</span>
          <Link to='/privacy-policy' className="hover:text-white">Privacy Policy</Link>
        </div>

        <div className="border-t border-gray-800 pt-8 flex items-center justify-center">
          <p className="text-gray-400">
            © Copyright 2014 - 2024. All Rights Reserved.
          </p>
        </div>
      </div>
    </footer>
  );
} 