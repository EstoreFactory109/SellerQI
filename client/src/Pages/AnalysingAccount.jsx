import React, { useState } from "react";
import { motion } from "framer-motion";

// Animated DNA Helix Loader
const HelixLoader = () => {
    const dots = Array.from({ length: 12 }, (_, i) => i);
    return (
        <div className="relative w-24 h-24">
            {dots.map((i) => (
            <motion.div
                    key={i}
                    className="absolute w-3 h-3 rounded-full shadow-md"
                    style={{
                        left: '50%',
                        top: '50%',
                        background: i % 2 === 0 ? '#6366f1' : '#a5b4fc',
                    }}
                    animate={{
                        x: [
                            Math.cos((i / 12) * Math.PI * 2) * 30,
                            Math.cos((i / 12) * Math.PI * 2 + Math.PI) * 30,
                            Math.cos((i / 12) * Math.PI * 2) * 30,
                        ],
                        y: [
                            Math.sin((i / 12) * Math.PI * 2) * 15 - 4,
                            Math.sin((i / 12) * Math.PI * 2 + Math.PI) * 15 - 4,
                            Math.sin((i / 12) * Math.PI * 2) * 15 - 4,
                        ],
                    scale: [1, 1.2, 1],
                        opacity: [0.7, 1, 0.7],
                }}
                transition={{ 
                        duration: 2,
                    repeat: Infinity,
                        ease: "easeInOut",
                        delay: i * 0.1,
                }}
            />
            ))}
            {/* Center glow */}
            <motion.div
                className="absolute inset-0 m-auto w-12 h-12 rounded-full bg-gradient-to-br from-indigo-300/40 to-purple-300/40 blur-xl"
                animate={{ 
                    scale: [1, 1.3, 1],
                    opacity: [0.4, 0.7, 0.4],
                }}
                transition={{ 
                    duration: 3,
                    repeat: Infinity,
                    ease: "easeInOut",
                }}
            />
        </div>
    );
};

// Floating particles background
const FloatingParticles = () => {
    const particles = Array.from({ length: 20 }, (_, i) => ({
        id: i,
        size: Math.random() * 6 + 3,
        x: Math.random() * 100,
        y: Math.random() * 100,
        duration: Math.random() * 20 + 15,
        delay: Math.random() * 5,
    }));

    return (
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
            {particles.map((p) => (
            <motion.div
                    key={p.id}
                    className="absolute rounded-full bg-indigo-500/10"
                    style={{
                        width: p.size,
                        height: p.size,
                        left: `${p.x}%`,
                        top: `${p.y}%`,
                    }}
                animate={{ 
                        y: [0, -80, 0],
                        x: [0, Math.random() * 30 - 15, 0],
                        opacity: [0, 0.4, 0],
                }}
                transition={{ 
                        duration: p.duration,
                    repeat: Infinity,
                        delay: p.delay,
                    ease: "easeInOut",
                }}
            />
            ))}
        </div>
    );
};

const AnalysingAccount = () => {
    const [jobStatus] = useState('processing'); // Static status - always 'processing'
    const [progress] = useState(50); // Static progress - always 50%

    // Get status message (static)
    const getStatusMessage = () => {
        return 'Deep analysis in progress...';
    };

    return (
        <div className="h-screen w-full bg-gray-50 flex flex-col overflow-hidden relative">
            {/* Floating particles background */}
            <FloatingParticles />
            
            {/* Gradient mesh background - light theme */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
                <div className="absolute top-0 left-1/4 w-96 h-96 bg-indigo-100/60 rounded-full blur-3xl" />
                <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-purple-100/50 rounded-full blur-3xl" />
                <div className="absolute top-1/2 left-1/2 w-72 h-72 bg-blue-100/40 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
            </div>

            {/* Main content - scrollable area */}
            <div className="flex-1 flex flex-col items-center justify-center px-6 py-4 relative z-10 overflow-y-auto">
                <div className="w-full max-w-4xl flex flex-col items-center gap-4">
                    {/* Loader */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.8, ease: "easeOut" }}
                        className="mb-2"
                    >
                        <HelixLoader />
                    </motion.div>

                    {/* Main Title */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6, delay: 0.2 }}
                        className="text-center mb-2"
                    >
                        <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-1 tracking-tight">
                            Analysis in Progress
                        </h1>
                        <p className="text-gray-600 text-base md:text-lg max-w-xl mx-auto">
                            We're performing a deep analysis of your Amazon account
                        </p>
                    </motion.div>
                            
                    {/* Status Badge */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.5, delay: 0.4 }}
                        className="mb-2"
                    >
                        <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700 border border-indigo-200">
                            <motion.span
                                className="w-1.5 h-1.5 rounded-full bg-indigo-500"
                                animate={{ opacity: [1, 0.4, 1] }}
                                transition={{ duration: 1.5, repeat: Infinity }}
                            />
                            {getStatusMessage()}
                        </span>
                    </motion.div>

                    {/* Safe to close card - highlighted so users know they can leave */}
                    <motion.div
                        initial={{ opacity: 0, y: 30 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6, delay: 0.5 }}
                        className="w-full bg-white rounded-xl border-2 border-emerald-300 shadow-lg shadow-emerald-200/50 p-5 mb-4 ring-2 ring-emerald-100"
                    >
                        <div className="flex items-start gap-4">
                            <div className="flex-shrink-0 w-12 h-12 bg-gradient-to-br from-emerald-400 to-teal-500 rounded-lg flex items-center justify-center shadow-md shadow-emerald-200">
                                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                            </div>
                            <div className="flex-1">
                                <h3 className="text-lg font-semibold text-gray-900 mb-1.5">
                                    You can safely close this tab
                                </h3>
                                <p className="text-gray-600 text-sm leading-relaxed mb-4">
                                    Your analysis is running in the background and will continue even if you close this page.
                                </p>
                                <div className="flex items-center gap-3 rounded-lg bg-emerald-50 border-2 border-emerald-200 px-4 py-3">
                                    <div className="flex-shrink-0 w-10 h-10 bg-emerald-500 rounded-full flex items-center justify-center">
                                        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                        </svg>
                                    </div>
                                    <div>
                                        <p className="text-sm font-semibold text-emerald-900">We'll email you when it's ready</p>
                                        <p className="text-xs text-emerald-700 mt-0.5">Feel free to close this page — you'll get a notification at your registered email.</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </motion.div>

                    {/* What's being analyzed */}
                    <motion.div
                        initial={{ opacity: 0, y: 30 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6, delay: 0.7 }}
                        className="w-full mb-4"
                    >
                        <h4 className="text-center text-gray-400 text-xs font-medium uppercase tracking-wider mb-3">
                            Currently Analyzing
                        </h4>
                        <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                            {[
                                { icon: "📊", label: "Sales Data" },
                                { icon: "📈", label: "PPC Campaigns" },
                                { icon: "💰", label: "Profitability" },
                                { icon: "📦", label: "Inventory" },
                                { icon: "🏆", label: "Rankings" },
                                { icon: "🛡️", label: "Account Health" },
                            ].map((item, index) => (
                                <motion.div
                                    key={item.label}
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.4, delay: 0.8 + index * 0.1 }}
                                    className="bg-white rounded-lg p-2.5 text-center border border-gray-200 shadow-sm hover:border-indigo-300 hover:shadow-md transition-all"
                                >
                                    <motion.span 
                                        className="text-xl block mb-1"
                                        animate={{ scale: [1, 1.1, 1] }}
                                        transition={{ duration: 2, repeat: Infinity, delay: index * 0.3 }}
                                    >
                                        {item.icon}
                                    </motion.span>
                                    <span className="text-[10px] text-gray-600 font-medium leading-tight">{item.label}</span>
                                </motion.div>
                            ))}
                        </div>
                    </motion.div>
                </div>
            </div>
                            
            {/* Bottom section with resources - fixed at bottom */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 1 }}
                className="relative z-10 border-t border-gray-200 bg-white flex-shrink-0"
            >
                <div className="max-w-5xl mx-auto px-6 py-4">
                    <p className="text-center text-gray-600 text-xs font-medium mb-3">
                        While you wait, explore how SellerQI helps Amazon sellers succeed
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-3">
                        <a
                            href="https://www.sellerqi.com/use-cases"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="group flex items-center gap-2 px-4 py-2 bg-white hover:bg-indigo-50 rounded-full border-2 border-gray-200 hover:border-indigo-400 transition-all shadow-sm hover:shadow-md"
                        >
                            <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span className="text-xs font-medium text-gray-700 group-hover:text-indigo-700 transition-colors">Use Cases</span>
                            <svg className="w-3 h-3 text-gray-400 group-hover:text-indigo-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                        </a>
                        <a
                            href="https://www.sellerqi.com/case-study/"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="group flex items-center gap-2 px-4 py-2 bg-white hover:bg-indigo-50 rounded-full border-2 border-gray-200 hover:border-indigo-400 transition-all shadow-sm hover:shadow-md"
                        >
                            <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                            </svg>
                            <span className="text-xs font-medium text-gray-700 group-hover:text-indigo-700 transition-colors">Case Studies</span>
                            <svg className="w-3 h-3 text-gray-400 group-hover:text-indigo-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                        </a>
                        <a
                            href="https://www.sellerqi.com/blog/"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="group flex items-center gap-2 px-4 py-2 bg-white hover:bg-indigo-50 rounded-full border-2 border-gray-200 hover:border-indigo-400 transition-all shadow-sm hover:shadow-md"
                        >
                            <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                            </svg>
                            <span className="text-xs font-medium text-gray-700 group-hover:text-indigo-700 transition-colors">Blog</span>
                            <svg className="w-3 h-3 text-gray-400 group-hover:text-indigo-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                        </a>
                    </div>
                </div>
            </motion.div>
        </div>
    );
};

export default AnalysingAccount;
