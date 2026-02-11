import React, { useState, useRef, useEffect, useMemo } from 'react';
import axiosInstance from '../config/axios.config.js';
import { MessageSquare, Send, Plus, Trash2, Bot, User, Search, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts';

const TYPING_SPEED_MS = 12;
const TYPING_CHUNK = 2;

/** Max size for a single chat's message history (bytes). Older messages are trimmed when exceeded. */
const CHAT_MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

/** Approximate UTF-8 byte size of the messages array when serialized (matches what we store and send). */
function getMessagesSizeBytes(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return 0;
  try {
    return new TextEncoder().encode(JSON.stringify(messages)).length;
  } catch {
    return 0;
  }
}

/** Trim oldest messages until total size is at or below maxBytes. Keeps at least the last message. */
function trimMessagesToMaxSize(messages, maxBytes) {
  if (!Array.isArray(messages) || messages.length <= 1) return messages;
  let list = [...messages];
  while (list.length > 1 && getMessagesSizeBytes(list) > maxBytes) {
    list = list.slice(1);
  }
  return list;
}

/** Renders assistant message content with optional typing animation; supports paragraphs and **bold**. */
function QMateMessageContent({ content, animate = true }) {
  const [visibleLength, setVisibleLength] = useState(0);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (!content || typeof content !== 'string') return;
    setVisibleLength(animate ? 0 : content.length);
    if (!animate) return;

    intervalRef.current = setInterval(() => {
      setVisibleLength((prev) => {
        if (prev >= content.length) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          return content.length;
        }
        return Math.min(prev + TYPING_CHUNK, content.length);
      });
    }, TYPING_SPEED_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [content, animate]);

  if (!content || typeof content !== 'string') return null;
  const visible = animate ? content.slice(0, visibleLength) : content;
  const lines = visible.split(/\n/).map((s) => s.trim()).filter(Boolean);
  if (lines.length === 0 && visibleLength > 0) return <p className="m-0 text-gray-400">—</p>;
  if (lines.length === 0) return <span className="inline-block w-2 h-4 bg-blue-400 animate-pulse" />;

  return (
    <div className="space-y-2">
      {lines.map((line, i) => {
        const parts = [];
        let rest = line.trim();
        let key = 0;
        while (rest.length > 0) {
          const boldMatch = rest.match(/\*\*(.+?)\*\*/);
          if (boldMatch) {
            const idx = rest.indexOf(boldMatch[0]);
            if (idx > 0) parts.push(<span key={key++}>{rest.slice(0, idx)}</span>);
            parts.push(<strong key={key++} className="font-semibold text-gray-100">{boldMatch[1]}</strong>);
            rest = rest.slice(idx + boldMatch[0].length);
          } else {
            parts.push(<span key={key++}>{rest}</span>);
            break;
          }
        }
        return <p key={i} className="m-0">{parts.length ? parts : '\u00A0'}</p>;
      })}
      {animate && visibleLength < content.length && (
        <span className="inline-block w-2 h-4 ml-0.5 bg-blue-400 animate-pulse align-middle" aria-hidden />
      )}
    </div>
  );
}

const CHART_LINE_COLORS = ['#3B82F6', '#10B981', '#F59E0B'];

const MORNING_HEADLINES = [
  'Good morning — what should we focus on today?',
  'Let’s plan today’s Amazon moves',
  'Ready to make today profitable?',
  'What’s on the agenda today?',
  'Let’s set today up for success',
  'Want a quick look at yesterday’s performance?',
];

const AFTERNOON_HEADLINES = [
  'What needs attention right now?',
  'Let’s fix what’s slowing you down',
  'Anything we should optimize today?',
  'Want a mid-day performance check?',
  'What should we improve before the day ends?',
  'Time to make a few smart adjustments?',
];

const EVENING_HEADLINES = [
  'Want a quick recap of today?',
  'How did today’s numbers look?',
  'Let’s review today’s performance',
  'Anything to fix before tomorrow?',
  'Want to prep for a stronger tomorrow?',
  'Let’s close the day on a smart note',
];

const LATE_NIGHT_HEADLINES = [
  'Just checking in — what would you like to see?',
  'Want a quiet performance overview?',
  'Everything’s running — need anything?',
  'Planning ahead for tomorrow?',
];

function pickHeadlineForNow() {
  const hour = new Date().getHours(); // 0–23 local time
  let options;

  if (hour >= 5 && hour < 12) {
    options = MORNING_HEADLINES;
  } else if (hour >= 12 && hour < 18) {
    options = AFTERNOON_HEADLINES;
  } else if (hour >= 18 && hour < 23) {
    options = EVENING_HEADLINES;
  } else {
    options = LATE_NIGHT_HEADLINES;
  }

  const idx = Math.floor(Math.random() * options.length);
  return options[idx] || 'How can I help you today?';
}

/** Renders a single chart when chart.data is present (e.g. sales or PPC over time). */
function QMateChart({ chart }) {
  const data = Array.isArray(chart?.data) ? chart.data : [];
  const xField = chart?.xField || 'interval' || 'date';
  const yFields = Array.isArray(chart?.yFields) && chart.yFields.length > 0
    ? chart.yFields
    : (
        chart?.dataSource === 'ppc_datewise'
          ? [{ field: 'totalCost', label: 'Ad Spend' }, { field: 'sales', label: 'Sales' }]
          : [{ field: 'TotalAmount', label: 'Sales' }, { field: 'Profit', label: 'Profit' }]
      );

  if (data.length === 0) return null;

  const formatTick = (value) => {
    if (typeof value === 'number' && (value >= 1000 || value <= -1000)) {
      return `${(value / 1000).toFixed(1)}k`;
    }
    return typeof value === 'number' ? value.toFixed(0) : value;
  };

  return (
    <div className="mt-2">
      <ResponsiveContainer width="100%" height={220}>
        <LineChart
          data={data}
          margin={{ top: 8, right: 12, left: 0, bottom: 4 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
          <XAxis
            dataKey={xField}
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            stroke="#30363d"
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => {
              if (typeof v === 'string' && v.length > 10) return v.slice(0, 7) + '…';
              return v;
            }}
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            stroke="#30363d"
            tickLine={false}
            axisLine={false}
            tickFormatter={formatTick}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#21262d',
              border: '1px solid #30363d',
              borderRadius: '8px',
              padding: '8px 12px',
              fontSize: '12px',
              color: '#f3f4f6',
            }}
            formatter={(value) => [typeof value === 'number' ? formatTick(value) : value]}
            labelFormatter={(label) => String(label)}
          />
          <Legend
            wrapperStyle={{ fontSize: '11px' }}
            formatter={(value) => value}
            iconType="line"
            iconSize={8}
          />
          {yFields.map((y, i) => (
            <Line
              key={y.field}
              type="monotone"
              dataKey={y.field}
              name={y.label || y.field}
              stroke={CHART_LINE_COLORS[i % CHART_LINE_COLORS.length]}
              strokeWidth={2}
              dot={{ r: 2, fill: '#21262d' }}
              activeDot={{ r: 4 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

const QMate = () => {
  const [welcomeHeadline, setWelcomeHeadline] = useState(() => pickHeadlineForNow());
  const [chats, setChats] = useState([]);
  const [chatsLoading, setChatsLoading] = useState(true);
  const [activeChatId, setActiveChatId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingChatId, setLoadingChatId] = useState(null);
  const [historySearch, setHistorySearch] = useState('');
  const [showInfoModal, setShowInfoModal] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const activeChat = chats.find(chat => chat.id === activeChatId);

  const filteredChats = useMemo(() => {
    const q = (historySearch || '').trim().toLowerCase();
    if (!q) return chats;
    const toSearchableDate = (dateVal) => {
      const d = new Date(dateVal);
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      if (d.toDateString() === today.toDateString()) return 'today';
      if (d.toDateString() === yesterday.toDateString()) return 'yesterday';
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toLowerCase();
    };
    return chats.filter(chat => {
      const title = (chat.title || '').toLowerCase();
      const dateStr = toSearchableDate(chat.date);
      return title.includes(q) || dateStr.includes(q);
    });
  }, [chats, historySearch]);

  /** Track chat history size (bytes) and human-readable display; never exceed CHAT_MAX_SIZE_BYTES. */
  const chatSizeTrack = useMemo(() => {
    const bytes = getMessagesSizeBytes(messages);
    const mb = (bytes / (1024 * 1024)).toFixed(2);
    const maxMb = (CHAT_MAX_SIZE_BYTES / (1024 * 1024)).toFixed(0);
    const isNearLimit = bytes > CHAT_MAX_SIZE_BYTES * 0.8;
    return { bytes, mb, maxMb, isNearLimit };
  }, [messages]);

  // Fetch chat list from API on mount (persisted history like ChatGPT/Claude)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await axiosInstance.get('/api/qmate/chats');
        const list = res?.data?.data?.chats ?? [];
        if (!cancelled) setChats(Array.isArray(list) ? list : []);
      } catch (err) {
        if (!cancelled) setChats([]);
      } finally {
        if (!cancelled) setChatsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Refresh headline on every mount (e.g. page reload) so it changes when you come back
  useEffect(() => {
    setWelcomeHeadline(pickHeadlineForNow());
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleNewChat = async () => {
    try {
      const res = await axiosInstance.post('/api/qmate/chats', { title: 'New Chat' });
      const chat = res?.data?.data?.chat;
      if (!chat?.id) return;
      const newChat = { id: chat.id, title: chat.title, date: chat.date };
      setChats(prev => [newChat, ...prev]);
      setActiveChatId(chat.id);
      setMessages([]);
      setWelcomeHeadline(pickHeadlineForNow());
    } catch (err) {
      console.error('Failed to create new chat', err);
    }
  };

  const handleChatSelect = async (chat) => {
    if (chat.id === activeChatId) return;
    setLoadingChatId(chat.id);
    try {
      const res = await axiosInstance.get(`/api/qmate/chats/${chat.id}`);
      const data = res?.data?.data?.chat;
      if (data?.messages) {
        setMessages(Array.isArray(data.messages) ? data.messages : []);
      } else {
        setMessages([]);
      }
      setActiveChatId(chat.id);
      setWelcomeHeadline(pickHeadlineForNow());
    } catch (err) {
      console.error('Failed to load chat', err);
    } finally {
      setLoadingChatId(null);
    }
  };

  const handleSuggestionClick = (suggestion) => {
    setInput(suggestion);
    inputRef.current?.focus();
  };

  const suggestions = [
    {
      icon: '📊',
      title: 'Account Health Analysis',
      message: 'Analyze my account health and identify any issues that need attention',
    },
    {
      icon: '💰',
      title: 'Sales Performance',
      message: 'Show me my sales performance trends and key metrics for the last 30 days',
    },
    {
      icon: '📦',
      title: 'Product Insights',
      message: 'Which products are performing best and which need optimization?',
    },
    {
      icon: '🎯',
      title: 'Growth Recommendations',
      message: 'What are the top recommendations to grow my Amazon business?',
    },
  ];

  const handleDeleteChat = async (chatId, e) => {
    e.stopPropagation();
    try {
      await axiosInstance.delete(`/api/qmate/chats/${chatId}`);
    } catch (err) {
      console.error('Failed to delete chat', err);
    }
    const updatedChats = chats.filter(chat => chat.id !== chatId);
    setChats(updatedChats);
    if (activeChatId === chatId) {
      if (updatedChats.length > 0) {
        setActiveChatId(updatedChats[0].id);
        const res = await axiosInstance.get(`/api/qmate/chats/${updatedChats[0].id}`);
        const data = res?.data?.data?.chat;
        setMessages(Array.isArray(data?.messages) ? data.messages : []);
      } else {
        setActiveChatId(null);
        setMessages([]);
      }
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    let chatId = activeChatId;
    if (!chatId) {
      try {
        const createRes = await axiosInstance.post('/api/qmate/chats', { title: 'New Chat' });
        const newChat = createRes?.data?.data?.chat;
        if (!newChat?.id) return;
        chatId = newChat.id;
        setChats(prev => [{ id: newChat.id, title: newChat.title, date: newChat.date }, ...prev]);
        setActiveChatId(newChat.id);
      } catch (err) {
        console.error('Failed to create chat', err);
        return;
      }
    }

    const userMessage = {
      id: Date.now(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    let currentMessages = trimMessagesToMaxSize([...messages, userMessage], CHAT_MAX_SIZE_BYTES);
    setMessages(currentMessages);
    setInput('');
    setIsLoading(true);

    const isNewChat = !activeChatId || activeChat?.title === 'New Chat';
    const newTitle = (isNewChat ? input.trim().slice(0, 50) : activeChat?.title) || 'New Chat';
    if (chats.some(c => c.id === chatId)) {
      setChats(prev =>
        prev.map(chat =>
          chat.id === chatId ? { ...chat, title: newTitle } : chat
        )
      );
    }

    try {
      const response = await axiosInstance.post('/api/qmate/chat', {
        message: userMessage.content,
        messages: currentMessages.map(msg => ({
          role: msg.role,
          content: msg.content,
        })),
      });

      const payload = response?.data?.data || {};
      const assistantPayload = payload.message || {};

      const assistantMessage = {
        id: Date.now() + 1,
        role: 'assistant',
        content: assistantPayload.content || "I'm sorry, I couldn't generate a detailed answer this time.",
        timestamp: new Date(),
        charts: assistantPayload.charts || [],
        followUps: assistantPayload.follow_up_questions || [],
      };

      const fullMessages = trimMessagesToMaxSize([...currentMessages, assistantMessage], CHAT_MAX_SIZE_BYTES);
      setMessages(fullMessages);

      const apiMessages = fullMessages.map(m => ({
        role: m.role,
        content: m.content,
        charts: m.charts || [],
        followUps: m.followUps || [],
      }));
      await axiosInstance.patch(`/api/qmate/chats/${chatId}`, { title: newTitle, messages: apiMessages });
    } catch (error) {
      console.error('Error calling QMate API:', error);
      const assistantMessage = {
        id: Date.now() + 1,
        role: 'assistant',
        content: "I'm having trouble reaching the AI service right now. Please try again in a minute.",
        timestamp: new Date(),
      };
      const fullMessages = trimMessagesToMaxSize([...currentMessages, assistantMessage], CHAT_MAX_SIZE_BYTES);
      setMessages(fullMessages);
      const apiMessages = fullMessages.map(m => ({
        role: m.role,
        content: m.content,
        charts: m.charts || [],
        followUps: m.followUps || [],
      }));
      try {
        await axiosInstance.patch(`/api/qmate/chats/${chatId}`, { title: newTitle, messages: apiMessages });
      } catch (patchErr) {
        console.error('Failed to save chat history', patchErr);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    } else if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
  };

  return (
    <div className="flex h-full min-h-0 bg-[#0f0f0f] text-gray-100 overflow-hidden">
      {/* Sidebar - Chat History */}
      <aside className="w-64 bg-[#161b22] border-r border-[#30363d] flex flex-col flex-shrink-0">
        {/* QMate title */}
        <div className="p-3 border-b border-[#30363d] flex items-center gap-2">
          <Bot className="w-5 h-5 text-blue-400 flex-shrink-0" />
          <h1 className="text-sm font-semibold text-white">QMate</h1>
        </div>
        {/* Search history */}
        <div className="p-3 border-b border-[#30363d]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
            <input
              type="text"
              value={historySearch}
              onChange={(e) => setHistorySearch(e.target.value)}
              placeholder="Search chats..."
              className="w-full pl-9 pr-3 py-2 bg-[#21262d] border border-[#30363d] rounded-lg text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50"
            />
          </div>
        </div>

        {/* New Chat Button */}
        <div className="p-3 border-b border-[#30363d]">
          <button
            onClick={handleNewChat}
            className="w-full flex items-center gap-2 px-3 py-2.5 bg-[#21262d] hover:bg-[#1c2128] border border-[#30363d] rounded-lg text-sm font-medium text-gray-300 hover:text-white transition-colors duration-200"
          >
            <Plus className="w-4 h-4" />
            New Chat
          </button>
        </div>

        {/* Chat History */}
        <div className="flex-1 overflow-y-auto scrollbar-hide">
          <div className="p-2 space-y-1">
            {chatsLoading ? (
              <p className="px-3 py-2 text-xs text-gray-500">Loading chats...</p>
            ) : filteredChats.length === 0 ? (
              <p className="px-3 py-2 text-xs text-gray-500">
                {chats.length === 0 ? 'No chats yet' : 'No matching chats'}
              </p>
            ) : (
              filteredChats.map((chat) => (
              <motion.div
                key={chat.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className={`group relative flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-colors duration-200 ${
                  activeChatId === chat.id
                    ? 'bg-[#21262d] border border-blue-500/50'
                    : 'hover:bg-[#1c2128]'
                } ${loadingChatId === chat.id ? 'opacity-70 pointer-events-none' : ''}`}
                onClick={() => handleChatSelect(chat)}
              >
                <MessageSquare className={`w-4 h-4 flex-shrink-0 ${
                  activeChatId === chat.id ? 'text-blue-400' : 'text-gray-400'
                }`} />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium truncate ${
                    activeChatId === chat.id ? 'text-white' : 'text-gray-300'
                  }`}>
                    {chat.title}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {formatDate(chat.date)}
                  </p>
                </div>
                <button
                  onClick={(e) => handleDeleteChat(chat.id, e)}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:bg-[#30363d] rounded transition-all duration-200"
                >
                  <Trash2 className="w-3.5 h-3.5 text-gray-400 hover:text-red-400" />
                </button>
              </motion.div>
            ))
            )}
          </div>
        </div>
      </aside>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Messages Area */}
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-4 py-4">
          <div className="max-w-3xl mx-auto h-full">
            {/* Welcome Message & Suggestions - Show when no messages */}
            {messages.length === 0 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-center justify-center min-h-0 h-full py-2 space-y-4"
              >
                {/* Welcome Header - Attractive hero message */}
                <div className="text-center space-y-3 flex-shrink-0">
                  <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.1, duration: 0.4 }}
                    className="w-14 h-14 bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-600 rounded-xl flex items-center justify-center mx-auto shadow-lg shadow-blue-500/20 ring-2 ring-blue-400/20"
                  >
                    <Bot className="w-7 h-7 text-white" />
                  </motion.div>
                  <motion.h2
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="text-xl font-bold text-white tracking-tight bg-clip-text text-center max-w-md mx-auto leading-tight"
                  >
                    {welcomeHeadline}
                  </motion.h2>
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.3 }}
                    className="text-gray-400 text-xs max-w-sm mx-auto leading-relaxed"
                  >
                    I'm QMate, your AI assistant for SellerQI. Ask me anything about your Amazon seller account.
                  </motion.p>
                </div>

                {/* Suggestion Blocks */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 w-full max-w-2xl">
                  {suggestions.map((suggestion, index) => (
                    <motion.button
                      key={index}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.1 }}
                      onClick={() => handleSuggestionClick(suggestion.message)}
                      className="group relative p-3 bg-[#21262d] border border-[#30363d] rounded-xl hover:border-blue-500/50 hover:bg-[#1c2128] transition-all duration-200 text-left"
                    >
                      <div className="flex items-start gap-3">
                        <div className="text-2xl flex-shrink-0">{suggestion.icon}</div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-semibold text-white mb-1 group-hover:text-blue-400 transition-colors">
                            {suggestion.title}
                          </h3>
                          <p className="text-xs text-gray-400 line-clamp-2">
                            {suggestion.message}
                          </p>
                        </div>
                      </div>
                      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Send className="w-4 h-4 text-blue-400" />
                      </div>
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Messages List */}
            {messages.length > 0 && (
              <div className="space-y-6">
                <AnimatePresence>
                  {messages.map((message) => (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className={`flex gap-4 ${
                    message.role === 'user' ? 'justify-end' : 'justify-start'
                  }`}
                >
                  {message.role === 'assistant' && (
                    <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Bot className="w-5 h-5 text-white" />
                    </div>
                  )}
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                      message.role === 'user'
                        ? 'bg-blue-600 text-white'
                        : 'bg-[#21262d] text-gray-100 border border-[#30363d]'
                    }`}
                  >
                    <div className="text-sm leading-relaxed">
                      {message.role === 'assistant' ? (
                        <QMateMessageContent key={message.id} content={message.content} />
                      ) : (
                        <p className="whitespace-pre-wrap">{message.content}</p>
                      )}
                    </div>

                    {message.role === 'assistant' && message.charts && message.charts.length > 0 && (
                      <div className="mt-3 space-y-3">
                        {message.charts.map((chart, index) => (
                          <div
                            key={chart.id || index}
                            className="bg-[#101318] border border-[#30363d] rounded-xl p-3"
                          >
                            <p className="text-xs font-semibold text-gray-200 mb-1">
                              {chart.title || 'Chart'}
                            </p>
                            {chart.description && (
                              <p className="text-[11px] text-gray-400 mb-2">
                                {chart.description}
                              </p>
                            )}
                            {Array.isArray(chart.data) && chart.data.length > 0 && (
                              <QMateChart chart={chart} />
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {message.role === 'assistant' && message.followUps && message.followUps.length > 0 && (
                      <div className="mt-3">
                        <p className="text-[11px] font-semibold text-gray-400 mb-1">
                          You can ask:
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {message.followUps.map((q, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => handleSuggestionClick(q)}
                              className="text-[11px] px-2 py-1 rounded-full bg-[#161b22] border border-[#30363d] hover:border-blue-500/60 text-gray-300 hover:text-white transition-colors"
                            >
                              {q}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  {message.role === 'user' && (
                    <div className="w-8 h-8 bg-[#30363d] rounded-lg flex items-center justify-center flex-shrink-0">
                      <User className="w-5 h-5 text-gray-400" />
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>

                {isLoading && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex gap-4 justify-start"
                  >
                    <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Bot className="w-5 h-5 text-white" />
                    </div>
                    <div className="bg-[#21262d] border border-[#30363d] rounded-2xl px-4 py-3">
                      <div className="flex gap-1">
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                      </div>
                    </div>
                  </motion.div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>
        </div>

        {/* Input Area */}
        <div className="p-4 flex-shrink-0">
          <form onSubmit={handleSendMessage} className="max-w-3xl mx-auto">
            <div className="relative flex items-end gap-2">
              <div className="flex-1 relative">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                        handleSendMessage(e);
                    }
                  }}
                  placeholder="Message QMate..."
                  rows={1}
                  className="w-full px-4 py-3 pr-12 bg-[#21262d] border border-[#30363d] rounded-xl text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 resize-none max-h-32 overflow-y-auto scrollbar-hide"
                  style={{ minHeight: '48px' }}
                />
              </div>
              <button
                type="submit"
                disabled={!input.trim() || isLoading}
                className="p-3 bg-blue-600 hover:bg-blue-700 disabled:bg-[#30363d] disabled:cursor-not-allowed rounded-xl transition-colors duration-200 flex-shrink-0"
              >
                <Send className={`w-5 h-5 ${!input.trim() || isLoading ? 'text-gray-500' : 'text-white'}`} />
              </button>
            </div>
            <div className="mt-2 flex items-center justify-between gap-4 flex-wrap">
              <p className="text-xs text-gray-500">
                QMate can make mistakes. Check important{' '}
                <button
                  type="button"
                  onClick={() => setShowInfoModal(true)}
                  className="text-blue-400 hover:text-blue-300 underline focus:outline-none focus:ring-0"
                >
                  info
                </button>
                .
              </p>
              <p
                className={`text-xs tabular-nums ${
                  chatSizeTrack.isNearLimit ? 'text-amber-500' : 'text-gray-500'
                }`}
                title="Chat history size (oldest messages are removed above 10 MB)"
              >
                History: {chatSizeTrack.mb} MB / {chatSizeTrack.maxMb} MB
              </p>
            </div>
          </form>
        </div>
      </div>

      {/* AI info modal */}
      {showInfoModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
          onClick={() => setShowInfoModal(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="qmate-info-title"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-[#161b22] border border-[#30363d] rounded-xl shadow-xl max-w-lg w-full max-h-[85vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#30363d]">
              <h2 id="qmate-info-title" className="text-base font-semibold text-white">
                About QMate AI
              </h2>
              <button
                type="button"
                onClick={() => setShowInfoModal(false)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-[#30363d] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-5 py-4 overflow-y-auto text-sm text-gray-300 space-y-4">
              <p>
                <strong className="text-gray-100">What is QMate?</strong><br />
                QMate is an AI assistant inside SellerQI that uses your connected account data to answer questions about sales, profitability, ads, inventory, and listing issues. It does not access the internet or data outside your SellerQI analytics.
              </p>
              <p>
                <strong className="text-gray-100">It can make mistakes.</strong><br />
                Answers are generated by AI and may contain errors, outdated summaries, or suggestions that don’t fit your situation. Numbers and metrics are based on the data we have; they may be delayed or incomplete.
              </p>
              <p>
                <strong className="text-gray-100">Always verify important decisions.</strong><br />
                Before changing listings, pricing, ad spend, or acting on financial or compliance advice, confirm the details in Amazon Seller Central or your own reports. QMate is not a substitute for professional business or legal advice.
              </p>
              <p>
                <strong className="text-gray-100">Your data.</strong><br />
                QMate uses the same data as your SellerQI dashboard. If something looks wrong, refresh your data or check the relevant dashboard section. Chat history is stored so you can revisit past conversations.
              </p>
            </div>
            <div className="px-5 py-3 border-t border-[#30363d] flex justify-end">
              <button
                type="button"
                onClick={() => setShowInfoModal(false)}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              >
                Got it
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};

export default QMate;
