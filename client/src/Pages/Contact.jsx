import React, { useState, useEffect } from 'react';
import Navbar from '../Components/Navigation/Navbar';
import Footer from '../Components/Navigation/Footer';
import { LuFacebook } from "react-icons/lu";
import { BsTwitterX } from "react-icons/bs";
import { AiOutlineLinkedin } from "react-icons/ai";

export default function ContactPage() {
  const [form, setForm] = useState({ name: '', email: '', subject: '', message: '', helpType: 'Other' });
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    // Here you would handle form submission (e.g., send to API)
    setSubmitted(true);
  };

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <Navbar />
      
      <main className="flex-1 container mx-auto px-4 py-16 max-w-3xl">
        <h1 className="text-4xl font-bold mb-6 text-center">Contact Us</h1>
        <p className="text-gray-600 text-center mb-10 max-w-xl mx-auto">
          Have a question, feedback, or need support? Fill out the form below and our team will get back to you as soon as possible.
        </p>
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-2xl mx-auto">
          {submitted ? (
            <div className="text-center text-green-600 text-lg font-semibold py-12">
              Thank you for reaching out! We have received your message and will get back to you soon.
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-gray-700 font-medium mb-2">How can we help you?</label>
                <select
                  name="helpType"
                  value={form.helpType}
                  onChange={handleChange}
                  className="w-full border border-gray-300 rounded px-4 py-3 focus:outline-none focus:border-blue-500"
                  required
                >
                  <option value="">Please tell us what your message is about...</option>
                  <option value="GTmetrix PRO">I have a question about SellerQI PRO</option>
                  <option value="Optimization Help">I need product optimization help</option>
                  <option value="Fails to Test">SellerQI fails to analyze my product</option>
                  <option value="Report Bug">I want to report a bug in SellerQI</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-gray-700 font-medium mb-2">Name</label>
                  <input
                    type="text"
                    name="name"
                    value={form.name}
                    onChange={handleChange}
                    required
                    className="w-full border border-gray-300 rounded px-4 py-3 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-gray-700 font-medium mb-2">Email</label>
                  <input
                    type="email"
                    name="email"
                    value={form.email}
                    onChange={handleChange}
                    required
                    className="w-full border border-gray-300 rounded px-4 py-3 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-gray-700 font-medium mb-2">Subject</label>
                <input
                  type="text"
                  name="subject"
                  value={form.subject}
                  onChange={handleChange}
                  required
                  className="w-full border border-gray-300 rounded px-4 py-3 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-gray-700 font-medium mb-2">Message</label>
                <textarea
                  name="message"
                  value={form.message}
                  onChange={handleChange}
                  required
                  rows={6}
                  className="w-full border border-gray-300 rounded px-4 py-3 focus:outline-none focus:border-blue-500"
                />
              </div>
              <button
                type="submit"
                className="w-full bg-[#23253A] text-white font-semibold py-3 rounded hover:bg-[#2d3a52] transition-colors text-lg shadow-md"
              >
                Send Message
              </button>
            </form>
          )}
          <div className="mt-10 border-t pt-8 text-gray-600 text-sm">
            <div className="mb-2 font-semibold">Email:</div>
            <a href="mailto:support@sellerqi.com" className="text-blue-600 hover:underline">support@sellerqi.com</a>
            <div className="mt-4 mb-2 font-semibold">Address:</div>
            <div>15233 Ventura Blvd Suite 500, Sherman Oaks, CA 91403</div>
            <div className="mt-4 flex gap-4">
              <a href="#" className="text-gray-400 hover:text-blue-600" aria-label="Facebook">
                <LuFacebook className="w-6 h-6" />
              </a>
              <a href="#" className="text-gray-400 hover:text-blue-600" aria-label="Twitter">
                <BsTwitterX className="w-6 h-6" />
              </a>
              <a href="#" className="text-gray-400 hover:text-blue-600" aria-label="LinkedIn">
                <AiOutlineLinkedin className="w-6 h-6" />
              </a>
            </div>
          </div>
        </div>
      </main>
      
      {/* Footer */}
      <Footer />
    </div>
  );
}