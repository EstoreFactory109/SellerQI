import React, { useState, useMemo, useEffect } from "react";
import { useSelector, useDispatch } from 'react-redux';
import { useSearchParams } from 'react-router-dom';
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Search,
  Download,
  RefreshCw,
  ChevronRight,
  Info
} from 'lucide-react';
import { fetchTasks, updateTaskStatus, toggleTaskStatusLocal } from '../../redux/slices/TasksSlice.js';
import { TasksPageSkeleton } from '../../Components/Skeleton/PageSkeletons.jsx';
import { COLORS } from '../../Components/Shared/index.js';

import { formatCurrencyWithLocale } from '../../utils/currencyUtils.js';
import {
  BUCKET,
  BUCKET_ORDER,
  BUCKET_LABELS,
  BUCKET_SUBTITLES,
  selectBuckets,
  formatEffort,
  groupKeyForTask,
  indexGroups
} from '../../utils/taskBuckets.js';
import MarketplaceSwitcher from '../../Components/Marketplace/MarketplaceSwitcher.jsx'
import FixItPackagesModal from '../../Components/Tasks/FixItPackagesModal.jsx';
import FixItUrgencyCard from '../../Components/Tasks/FixItUrgencyCard.jsx';
import { FIX_IT_PACKAGES } from '../../utils/featureFlags.js';
import RemovalReceiptModal from '../../Components/Tasks/RemovalReceiptModal.jsx';
import ApproveChangeModal from '../../Components/Tasks/ApproveChangeModal.jsx';
import BulkApproveModal from '../../Components/Tasks/BulkApproveModal.jsx';
import axiosInstance from '../../config/axios.config.js';
import { openTasksOf, summarizeUrgency } from '../../utils/taskUrgency.js';
import { trackEvent } from '../../utils/analytics.js';

// tasks-logics.xlsx priority labels. Word + colour, never colour alone.
const PRIORITY_BADGE = {
  P1: { label: 'Urgent', fg: COLORS.fix, bg: 'rgba(239,68,68,.14)', title: 'Fix now: account, money with a deadline, or sales stopped' },
  P2: { label: 'High', fg: COLORS.watch, bg: 'rgba(245,166,35,.14)', title: 'Fix this week: losing sales or at risk' },
  P3: { label: 'Medium', fg: COLORS.accent, bg: 'rgba(59,130,246,.14)', title: 'Worth fixing: costs money or performance' },
  P4: { label: 'Low', fg: COLORS.textMuted, bg: 'rgba(107,116,134,.14)', title: 'Polish when you have time' },
};

// Helper function to escape special regex characters in currency symbol
const escapeRegex = (str) => {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

// Tasks are grouped by what's worth doing, not by which category they came from.
// Ordering/capping lives in utils/taskBuckets.js; the effort and impact data it
// sorts on is computed server-side by TaskPrioritizationService.

// Common currency symbols to detect in messages
// Order matters: longer symbols first to avoid partial matches (e.g., "C$" before "$")
const CURRENCY_SYMBOLS = ['C$', 'A$', 'S$', 'R$', 'MX$', 'E£', 'AED', 'SAR', 'د.إ', '﷼', '$', '€', '£', '¥', '₹', '₺', 'kr', 'zł'];

// Helper function to detect and convert currency in a message
const convertCurrencyInMessage = (message, targetCurrency = '$') => {
  if (!message) return message;
  
  let convertedMessage = message;
  
  // Replace each currency symbol with the target currency
  // Process longer symbols first to avoid partial matches
  CURRENCY_SYMBOLS.forEach(originalSymbol => {
    if (originalSymbol === targetCurrency) return; // Skip if already the target currency
    
    const escapedSymbol = escapeRegex(originalSymbol);
    
    // Pattern to match: currency symbol + optional negative + number (with commas/decimals)
    // Examples: $123.45, -$123.45, $1,234.56, €100, £50.00, C$100.00
    const pattern = new RegExp(`${escapedSymbol}(-?[\\d,.]+)`, 'g');
    
    convertedMessage = convertedMessage.replace(pattern, (match, numberPart) => {
      // Keep the number part, just replace the currency symbol
      return `${targetCurrency}${numberPart}`;
    });
  });
  
  return convertedMessage;
};

// Helper function to format messages with important details highlighted on separate line
const formatMessageWithHighlight = (message, currency = '$') => {
  if (!message) return { mainText: '', highlightedText: '' };
  
  // First, convert any currency in the message to the target currency
  const convertedMessage = convertCurrencyInMessage(message, currency);
  
  // Escape currency symbol for use in regex
  const escapedCurrency = escapeRegex(currency);
  
  // Patterns to extract and highlight on a separate line
  // These patterns match the exact formats from the backend
  const patterns = [
    // Ranking - Restricted words patterns (exact backend formats)
    /^(.*?)(The Characters used are:\s*.+)$/i,  // Title - restricted words
    /^(.*?)(The characters which are used:\s*.+)$/i,  // Title - special characters
    /^(.*?)(The words Used are:\s*.+)$/,  // Bullet Points - restricted words (case sensitive 'Used')
    /^(.*?)(The words used are:\s*.+)$/i,  // Description - restricted words
    /^(.*?)(The special characters used are:\s*.+)$/i,  // Bullet Points & Description - special characters
    
    // Inventory patterns - units available
    /^(.*?)(Only \d+ units available.*)$/i,
    /^(.*?)(Currently \d+ units available.*)$/i,
    /^(.*?)(\d+ units available.*)$/i,
    
    // Inventory - Stranded reason
    /^(.*?)(Reason:\s*.+)$/i,
    
    // Inventory - Inbound non-compliance problem
    /^(.*?)(Problem:\s*.+)$/i,
    
    // Buy Box patterns
    /^(.*?)(With \d+ page views.+)$/i,
    
    // Amazon recommends pattern
    /^(.*?)(Amazon recommends replenishing \d+ units.*)$/i,
    
    // Unfulfillable inventory quantity
    /^(.*?)(Unfulfillable Quantity:\s*\d+\s*units)$/i,
    
    // Profitability patterns - using dynamic currency (after conversion)
    new RegExp(`^(.*?)(Revenue:\\s*${escapedCurrency}[\\d,.]+.*)$`, 'i'),
    new RegExp(`^(.*?)(Net Profit:\\s*-?${escapedCurrency}[\\d,.]+.*)$`, 'i'),
    new RegExp(`^(.*?)(Total Costs:\\s*${escapedCurrency}[\\d,.]+.*)$`, 'i'),
    
    // PPC/Sponsored Ads patterns - match complete parenthetical expressions first (most specific)
    new RegExp(`^(.*?)(\\([^)]*Spend:\\s*${escapedCurrency}[\\d,.]+[^)]*\\))`, 'i'),  // Match complete (Spend: ...) with brackets
    new RegExp(`^(.*?)(\\([^)]*Sales:\\s*${escapedCurrency}[\\d,.]+[^)]*\\))`, 'i'),  // Match complete (Sales: ...) with brackets
    /^(.*?)(\([^)]*ACOS:\s*[\d.]+%[^)]*\))/i,  // Match complete (ACOS: ...) with brackets
    new RegExp(`^(.*?)(\\([^)]*Spend:\\s*${escapedCurrency}[\\d,.]+[^)]*Sales:\\s*${escapedCurrency}[\\d,.]+[^)]*\\))`, 'i'),  // Match (Spend: ... Sales: ...) together
    new RegExp(`^(.*?)(Spend:\\s*${escapedCurrency}[\\d,.]+(?:\\s*,\\s*Sales:\\s*${escapedCurrency}[\\d,.]+)?[^.)]*)`, 'i'),  // Fallback for Spend without brackets (stop at period or closing paren)
    new RegExp(`^(.*?)(Sales:\\s*${escapedCurrency}[\\d,.]+[^.)]*)`, 'i'),  // Fallback for Sales without brackets
    /^(.*?)(ACOS:\s*[\d.]+%[^.(]*)/i,  // Fallback for ACOS without brackets (stop before opening paren or period)
    /^(.*?)(\d+ clicks from \d+ impressions.*)$/i,
  ];
  
  for (const pattern of patterns) {
    const match = convertedMessage.match(pattern);
    if (match && match[2]) {
      return {
        mainText: match[1].trim(),
        highlightedText: match[2].trim()
      };
    }
  }
  
  return { mainText: convertedMessage, highlightedText: '' };
};

// Component to render message with highlighted part
const FormattedMessage = ({ message, errorCategory, currency }) => {
  const { mainText, highlightedText } = formatMessageWithHighlight(message, currency);
  
  // Don't make bold for profitability and sponsored ads errors
  const shouldBold = errorCategory?.toLowerCase() !== 'profitability' && 
                     errorCategory?.toLowerCase() !== 'sponsoredads' &&
                     errorCategory?.toLowerCase() !== 'sponsored ads';
  
  return (
    <>
      {mainText && <span style={{ color: COLORS.textPrimary }}>{mainText}</span>}
      {highlightedText && (
        <>
          <br />
          {shouldBold ? (
            <strong className="mt-1 block" style={{ color: COLORS.textPrimary }}>{highlightedText}</strong>
          ) : (
            <span className="mt-1 block" style={{ color: COLORS.textPrimary }}>{highlightedText}</span>
          )}
        </>
      )}
    </>
  );
};

// Helper function to format "How to Solve" text with numbered points on separate lines
const formatHowToSolve = (text) => {
  if (!text) return [];
  
  // Check if text contains numbered points pattern (e.g., "1) ", "2) ", etc.)
  if (!text.match(/\d+\)\s+/)) {
    // No numbered points, return as single item
    return [text];
  }
  
  // Split on pattern: number followed by ") " (with optional space before)
  // Use positive lookahead to keep the delimiter
  const parts = text.split(/(?=\d+\)\s+)/);
  
  const formatted = [];
  
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed) {
      formatted.push(trimmed);
    }
  }
  
  return formatted.length > 0 ? formatted : [text];
};

// Component to render "How to Solve" with numbered points on separate lines
const FormattedHowToSolve = ({ text }) => {
  const formattedPoints = formatHowToSolve(text);
  
  return (
    <div className="space-y-1">
      {formattedPoints.map((point, index) => (
        <div key={index} className="whitespace-normal">
          {point}
        </div>
      ))}
    </div>
  );
};

export default function Tasks() {
  const dispatch = useDispatch();
  const [searchQuery, setSearchQuery] = useState('');
  const [showFixIt, setShowFixIt] = useState(false);
  // The task whose "approve this change on Amazon" dialog is open.
  const [approveTask, setApproveTask] = useState(null);
  // Several selected ad changes approved together.
  const [bulkApproveTasks, setBulkApproveTasks] = useState(null);
  // The removal_confirm_receipt task whose "Confirm what arrived" form is open.
  const [receiptTaskId, setReceiptTaskId] = useState(null);
  // Replenishment lead time for this marketplace (server default 45 days when unset).
  const [leadTime, setLeadTime] = useState(null); // { days, defaultDays }
  const [leadTimeEditing, setLeadTimeEditing] = useState(false);
  const [leadTimeInput, setLeadTimeInput] = useState('');
  const [leadTimeNote, setLeadTimeNote] = useState(null);
  const saveLeadTime = async () => {
    const days = leadTimeInput.trim() === '' ? null : Number(leadTimeInput);
    if (days !== null && !(Number.isInteger(days) && days >= 1 && days <= 365)) {
      setLeadTimeNote({ ok: false, text: 'Enter a whole number of days from 1 to 365.' });
      return;
    }
    try {
      await axiosInstance.put('/api/pagewise/inventory/lead-time', { days }, { withCredentials: true });
      setLeadTime((lt) => ({ ...(lt || {}), days }));
      setLeadTimeEditing(false);
      setLeadTimeNote({ ok: true, text: 'Saved. Replenishment tasks use it from the next data refresh.' });
      trackEvent('lead_time_set', { days: days ?? 'default' });
    } catch (err) {
      setLeadTimeNote({ ok: false, text: err.response?.data?.message || 'Could not save. Please try again.' });
    }
  };
  // detail_page_changed: the seller says the change was theirs.
  const [mineSaving, setMineSaving] = useState(null);
  const markChangeAsMine = async (item) => {
    setMineSaving(item.taskId);
    try {
      await axiosInstance.post('/api/pagewise/tasks/listing-changes/confirm', { taskId: item.taskId }, { withCredentials: true });
      trackEvent('listing_change_confirm_mine');
      if (!completedTasks.has(item.taskId)) dispatch(toggleTaskStatusLocal({ taskId: item.taskId }));
    } catch (err) {
      setResellerNotes((n) => ({ ...n, [item.taskId]: { ok: false, text: err.response?.data?.message || 'Could not save. Please try again.' } }));
    } finally {
      setMineSaving(null);
    }
  };
  // new_seller_on_brand tasks: which one is saving, and per-task messages.
  const [resellerSaving, setResellerSaving] = useState(null);
  const [resellerNotes, setResellerNotes] = useState({});

  // "These are my authorised resellers": whitelist the task's new seller IDs, so they
  // are never flagged again on this marketplace, and tick the task off.
  const markAuthorisedResellers = async (item) => {
    const sellerIds = item.renderData?.sellerIds || [];
    if (sellerIds.length === 0) return;
    const ok = window.confirm(
      `Mark ${sellerIds.length === 1 ? `seller ${sellerIds[0]}` : `sellers ${sellerIds.join(', ')}`} as authorised to sell your products? ` +
      'You will not be warned about them again on this marketplace.'
    );
    if (!ok) return;
    setResellerSaving(item.taskId);
    try {
      await axiosInstance.post('/api/authorized-resellers', { sellerIds }, { withCredentials: true });
      setResellerNotes((n) => ({ ...n, [item.taskId]: { ok: true, text: 'Saved as authorised. They will not be flagged again.' } }));
      trackEvent('authorized_resellers_add', { count: sellerIds.length });
      if (!completedTasks.has(item.taskId)) dispatch(updateTaskStatus({ taskId: item.taskId, status: 'completed' }));
    } catch (err) {
      setResellerNotes((n) => ({ ...n, [item.taskId]: { ok: false, text: err.response?.data?.message || 'Could not save. Please try again.' } }));
    } finally {
      setResellerSaving(null);
    }
  };
  // Deep-link support: the Dashboard's "Top things to fix" links here with
  // ?category=&type= so a seller lands on the individual rows that make up the
  // figure they just clicked, instead of the unfiltered list.
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedCategory = searchParams.get('category');
  const linkedType = searchParams.get('type');
  // Set when arriving from a "top products to fix" row — shows just that product's issues.
  const linkedAsin = searchParams.get('asin');

  const [filterCategory, setFilterCategory] = useState(linkedCategory || 'all');
  const [filterType, setFilterType] = useState(linkedType || null);
  const [filterAsin, setFilterAsin] = useState(linkedAsin || null);
  const [filterStatus, setFilterStatus] = useState('all');
  const [selectedTaskIds, setSelectedTaskIds] = useState(() => new Set());
  const [expandedGroups, setExpandedGroups] = useState({
    [BUCKET.HIGH_IMPACT]: true,
    [BUCKET.QUICK_WINS]: true,
    [BUCKET.EVERYTHING_ELSE]: false
  });
  const [groupDisplayLimits, setGroupDisplayLimits] = useState({
    [BUCKET.HIGH_IMPACT]: 10,
    [BUCKET.QUICK_WINS]: 10,
    [BUCKET.EVERYTHING_ELSE]: 10
  });
  const GROUP_PAGE_SIZE = 10;

  // Get tasks data from Redux store
  const tasks = useSelector(state => state.tasks?.tasks || []);
  const taskRenewalDate = useSelector(state => state.tasks?.taskRenewalDate);
  const loading = useSelector(state => state.tasks?.loading || false);
  const error = useSelector(state => state.tasks?.error);
  const completedTasksArray = useSelector(state => state.tasks?.completedTasks || []);
  // Issue-type aggregates, identical to what the Dashboard's "Top things to fix"
  // reports — used to show a task's standing inside that same figure.
  const taskGroups = useSelector(state => state.tasks?.groups || []);
  
  // Convert array to Set for easier checking
  const completedTasks = useMemo(() => new Set(completedTasksArray), [completedTasksArray]);

  // Get user data from Redux store
  const userData = useSelector(state => state.Auth?.user);
  
  // Get currency from Redux store
  const currency = useSelector(state => state.currency?.currency) || '$';
  
  // Get products data from Redux store for product name lookup
  const totalProducts = useSelector(state => state.Dashboard?.DashBoardInfo?.TotalProduct) || [];




  // Fetch tasks data from Redux (only if not already loaded)
  useEffect(() => {
    if (!userData?.userId) {
      return;
    }

    // Only fetch if tasks are empty or haven't been fetched recently
    if (tasks.length === 0) {
      dispatch(fetchTasks());
    }
  }, [userData?.userId, tasks.length, dispatch]);

  // The lead time replenishment tasks are judged on, only when there are any.
  const hasReplenishTasks = tasks.some((t) => String(t.errorType || '').startsWith('replenishment_needed'));
  useEffect(() => {
    if (!hasReplenishTasks || leadTime) return;
    axiosInstance.get('/api/pagewise/inventory/lead-time', { withCredentials: true })
      .then((res) => setLeadTime(res.data?.data || null))
      .catch(() => {});
  }, [hasReplenishTasks, leadTime]);

  // Create a map of ASIN to product details for quick lookup
  const productDetailsMap = useMemo(() => {
    const map = new Map();
    totalProducts.forEach(product => {
      if (product.asin) {
        map.set(product.asin, {
          name: product.itemName || product.title || product.productName || null,
          sku: product.sku || null
        });
      }
    });
    return map;
  }, [totalProducts]);

  // Transform API data to match table structure
  const transformedTasks = useMemo(() => {
    return tasks.map((task, index) => {
      // Get product details from the map
      const productDetails = productDetailsMap.get(task.asin);
      
      // Get the product name - prioritize the one from products list if the task has a generic name
      let productName = task.productName;
      
      // If product name is generic (starts with "Product " followed by ASIN), look it up
      if (productName && productName.startsWith('Product ') && task.asin) {
        if (productDetails?.name) {
          productName = productDetails.name;
        }
      }
      
      // If no product name at all, try to look it up
      if (!productName && task.asin) {
        productName = productDetails?.name || `Product ${task.asin}`;
      }
      
      // Get SKU from product details
      const sku = productDetails?.sku || null;
      
      return {
        slNo: index + 1,
        taskId: task.taskId,
        product: productName,
        asin: task.asin,
        sku: sku,
        errorCategory: task.errorCategory,
        errorType: task.errorType,
        error: task.error,
        howToSolve: task.solution,
        status: task.status,
        // Reopened by the server: the seller marked it done more than a week ago
        // but the latest data still shows the issue.
        stillDetected: !!task.stillDetected,
        amount: task.amount || 0,
        amountIsEstimated: !!task.amountIsEstimated,
        // Stock value stuck in FBA: a one-off figure, never added to monthly money.
        capitalAmount: task.capitalAmount || 0,
        // Effort/impact come from the server (TaskPrioritizationService) and drive
        // the bucketing below.
        effortMinutes: task.effortMinutes,
        impactWeight: task.impactWeight,
        isQuickWin: !!task.isQuickWin,
        // tasks-logics.xlsx P1-P4 (server TaskPriorityLevels).
        priorityLevel: task.priorityLevel || null,
        // A fix SellerQI can make on Amazon once the seller approves it (server TaskActionService).
        proposedAction: task.proposedAction || null,
        // Task-specific details some actions need (e.g. the seller IDs on a
        // new_seller_on_brand task).
        renderData: task.renderData || null
      };
    });
  }, [tasks, productDetailsMap]);

  // Tasks the server closed because the issue stopped being detected. They are in
  // completedTasks too (see TasksSlice), so progress and filters treat them as done.
  const resolvedTaskIds = useMemo(
    () => new Set(transformedTasks.filter(t => t.status === 'resolved').map(t => t.taskId)),
    [transformedTasks]
  );

  const statusLabel = (item) => {
    if (resolvedTaskIds.has(item.taskId)) return 'Resolved automatically';
    if (completedTasks.has(item.taskId)) return 'Completed';
    if (item.stillDetected) return 'Still detected';
    return 'Pending';
  };

  const statusTitle = (item) => {
    if (resolvedTaskIds.has(item.taskId)) return 'Our latest data no longer shows this issue.';
    if (!completedTasks.has(item.taskId) && item.stillDetected) {
      return 'You marked this done over a week ago, but our latest data still shows the issue.';
    }
    return undefined;
  };

  // Real completion progress (over ALL tasks, not just the current filtered/paginated view)
  const totalTasksCount = transformedTasks.length;
  const completedTasksCount = useMemo(
    () => transformedTasks.filter(t => completedTasks.has(t.taskId)).length,
    [transformedTasks, completedTasks]
  );
  const pendingTasksCount = totalTasksCount - completedTasksCount;
  const progressPct = totalTasksCount > 0 ? Math.round((completedTasksCount / totalTasksCount) * 100) : 0;
  const progressWidth = completedTasksCount > 0 ? Math.max(1.5, progressPct) : 0;

  // completedTasks is now managed by Redux, no need for this effect

  // Filter and sort data
  const filteredAndSortedData = useMemo(() => {
    let filtered = transformedTasks;

    // Apply status filter
    if (filterStatus === 'pending') {
      filtered = filtered.filter(item => !completedTasks.has(item.taskId));
    } else if (filterStatus === 'completed') {
      filtered = filtered.filter(item => completedTasks.has(item.taskId));
    }
    // If filterStatus is 'all', show all tasks

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(item =>
        item.product.toLowerCase().includes(query) ||
        item.asin.toLowerCase().includes(query) ||
        item.error.toLowerCase().includes(query) ||
        item.errorCategory.toLowerCase().includes(query)
      );
    }

    // Apply category filter
    if (filterCategory !== 'all') {
      filtered = filtered.filter(item =>
        item.errorCategory.toLowerCase() === filterCategory.toLowerCase()
      );
    }

    // Narrows to one issue type when arriving from a Dashboard opportunity. Applied
    // only if it actually matches something — a stale link (an opportunity stored
    // under an older issueType name) then degrades to the category view instead of
    // stranding the seller on an empty page.
    if (filterType) {
      const ofType = filtered.filter(item => groupKeyForTask(item).endsWith(`:${filterType}`));
      if (ofType.length > 0) filtered = ofType;
    }

    // Narrows to one product when arriving from a "top products to fix" row. Same
    // degrade-rather-than-strand rule.
    if (filterAsin) {
      const ofAsin = filtered.filter(item => item.asin === filterAsin);
      if (ofAsin.length > 0) filtered = ofAsin;
    }

    return filtered;
  }, [transformedTasks, searchQuery, filterCategory, filterType, filterAsin, filterStatus, completedTasks]);

  // True only when the deep-linked type really narrowed the list, so the banner
  // can't claim a filter that isn't in effect.
  const linkedTypeMatched = useMemo(
    () => !!filterType && transformedTasks.some(item => groupKeyForTask(item).endsWith(`:${filterType}`)),
    [filterType, transformedTasks]
  );

  const linkedAsinMatched = useMemo(
    () => !!filterAsin && transformedTasks.some(item => item.asin === filterAsin),
    [filterAsin, transformedTasks]
  );

  // Clears whichever deep-link narrowing is active and drops it from the URL.
  const clearDeepLink = () => {
    setFilterType(null);
    setFilterAsin(null);
    setFilterCategory('all');
    const next = new URLSearchParams(searchParams);
    next.delete('category');
    next.delete('type');
    next.delete('asin');
    setSearchParams(next, { replace: true });
  };

  // High impact / Quick wins / Everything else. Computed from the FILTERED list so
  // narrowing to one section re-buckets within that section, and from completedTasks
  // so a ticked-off task doesn't hold a "do this first" slot.
  const groupedTasks = useMemo(
    () => selectBuckets(filteredAndSortedData, { completedTaskIds: completedTasks }),
    [filteredAndSortedData, completedTasks]
  );

  // An empty bucket is hidden rather than rendered as a permanently-empty group.
  const bucketsPresent = useMemo(
    () => new Set(BUCKET_ORDER.filter(id => (groupedTasks[id] || []).length > 0)),
    [groupedTasks]
  );

  const groupsById = useMemo(() => indexGroups(taskGroups), [taskGroups]);

  // What leaving the open tasks undone costs: drives the hero, the risk banner and
  // the per-package value in the Fix it modal. Open tasks only, so ticking one off
  // lowers the figures straight away.
  const openTasks = useMemo(() => openTasksOf(transformedTasks, completedTasks), [transformedTasks, completedTasks]);
  const urgency = useMemo(() => summarizeUrgency(openTasks, taskGroups), [openTasks, taskGroups]);

  const openFixIt = (source) => {
    trackEvent('fixit_open', {
      source,
      open_tasks: urgency.openCount,
      monthly_recoverable: urgency.monthlyRecoverable,
    });
    setShowFixIt(true);
  };

  // "1 of 93 keywords spending money with zero sales · A$187.41 total" — shown on
  // highlighted rows so a A$26.37 task reads as part of the Dashboard's A$187.41,
  // rather than looking like the two pages disagree.
  const getGroupContext = (item) => {
    const group = groupsById.get(groupKeyForTask(item));
    if (!group || group.count <= 1) return null;
    const money = group.totalAmount > 0
      ? ` · ${formatCurrencyWithLocale(group.totalAmount, currency)} total`
      : '';
    return `1 of ${group.count} · ${group.title}${money}`;
  };

  const toggleGroup = (groupId) => {
    setExpandedGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  const showMoreInGroup = (groupId) => {
    setGroupDisplayLimits(prev => ({ ...prev, [groupId]: prev[groupId] + GROUP_PAGE_SIZE }));
  };

  const toggleSelectTask = (taskId) => {
    setSelectedTaskIds(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId); else next.add(taskId);
      return next;
    });
  };

  const selectGroup = (items) => {
    setSelectedTaskIds(prev => {
      const next = new Set(prev);
      items.forEach(item => next.add(item.taskId));
      return next;
    });
  };

  const clearSelection = () => setSelectedTaskIds(new Set());

  const markSelectedComplete = () => {
    selectedTaskIds.forEach(taskId => {
      if (!completedTasks.has(taskId) && !resolvedTaskIds.has(taskId)) {
        dispatch(updateTaskStatus({ taskId, status: 'completed' }));
      }
    });
    clearSelection();
  };

  const exportRowsToCSV = (rows, filenameSuffix) => {
    const headers = ['Product', 'ASIN', 'Error Category', 'Error', 'How To Solve', 'Amount', 'Estimated', 'Status'];
    const csvContent = [
      headers.join(','),
      ...rows.map(item => [
        `"${item.product.replace(/"/g, '""')}"`, // Escape quotes in product name
        item.asin,
        item.errorCategory,
        `"${item.error.replace(/"/g, '""')}"`, // Escape quotes in error message
        `"${item.howToSolve.replace(/"/g, '""')}"`, // Escape quotes in how to solve
        item.amount > 0 ? `"${formatCurrencyWithLocale(item.amount, currency)}"` : '', // Quoted - locale formatting adds commas
        // The on-screen amount carries a '*' when it's an estimate; keep that
        // caveat in the export rather than losing it on download.
        item.amount > 0 && item.amountIsEstimated ? 'Yes' : '',
        statusLabel(item)
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `tasks_${filenameSuffix}_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportToCSV = () => exportRowsToCSV(filteredAndSortedData, 'export');
  const exportSelectedToCSV = () => exportRowsToCSV(transformedTasks.filter(t => selectedTaskIds.has(t.taskId)), 'selected');

  const toggleTaskStatus = async (taskId) => {
    // Resolved is the server's call (the issue is gone); there is nothing to undo.
    if (resolvedTaskIds.has(taskId)) return;
    const isCurrentlyCompleted = completedTasks.has(taskId);
    const newStatus = isCurrentlyCompleted ? 'pending' : 'completed';
    
    // Optimistically update Redux state
    dispatch(updateTaskStatus({ taskId, status: newStatus }));
  };

  const refreshTasks = () => {
    if (!userData?.userId) return;
    dispatch(fetchTasks());
  };

  const getBucketColor = (bucketId) => {
    switch (bucketId) {
      case BUCKET.HIGH_IMPACT:
        return { color: '#f87171', background: 'rgba(239, 68, 68, 0.2)', border: 'rgba(239, 68, 68, 0.3)' };
      case BUCKET.QUICK_WINS:
        return { color: '#22c55e', background: 'rgba(34, 197, 94, 0.2)', border: 'rgba(34, 197, 94, 0.3)' };
      default:
        return { color: '#9ca3af', background: 'rgba(156, 163, 175, 0.2)', border: 'rgba(156, 163, 175, 0.3)' };
    }
  };

  // Get category color for error category badges (same as Overview page)
  const getCategoryColor = (category) => {
    switch (category?.toLowerCase()) {
      case 'ranking':
        return { color: '#fbbf24', background: 'rgba(251, 191, 36, 0.2)', border: 'rgba(251, 191, 36, 0.3)' };
      case 'conversion':
        return { color: '#f87171', background: 'rgba(239, 68, 68, 0.2)', border: 'rgba(239, 68, 68, 0.3)' };
      case 'inventory':
        return { color: '#fb923c', background: 'rgba(251, 146, 60, 0.2)', border: 'rgba(251, 146, 60, 0.3)' };
      case 'account health':
        return { color: '#60a5fa', background: 'rgba(96, 165, 250, 0.2)', border: 'rgba(96, 165, 250, 0.3)' };
      case 'profitability':
        return { color: '#22c55e', background: 'rgba(34, 197, 94, 0.2)', border: 'rgba(34, 197, 94, 0.3)' };
      case 'sponsored ads':
        return { color: '#c084fc', background: 'rgba(192, 132, 252, 0.2)', border: 'rgba(192, 132, 252, 0.3)' };
      default:
        return { color: '#9ca3af', background: 'rgba(156, 163, 175, 0.2)', border: 'rgba(156, 163, 175, 0.3)' };
    }
  };

  // Get unique categories from tasks
  const categories = useMemo(() => {
    const uniqueCategories = [...new Set(tasks.map(task => task.errorCategory))];
    return ['all', ...uniqueCategories];
  }, [tasks]);

  if (loading) {
    return <TasksPageSkeleton rows={10} />;
  }

  if (error) {
    return (
      <div className="min-h-screen overflow-x-hidden w-full flex items-center justify-center" style={{ background: '#1a1a1a' }}>
        <div className="flex flex-col items-center gap-2">
          <AlertTriangle className="w-6 h-6" style={{ color: '#f87171' }} />
          <p className="text-xs" style={{ color: '#f87171' }}>{error}</p>
          <button 
            onClick={refreshTasks}
            className="px-3 py-1.5 rounded-lg transition-all text-xs"
            style={{ background: '#3b82f6', color: 'white' }}
            onMouseEnter={(e) => e.target.style.background = '#2563eb'}
            onMouseLeave={(e) => e.target.style.background = '#3b82f6'}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-x-hidden w-full p-2 md:p-3 font-sans" style={{ background: COLORS.bgBase }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-2 mb-4">
        <div>
          <h1 className="m-0 mb-1 text-2xl leading-8 font-semibold tracking-[-0.02em]" style={{ color: COLORS.textPrimary }}>Tasks</h1>
          <p className="m-0 text-sm" style={{ color: COLORS.textSecondary }}>Every issue we found, turned into something you can actually do. Start at the top.</p>
        </div>
        <div className='flex items-center gap-2 flex-shrink-0'>
          <MarketplaceSwitcher />
          {/* Export Button */}
          <button
            onClick={exportToCSV}
            className="flex items-center gap-1.5 px-[14px] py-[9px] rounded-lg text-[13px] font-medium border transition-colors"
            style={{ background: COLORS.surface, borderColor: COLORS.border, color: COLORS.textPrimary }}
          >
            <Download size={15} />
            Export CSV
          </button>

          {/* Refresh Button */}
          <button
            onClick={refreshTasks}
            disabled={loading}
            className="flex items-center gap-1.5 px-[14px] py-[9px] rounded-lg text-[13px] font-medium border transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: COLORS.surface, borderColor: COLORS.border, color: COLORS.textPrimary }}
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* One card: what the open tasks cost, what threatens the account, and the
          way out. Every figure comes from the seller's own open tasks. */}
      <FixItUrgencyCard
        urgency={urgency}
        openTasks={openTasks}
        totalTasks={transformedTasks.length}
        currency={currency}
        onFix={FIX_IT_PACKAGES ? openFixIt : undefined}
      />

      {/* Renew date tip - always visible (same style as Your Products page) */}
      <div className="bg-blue-500/10 border-l-4 border-blue-500/40 p-2 mb-2 rounded-r space-y-3">
        <div className="flex items-start gap-2">
          <Info className="text-blue-400 flex-shrink-0 mt-0.5" size={16} />
          <div>
            <h3 className="text-xs font-semibold text-blue-300 mb-0.5">Tasks renewal</h3>
            <p className="text-xs text-blue-400">
              {taskRenewalDate
                ? <>Tasks renew on <strong>{new Date(taskRenewalDate).toLocaleDateString(undefined, { dateStyle: 'long' })}</strong>.</>
                : 'Tasks are renewed periodically. The next renewal date will appear here once your tasks have been loaded.'}
            </p>
          </div>
        </div>
      </div>

      {/* Arrived from a Dashboard opportunity or a "top products to fix" row —
          make the narrowing visible and undoable. */}
      {(linkedTypeMatched || linkedAsinMatched) && (
        <div
          className="flex items-center gap-2 flex-wrap mb-3 px-3.5 py-2.5 rounded-xl border text-[13px]"
          style={{ borderColor: COLORS.border, background: 'rgba(59,130,246,.07)', color: COLORS.textSecondary }}
        >
          <span>
            {linkedAsinMatched ? (
              <>
                Showing only <strong style={{ color: COLORS.textPrimary }}>{filterAsin}</strong>
                {' '}— every open issue on that product.
              </>
            ) : (
              <>
                Showing only <strong style={{ color: COLORS.textPrimary }}>
                  {groupsById.get(`${filterCategory}:${filterType}`)?.title || filterType}
                </strong> — the tasks behind that dashboard figure.
              </>
            )}
          </span>
          <button
            type="button"
            onClick={clearDeepLink}
            className="px-2.5 py-1 rounded-lg text-xs border transition-colors"
            style={{ borderColor: COLORS.borderStrong, color: COLORS.textSecondary, background: 'transparent' }}
          >
            Show all tasks
          </button>
        </div>
      )}

      {/* Category filter - pill tabs, categories derived from real task data */}
      <div className="flex gap-1.5 flex-wrap mb-3">
        {categories.map(category => {
          const isOn = filterCategory === category;
          return (
            <button
              key={category}
              type="button"
              onClick={() => { setFilterCategory(category); setFilterType(null); setFilterAsin(null); }}
              className="px-[13px] py-[7px] rounded-full text-xs font-medium border transition-colors"
              style={{
                borderColor: isOn ? COLORS.accent : COLORS.border,
                background: isOn ? 'rgba(59,130,246,.12)' : 'transparent',
                color: isOn ? COLORS.textPrimary : COLORS.textSecondary,
              }}
            >
              {category === 'all' ? 'All categories' : category}
            </button>
          );
        })}
      </div>

      {/* Search + status toggle */}
      <div className="flex items-center gap-2.5 flex-wrap mb-3">
        <div className="relative flex-1 min-w-[240px] max-w-[360px]">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2" size={15} style={{ color: COLORS.textMuted }} />
          <input
            type="text"
            placeholder="Search a product, ASIN or problem…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg text-[13px] focus:outline-none transition-colors"
            style={{ background: COLORS.bgBase, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary }}
            onFocus={(e) => { e.target.style.borderColor = COLORS.accent; }}
            onBlur={(e) => { e.target.style.borderColor = COLORS.border; }}
          />
        </div>
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="px-3 py-2 rounded-lg text-xs border transition-colors"
            style={{ borderColor: COLORS.border, color: COLORS.textSecondary, background: 'transparent' }}
          >
            Clear
          </button>
        )}
        <div className="flex-1" />
        <div className="flex gap-0.5 p-0.5 rounded-lg border" style={{ borderColor: COLORS.border, background: COLORS.bgBase }}>
          {[
            { id: 'all', label: 'All' },
            { id: 'pending', label: 'Pending' },
            { id: 'completed', label: 'Completed' },
          ].map(s => {
            const isOn = filterStatus === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setFilterStatus(s.id)}
                className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
                style={{
                  background: isOn ? 'rgba(59,130,246,.16)' : 'transparent',
                  color: isOn ? COLORS.textPrimary : COLORS.textMuted,
                }}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Selection legend */}
      <div className="flex items-center gap-4 text-xs mb-3" style={{ color: COLORS.textMuted }}>
        <span className="flex items-center gap-1.5">
          <span className="w-3.5 h-3.5 rounded-full border inline-block" style={{ borderColor: COLORS.borderStrong }} />
          Select for a batch action
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-[15px] h-[15px] rounded border inline-block" style={{ borderColor: COLORS.borderStrong }} />
          Mark complete
        </span>
      </div>

      {/* High impact / Quick wins / Everything else */}
      <div className="flex flex-col gap-3.5">
        {BUCKET_ORDER.filter(id => bucketsPresent.has(id)).map(groupId => {
          const items = groupedTasks[groupId] || [];
          const isOpen = expandedGroups[groupId];
          const displayLimit = groupDisplayLimits[groupId];
          const visibleItems = items.slice(0, displayLimit);
          const remaining = items.length - visibleItems.length;
          const pendingInGroup = items.filter(i => !completedTasks.has(i.taskId)).length;
          const recoverableInGroup = items.reduce((sum, i) => sum + (i.amount || 0), 0);
          const sc = getBucketColor(groupId);
          const subtitle = BUCKET_SUBTITLES[groupId];

          return (
            <div key={groupId} className="rounded-2xl border overflow-hidden" style={{ borderColor: COLORS.border, background: COLORS.surface }}>
              <div className="flex items-center gap-3 px-5 py-[15px]">
                <button
                  type="button"
                  onClick={() => toggleGroup(groupId)}
                  className="flex items-center gap-3 flex-1 min-w-0 text-left"
                >
                  <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: sc.color }} />
                  <span className="text-base font-semibold" style={{ color: COLORS.textPrimary }}>{BUCKET_LABELS[groupId]}</span>
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-bold flex-shrink-0" style={{ background: sc.background, color: sc.color }}>{items.length}</span>
                  {subtitle && (
                    <span className="text-[12px] flex-shrink-0" style={{ color: COLORS.textMuted }}>{subtitle}</span>
                  )}
                  <span className="flex-1" />
                  {recoverableInGroup > 0 && (
                    <span className="text-[13px] font-semibold flex-shrink-0" style={{ color: COLORS.good }}>
                      {formatCurrencyWithLocale(recoverableInGroup, currency)} recoverable
                    </span>
                  )}
                  <span className="text-[13px] flex-shrink-0" style={{ color: COLORS.textSecondary }}>{pendingInGroup} pending</span>
                  <ChevronRight size={16} style={{ color: COLORS.textMuted, transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s', flexShrink: 0 }} />
                </button>
                {FIX_IT_PACKAGES && groupId === BUCKET.HIGH_IMPACT && pendingInGroup > 0 && (
                  <button
                    type="button"
                    onClick={() => openFixIt('bucket')}
                    className="flex-none px-[11px] py-1.5 rounded-lg text-xs font-semibold transition-opacity hover:opacity-90 whitespace-nowrap"
                    style={{ background: 'rgba(59,130,246,.14)', color: COLORS.accent }}
                  >
                    Have us fix these
                  </button>
                )}
                {items.length > 0 && (
                  <button
                    type="button"
                    onClick={() => selectGroup(items)}
                    className="flex-none px-[11px] py-1.5 rounded-lg text-xs border transition-colors whitespace-nowrap"
                    style={{ borderColor: COLORS.border, color: COLORS.textSecondary, background: 'transparent' }}
                  >
                    Select group
                  </button>
                )}
              </div>

              {isOpen && (
                <div>
                  {visibleItems.map((item, index) => (
                    <motion.div
                      key={item.taskId}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.03 }}
                      className="flex gap-3.5 px-5 py-4"
                      style={{
                        borderTop: `1px solid ${COLORS.border}`,
                        opacity: completedTasks.has(item.taskId) ? 0.55 : 1,
                        background: selectedTaskIds.has(item.taskId) ? 'rgba(59,130,246,.07)' : 'transparent',
                      }}
                    >
                      <div className="flex-none flex flex-col items-center gap-[11px] pr-3" style={{ borderRight: `1px solid ${COLORS.border}` }}>
                        <button
                          type="button"
                          title="Select for a batch action"
                          onClick={() => toggleSelectTask(item.taskId)}
                          className="w-4 h-4 mt-1 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] leading-none cursor-pointer transition-colors"
                          style={{
                            border: `1px solid ${selectedTaskIds.has(item.taskId) ? COLORS.accent : COLORS.borderStrong}`,
                            background: selectedTaskIds.has(item.taskId) ? 'rgba(59,130,246,.28)' : 'transparent',
                            color: '#7EA8F8',
                          }}
                        >
                          {selectedTaskIds.has(item.taskId) ? '✓' : ''}
                        </button>
                        <button
                          type="button"
                          title={resolvedTaskIds.has(item.taskId) ? 'Resolved automatically — this issue is no longer detected' : 'Mark complete'}
                          onClick={() => toggleTaskStatus(item.taskId)}
                          disabled={resolvedTaskIds.has(item.taskId)}
                          className={`w-5 h-5 rounded-md flex-shrink-0 flex items-center justify-center text-xs leading-none transition-colors ${resolvedTaskIds.has(item.taskId) ? 'cursor-default' : 'cursor-pointer'}`}
                          style={{
                            border: `1px solid ${completedTasks.has(item.taskId) ? COLORS.good : COLORS.borderStrong}`,
                            background: completedTasks.has(item.taskId) ? 'rgba(34,197,94,.18)' : 'transparent',
                            color: COLORS.good,
                          }}
                        >
                          {completedTasks.has(item.taskId) ? '✓' : ''}
                        </button>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1.5">
                          {(() => {
                            const categoryStyle = getCategoryColor(item.errorCategory);
                            return (
                              <span className="px-2 py-0.5 rounded text-[11px] font-semibold" style={{ background: categoryStyle.background, color: categoryStyle.color }}>
                                {item.errorCategory}
                              </span>
                            );
                          })()}
                          <span className="text-[13px] truncate" style={{ color: COLORS.textSecondary }} title={item.product}>{item.product}</span>
                          <span className="text-xs tabular-nums flex-shrink-0" style={{ color: COLORS.textMuted }}>{item.asin}</span>
                        </div>
                        <div className="text-sm font-medium mb-1.5 whitespace-normal break-words" style={{ color: COLORS.textPrimary }}>
                          <FormattedMessage message={item.error} errorCategory={item.errorCategory} currency={currency} />
                        </div>
                        <div className="text-[13px] leading-5" style={{ color: COLORS.textSecondary }}>
                          <span style={{ color: COLORS.textMuted }}>How to fix — </span>
                          <FormattedHowToSolve text={item.howToSolve} />
                        </div>
                        {item.errorType === 'new_seller_on_brand' && (item.renderData?.sellerIds || []).length > 0 && (
                          <div className="mt-2.5 flex items-center gap-2.5 flex-wrap">
                            {!completedTasks.has(item.taskId) && (
                              <button
                                type="button"
                                onClick={() => markAuthorisedResellers(item)}
                                disabled={resellerSaving === item.taskId}
                                className="px-3.5 py-1.5 rounded-lg text-xs font-semibold border disabled:opacity-50"
                                style={{ borderColor: COLORS.border, color: COLORS.textPrimary, background: 'transparent' }}
                              >
                                {resellerSaving === item.taskId
                                  ? 'Saving…'
                                  : (item.renderData.sellerIds.length === 1 ? 'This is my authorised reseller' : 'These are my authorised resellers')}
                              </button>
                            )}
                            {resellerNotes[item.taskId] && (
                              <span role="status" className="text-xs" style={{ color: resellerNotes[item.taskId].ok ? COLORS.good : COLORS.watch }}>
                                {resellerNotes[item.taskId].text}
                              </span>
                            )}
                          </div>
                        )}
                        {String(item.errorType || '').startsWith('replenishment_needed') && leadTime && (
                          <div className="mt-2 text-xs flex flex-wrap items-center gap-2" style={{ color: COLORS.textSecondary }}>
                            {leadTimeEditing ? (
                              <>
                                <label htmlFor={`lead-time-${item.taskId}`}>Your lead time (days):</label>
                                <input
                                  id={`lead-time-${item.taskId}`}
                                  type="number"
                                  min="1"
                                  max="365"
                                  value={leadTimeInput}
                                  onChange={(e) => setLeadTimeInput(e.target.value)}
                                  placeholder={String(leadTime.defaultDays)}
                                  className="w-20 rounded border px-2 py-0.5"
                                  style={{ borderColor: COLORS.border, background: COLORS.surfaceElevated, color: COLORS.textPrimary }}
                                />
                                <button type="button" onClick={saveLeadTime} className="px-2 py-0.5 rounded text-xs font-semibold" style={{ background: COLORS.accent, color: '#061021' }}>Save</button>
                                <button type="button" onClick={() => setLeadTimeEditing(false)} className="px-2 py-0.5 rounded text-xs border" style={{ borderColor: COLORS.border, color: COLORS.textSecondary, background: 'transparent' }}>Cancel</button>
                              </>
                            ) : (
                              <>
                                <span>Judged on a {leadTime.days || leadTime.defaultDays}-day lead time{leadTime.days ? '' : ' (default)'} plus 14 days.</span>
                                <button type="button" onClick={() => { setLeadTimeInput(leadTime.days ? String(leadTime.days) : ''); setLeadTimeEditing(true); setLeadTimeNote(null); }} className="underline" style={{ color: COLORS.accent, background: 'transparent' }}>
                                  Set your lead time
                                </button>
                              </>
                            )}
                            {leadTimeNote && <span role="status" style={{ color: leadTimeNote.ok ? COLORS.good : COLORS.watch }}>{leadTimeNote.text}</span>}
                          </div>
                        )}
                        {item.errorType === 'detail_page_changed' && !completedTasks.has(item.taskId) && (
                          <button
                            type="button"
                            onClick={() => markChangeAsMine(item)}
                            disabled={mineSaving === item.taskId}
                            className="mt-2.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold border"
                            style={{ borderColor: COLORS.border, color: COLORS.textPrimary, background: 'transparent' }}
                          >
                            {mineSaving === item.taskId ? 'Saving…' : 'I made this change'}
                          </button>
                        )}
                        {item.errorType === 'detail_page_changed' && resellerNotes[item.taskId] && (
                          <span role="status" className="block mt-1 text-xs" style={{ color: COLORS.watch }}>{resellerNotes[item.taskId].text}</span>
                        )}
                        {item.proposedAction && !item.proposedAction.done && !completedTasks.has(item.taskId) && (
                          <button
                            type="button"
                            onClick={() => { setApproveTask(item); trackEvent('task_action_open', { type: item.proposedAction.type }); }}
                            className="mt-2.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold"
                            style={{ background: COLORS.accent, color: '#061021' }}
                          >
                            {item.proposedAction.label}…
                          </button>
                        )}
                        {item.proposedAction?.done && (
                          <span className="mt-2.5 inline-block text-xs" style={{ color: COLORS.good }}>Changed on Amazon after your approval.</span>
                        )}
                        {item.errorType === 'removal_confirm_receipt' && !completedTasks.has(item.taskId) && (
                          <button
                            type="button"
                            onClick={() => { setReceiptTaskId(item.taskId); trackEvent('removal_receipts_open'); }}
                            className="mt-2.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold"
                            style={{ background: COLORS.accent, color: '#061021' }}
                          >
                            Confirm what arrived
                          </button>
                        )}
                        {groupId !== BUCKET.EVERYTHING_ELSE && getGroupContext(item) && (
                          <div className="text-[11px] mt-1.5" style={{ color: COLORS.textMuted }}>
                            {getGroupContext(item)}
                          </div>
                        )}
                      </div>
                      <div className="flex-none text-right flex flex-col items-end gap-1.5">
                        {PRIORITY_BADGE[item.priorityLevel] && (
                          <span
                            className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
                            title={PRIORITY_BADGE[item.priorityLevel].title}
                            style={{ background: PRIORITY_BADGE[item.priorityLevel].bg, color: PRIORITY_BADGE[item.priorityLevel].fg }}
                          >
                            {item.priorityLevel} {PRIORITY_BADGE[item.priorityLevel].label}
                          </span>
                        )}
                        {item.amount > 0 && (
                          <span className="text-sm font-bold tabular-nums whitespace-nowrap" style={{ color: COLORS.good }}>
                            {formatCurrencyWithLocale(item.amount, currency)}{item.amountIsEstimated ? '*' : ''}
                          </span>
                        )}
                        {formatEffort(item.effortMinutes) && (
                          <span className="text-[11px] whitespace-nowrap" style={{ color: COLORS.textMuted }}>
                            {formatEffort(item.effortMinutes)}
                          </span>
                        )}
                        <span
                          className="inline-block text-[11px] font-semibold px-2 py-1 rounded-full whitespace-nowrap"
                          title={statusTitle(item)}
                          style={completedTasks.has(item.taskId)
                            ? { background: 'rgba(34,197,94,.14)', color: COLORS.good }
                            : { background: 'rgba(245,166,35,.14)', color: COLORS.watch }}
                        >
                          {statusLabel(item)}
                        </span>
                      </div>
                    </motion.div>
                  ))}

                  {items.length === 0 && (
                    <div className="px-5 py-[22px] text-[13px]" style={{ borderTop: `1px solid ${COLORS.border}`, color: COLORS.textMuted }}>
                      Nothing in this group matches the current filters.
                    </div>
                  )}

                  {remaining > 0 && (
                    <div className="flex items-center gap-3.5 px-5 py-[13px]" style={{ borderTop: `1px solid ${COLORS.border}` }}>
                      <button
                        type="button"
                        onClick={() => showMoreInGroup(groupId)}
                        className="px-3.5 py-2 rounded-lg text-xs font-medium border transition-colors"
                        style={{ borderColor: COLORS.border, color: COLORS.textPrimary, background: COLORS.bgBase }}
                      >
                        Show {Math.min(GROUP_PAGE_SIZE, remaining)} more
                      </button>
                      <span className="text-xs" style={{ color: COLORS.textMuted }}>{remaining} more not shown.</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {filteredAndSortedData.length === 0 && (
          <div className="rounded-2xl border py-12 text-center" style={{ borderColor: COLORS.border, background: COLORS.surface }}>
            <AlertTriangle className="w-6 h-6 mx-auto mb-2" style={{ color: COLORS.textMuted }} />
            <h3 className="text-[15px] font-semibold mb-1" style={{ color: COLORS.textPrimary }}>No tasks found</h3>
            <p className="text-sm" style={{ color: COLORS.textSecondary }}>
              {searchQuery || filterCategory !== 'all'
                ? 'Try adjusting your search or filter criteria.'
                : 'No issues detected in your account.'}
            </p>
          </div>
        )}
      </div>

      {/* Sticky batch-action bar */}
      {selectedTaskIds.size > 0 && (
        <div
          className="sticky bottom-[18px] z-20 mt-3 flex items-center gap-4 px-[18px] py-[13px] rounded-xl border shadow-2xl"
          style={{ borderColor: COLORS.borderStrong, background: COLORS.surfaceElevated }}
        >
          <span className="text-sm font-semibold" style={{ color: COLORS.textPrimary }}>{selectedTaskIds.size} selected</span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={clearSelection}
            className="px-3 py-2 rounded-lg text-[13px] border transition-colors"
            style={{ borderColor: COLORS.borderStrong, color: COLORS.textSecondary, background: 'transparent' }}
          >
            Clear
          </button>
          <button
            type="button"
            onClick={exportSelectedToCSV}
            className="px-3 py-2 rounded-lg text-[13px] border transition-colors"
            style={{ borderColor: COLORS.borderStrong, color: COLORS.textPrimary, background: 'transparent' }}
          >
            Export selected
          </button>
          {(() => {
            const approvable = transformedTasks.filter((t) => selectedTaskIds.has(t.taskId) && t.proposedAction && !t.proposedAction.editable
              && !t.proposedAction.done && !completedTasks.has(t.taskId));
            return approvable.length > 0 ? (
              <button
                type="button"
                onClick={() => { setBulkApproveTasks(approvable); trackEvent('task_action_bulk_open', { count: approvable.length }); }}
                className="px-3 py-2 rounded-lg text-[13px] border transition-colors"
                style={{ borderColor: COLORS.accent, color: COLORS.textPrimary, background: 'transparent' }}
              >
                Approve {approvable.length} change{approvable.length === 1 ? '' : 's'}…
              </button>
            ) : null;
          })()}
          <button
            type="button"
            onClick={markSelectedComplete}
            className="px-4 py-2 rounded-lg text-[13px] font-semibold transition-colors"
            style={{ background: COLORS.accent, color: '#061021' }}
          >
            Mark complete
          </button>
        </div>
      )}
      </div>

      <FixItPackagesModal
        open={showFixIt}
        onClose={() => setShowFixIt(false)}
        openTasks={openTasks}
        currency={currency}
      />

      <BulkApproveModal
        tasks={bulkApproveTasks}
        onClose={() => setBulkApproveTasks(null)}
        onApproved={(taskId) => {
          if (!completedTasks.has(taskId)) dispatch(toggleTaskStatusLocal({ taskId }));
        }}
      />
      <ApproveChangeModal
        task={approveTask}
        onClose={() => setApproveTask(null)}
        // The server marks the task done; mirror it locally without a second write.
        onApproved={(taskId) => {
          if (!completedTasks.has(taskId)) dispatch(toggleTaskStatusLocal({ taskId }));
        }}
      />
      <RemovalReceiptModal
        open={!!receiptTaskId}
        onClose={() => setReceiptTaskId(null)}
        // Answered: the ask is done. Any shortfall comes back as its own claim task.
        onConfirmed={() => {
          if (receiptTaskId && !completedTasks.has(receiptTaskId)) {
            dispatch(updateTaskStatus({ taskId: receiptTaskId, status: 'completed' }));
          }
        }}
      />
    </div>
  );
}
