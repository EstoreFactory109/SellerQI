import React, { useEffect } from 'react';
import Navbar from '../Components/Navigation/Navbar';
import Footer from '../Components/Navigation/Footer';

export default function PrivacyPolicy() {
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <Navbar />

      <main className="flex-1 container mx-auto px-4 py-12 max-w-4xl">
        <div className="font-sans leading-relaxed mx-5 my-5 max-w-4xl">
          <h1 className="text-3xl font-bold text-gray-800 mb-4">SellerQi Privacy Policy</h1>

          <p className="mb-6">
            <strong className="font-semibold">Effective Date:</strong> 1 June 2025
          </p>

          <h2 className="text-2xl font-semibold text-gray-800 mt-8 mb-4">1. Introduction</h2>
          <p className="mb-4">
            SellerQi. ("we," "our," "us," or the "Company"), a company registered in the United States,
            provides services globally and is committed to protecting your personal data in compliance with
            all applicable privacy laws worldwide. This Privacy Policy explains how we collect, use, disclose,
            and safeguard your information when you visit our website{' '}
            <a href="https://www.sellerqi.com" className="text-blue-600 hover:underline">
              https://www.sellerqi.com
            </a>{' '}
            (the "Site") and use our services, tools, and applications (collectively, the "Services").
          </p>

          <p className="mb-4">
            By accessing or using our Services, you agree to this Privacy Policy. If you do not agree with
            the terms of this Privacy Policy, please do not access the Site or use our Services.
          </p>

          <p className="mb-6 p-4 bg-amber-50 border-l-4 border-amber-400">
            <strong className="font-semibold">IMPORTANT NOTICE:</strong> This Privacy Policy constitutes a
            legally binding agreement. We comply with privacy laws in all jurisdictions where we operate,
            including but not limited to the United States, European Union, United Kingdom, Australia,
            Canada, and other countries.
          </p>

          <h2 className="text-2xl font-semibold text-gray-800 mt-8 mb-4">2. Global Privacy Compliance Overview</h2>
          <p className="mb-4">We comply with the following international privacy frameworks:</p>
          <ul className="list-disc ml-6 mb-6 space-y-2">
            <li>United States: State privacy laws (CCPA/CPRA, VCDPA, CPA, etc.) and federal regulations</li>
            <li>European Union/EEA: General Data Protection Regulation (GDPR)</li>
            <li>United Kingdom: UK GDPR and Data Protection Act 2018</li>
            <li>Australia: Privacy Act 1988 and Australian Privacy Principles (APPs)</li>
            <li>Canada: Personal Information Protection and Electronic Documents Act (PIPEDA)</li>
            <li>Brazil: Lei Geral de Proteção de Dados (LGPD)</li>
            <li>Japan: Act on Protection of Personal Information (APPI)</li>
            <li>Switzerland: Federal Data Protection Act (FADP)</li>
            <li>New Zealand: Privacy Act 2020</li>
            <li>Singapore: Personal Data Protection Act (PDPA)</li>
            <li>Other Jurisdictions: We comply with applicable local privacy laws</li>
          </ul>

          <h2 className="text-2xl font-semibold text-gray-800 mt-8 mb-4">3. Information We Collect</h2>
          
          <h3 className="text-xl font-semibold text-gray-700 mt-6 mb-3">3.1 Personal Information You Provide</h3>
          <p className="mb-4">We collect information that you voluntarily provide when using our Services:</p>
          <ul className="list-disc ml-6 mb-6 space-y-2">
            <li>Identity Data: Name, username, title, date of birth (where required)</li>
            <li>Contact Data: Email address, postal address, telephone numbers</li>
            <li>Financial Data: Payment card details, bank account information (processed through secure third-party processors)</li>
            <li>Transaction Data: Purchase history, payment records, tax information</li>
            <li>Account Data: Username, password, account preferences</li>
            <li>Profile Data: Business information, preferences, feedback, survey responses</li>
            <li>Communications Data: Correspondence and communications with us</li>
            <li>Marketing Data: Marketing preferences and consent records</li>
            <li>Identity Verification Data: Government-issued ID information (where legally required)</li>
          </ul>

          <h3 className="text-xl font-semibold text-gray-700 mt-6 mb-3">3.2 Information We Collect Automatically</h3>
          <p className="mb-4">When you use our Services, we automatically collect:</p>
          <ul className="list-disc ml-6 mb-6 space-y-2">
            <li>Technical Data: IP address, browser type and version, time zone setting, browser plug-in types and versions, operating system and platform</li>
            <li>Usage Data: Information about how you use our website and services</li>
            <li>Location Data: Geographic location based on IP address</li>
            <li>Device Data: Device type, unique device identifiers, mobile network information</li>
            <li>Cookie Data: Information collected through cookies and similar technologies</li>
          </ul>

          <h3 className="text-xl font-semibold text-gray-700 mt-6 mb-3">3.3 Special Categories of Data</h3>
          <p className="mb-4">We do not intentionally collect special categories of personal data (including racial or ethnic origin, political opinions, religious beliefs, genetic data, biometric data, health data, or data concerning sexual orientation) unless:</p>
          <ul className="list-disc ml-6 mb-6 space-y-2">
            <li>Required by law</li>
            <li>You explicitly consent</li>
            <li>Necessary for legal claims</li>
            <li>You have made the data public</li>
          </ul>

          <h3 className="text-xl font-semibold text-gray-700 mt-6 mb-3">3.4 Third-Party Data</h3>
          <p className="mb-4">We may receive data about you from:</p>
          <ul className="list-disc ml-6 mb-6 space-y-2">
            <li>E-commerce platforms (Amazon, eBay, etc.)</li>
            <li>Payment service providers</li>
            <li>Analytics providers</li>
            <li>Marketing partners</li>
            <li>Social media platforms</li>
            <li>Public databases</li>
          </ul>

          <h2 className="text-2xl font-semibold text-gray-800 mt-8 mb-4">4. Legal Basis for Processing (Global)</h2>
          <p className="mb-4">We process your personal information based on the following legal grounds:</p>

          <h3 className="text-xl font-semibold text-gray-700 mt-6 mb-3">4.1 All Jurisdictions</h3>
          <ul className="list-disc ml-6 mb-6 space-y-2">
            <li>Consent: Where you have given clear, informed consent</li>
            <li>Contract: To perform our contract with you</li>
            <li>Legal Obligation: To comply with applicable laws</li>
            <li>Vital Interests: To protect someone's life</li>
            <li>Public Task: For tasks in the public interest (where applicable)</li>
            <li>Legitimate Interests: For our legitimate business interests</li>
          </ul>

          <h3 className="text-xl font-semibold text-gray-700 mt-6 mb-3">4.2 Jurisdiction-Specific Bases</h3>
          <ul className="list-disc ml-6 mb-6 space-y-2">
            <li>Australia: With your consent or where reasonably necessary for our functions</li>
            <li>Canada: With consent or where permitted by PIPEDA</li>
            <li>Brazil: Based on LGPD legal bases including legitimate interest</li>
            <li>Singapore: With consent or deemed consent under PDPA</li>
          </ul>

          <h2 className="text-2xl font-semibold text-gray-800 mt-8 mb-4">5. How We Use Your Information</h2>

          <h3 className="text-xl font-semibold text-gray-700 mt-6 mb-3">5.1 Primary Purposes</h3>
          <ul className="list-disc ml-6 mb-6 space-y-2">
            <li>Provide and maintain our Services</li>
            <li>Process transactions and payments</li>
            <li>Send service-related communications</li>
            <li>Provide customer support</li>
            <li>Improve and develop our Services</li>
            <li>Ensure security and prevent fraud</li>
            <li>Comply with legal obligations</li>
          </ul>

          <h3 className="text-xl font-semibold text-gray-700 mt-6 mb-3">5.2 Secondary Purposes (with consent where required)</h3>
          <ul className="list-disc ml-6 mb-6 space-y-2">
            <li>Marketing communications</li>
            <li>Personalization of services</li>
            <li>Analytics and research</li>
            <li>Targeted advertising (where permitted)</li>
          </ul>

          <h2 className="text-2xl font-semibold text-gray-800 mt-8 mb-4">6. International Data Transfers</h2>

          <h3 className="text-xl font-semibold text-gray-700 mt-6 mb-3">6.1 Transfer Mechanisms</h3>
          <p className="mb-4">As a US-based company serving global customers, we transfer data internationally using appropriate safeguards:</p>
          
          <p className="mb-2 font-semibold">For EEA/UK to US transfers:</p>
          <ul className="list-disc ml-6 mb-4 space-y-2">
            <li>Standard Contractual Clauses (SCCs)</li>
            <li>Supplementary measures where required</li>
            <li>Your explicit consent where applicable</li>
          </ul>

          <p className="mb-2 font-semibold">For other international transfers:</p>
          <ul className="list-disc ml-6 mb-6 space-y-2">
            <li>Adequacy decisions where available</li>
            <li>Appropriate contractual safeguards</li>
            <li>Consent where required</li>
            <li>Other lawful transfer mechanisms</li>
          </ul>

          <h3 className="text-xl font-semibold text-gray-700 mt-6 mb-3">6.2 Data Localization</h3>
          <p className="mb-4">We comply with data localization requirements where applicable, including:</p>
          <ul className="list-disc ml-6 mb-6 space-y-2">
            <li>Russia: Local data storage requirements</li>
            <li>China: Critical information infrastructure data</li>
            <li>Other jurisdictions with localization requirements</li>
          </ul>

          <h2 className="text-2xl font-semibold text-gray-800 mt-8 mb-4">7. How We Share Your Information</h2>

          <h3 className="text-xl font-semibold text-gray-700 mt-6 mb-3">7.1 Service Providers</h3>
          <p className="mb-4">We share data with carefully vetted service providers who:</p>
          <ul className="list-disc ml-6 mb-6 space-y-2">
            <li>Sign appropriate data processing agreements</li>
            <li>Implement adequate security measures</li>
            <li>Process data only on our instructions</li>
          </ul>

          <h3 className="text-xl font-semibold text-gray-700 mt-6 mb-3">7.2 Legal Disclosures</h3>
          <p className="mb-4">We may disclose information to:</p>
          <ul className="list-disc ml-6 mb-6 space-y-2">
            <li>Comply with legal obligations</li>
            <li>Respond to lawful requests from authorities</li>
            <li>Protect rights, property, or safety</li>
            <li>Prevent fraud or security issues</li>
          </ul>

          <h3 className="text-xl font-semibold text-gray-700 mt-6 mb-3">7.3 Business Transfers</h3>
          <p className="mb-4">In case of merger, acquisition, or asset sale, appropriate protections will be in place.</p>

          <h3 className="text-xl font-semibold text-gray-700 mt-6 mb-3">7.4 International Sharing</h3>
          <p className="mb-4">When sharing data internationally, we ensure appropriate safeguards are in place.</p>

          <p className="mb-6 p-4 bg-amber-50 border-l-4 border-amber-400">
            <strong className="font-semibold">IMPORTANT:</strong> We do not sell personal information.
          </p>

          <h2 className="text-2xl font-semibold text-gray-800 mt-8 mb-4">8. Data Security</h2>
          <p className="mb-4">We implement comprehensive security measures appropriate to the risk:</p>
          <ul className="list-disc ml-6 mb-6 space-y-2">
            <li>Encryption in transit and at rest</li>
            <li>Access controls and authentication</li>
            <li>Regular security assessments</li>
            <li>Employee training</li>
            <li>Incident response procedures</li>
            <li>Compliance with industry standards (ISO 27001, SOC 2 where applicable)</li>
          </ul>

          <h3 className="text-xl font-semibold text-gray-700 mt-6 mb-3">8.1 Breach Notification</h3>
          <p className="mb-4">We will notify you of personal data breaches as required by applicable law:</p>
          <ul className="list-disc ml-6 mb-6 space-y-2">
            <li>EU/UK: Within 72 hours to authorities, without undue delay to individuals</li>
            <li>Australia: As soon as practicable for eligible data breaches</li>
            <li>US States: Within timeframes specified by state law</li>
            <li>Other jurisdictions: As required by local law</li>
          </ul>

          <h2 className="text-2xl font-semibold text-gray-800 mt-8 mb-4">9. Data Retention</h2>
          <p className="mb-4">We retain personal data based on:</p>
          <ul className="list-disc ml-6 mb-4 space-y-2">
            <li>Duration of our relationship</li>
            <li>Legal retention requirements</li>
            <li>Statute of limitations periods</li>
            <li>Legitimate business needs</li>
          </ul>

          <p className="mb-2 font-semibold">Specific retention periods:</p>
          <ul className="list-disc ml-6 mb-6 space-y-2">
            <li>Financial records: 7 years (or as required by law)</li>
            <li>Marketing data: Until consent withdrawn</li>
            <li>Account data: Duration of account plus legal requirements</li>
            <li>Log data: 12-24 months</li>
          </ul>

          <h2 className="text-2xl font-semibold text-gray-800 mt-8 mb-4">10. Your Rights (By Region)</h2>

          <h3 className="text-xl font-semibold text-gray-700 mt-6 mb-3">10.1 Global Rights</h3>
          <p className="mb-4">Regardless of location, you can:</p>
          <ul className="list-disc ml-6 mb-6 space-y-2">
            <li>Access your personal data</li>
            <li>Correct inaccurate data</li>
            <li>Request deletion (subject to legal requirements)</li>
            <li>Withdraw consent</li>
            <li>Lodge complaints</li>
          </ul>

          <h3 className="text-xl font-semibold text-gray-700 mt-6 mb-3">10.2 European Union/EEA/UK Rights (GDPR)</h3>
          <ul className="list-disc ml-6 mb-6 space-y-2">
            <li>Access: Obtain confirmation and copies of your data</li>
            <li>Rectification: Correct inaccurate data</li>
            <li>Erasure ("Right to be Forgotten"): Delete data in certain circumstances</li>
            <li>Restriction: Limit processing in certain circumstances</li>
            <li>Portability: Receive data in machine-readable format</li>
            <li>Object: Object to certain processing activities</li>
            <li>Automated Decision-Making: Right not to be subject to solely automated decisions</li>
            <li>Supervisory Authority: Lodge complaints with data protection authorities</li>
          </ul>

          <h3 className="text-xl font-semibold text-gray-700 mt-6 mb-3">10.3 Australia Rights (Privacy Act)</h3>
          <ul className="list-disc ml-6 mb-6 space-y-2">
            <li>Access: Access personal information we hold</li>
            <li>Correction: Correct inaccurate information</li>
            <li>Anonymity: Deal with us anonymously where lawful</li>
            <li>Cross-border Disclosure: Be informed of overseas disclosures</li>
            <li>Direct Marketing: Opt-out of direct marketing</li>
            <li>Data Quality: Expect accurate, complete, and up-to-date information</li>
          </ul>

          <h3 className="text-xl font-semibold text-gray-700 mt-6 mb-3">10.4 California Rights (CCPA/CPRA)</h3>
          <ul className="list-disc ml-6 mb-6 space-y-2">
            <li>Know: Information about data collection and sharing</li>
            <li>Delete: Request deletion of personal information</li>
            <li>Correct: Correct inaccurate information</li>
            <li>Opt-Out: Opt-out of "sales" or "sharing"</li>
            <li>Limit Use: Limit use of sensitive personal information</li>
            <li>Non-Discrimination: No discrimination for exercising rights</li>
            <li>Authorized Agent: Use an authorized agent</li>
          </ul>

          <h3 className="text-xl font-semibold text-gray-700 mt-6 mb-3">10.5 Canada Rights (PIPEDA)</h3>
          <ul className="list-disc ml-6 mb-6 space-y-2">
            <li>Access: Access personal information</li>
            <li>Correction: Update or correct information</li>
            <li>Withdrawal: Withdraw consent</li>
            <li>Complaints: File complaints with Privacy Commissioner</li>
          </ul>

          <h3 className="text-xl font-semibold text-gray-700 mt-6 mb-3">10.6 Brazil Rights (LGPD)</h3>
          <ul className="list-disc ml-6 mb-6 space-y-2">
            <li>Confirmation and Access: Confirm processing and access data</li>
            <li>Correction: Rectify incomplete or outdated data</li>
            <li>Anonymization: Request anonymization or blocking</li>
            <li>Portability: Data portability to other providers</li>
            <li>Deletion: Delete unnecessary data</li>
            <li>Information: Learn about sharing with third parties</li>
            <li>Consent: Be informed about consent and withdraw it</li>
            <li>Review: Review automated decisions</li>
          </ul>

          <h3 className="text-xl font-semibold text-gray-700 mt-6 mb-3">10.7 Other Jurisdictions</h3>
          <p className="mb-6">We respect privacy rights in all jurisdictions where we operate. Contact us to exercise your rights.</p>

          <h2 className="text-2xl font-semibold text-gray-800 mt-8 mb-4">11. Marketing and Communications</h2>

          <h3 className="text-xl font-semibold text-gray-700 mt-6 mb-3">11.1 Marketing Preferences</h3>
          <p className="mb-4">We respect your marketing preferences:</p>
          <ul className="list-disc ml-6 mb-6 space-y-2">
            <li>Opt-in required: EU/EEA, UK, Canada, Australia (generally)</li>
            <li>Opt-out available: All jurisdictions</li>
            <li>Unsubscribe: Available in all marketing emails</li>
            <li>SMS: Reply STOP to opt-out</li>
          </ul>

          <h3 className="text-xl font-semibold text-gray-700 mt-6 mb-3">11.2 Cookies and Tracking</h3>
          <ul className="list-disc ml-6 mb-6 space-y-2">
            <li>Cookie Consent: Required in EU/UK and other jurisdictions</li>
            <li>Analytics: Used with appropriate legal basis</li>
            <li>Advertising: Targeted advertising with consent where required</li>
            <li>Do Not Track: Honored where legally required</li>
          </ul>

          <h2 className="text-2xl font-semibold text-gray-800 mt-8 mb-4">12. Children's Privacy</h2>
          <p className="mb-6">Our Services are not directed to individuals under 18. We do not knowingly collect personal information from children. If we learn we have collected information from a child under the applicable age of consent, we will delete it.</p>

          <h2 className="text-2xl font-semibold text-gray-800 mt-8 mb-4">13. Automated Decision-Making</h2>
          <p className="mb-6">We may use automated decision-making in limited circumstances with appropriate safeguards. You have the right to request human review of automated decisions where required by law.</p>

          <h2 className="text-2xl font-semibold text-gray-800 mt-8 mb-4">14. Third-Party Links and Services</h2>
          <p className="mb-6">Our Services may contain links to third-party websites. We are not responsible for their privacy practices. Third-party services have their own privacy policies.</p>

          <h2 className="text-2xl font-semibold text-gray-800 mt-8 mb-4">15. Changes to This Privacy Policy</h2>
          <p className="mb-4">We may update this Privacy Policy to reflect:</p>
          <ul className="list-disc ml-6 mb-4 space-y-2">
            <li>Legal requirements changes</li>
            <li>Service modifications</li>
            <li>Best practices updates</li>
          </ul>

          <p className="mb-2 font-semibold">Notification:</p>
          <ul className="list-disc ml-6 mb-6 space-y-2">
            <li>Email for material changes</li>
            <li>Website notice</li>
            <li>Obtain consent where required</li>
          </ul>

          <h2 className="text-2xl font-semibold text-gray-800 mt-8 mb-4">16. Accessibility</h2>
          <p className="mb-6">
            This Privacy Policy is available in alternative formats upon request. Contact{' '}
            <a href="mailto:support@sellerqi.com" className="text-blue-600 hover:underline">
              support@sellerqi.com
            </a>{' '}
            for assistance.
          </p>

          <h2 className="text-2xl font-semibold text-gray-800 mt-8 mb-4">17. Dispute Resolution</h2>

          <h3 className="text-xl font-semibold text-gray-700 mt-6 mb-3">17.1 Direct Resolution</h3>
          <p className="mb-4">Contact us first to resolve privacy concerns.</p>

          <h3 className="text-xl font-semibold text-gray-700 mt-6 mb-3">17.2 External Resolution</h3>
          <p className="mb-4">For external resolution:</p>
          <ul className="list-disc ml-6 mb-6 space-y-2">
            <li>
              <strong className="font-semibold">EU/EEA/UK:</strong>{' '}
              <a
                href="https://edpb.europa.eu/about-edpb/board/members_en"
                className="text-blue-600 hover:underline break-all"
              >
                https://edpb.europa.eu/about-edpb/board/members_en
              </a>
            </li>
            <li>
              <strong className="font-semibold">Australia OAIC:</strong>{' '}
              <a
                href="https://www.oaic.gov.au/privacy/privacy-complaints"
                className="text-blue-600 hover:underline break-all"
              >
                https://www.oaic.gov.au/privacy/privacy-complaints
              </a>
            </li>
            <li>
              <strong className="font-semibold">Canada (OPC):</strong>{' '}
              <a
                href="https://www.priv.gc.ca/en/report-a-concern"
                className="text-blue-600 hover:underline break-all"
              >
                https://www.priv.gc.ca/en/report-a-concern
              </a>
            </li>
            <li>
              <strong className="font-semibold">California (OAG):</strong>{' '}
              <a
                href="https://oag.ca.gov/privacy/ccpa"
                className="text-blue-600 hover:underline"
              >
                https://oag.ca.gov/privacy/ccpa
              </a>
            </li>
          </ul>

          <h3 className="text-xl font-semibold text-gray-700 mt-6 mb-3">17.3 Jurisdiction</h3>
          <p className="mb-6">Disputes are subject to the laws of your jurisdiction and applicable international treaties.</p>

          <h2 className="text-2xl font-semibold text-gray-800 mt-8 mb-4">18. Contact Information</h2>

          <h3 className="text-xl font-semibold text-gray-700 mt-6 mb-3">18.1 Global Privacy Inquiries</h3>
          <div className="mb-6 p-6 bg-blue-50 rounded-lg border border-blue-200">
            <p className="mb-3">
              <strong className="font-semibold">SellerQi,</strong><br />
              Attn: Global Privacy Department<br />
              15233 Ventura Blvd Suite 500, Sherman Oaks, CA 91403<br />
              <strong className="font-semibold">Email:</strong>{' '}
              <a href="mailto:privacy@sellerqi.com" className="text-blue-600 hover:underline">
                privacy@sellerqi.com
              </a>
            </p>

            <div className="mt-4 pt-4 border-t border-blue-200">
              <p className="font-semibold mb-2">18.3 Response Times</p>
              <ul className="space-y-1 text-sm">
                <li>General Inquiries: 30 days</li>
                <li>GDPR Requests: 1 month (extendable to 3 months)</li>
                <li>CCPA Requests: 45 days (extendable to 90 days)</li>
                <li>Other Jurisdictions: As required by law</li>
              </ul>
            </div>
          </div>

          <div className="mt-8 pt-4 border-t border-gray-300 text-center text-gray-600">
            <p>
              <strong className="font-semibold">Copyright © 2025 SellerQi, All rights reserved.</strong>
            </p>
            <p className="mt-2">
              Available Languages: English |
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
}