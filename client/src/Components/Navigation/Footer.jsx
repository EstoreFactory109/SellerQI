import React from 'react';
import { Link } from 'react-router-dom';
import { LuFacebook } from "react-icons/lu";
import { BsTwitterX } from "react-icons/bs";
import { AiOutlineLinkedin } from "react-icons/ai";

export default function Footer() {
  return (
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
              <li><Link to="/contact-us" className="hover:text-white">Contact</Link></li>
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
          <div><Link to="/terms-of-use" className="hover:text-white">Terms of Use</Link></div>
          <div><Link to="#" className="hover:text-white">Refund Policy</Link></div>
          <div><Link to='/privacy-policy' className="hover:text-white">Privacy Policy</Link></div>
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
  );
} 