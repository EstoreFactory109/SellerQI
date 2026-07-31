import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Lock } from 'lucide-react';
import { SEARCHABLE_PAGES } from './searchablePages.js';

const MAX_RESULTS = 8;

const VARIANT_CLASSES = {
    dark: {
        wrapper: 'relative w-full px-3 pb-3',
        inputWrapper: 'relative',
        input: 'w-full pl-8 pr-3 py-1.5 rounded-lg text-sm bg-[#21262d] border border-[#30363d] text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors',
        icon: 'absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 cursor-pointer',
        dropdown: 'absolute left-3 right-3 top-full mt-1 bg-[#21262d] border border-[#30363d] rounded-2xl shadow-lg z-50 max-h-72 overflow-y-auto',
        row: 'flex items-center justify-between gap-2 px-3 py-2 text-sm text-gray-200 hover:bg-[#30363d] cursor-pointer transition-colors',
        empty: 'px-3 py-2 text-sm text-gray-500',
        lock: 'w-3.5 h-3.5 text-amber-500 shrink-0',
    },
    light: {
        wrapper: 'relative w-full px-4 pb-3',
        inputWrapper: 'relative',
        input: 'w-full pl-8 pr-3 py-1.5 rounded-lg text-sm bg-white border border-gray-200 text-gray-700 placeholder-gray-400 focus:outline-none focus:border-blue-500 transition-colors',
        icon: 'absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 cursor-pointer',
        dropdown: 'absolute left-4 right-4 top-full mt-1 bg-white border border-gray-200 rounded-2xl shadow-lg z-50 max-h-72 overflow-y-auto',
        row: 'flex items-center justify-between gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-blue-50 cursor-pointer transition-colors',
        empty: 'px-3 py-2 text-sm text-gray-400',
        lock: 'w-3 h-3 text-amber-500 shrink-0',
    },
};

const levenshtein = (a, b) => {
    const m = a.length;
    const n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    const dp = new Array(n + 1);
    for (let j = 0; j <= n; j++) dp[j] = j;
    for (let i = 1; i <= m; i++) {
        let prev = dp[0];
        dp[0] = i;
        for (let j = 1; j <= n; j++) {
            const temp = dp[j];
            dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
            prev = temp;
        }
    }
    return dp[n];
};

// How many typos to tolerate for a query word of this length. Short words (<=3 chars, e.g.
// abbreviations like "ppc") require an exact match - fuzzy tolerance on them produces noise.
const maxEditDistance = (len) => (len <= 3 ? 0 : len <= 5 ? 1 : len <= 8 ? 2 : 3);

// 0 = exact substring match, 1..maxDist = fuzzy/typo match, -1 = no match within tolerance.
const wordScoreInText = (word, text) => {
    if (text.includes(word)) return 0;
    const maxDist = maxEditDistance(word.length);
    let best = Infinity;
    for (let start = 0; start < text.length; start++) {
        for (let len = Math.max(1, word.length - maxDist); len <= word.length + maxDist; len++) {
            if (start + len > text.length) break;
            const dist = levenshtein(word, text.slice(start, start + len));
            if (dist < best) best = dist;
        }
    }
    return best <= maxDist ? best : -1;
};

// Every word in the query must match somewhere in the label or keywords (substring or typo-
// tolerant fuzzy match) for the entry to qualify. Label matches are weighted above keyword-only
// matches so the page name itself wins ties.
const entryScore = (entry, queryWords) => {
    const label = entry.label.toLowerCase();
    const keywordText = entry.keywords.join(' ').toLowerCase();
    let total = 0;
    for (const word of queryWords) {
        const labelScore = wordScoreInText(word, label);
        const keywordScore = wordScoreInText(word, keywordText);
        if (labelScore === -1 && keywordScore === -1) return -1;
        const best = labelScore === -1 ? keywordScore + 0.5
            : keywordScore === -1 ? labelScore
                : Math.min(labelScore, keywordScore + 0.5);
        total += best;
    }
    return total;
};

const getMatches = (query) => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return SEARCHABLE_PAGES
        .map((entry) => ({ entry, score: entryScore(entry, words) }))
        .filter((m) => m.score !== -1)
        .sort((a, b) => a.score - b.score)
        .slice(0, MAX_RESULTS)
        .map((m) => m.entry);
};

const NavSearch = ({ variant = 'dark', isPremiumLocked = false, onNavigate }) => {
    const [query, setQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    const navigate = useNavigate();
    const containerRef = useRef(null);

    const classes = VARIANT_CLASSES[variant] || VARIANT_CLASSES.dark;

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedQuery(query);
            if (query.trim()) setIsOpen(true);
        }, 300);
        return () => clearTimeout(timer);
    }, [query]);

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (containerRef.current && !containerRef.current.contains(e.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const matches = getMatches(debouncedQuery);

    const goToEntry = (entry) => {
        if (!entry) return;
        navigate(entry.path);
        setQuery('');
        setDebouncedQuery('');
        setIsOpen(false);
        onNavigate?.();
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            goToEntry(matches[0]);
        } else if (e.key === 'Escape') {
            setIsOpen(false);
        }
    };

    return (
        <div className={classes.wrapper} ref={containerRef}>
            <div className={classes.inputWrapper}>
                <Search
                    className={classes.icon}
                    onClick={() => goToEntry(matches[0])}
                />
                <input
                    type="text"
                    value={query}
                    placeholder="Search pages..."
                    onChange={(e) => setQuery(e.target.value)}
                    onFocus={() => query.trim() && setIsOpen(true)}
                    onKeyDown={handleKeyDown}
                    className={classes.input}
                />
            </div>

            {isOpen && debouncedQuery.trim() && (
                <div className={classes.dropdown}>
                    {matches.length === 0 ? (
                        <div className={classes.empty}>No matching pages</div>
                    ) : (
                        matches.map((entry) => (
                            <div
                                key={entry.path}
                                className={classes.row}
                                onClick={() => goToEntry(entry)}
                            >
                                <span className="truncate">{entry.label}</span>
                                {entry.lockable && isPremiumLocked && <Lock className={classes.lock} />}
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
};

export default NavSearch;
