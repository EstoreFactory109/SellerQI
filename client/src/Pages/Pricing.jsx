import React, { useState } from 'react';
import { Check, X } from 'lucide-react';
import Logo from "../assets/Icons/MainLogo.png"
import { useNavigate } from 'react-router-dom';
import { Link } from 'react-router-dom';

export default function PricingPage() {
  const navigate = useNavigate();

  const loginNavigate = (e) => {
    e.preventDefault();
    navigate('/log-in');
  }


  const [openFaq, setOpenFaq] = useState(2);
  const faqs = [
    {
      q: "What's the difference between Lite and Pro ?",
      a: '',
    },
    {
      q: 'Will I lose data if I downgrade ?',
      a: '',
    },
    {
      q: 'Can I cancel anytime ?',
      a: 'Yes you can cancel the subscription anytime you want.',
    },
    {
      q: 'How often is my product data updated?',
      a: '',
    },
    {
      q: 'Question',
      a: '',
    },
  ];
  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-200">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
        <div className="flex items-center">
              <img src={Logo} alt='SellerQI' className='w-28 h-9' />
            </div>
          <nav className="hidden md:flex items-center space-x-8">
            <Link to="/" className="text-gray-600 hover:text-gray-900 font-medium cursor-pointer" >Home</Link>
            <button className="bg-gray-900 text-white px-6 py-2 rounded hover:bg-gray-800" onClick={loginNavigate}>Login</button>
          </nav>
        </div>
      </header>
      <main className="flex-1 w-full">
        <section className="py-20 px-4">
          <div className="container mx-auto max-w-3xl text-center mb-16">
            <h1 className="text-5xl font-extrabold mb-6 leading-tight">
              Choose the <span className="text-red-500">Plan</span> That Grows<br />With You
            </h1>
            <p className="text-gray-600 text-lg max-w-2xl mx-auto">
              Start with a free audit. Upgrade when you're ready for full insights, reports & expert-backed solutions.
            </p>
          </div>
          <div className="container mx-auto flex flex-col md:flex-row gap-8 justify-center items-end mb-24">
            {/* LITE */}
            <div className="flex-1 bg-white rounded-2xl border border-gray-200 shadow-[0_2px_16px_0_rgba(0,0,0,0.06)] p-8 flex flex-col items-center max-w-xs mx-auto min-h-[520px] relative z-0">
              <div className="text-lg font-bold mb-2">LITE</div>
              <div className="text-3xl font-extrabold mb-2">$0<span className="text-base font-normal">/mo</span></div>
              <div className="text-gray-500 mb-6 text-center">Perfect for new Amazon sellers who want a quick health check.</div>
              <ul className="mb-8 space-y-3 text-left w-full">
                <li className="flex items-center gap-2 text-green-600"><Check className="w-5 h-5" />Product Audit Summary</li>
                <li className="flex items-center gap-2 text-red-500"><X className="w-5 h-5" />Download Reports</li>
                <li className="flex items-center gap-2 text-red-500"><X className="w-5 h-5" />Fix Recommendations</li>
                <li className="flex items-center gap-2 text-red-500"><X className="w-5 h-5" />Expert Consultation</li>
                <li className="flex items-center gap-2 text-red-500"><X className="w-5 h-5" />Track Multiple Products</li>
                <li className="flex items-center gap-2 text-red-500"><X className="w-5 h-5" />Issue Breakdown</li>
              </ul>
              <button className="bg-[#23253A] text-white px-6 py-2 rounded w-full font-semibold shadow-md">Subscribe</button>
            </div>
            {/* PRO */}
            <div className="flex-1 bg-[#23253A] rounded-2xl border-4 border-yellow-400 shadow-[0_8px_32px_0_rgba(0,0,0,0.18)] p-10 flex flex-col items-center max-w-xs mx-auto min-h-[560px] scale-105 relative z-10">
              <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-green-500 text-white text-xs font-bold px-6 py-2 rounded-full shadow-lg z-20">10% OFF</div>
              <div className="text-lg font-bold mb-2 text-white">PRO</div>
              <div className="text-4xl font-extrabold mb-2 text-white">$99<span className="text-base font-normal text-gray-300">/mo</span></div>
              <div className="text-white mb-6 text-center font-medium">Recommended for serious sellers who want full visibility, fixes, and growth.</div>
              <ul className="mb-8 space-y-3 text-left w-full">
                <li className="flex items-center gap-2 text-green-400 font-semibold"><Check className="w-5 h-5" />Product Audit Summary</li>
                <li className="flex items-center gap-2 text-green-400 font-semibold"><Check className="w-5 h-5" />Download Reports</li>
                <li className="flex items-center gap-2 text-green-400 font-semibold"><Check className="w-5 h-5" />Fix Recommendations</li>
                <li className="flex items-center gap-2 text-green-400 font-semibold"><Check className="w-5 h-5" />Expert Consultation</li>
                <li className="flex items-center gap-2 text-green-400 font-semibold"><Check className="w-5 h-5" />Track Multiple Products</li>
                <li className="flex items-center gap-2 text-green-400 font-semibold"><Check className="w-5 h-5" />Issue Breakdown</li>
              </ul>
              <button className="bg-yellow-400 text-black px-6 py-3 rounded w-full font-extrabold shadow-lg text-lg tracking-wide">Subscribe</button>
            </div>
            {/* AGENCY */}
            <div className="flex-1 bg-white rounded-2xl border border-gray-200 shadow-[0_2px_16px_0_rgba(0,0,0,0.06)] p-8 flex flex-col items-center max-w-xs mx-auto min-h-[520px] relative z-0">
              <div className="text-lg font-bold mb-2">AGENCY</div>
              <div className="text-3xl font-extrabold mb-2">$49<span className="text-base font-normal">/mo</span></div>
              <div className="text-gray-500 mb-6 text-center">Great for first time audits or early stage sellers.</div>
              <ul className="mb-8 space-y-3 text-left w-full">
                <li className="flex items-center gap-2 text-green-600"><Check className="w-5 h-5" />Product Audit Summary</li>
                <li className="flex items-center gap-2 text-green-600"><Check className="w-5 h-5" />Download Reports</li>
                <li className="flex items-center gap-2 text-green-600"><Check className="w-5 h-5" />Fix Recommendations</li>
                <li className="flex items-center gap-2 text-green-600"><Check className="w-5 h-5" />Expert Consultation</li>
                <li className="flex items-center gap-2 text-green-600"><Check className="w-5 h-5" />Track Multiple Products</li>
                <li className="flex items-center gap-2 text-green-600"><Check className="w-5 h-5" />Issue Breakdown</li>
              </ul>
              <button className="bg-[#23253A] text-white px-6 py-2 rounded w-full font-semibold shadow-md">Subscribe</button>
            </div>
          </div>
        </section>
        {/* FAQ Section */}
        <section className="bg-gray-100 py-20 px-4">
          <div className="container mx-auto max-w-3xl">
            <div className="text-center mb-12">
              <div className="text-xs font-bold text-red-400 mb-2 tracking-widest">FAQS</div>
              <h2 className="text-3xl font-extrabold mb-2">Frequently Asked Questions</h2>
            </div>
            <div className="space-y-4">
              {faqs.map((faq, i) => (
                <div key={i} className={`bg-white rounded-lg overflow-hidden transition-all border ${openFaq === i ? 'border-blue-200 shadow-md' : 'border-transparent'}`}>
                  <button
                    className="w-full text-left px-6 py-4 font-semibold flex justify-between items-center focus:outline-none text-lg"
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  >
                    <span>{faq.q}</span>
                    <span className={`ml-4 text-2xl font-bold transition-transform ${openFaq === i ? 'text-blue-500 rotate-45' : 'text-gray-400'}`}>{openFaq === i ? '-' : '+'}</span>
                  </button>
                  {openFaq === i && faq.a && (
                    <div className="px-6 pb-4 text-gray-600 text-base bg-blue-50">{faq.a}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
        {/* Contact CTA */}
        <section className="py-20 bg-white text-center">
          <div className="mb-8">
            <svg width="60" height="60" viewBox="0 0 100 100" className="mx-auto mb-4">
              <circle cx="50" cy="50" r="30" fill="none" stroke="#FCD34D" strokeWidth="6" strokeDasharray="47 141" />
              <circle cx="50" cy="50" r="30" fill="none" stroke="#EF4444" strokeWidth="6" strokeDasharray="47 141" strokeDashoffset="-47" />
              <circle cx="50" cy="50" r="30" fill="none" stroke="#10B981" strokeWidth="6" strokeDasharray="47 141" strokeDashoffset="-94" />
              <circle cx="50" cy="50" r="30" fill="none" stroke="#FFFFFF" strokeWidth="6" strokeDasharray="47 141" strokeDashoffset="-141" />
              <text x="50" y="58" textAnchor="middle" fill="#23253A" fontSize="24" fontWeight="bold">Q</text>
            </svg>
            <h2 className="text-2xl font-bold mb-2">Still have questions? We're here for you!</h2>
            <button className="mt-4 bg-[#23253A] text-white px-6 py-2 rounded font-semibold shadow">Contact Us <span className="ml-2">&gt;</span></button>
          </div>
        </section>
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