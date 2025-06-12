import React, { useEffect } from 'react';
import Navbar from '../Components/Navigation/Navbar';
import Footer from '../Components/Navigation/Footer';

export default function TermsAndConditions() {
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <Navbar />

      <main className="flex-1 container mx-auto px-4 py-12 max-w-4xl">

        <div className="font-sans mx-5 my-5 max-w-4xl leading-relaxed">
          <h1 className="text-3xl font-bold text-gray-800 mb-4">SellerQi Terms & Conditions</h1>

          <p className="mb-4">
            <strong className="font-semibold">Effective Date:</strong> 01/06/2025<br />
            <strong className="font-semibold">Last Updated:</strong> 11 June 2025
          </p>

          <p className="mb-4 p-4 bg-yellow-50 border-l-4 border-yellow-400">
            <strong className="font-semibold">IMPORTANT NOTICE:</strong> PLEASE READ THESE TERMS OF USE CAREFULLY.
            By accessing or using our Services, you agree to be legally bound by these Terms & Conditions.
            If you do not agree to these Terms, you may not access or use our Services.
          </p>

          <p className="mb-6 p-4 bg-red-50 border-l-4 border-red-400">
            <strong className="font-semibold">ARBITRATION NOTICE:</strong> These Terms contain an arbitration clause
            and class action waiver in Section 15. By agreeing to these Terms, you agree to resolve all disputes
            through binding individual arbitration, which means you waive any right to have disputes decided by a
            judge or jury, and you waive your right to participate in class actions, class arbitrations, or
            representative actions. You have the right to opt-out of arbitration as explained in Section 15.
          </p>

          <h2 className="text-2xl font-semibold text-gray-800 mt-6 mb-3">1. AGREEMENT AND ACCEPTANCE</h2>
          
          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">1.1 The Agreement</h3>
          <p className="mb-4">
            These Terms & Conditions ("Terms") constitute a legally binding agreement between you ("you," "your," "User," or "Customer") 
            and SellerQi, a Delaware corporation ("SellerQi," "we," "us," or "our"). These Terms govern your use of our website 
            located at https://www.sellerqi.com (the "Site"), our platform, analytics tools, applications, browser extensions, 
            APIs, and all other products and services we offer (collectively, the "Services").
          </p>

          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">1.2 Additional Terms</h3>
          <p className="mb-2">Your use of our Services is also governed by:</p>
          <ul className="list-disc list-inside mb-4 ml-4">
            <li>Our Privacy Policy</li>
            <li>Any subscription or order forms you complete</li>
            <li>Any additional terms for specific features or services</li>
            <li>Community guidelines or policies posted on our Services</li>
          </ul>
          <p className="mb-4">All of these documents are incorporated by reference and form part of the Agreement between you and SellerQi.</p>

          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">1.3 Acceptance</h3>
          <p className="mb-2">By accessing or using our Services, you:</p>
          <ul className="list-disc list-inside mb-4 ml-4">
            <li>Acknowledge that you have read and understood these Terms</li>
            <li>Agree to be bound by these Terms and all incorporated documents</li>
            <li>Represent that you are at least 18 years old or the age of majority in your jurisdiction</li>
            <li>If using on behalf of an entity, represent that you have authority to bind that entity</li>
          </ul>

          <h2 className="text-2xl font-semibold text-gray-800 mt-6 mb-3">2. ACCOUNT REGISTRATION AND SECURITY</h2>
          
          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">2.1 Account Requirements</h3>
          <p className="mb-2">To access most features of our Services, you must create an account. You agree to:</p>
          <ul className="list-disc list-inside mb-4 ml-4">
            <li>Provide accurate, current, and complete information</li>
            <li>Maintain and promptly update your account information</li>
            <li>Create your account manually without automated means</li>
            <li>Not create accounts for others without permission</li>
            <li>Not sell, trade, or transfer your account</li>
          </ul>

          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">2.2 Account Security</h3>
          <p className="mb-2">You are responsible for:</p>
          <ul className="list-disc list-inside mb-4 ml-4">
            <li>Maintaining the confidentiality of your login credentials</li>
            <li>All activities that occur under your account</li>
            <li>Immediately notifying us of any unauthorized use</li>
            <li>Ensuring no unauthorized access to your account</li>
          </ul>
          <p className="mb-4">We are not liable for any loss or damage from your failure to comply with these security obligations.</p>

          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">2.3 Account Ownership</h3>
          <p className="mb-4">
            The person or entity whose payment method is charged is the Account Owner and has full control over the account. 
            Unless your subscription explicitly includes multi-user access, accounts are for single use only and may not be shared.
          </p>

          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">2.4 Business Use Only</h3>
          <p className="mb-4">
            Our Services are designed for business use. By using our Services, you represent that you are using them for 
            business purposes and not for personal, family, or household use.
          </p>

          <h2 className="text-2xl font-semibold text-gray-800 mt-6 mb-3">3. SUBSCRIPTIONS AND PAYMENT</h2>
          
          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">3.1 Subscription Plans</h3>
          <p className="mb-2">We offer various subscription plans, including:</p>
          <ul className="list-disc list-inside mb-4 ml-4">
            <li>Monthly recurring subscriptions</li>
            <li>Annual recurring subscriptions</li>
            <li>Custom enterprise plans</li>
            <li>Free trial periods (where offered)</li>
          </ul>

          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">3.2 Billing and Renewal</h3>
          <ul className="list-disc list-inside mb-4 ml-4">
            <li><strong>Automatic Renewal:</strong> Subscriptions automatically renew unless cancelled</li>
            <li><strong>Billing Cycle:</strong> You will be charged on your subscription start date and each renewal date</li>
            <li><strong>Payment Methods:</strong> You must provide valid payment information</li>
            <li><strong>Failed Payments:</strong> We may suspend access if payment fails</li>
          </ul>

          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">3.3 Cancellation</h3>
          <ul className="list-disc list-inside mb-4 ml-4">
            <li>You may cancel anytime before your next billing date</li>
            <li>Cancellation takes effect at the end of the current billing period</li>
            <li>You retain access until the end of your paid period</li>
            <li>No refunds for partial periods</li>
          </ul>

          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">3.4 Refund Policy</h3>
          <ul className="list-disc list-inside mb-4 ml-4">
            <li><strong>7-Day Money Back Guarantee:</strong> Full refund if requested within 7 days of initial purchase</li>
            <li><strong>No Other Refunds:</strong> No refunds for renewals or after 7 days</li>
            <li><strong>How to Request:</strong> Email support@sellerqi.com within 7 days</li>
          </ul>

          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">3.5 Price Changes</h3>
          <p className="mb-4">
            We reserve the right to change prices with notice. Price changes will apply to new billing periods after notice is provided.
          </p>

          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">3.6 Taxes</h3>
          <p className="mb-4">
            You are responsible for all applicable taxes. Prices do not include taxes unless stated otherwise.
          </p>

          <h2 className="text-2xl font-semibold text-gray-800 mt-6 mb-3">4. USE OF SERVICES</h2>
          
          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">4.1 License Grant</h3>
          <p className="mb-4">
            Subject to these Terms, we grant you a limited, non-exclusive, non-transferable, revocable license to access 
            and use our Services for your internal business purposes.
          </p>

          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">4.2 Acceptable Use</h3>
          <p className="mb-2">
            You agree to use our Services only for lawful purposes and in accordance with these Terms. You agree not to use our Services:
          </p>
          <ul className="list-disc list-inside mb-4 ml-4">
            <li>In any way that violates any applicable law or regulation</li>
            <li>To transmit any harmful or malicious code</li>
            <li>In any manner that could disable, overburden, or impair our Services</li>
            <li>To attempt unauthorized access to any portion of our Services</li>
          </ul>

          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">4.3 Prohibited Activities</h3>
          <p className="mb-2">You shall not:</p>
          <ul className="list-disc list-inside mb-4 ml-4">
            <li>Reverse engineer, decompile, or disassemble our Services</li>
            <li>Copy, modify, or create derivative works of our Services</li>
            <li>Resell, sublicense, or transfer our Services to third parties</li>
            <li>Use automated means to access our Services (except our API where permitted)</li>
            <li>Remove or alter any proprietary notices</li>
            <li>Use our Services to compete with us</li>
            <li>Share your account credentials</li>
            <li>Misrepresent your identity or affiliation</li>
            <li>Interfere with other users' use of the Services</li>
            <li>Collect or harvest data from our Services</li>
            <li>Use our Services for illegal or unauthorized purposes</li>
          </ul>

          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">4.4 API Usage</h3>
          <p className="mb-2">If we provide API access:</p>
          <ul className="list-disc list-inside mb-4 ml-4">
            <li>You must comply with our API documentation and limits</li>
            <li>We may throttle or limit API calls</li>
            <li>You may not use the API to substantially replicate our Services</li>
            <li>We may modify or discontinue API access at any time</li>
          </ul>

          <h2 className="text-2xl font-semibold text-gray-800 mt-6 mb-3">5. THIRD-PARTY INTEGRATIONS</h2>
          
          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">5.1 Third-Party Platforms</h3>
          <p className="mb-2">Our Services may integrate with third-party platforms including:</p>
          <ul className="list-disc list-inside mb-4 ml-4">
            <li>Amazon Seller Central</li>
            <li>Other e-commerce marketplaces</li>
            <li>Payment processors</li>
            <li>Analytics services</li>
            <li>Social media platforms</li>
          </ul>

          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">5.2 Authorization</h3>
          <p className="mb-2">By connecting third-party accounts, you:</p>
          <ul className="list-disc list-inside mb-4 ml-4">
            <li>Authorize us to access your accounts as necessary for our Services</li>
            <li>Represent that you have the right to grant such access</li>
            <li>Acknowledge we are not responsible for third-party platforms</li>
            <li>Agree to comply with third-party terms of service</li>
          </ul>

          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">5.3 Data from Third Parties</h3>
          <p className="mb-2">You grant us the right to:</p>
          <ul className="list-disc list-inside mb-4 ml-4">
            <li>Collect and analyze data from connected accounts</li>
            <li>Use such data to provide and improve our Services</li>
            <li>Generate aggregated insights and analytics</li>
            <li>Store and process data as described in our Privacy Policy</li>
          </ul>

          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">5.4 No Endorsement</h3>
          <p className="mb-4">
            We are not affiliated with, endorsed by, or sponsored by any third-party platforms unless explicitly stated.
          </p>

          <h2 className="text-2xl font-semibold text-gray-800 mt-6 mb-3">6. INTELLECTUAL PROPERTY</h2>
          
          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">6.1 Our Property</h3>
          <p className="mb-2">All rights, title, and interest in and to the Services, including:</p>
          <ul className="list-disc list-inside mb-4 ml-4">
            <li>Software, code, and algorithms</li>
            <li>Designs, graphics, and user interfaces</li>
            <li>Content, text, and documentation</li>
            <li>Trademarks, logos, and branding</li>
            <li>Data compilations and databases</li>
            <li>Analytics methodologies and insights</li>
          </ul>
          <p className="mb-4">Are and remain the exclusive property of SellerQi or our licensors.</p>

          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">6.2 Your Content</h3>
          <p className="mb-2">
            You retain ownership of content you submit to our Services ("User Content"). By submitting User Content, 
            you grant us a worldwide, non-exclusive, royalty-free license to:
          </p>
          <ul className="list-disc list-inside mb-4 ml-4">
            <li>Use, reproduce, and display User Content to provide our Services</li>
            <li>Create aggregated or anonymized data</li>
            <li>Improve and develop our Services</li>
          </ul>

          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">6.3 Feedback</h3>
          <p className="mb-4">
            Any feedback, suggestions, or ideas you provide become our property. We may use feedback without compensation or attribution.
          </p>

          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">6.4 Copyright Infringement</h3>
          <p className="mb-2">We respect intellectual property rights. To report copyright infringement:</p>
          <ul className="list-disc list-inside mb-4 ml-4">
            <li>Send notice to: legal@sellerqi.com</li>
            <li>Include all information required by the DMCA</li>
            <li>We will respond in accordance with applicable law</li>
          </ul>

          <h2 className="text-2xl font-semibold text-gray-800 mt-6 mb-3">7. PRIVACY AND DATA</h2>
          
          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">7.1 Privacy Policy</h3>
          <p className="mb-4">
            Our Privacy Policy governs how we collect, use, and protect your information. By using our Services, 
            you agree to our data practices as described in the Privacy Policy.
          </p>

          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">7.2 Data Processing</h3>
          <p className="mb-2">You acknowledge that:</p>
          <ul className="list-disc list-inside mb-4 ml-4">
            <li>We process data as a service provider</li>
            <li>You are responsible for the legality of data you provide</li>
            <li>We may aggregate and anonymize data for our business purposes</li>
            <li>We implement reasonable security measures</li>
          </ul>

          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">7.3 Customer Data</h3>
          <p className="mb-2">For data about your customers that you provide:</p>
          <ul className="list-disc list-inside mb-4 ml-4">
            <li>You represent you have all necessary rights and consents</li>
            <li>You remain the owner of such data</li>
            <li>We will only use it to provide Services</li>
            <li>We will not sell customer data</li>
          </ul>

          <h2 className="text-2xl font-semibold text-gray-800 mt-6 mb-3">8. WARRANTIES AND DISCLAIMERS</h2>
          
          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">8.1 Our Services</h3>
          <p className="mb-2 uppercase">
            THE SERVICES ARE PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED. 
            WE DISCLAIM ALL WARRANTIES INCLUDING:
          </p>
          <ul className="list-disc list-inside mb-4 ml-4 uppercase">
            <li>MERCHANTABILITY</li>
            <li>FITNESS FOR A PARTICULAR PURPOSE</li>
            <li>NON-INFRINGEMENT</li>
            <li>ACCURACY OR RELIABILITY OF INFORMATION</li>
            <li>UNINTERRUPTED OR ERROR-FREE OPERATION</li>
          </ul>

          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">8.2 No Guarantee of Results</h3>
          <p className="mb-2 uppercase">WE DO NOT GUARANTEE:</p>
          <ul className="list-disc list-inside mb-4 ml-4">
            <li>Any specific business results or outcomes</li>
            <li>Accuracy of data or analytics</li>
            <li>Increased sales or revenue</li>
            <li>Success on any platform</li>
            <li>Compatibility with all systems</li>
          </ul>

          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">8.3 Third-Party Content</h3>
          <p className="mb-4">
            We are not responsible for third-party content, services, or platforms accessed through our Services.
          </p>

          <h2 className="text-2xl font-semibold text-gray-800 mt-6 mb-3">9. LIMITATION OF LIABILITY</h2>
          
          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">9.1 Exclusion of Damages</h3>
          <p className="mb-2 uppercase">
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, SELLERQI SHALL NOT BE LIABLE FOR:
          </p>
          <ul className="list-disc list-inside mb-4 ml-4 uppercase">
            <li>INDIRECT, INCIDENTAL, SPECIAL, OR CONSEQUENTIAL DAMAGES</li>
            <li>LOST PROFITS, REVENUE, OR BUSINESS OPPORTUNITIES</li>
            <li>LOSS OF DATA OR BUSINESS INTERRUPTION</li>
            <li>PUNITIVE OR EXEMPLARY DAMAGES</li>
          </ul>

          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">9.2 Cap on Liability</h3>
          <p className="mb-2 uppercase">OUR TOTAL LIABILITY FOR ALL CLAIMS SHALL NOT EXCEED THE GREATER OF:</p>
          <ul className="list-disc list-inside mb-4 ml-4 uppercase">
            <li>THE AMOUNT YOU PAID US IN THE 6 MONTHS BEFORE THE CLAIM</li>
            <li>$100 USD</li>
          </ul>

          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">9.3 Basis of Bargain</h3>
          <p className="mb-4">
            You acknowledge these limitations are an essential element of our agreement and we would not provide 
            the Services without them.
          </p>

          <h2 className="text-2xl font-semibold text-gray-800 mt-6 mb-3">10. INDEMNIFICATION</h2>
          <p className="mb-2">
            You agree to indemnify, defend, and hold harmless SellerQi and our officers, directors, employees, 
            agents, and affiliates from any claims, damages, losses, liabilities, and expenses (including attorneys' fees) 
            arising from:
          </p>
          <ul className="list-disc list-inside mb-4 ml-4">
            <li>Your use of the Services</li>
            <li>Your violation of these Terms</li>
            <li>Your violation of any rights of another</li>
            <li>Your User Content</li>
            <li>Your violation of any applicable laws</li>
            <li>Any misrepresentation by you</li>
            <li>Unauthorized use of your account</li>
          </ul>

          <h2 className="text-2xl font-semibold text-gray-800 mt-6 mb-3">11. TERM AND TERMINATION</h2>
          
          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">11.1 Term</h3>
          <p className="mb-4">
            These Terms are effective when you first access the Services and continue until terminated.
          </p>

          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">11.2 Termination by You</h3>
          <p className="mb-2">You may terminate by:</p>
          <ul className="list-disc list-inside mb-4 ml-4">
            <li>Cancelling your subscription</li>
            <li>Deleting your account</li>
            <li>Ceasing use of the Services</li>
          </ul>

          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">11.3 Termination by Us</h3>
          <p className="mb-2">We may terminate or suspend your access:</p>
          <ul className="list-disc list-inside mb-4 ml-4">
            <li>For violation of these Terms</li>
            <li>For non-payment</li>
            <li>For fraudulent or illegal activity</li>
            <li>For any reason with 30 days' notice</li>
            <li>Immediately for cause</li>
          </ul>

          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">11.4 Effect of Termination</h3>
          <p className="mb-2">Upon termination:</p>
          <ul className="list-disc list-inside mb-4 ml-4">
            <li>Your license to use the Services ends</li>
            <li>You must cease all use of the Services</li>
            <li>We may delete your data after a reasonable period</li>
            <li>Provisions that should survive will remain in effect</li>
          </ul>

          <h2 className="text-2xl font-semibold text-gray-800 mt-6 mb-3">12. MODIFICATIONS</h2>
          
          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">12.1 To These Terms</h3>
          <p className="mb-2">We may modify these Terms at any time. We will notify you of material changes via:</p>
          <ul className="list-disc list-inside mb-4 ml-4">
            <li>Email notification</li>
            <li>In-Service notification</li>
            <li>Website posting</li>
          </ul>
          <p className="mb-4">Continued use after changes constitutes acceptance.</p>

          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">12.2 To Services</h3>
          <p className="mb-4">
            We may modify, suspend, or discontinue any aspect of the Services at any time without liability.
          </p>

          <h2 className="text-2xl font-semibold text-gray-800 mt-6 mb-3">13. COMMUNICATIONS</h2>
          
          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">13.1 Electronic Communications</h3>
          <p className="mb-4">
            You consent to receive electronic communications from us. Electronic communications satisfy any legal 
            requirement for written communications.
          </p>

          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">13.2 Marketing Communications</h3>
          <p className="mb-4">
            You may opt out of marketing communications but not Service-related communications.
          </p>

          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">13.3 Notice to Us</h3>
          <p className="mb-2">Send notices to:</p>
          <div className="mb-4 ml-4">
            <p>Email: support@sellerqi.com</p>
            <p>Mail: SellerQi, 15233 Ventura Blvd Suite 500, Sherman Oaks, CA 91403</p>
            <p>Attn: Legal Department</p>
          </div>

          <h2 className="text-2xl font-semibold text-gray-800 mt-6 mb-3">14. INTERNATIONAL USE</h2>
          
          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">14.1 US-Based Services</h3>
          <p className="mb-4">
            Our Services are operated from the United States. We make no representation that the Services are 
            appropriate or available in other locations.
          </p>

          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">14.2 Export Controls</h3>
          <p className="mb-4">
            You may not use the Services in violation of U.S. export laws and regulations.
          </p>

          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">14.3 International Users</h3>
          <p className="mb-4">
            If you access the Services from outside the U.S., you are responsible for compliance with local laws.
          </p>

          <h2 className="text-2xl font-semibold text-gray-800 mt-6 mb-3">15. DISPUTE RESOLUTION</h2>
          
          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">15.1 Informal Resolution</h3>
          <p className="mb-4">
            Before filing any legal action, you agree to attempt to resolve disputes informally by contacting support@sellerqi.com.
          </p>

          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">15.2 Binding Arbitration</h3>
          <p className="mb-2 uppercase font-semibold">PLEASE READ CAREFULLY - THIS AFFECTS YOUR LEGAL RIGHTS</p>
          <p className="mb-2">Any disputes not resolved informally shall be resolved through binding arbitration:</p>
          <ul className="list-disc list-inside mb-4 ml-4">
            <li><strong>Arbitrator:</strong> JAMS or AAA</li>
            <li><strong>Rules:</strong> JAMS Comprehensive Rules or AAA Commercial Rules</li>
            <li><strong>Location:</strong> Delaware (or your location for claims under $10,000)</li>
          </ul>

          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">15.3 Class Action Waiver</h3>
          <p className="mb-4 uppercase">
            YOU WAIVE ANY RIGHT TO PARTICIPATE IN CLASS ACTIONS. All disputes must be brought in your individual capacity.
          </p>

          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">15.4 Opt-Out</h3>
          <p className="mb-2">
            You may opt out of arbitration by notifying us in writing within 30 days of first accepting these Terms at:
          </p>
          <div className="mb-4 ml-4">
            <p>SellerQi</p>
            <p>15233 Ventura Blvd Suite 500, Sherman Oaks, CA 91403</p>
            <p>Attn: Legal - Arbitration Opt-Out</p>
          </div>

          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">15.5 Exceptions</h3>
          <p className="mb-2">The following are excluded from arbitration:</p>
          <ul className="list-disc list-inside mb-4 ml-4">
            <li>Small claims court actions</li>
            <li>Injunctive relief for IP violations</li>
            <li>Claims that cannot be arbitrated under applicable law</li>
          </ul>

          <h2 className="text-2xl font-semibold text-gray-800 mt-6 mb-3">16. GENERAL PROVISIONS</h2>
          
          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">16.1 Governing Law</h3>
          <p className="mb-4">
            These Terms are governed by Delaware law without regard to conflict of law principles.
          </p>

          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">16.2 Venue</h3>
          <p className="mb-4">
            Any disputes not subject to arbitration shall be brought in Delaware courts.
          </p>

          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">16.3 Entire Agreement</h3>
          <p className="mb-4">
            These Terms and incorporated documents constitute the entire agreement between us.
          </p>

          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">16.4 Severability</h3>
          <p className="mb-4">
            If any provision is unenforceable, the remaining provisions continue in effect.
          </p>

          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">16.5 No Waiver</h3>
          <p className="mb-4">
            Our failure to enforce any right is not a waiver of that right.
          </p>

          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">16.6 Assignment</h3>
          <p className="mb-4">
            You may not assign these Terms. We may assign our rights and obligations.
          </p>

          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">16.7 Force Majeure</h3>
          <p className="mb-4">
            We are not liable for failures beyond our reasonable control.
          </p>

          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">16.8 Interpretation</h3>
          <p className="mb-4">
            Headings are for convenience only. "Including" means "including without limitation."
          </p>

          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">16.9 Survival</h3>
          <p className="mb-4">
            Provisions that should reasonably survive termination will do so.
          </p>

          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">16.10 California Users</h3>
          <p className="mb-4">
            California residents: See our Privacy Policy for rights under California law. For complaints: 
            California Department of Consumer Affairs, 1625 North Market Blvd., Suite N 112, Sacramento, CA 95834.
          </p>

          <h2 className="text-2xl font-semibold text-gray-800 mt-6 mb-3">17. ARTIFICIAL INTELLIGENCE FEATURES</h2>
          
          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">17.1 AI Services</h3>
          <p className="mb-2">Our Services may include AI-powered features. You acknowledge that:</p>
          <ul className="list-disc list-inside mb-4 ml-4">
            <li>AI outputs may be inaccurate or incomplete</li>
            <li>You should verify AI-generated content</li>
            <li>We are not liable for AI outputs</li>
            <li>You are responsible for your use of AI features</li>
          </ul>

          <h3 className="text-xl font-semibold text-gray-700 mt-4 mb-2">17.2 AI Content Rights</h3>
          <p className="mb-4">
            AI-generated content provided through our Services remains subject to our intellectual property rights.
          </p>

          <h2 className="text-2xl font-semibold text-gray-800 mt-6 mb-3">18. CONTACT INFORMATION</h2>
          <div className="mb-6 p-4 bg-gray-50 rounded">
            <p className="mb-2">
              <strong className="font-semibold">SellerQi</strong><br />
              15233 Ventura Blvd Suite 500, Sherman Oaks, CA 91403
            </p>
            <p className="mb-1">
              <strong className="font-semibold">General Inquiries:</strong>{' '}
              <a
                href="mailto:support@sellerqi.com"
                className="text-blue-600 hover:underline"
              >
                support@sellerqi.com
              </a>
            </p>
            <p className="mb-1">
              <strong className="font-semibold">Legal Matters:</strong>{' '}
              <a
                href="mailto:legal@sellerqi.com"
                className="text-blue-600 hover:underline"
              >
                legal@sellerqi.com
              </a>
            </p>
            <p>
              <strong className="font-semibold">Privacy Concerns:</strong>{' '}
              <a
                href="mailto:privacy@sellerqi.com"
                className="text-blue-600 hover:underline"
              >
                privacy@sellerqi.com
              </a>
            </p>
          </div>

          <div className="mt-8 pt-4 border-t border-gray-300 text-center text-gray-600">
            <p className="mb-1">
              <strong className="font-semibold">Copyright © 2025 SellerQi. All rights reserved.</strong>
            </p>
            <p>
              <strong className="font-semibold">Last Updated:</strong> 11 June 2025
            </p>
            <p>
              <strong className="font-semibold">Version:</strong> 1.0
            </p>
          </div>
        </div>

      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
}