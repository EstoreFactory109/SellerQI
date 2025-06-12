import React, { useEffect } from 'react';
import Navbar from '../Components/Navigation/Navbar';
import Footer from '../Components/Navigation/Footer';

export default function ReturnsRefundsPolicy() {
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <Navbar />

      <main className="flex-1 container mx-auto px-4 py-12 max-w-4xl">
        <h1 className="text-4xl font-bold mb-8">Returns and Refunds Policy</h1>
        
        <div className="prose prose-lg max-w-none">
          <p className="text-gray-600 mb-6">Last updated: {new Date().toLocaleDateString()}</p>

          <section className="mb-8">
            <p className="mb-4">
              <strong>Thank you for shopping at SellerQI.</strong>
            </p>
            <p className="mb-4">
              Please read this policy carefully. This is the Return and Refund Policy of SellerQI. The Return and Refund Policy for eStore Factory has been created with the help of TermsFeed.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">Digital Products</h2>
            <p className="mb-4">
              We issue refunds for digital products within 7 days of the original purchase of the product. We recommend contacting us for assistance if you are not satisfied with the work done on your website or Amazon seller account.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">Contact Us</h2>
            <p className="mb-4">
              If you have any questions about our Returns and Refunds Policy, please contact us:
            </p>
            <p className="mb-4">
              <strong>Phone Number : +1 (818) 350-5302</strong><br />
              <strong>(Mon-Sat India Time, 9:30 AM – 7:30 PM)</strong>
            </p>
          </section>
        </div>
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
}