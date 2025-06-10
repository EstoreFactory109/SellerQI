import React, { useState } from 'react';
import Navbar from '../Components/Navigation/Navbar';
import Footer from '../Components/Navigation/Footer';

export default function ContactPage() {
  const [form, setForm] = useState({ name: '', email: '', subject: '', message: '', helpType: 'Other' });
  const [submitted, setSubmitted] = useState(false);

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
            <div>123 SellerQI Lane, Suite 100, New York, NY 10001</div>
            <div className="mt-4 flex gap-4">
              <a href="#" className="text-gray-400 hover:text-blue-600" aria-label="Facebook">
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
              </a>
              <a href="#" className="text-gray-400 hover:text-blue-600" aria-label="Twitter">
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z"/></svg>
              </a>
              <a href="#" className="text-gray-400 hover:text-blue-600" aria-label="LinkedIn">
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
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