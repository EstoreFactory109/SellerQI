import React from 'react';
import { motion } from 'framer-motion';

export default function FeedbackTextarea({ value, onChange, placeholder }) {
  return (
    <motion.textarea
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      transition={{ duration: 0.25 }}
      rows={4}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-3 py-2 rounded-lg border border-[#30363d] bg-[#0d1117] text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
    />
  );
}
