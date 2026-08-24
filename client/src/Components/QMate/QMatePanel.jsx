import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Send, Loader2 } from 'lucide-react';
import axiosInstance from '../../config/axios.config.js';
import { COLORS } from '../Shared/index.js';

const SUGGESTIONS = [
  'What are my biggest issues right now?',
  'How is my profitability trending?',
  'Any wasted ad spend I should fix?',
];

/**
 * Slide-in "Ask QMate" chat drawer — opens in place instead of navigating to the
 * full QMate page.
 *
 * @param {boolean} isOpen
 * @param {Function} onClose
 * @param {string|null} [initialQuestion] - asked automatically on open, so an
 *   "Ask QMate" tag on a specific row lands the seller on an answer rather than an
 *   empty box. Matches the existing suggestion chips, which also send on click.
 */
const QMatePanel = ({ isOpen, onClose, initialQuestion = null }) => {
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [chatId, setChatId] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const dashboardInfo = useSelector((state) => state.Dashboard?.DashBoardInfo);
  const dashboardDateRange = useMemo(() => ({
    startDate: dashboardInfo?.startDate || null,
    endDate: dashboardInfo?.endDate || null,
    calendarMode: dashboardInfo?.calendarMode || 'default',
  }), [dashboardInfo?.startDate, dashboardInfo?.endDate, dashboardInfo?.calendarMode]);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      inputRef.current?.focus();
    }
  }, [messages, isOpen]);

  const sendMessage = async (text) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    let currentChatId = chatId;
    if (!currentChatId) {
      try {
        const createRes = await axiosInstance.post('/api/qmate/chats', { title: trimmed.slice(0, 50) || 'New Chat' });
        currentChatId = createRes?.data?.data?.chat?.id || null;
        setChatId(currentChatId);
      } catch {
        // Chat still works for this turn without a persisted chatId.
      }
    }

    const userMessage = { id: Date.now(), role: 'user', content: trimmed };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput('');
    setIsLoading(true);

    try {
      const response = await axiosInstance.post('/api/qmate/chat', {
        message: trimmed,
        messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
        chatId: currentChatId,
        dateRange: dashboardDateRange.startDate && dashboardDateRange.endDate ? dashboardDateRange : null,
      });
      const assistantContent = response?.data?.data?.message?.content
        || "I'm sorry, I couldn't generate a detailed answer this time.";
      setMessages((prev) => [...prev, { id: Date.now() + 1, role: 'assistant', content: assistantContent }]);
    } catch {
      setMessages((prev) => [...prev, { id: Date.now() + 1, role: 'assistant', content: 'Something went wrong reaching QMate — please try again.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    sendMessage(input);
  };

  // Ask the row's question once per open. Guarded on the question itself rather
  // than on isOpen alone, so reopening the drawer manually doesn't re-ask, and
  // asking about a second row while open does.
  const askedRef = useRef(null);
  useEffect(() => {
    if (!isOpen) {
      askedRef.current = null;
      return;
    }
    if (initialQuestion && askedRef.current !== initialQuestion) {
      askedRef.current = initialQuestion;
      sendMessage(initialQuestion);
    }
    // sendMessage is stable enough here; re-running on it would double-send.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialQuestion]);

  const goToFullChat = () => {
    onClose();
    navigate('/seller-central-checker/qmate');
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 flex justify-end" style={{ zIndex: 60 }}>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0"
            style={{ background: 'rgba(4,6,10,.6)', backdropFilter: 'blur(2px)' }}
            onClick={onClose}
          />
          <motion.div
            initial={{ x: 420 }}
            animate={{ x: 0 }}
            exit={{ x: 420 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="relative h-full flex flex-col"
            style={{ width: 420, maxWidth: '100vw', background: '#0E121A', borderLeft: `1px solid ${COLORS.border}` }}
          >
            <div className="flex items-center gap-2.5" style={{ padding: '16px 18px', borderBottom: `1px solid ${COLORS.border}` }}>
              <div className="w-[26px] h-[26px] rounded-md flex items-center justify-center text-[13px] font-bold flex-shrink-0" style={{ background: COLORS.accent, color: '#061021' }}>
                Q
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold" style={{ color: COLORS.textPrimary }}>QMate</div>
                <div className="text-[11px]" style={{ color: COLORS.good }}>● Using your live account data</div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
                style={{ border: `1px solid ${COLORS.border}`, color: COLORS.textSecondary }}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto flex flex-col gap-3.5" style={{ padding: '18px' }}>
              {messages.length === 0 && (
                <>
                  <p className="text-sm m-0" style={{ color: COLORS.textSecondary }}>
                    Ask about your sales, ads, listings, or anything else in your account.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => sendMessage(s)}
                        className="rounded-full text-xs transition-colors"
                        style={{ padding: '6px 11px', border: `1px solid ${COLORS.border}`, color: COLORS.textSecondary, background: 'transparent' }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </>
              )}
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`text-[13px] leading-5 ${m.role === 'user' ? 'self-end' : ''}`}
                  style={{
                    maxWidth: m.role === 'user' ? '84%' : '92%',
                    padding: m.role === 'user' ? '10px 13px' : '12px 14px',
                    borderRadius: m.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                    background: m.role === 'user' ? COLORS.surfaceElevated : COLORS.surface,
                    border: m.role === 'user' ? 'none' : `1px solid ${COLORS.border}`,
                    color: '#E2E7F0',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {m.content}
                </div>
              ))}
              {isLoading && (
                <div className="flex items-center gap-2 text-xs" style={{ color: COLORS.textMuted }}>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> QMate is thinking…
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div style={{ padding: '14px 16px', borderTop: `1px solid ${COLORS.border}` }}>
              <form
                onSubmit={handleSubmit}
                className="flex items-center gap-2"
                style={{ padding: '9px 12px', border: `1px solid ${COLORS.border}`, borderRadius: '10px', background: COLORS.surface }}
              >
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask about your account…"
                  className="flex-1 bg-transparent outline-none text-[13px]"
                  style={{ color: COLORS.textPrimary }}
                  disabled={isLoading}
                />
                <button
                  type="submit"
                  disabled={isLoading || !input.trim()}
                  className="w-[26px] h-[26px] rounded-md flex items-center justify-center flex-shrink-0 disabled:opacity-40"
                  style={{ background: COLORS.accent, color: '#061021' }}
                >
                  <Send className="w-3 h-3" />
                </button>
              </form>
              <div className="flex items-center justify-between mt-2">
                <span className="text-[11px]" style={{ color: COLORS.textMuted }}>QMate can make mistakes — check important info.</span>
                <button type="button" onClick={goToFullChat} className="text-[11px] font-medium" style={{ color: '#7EA8F8' }}>
                  Open full chat →
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default QMatePanel;
