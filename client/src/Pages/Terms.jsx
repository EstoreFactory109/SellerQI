import React from 'react';
import Navbar from '../Components/Navigation/Navbar';
import Footer from '../Components/Navigation/Footer';

export default function TermsAndConditions() {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <Navbar />

      <main className="flex-1 container mx-auto px-4 py-12 max-w-4xl">
        <h1 className="text-4xl font-bold mb-8">Terms and Conditions</h1>
        
        <div className="prose prose-lg max-w-none">
          <p className="text-gray-600 mb-6">Last updated: {new Date().toLocaleDateString()}</p>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">1. Agreement to Terms</h2>
            <p className="mb-4">
              By accessing and using SellerQI's services, you agree to be bound by these Terms and Conditions. If you disagree with any part of these terms, you may not access our services.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">2. Use License</h2>
            <p className="mb-4">Permission is granted to temporarily access our services for personal, non-commercial transitory viewing only. This is the grant of a license, not a transfer of title, and under this license you may not:</p>
            <ul className="list-disc pl-6 mb-4">
              <li>Modify or copy the materials</li>
              <li>Use the materials for any commercial purpose</li>
              <li>Attempt to decompile or reverse engineer any software contained in our services</li>
              <li>Remove any copyright or other proprietary notations from the materials</li>
              <li>Transfer the materials to another person or "mirror" the materials on any other server</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">3. User Account</h2>
            <p className="mb-4">When you create an account with us, you must provide accurate, complete, and current information. Failure to do so constitutes a breach of the Terms, which may result in immediate termination of your account.</p>
            <p className="mb-4">You are responsible for safeguarding the password and for all activities that occur under your account. You agree not to disclose your password to any third party.</p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">4. Subscription and Payments</h2>
            <p className="mb-4">Some parts of our service are billed on a subscription basis. You will be billed in advance on a recurring and periodic basis, depending on the type of subscription plan you select.</p>
            <p className="mb-4">At the end of each billing period, your subscription will automatically renew under the same conditions unless you cancel it or SellerQI cancels it.</p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">5. Intellectual Property</h2>
            <p className="mb-4">
              The Service and its original content, features, and functionality are and will remain the exclusive property of SellerQI and its licensors. The Service is protected by copyright, trademark, and other laws.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">6. Limitation of Liability</h2>
            <p className="mb-4">
              In no event shall SellerQI, nor its directors, employees, partners, agents, suppliers, or affiliates, be liable for any indirect, incidental, special, consequential or punitive damages, including without limitation, loss of profits, data, use, goodwill, or other intangible losses.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">7. Changes to Terms</h2>
            <p className="mb-4">
              We reserve the right, at our sole discretion, to modify or replace these Terms at any time. If a revision is material, we will provide at least 30 days' notice prior to any new terms taking effect.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">8. Contact Us</h2>
            <p className="mb-4">
              If you have any questions about these Terms, please contact us at:
            </p>
            <p className="mb-4">
              Email: terms@sellerqi.com<br />
              Address: [Your Company Address]
            </p>
          </section>
        </div>
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
}