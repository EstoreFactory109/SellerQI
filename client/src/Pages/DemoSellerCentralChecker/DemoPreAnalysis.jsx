import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  FileText, 
  Tag, 
  AlertCircle,
  Info,
  BarChart3
} from 'lucide-react';
import AnalysisReport from '../../Components/PreAnalysis/AnalysisReport.jsx';

// Ranking Analysis Functions (ported from backend)
// ─── Restricted wording ──────────────────────────────────────────────────────
// COPY of server/Services/Calculations/Rankings.js, which is the source of truth.
// The same copy lives in client/src/helpers/Rankingsj.js, client/src/Pages/
// Products/PreAnalysis.jsx and client/src/Pages/DemoSellerCentralChecker/
// DemoPreAnalysis.jsx. Change the server first, then paste it into all three.
//
// One flat list used to be applied to titles, bullets and descriptions alike, and
// it mixed three different things. Production had 8,264 open restricted-words
// tasks, and the hits were mostly ordinary product words: prevent, eco-friendly,
// recommended, certified, treat, stress, non-toxic (which also hit "toxic",
// because \b splits on the hyphen), bpa-free, mold, stroke, mono, weed, repellent,
// eliminates, biodegradable, tested, approved, guarantee. The list is now split:
//
// PROMOTIONAL_TERMS - offers, rankings and guarantees. Amazon's title policy bars
// them from titles; in bullets and descriptions they are ordinary selling copy
// ("backed by our 1-year guarantee"), so they are checked in the TITLE ONLY.
const PROMOTIONAL_TERMS = [
  "sale", "deal", "discount", "promo", "cheap", "bargain",
  "guarantee", "guaranteed", "100% guaranteed", "100% quality guaranteed",
  "best seller", "amazon's choice", "amazon's favorite",
  "free shipping", "fastest shipping", "today only", "limited time", "last chance",
  "buy with confidence", "unlike other brands", "works better than",
  "instant fix", "magic solution", "permanent results"
];

// PROHIBITED_CLAIMS - disease, drug and pesticide claims, and prohibited drug
// products. These are not allowed anywhere on a detail page, so they are checked
// in the title, bullets AND description.
const PROHIBITED_CLAIMS = [
  // disease / medical claims
  "cure", "cures", "heal", "remedy", "remedies", "diseases", "infection",
  "covid", "covid-19", "coronavirus", "pandemic", "virus", "viruses", "flu", "influenza",
  "cancer", "tumor", "diabetes", "obesity", "weight loss", "hiv", "hepatitis",
  "chlamydia", "gonorrhea", "syphilis", "trichomoniasis", "scabies", "mononucleosis",
  "pelvic inflammatory", "arthritis", "gout", "asthma", "cystic fibrosis",
  "alzheimer's", "dementia", "parkinson", "parkinson's", "multiple sclerosis",
  "muscular dystrophy", "lupus", "epilepsy", "seizure", "seizures", "meningitis",
  "glaucoma", "cataract", "concussion", "adhd", "autism", "anxiety", "depression",
  "crohn's", "celiac",
  // regulatory endorsements a listing cannot claim
  "fda approved", "fda-registered facility", "clinically proven", "doctor recommended",
  "epa registered", "n95", "kn95",
  // pesticide / antimicrobial claims
  "antibacterial", "anti-bacterial", "antimicrobial", "anti-microbial", "antifungal",
  "anti-fungal", "antiviral", "antiseptic", "germs", "germ-free", "kills germs",
  "kills 99.9% of germs", "bacteria", "fungal", "fungus", "sanitize", "sanitizes",
  "disinfect", "disinfects", "sterilizes", "pesticide", "pesticides", "insecticide",
  "fungicide", "fungicides",
  // detox claims
  "detox", "detoxify", "detoxification",
  // drugs and drug paraphernalia
  "cbd", "cannabinoid", "thc", "hemp oil", "marijuana", "delta-8", "delta-9",
  "cocaine", "opioid", "methamphetamine", "kratom", "psilocybin", "dmt", "ayahuasca",
  "picamilon", "phenibut", "clenbuterol", "ephedrine", "minoxidil",
  "bong", "one hitter", "dab rig"
];

const escapeTermForRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A term matches only as whole tokens, where a hyphen joins a token rather than
// splitting it: "toxic" must not match inside "non-toxic", nor "germ" inside
// "germ-free". Inside a multi-word term a space or hyphen is optional, so
// "fda approved" also finds "FDA-approved" and "covid-19" finds "covid 19" and
// "covid19". Straight and curly apostrophes are interchangeable. No lookbehind,
// so the identical client copies run in older Safari too.
const TERM_EDGE = "[^\\p{L}\\p{N}_'’-]";
const termPattern = (term) => {
  const body = term.split(/[\s-]+/).map((part) =>
    escapeTermForRegex(part).replace(/'/g, "['’]")
  ).join('[\\s-]?');
  return new RegExp(`(?:^|${TERM_EDGE})${body}(?=$|${TERM_EDGE})`, 'iu');
};

const matchTerms = (str, terms) => {
  if (typeof str !== 'string' || !str) return [];
  return terms.filter((term) => termPattern(term).test(str));
};

const findPromotionalTerms = (str) => matchTerms(str, PROMOTIONAL_TERMS);
const findProhibitedClaims = (str) => matchTerms(str, PROHIBITED_CLAIMS);


// ─── Amazon product title requirements ────────────────────────────────────────
// Source: Amazon Seller Central, "Product title requirements and guidelines".
// These apply to every product type except media, in every store except Saudi
// Arabia, Egypt, Türkiye, and the United Arab Emirates.

const TITLE_MAX_LENGTH = 75;

// Never permitted in a title, in any context.
const TITLE_PROHIBITED_CHARACTERS = ['!', '$', '?', '_', '{', '}', '^', '¬', '¦'];

// Permitted only as product identifiers ("Style #4301") or measurements
// ("<10 lb"). Decorative use ("Beach Coverup << Size Kids XXS >>") is not.
const TITLE_CONTEXTUAL_CHARACTERS = ['~', '#', '<', '>', '*'];

// Non-language ASCII (Æ, Š, Œ, Ÿ, Ž) plus decorative symbols, arrows, dingbats
// and emoji (★, ➤, 🔥 …), none of which belong in a title.
const TITLE_DECORATIVE_CHARACTERS = new RegExp(
  '[ÆæŒœŠšŸŽž]' +                                       // non-language ASCII
  '|[\\u00AB\\u00BB\\u2020-\\u2023\\u2026\\u2030\\u2039\\u203A\\u203B\\u203C\\u2047-\\u2049]' +
  '|[\\u2190-\\u21FF\\u2300-\\u23FF\\u2460-\\u24FF\\u25A0-\\u27BF\\u2B00-\\u2BFF]' +
  '|[\\u{1F000}-\\u{1FAFF}]',                           // emoji and pictographs
  'gu'
);

// Prepositions, articles, and conjunctions are exempt from the two-instance
// word limit; every other word, brand names included, is not.
const TITLE_REPETITION_EXEMPT_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'nor', 'but', 'so', 'yet', 'for',
  'in', 'on', 'at', 'by', 'to', 'of', 'off', 'up', 'with', 'without',
  'from', 'into', 'onto', 'over', 'under', 'per', 'plus', 'via', 'as',
  'than', 'about', 'after', 'before', 'between', 'through'
]);

// Promotional phrases, subjective commentary, and restricted claims that Amazon
// does not allow in titles. PROMOTIONAL_TERMS and PROHIBITED_CLAIMS (above) are
// checked alongside these.
const TITLE_RESTRICTED_PHRASES = [
  'fsa eligible', 'hsa eligible', 'fsa/hsa eligible', 'hsa/fsa eligible',
  'hot item', 'hot deal', 'top rated', 'top seller', 'best selling', 'bestseller',
  'must have', 'number one', 'number 1', 'no 1', '#1',
  'free gift', 'free delivery', 'free returns', 'money back', 'lowest price',
  'best price', 'cheapest', 'on sale', 'clearance', 'new arrival', 'order now',
  'buy now', 'act now', 'while supplies last', 'satisfaction guaranteed',
  'risk free', 'as seen on tv', 'flash sale', 'special offer', 'exclusive offer',
  'amazing', 'incredible', 'unbeatable', 'perfect gift', 'wow'
];

// Amazon asks for numerals ("2") rather than words ("two"). "one" is left out:
// it is far more often part of a name ("All-in-One") than a quantity.
const TITLE_SPELLED_OUT_NUMBERS = [
  'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty', 'forty', 'fifty',
  'sixty', 'seventy', 'eighty', 'ninety', 'hundred', 'thousand', 'dozen'
];

const escapeForRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Matches each phrase allowing a hyphen wherever the phrase has a space, so
// "must-have" and "must have" are both found.
const matchPhrases = (str, phrases) => {
  const found = phrases.filter((phrase) => {
    const body = escapeForRegex(phrase).replace(/ +/g, '[\\s-]+');
    const prefix = /^\w/.test(phrase) ? '\\b' : '';
    const suffix = /\w$/.test(phrase) ? '\\b' : '';
    return new RegExp(`${prefix}${body}${suffix}`, 'i').test(str);
  });
  return [...new Set(found)];
};

const findTitleCharacterIssues = (str) => {
  const prohibited = TITLE_PROHIBITED_CHARACTERS.filter((char) => str.includes(char));

  const decorative = [...new Set(str.match(TITLE_DECORATIVE_CHARACTERS) || [])];

  // A contextual symbol reads as decorative once it is repeated - either back to
  // back ("<< Size >>") or more than twice across the title ("A*B*C*D").
  const decorativeContextual = TITLE_CONTEXTUAL_CHARACTERS.filter((char) => {
    const occurrences = str.split(char).length - 1;
    if (occurrences === 0) return false;
    if (str.includes(`${char}${char}`)) return true;
    return occurrences > 2;
  });

  return { prohibited, decorative, decorativeContextual };
};

const findRepeatedTitleWords = (str) => {
  const words = str.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’]*/gu) || [];
  const counts = new Map();

  words.forEach((word) => {
    if (word.length < 2 || TITLE_REPETITION_EXEMPT_WORDS.has(word)) return;
    counts.set(word, (counts.get(word) || 0) + 1);
  });

  return [...counts.entries()]
    .filter(([, count]) => count > 2)
    .map(([word, count]) => ({ word, count }));
};

const findTitleCapitalizationIssue = (str) => {
  const letters = str.match(/\p{L}/gu) || [];
  if (letters.length < 4) return null;

  // A run of short acronyms (USB, LED, 4K) is not a shouted title, so all-caps
  // is only flagged once a word of five or more letters is uppercase.
  const hasLongUpperCaseWord = /\p{Lu}{5,}/u.test(str);

  if (!/\p{Ll}/u.test(str) && hasLongUpperCaseWord) return 'allCaps';
  if (!/\p{Lu}/u.test(str)) return 'allLowercase';
  return null;
};

const checkTitle = (str) => {
    let result = {};
    let errorCount = 0;

    const title = typeof str === 'string' ? str : '';

    // 1. Character limit - titles must not exceed 75 characters, spaces included.
    if (!title.trim()) {
        errorCount++;
        result.charLim = {
            status: "Error",
            Message: "Your product title is missing. Amazon requires a title that clearly and concisely describes the product.",
            HowTOSolve: "Add a title containing the minimum information needed to identify the product, such as brand plus product type (for example, \"Sony Headphones\"), and keep it within 75 characters."
        }
    } else if (title.length > TITLE_MAX_LENGTH) {
        errorCount++;
        result.charLim = {
            status: "Error",
            Message: `Your product title is ${title.length} characters, which exceeds Amazon's 75-character limit. Titles over the limit can be automatically corrected or kept out of search results, and they are truncated on mobile screens.`,
            HowTOSolve: "Trim the title to 75 characters or fewer, ordering the words brand, flavor or style, product type, key attribute, color, size or pack count, model number. Move the remaining detail (materials, use cases) into Item highlights, which gives you another 125 characters shown below the title."
        }
    } else {
        result.charLim = {
            status: "Success",
            Message: `Great job! Your product title is ${title.length} characters, within Amazon's 75-character limit.`,
            HowTOSolve: ""
        }
    }

    // 2. Restricted, promotional, and subjective wording.
    let RestictedWords = [...new Set([
        ...findPromotionalTerms(title),
        ...findProhibitedClaims(title),
        ...matchPhrases(title, TITLE_RESTRICTED_PHRASES)
    ])];

    if (RestictedWords.length>0) {
        errorCount++;
        result.RestictedWords = {
            status: "Error",
            Message: `Your product title contains restricted, promotional, or subjective wording that Amazon does not allow in titles. This covers promotional phrases such as "free shipping" or "100% quality guaranteed", subjective commentary such as "Hot Item" or "Best Seller", and restricted phrases such as "FSA/HSA eligible". The words used are: ${RestictedWords.join(', ')}`,
            HowTOSolve: "Remove these words and describe the product factually instead. Keep claims, offers, and eligibility statements out of the title - Amazon can suppress or automatically correct titles that contain them."
        }
    } else {
        result.RestictedWords = {
            status: "Success",
            Message: "Excellent! Your product title complies with Amazon's guidelines, avoiding restricted, promotional, and subjective wording.",
            HowTOSolve: ""
        }
    }

    // 3. Special characters - prohibited outright, decorative, or contextual misuse.
    const { prohibited, decorative, decorativeContextual } = findTitleCharacterIssues(title);

    if (prohibited.length > 0 || decorative.length > 0 || decorativeContextual.length > 0) {
        errorCount++;
        const details = [];
        if (prohibited.length > 0) {
            details.push(`characters that are never allowed in a title: ${prohibited.join(', ')}`);
        }
        if (decorative.length > 0) {
            details.push(`non-language or decorative symbols: ${decorative.join(', ')}`);
        }
        if (decorativeContextual.length > 0) {
            details.push(`symbols used decoratively rather than as an identifier or measurement: ${decorativeContextual.join(', ')}`);
        }
        result.checkSpecialCharacters = {
            status: "Error",
            Message: `Your product title uses special characters that violate Amazon's title requirements - ${details.join('; ')}. Non-compliant characters can lead to the title being suppressed or automatically corrected.`,
            HowTOSolve: "Remove the characters listed above. The characters ! $ ? _ { } ^ ¬ ¦ are never allowed, and ~ # < > * are allowed only as product identifiers (\"Style #4301\") or measurements (\"<10 lb\") - never for decoration. Stick to standard letters and numbers plus necessary punctuation such as hyphens (-), forward slashes (/), commas (,), ampersands (&), and periods (.)."
        }
    } else {
        result.checkSpecialCharacters = {
            status: "Success",
            Message: "Well done! Your product title adheres to Amazon's guidelines by avoiding prohibited and decorative special characters.",
            HowTOSolve: ""
        }
    }

    // 4. Word repetition - no word more than twice, brand names included.
    const repeatedWords = findRepeatedTitleWords(title);

    if (repeatedWords.length > 0) {
        errorCount++;
        result.wordRepetition = {
            status: "Error",
            Message: `Your product title repeats the same word more than twice, which Amazon does not allow. The repeated words are: ${repeatedWords.map(({ word, count }) => `${word} (${count} times)`).join(', ')}`,
            HowTOSolve: "Rewrite the title so that no word appears more than twice. Prepositions, articles, and conjunctions are exempt, but every other word - brand names included - is limited to two instances. For example, \"Levi's Men's Jeans Men's 501 Original Fit Men's Denim Jeans\" becomes \"Levi's Men's 501 Original Fit Jeans\"."
        }
    } else {
        result.wordRepetition = {
            status: "Success",
            Message: "Excellent! Your product title has no word repeated more than twice.",
            HowTOSolve: ""
        }
    }

    // 5. Capitalization - title case, neither all caps nor all lowercase.
    const capitalizationIssue = findTitleCapitalizationIssue(title);

    if (capitalizationIssue) {
        errorCount++;
        result.capitalization = {
            status: "Error",
            Message: capitalizationIssue === 'allCaps'
                ? "Your product title is written in all capital letters. Amazon requires title case, and all-caps titles are harder for customers to read in search results."
                : "Your product title is written entirely in lowercase. Amazon requires the first letter of each word to be capitalized.",
            HowTOSolve: "Capitalize the first letter of each word, except prepositions (in, on, over, with), conjunctions (and, or, for), and articles (the, a, an). Use \"Nike Air Running Shoes with Cushioned Sole\" rather than \"NIKE AIR RUNNING SHOES\" or \"nike air running shoes\"."
        }
    } else {
        result.capitalization = {
            status: "Success",
            Message: "Well done! Your product title uses proper title-case capitalization.",
            HowTOSolve: ""
        }
    }

    // 6. Numerals instead of spelled-out numbers. This is an Amazon best
    //    practice rather than a hard requirement, so it is reported as a warning
    //    and left out of NumberOfErrors.
    const spelledOutNumbers = matchPhrases(title, TITLE_SPELLED_OUT_NUMBERS);

    if (spelledOutNumbers.length > 0) {
        result.spelledOutNumbers = {
            status: "Warning",
            Message: `Your product title spells out numbers instead of using numerals: ${spelledOutNumbers.join(', ')}. Numerals are quicker for customers to scan and use fewer of the 75 available characters.`,
            HowTOSolve: "Replace spelled-out numbers with numerals and abbreviate measurements - \"2-Pack Cotton Towels, 24 x 48 inches\" rather than \"Two-Pack Cotton Towels, Twenty-Four x Forty-Eight inches\". Measurement abbreviations such as cm, oz, in, and kg are allowed."
        }
    } else {
        result.spelledOutNumbers = {
            status: "Success",
            Message: "Well done! Your product title uses numerals for quantities and measurements.",
            HowTOSolve: ""
        }
    }

    result.NumberOfErrors = errorCount;
    return result;
};

// Bullet, description and backend-keyword checks: COPY of server/Services/
// Calculations/Rankings.js (source of truth), so this preview and the tasks agree.
// Special characters are restricted in TITLES only (checkTitle, rule 3). Amazon
// has no such rule for bullets or descriptions, where "#1", "<10 lb" and "100%!"
// are ordinary copy. The key is kept, always Success, because the ProductDetails
// and Issues pages read it unconditionally.
const notCheckedOutsideTitle = (where) => ({
    status: "Success",
    Message: `Special characters are only restricted in product titles; Amazon applies no such rule to ${where}.`,
    HowTOSolve: ""
});

// The scrape stores [] both when a listing has no bullet points and when it could
// not read them, so an empty array is NO DATA, not a failure: it produces no error
// and no task. (A non-array is treated the same way.)
const checkBulletPoints = (arr) => {
    let result = {};
    const bullets = Array.isArray(arr) ? arr.filter((str) => typeof str === 'string') : [];

    let charLimErrCount = 0;
    const claims = new Set();

    bullets.forEach((str) => {
        if (str.length < 150) {
            charLimErrCount++;
        }
        // Every claim found, not only the first per bullet.
        findProhibitedClaims(str).forEach((word) => claims.add(word));
    });

    if(charLimErrCount>0){
        result.charLim={
            status:"Error",
            Message:"Your bullet points are under 150 characters. Short bullet points may not provide enough detail to effectively communicate the features and benefits of your products, potentially affecting customer interest and conversion rates.",
            HowTOSolve:"Enhance your bullet points to be at least 150 characters long, focusing on key features, benefits, and differentiators of your product. Use this space to clearly articulate why customers should choose your product, including any unique selling propositions.."
        }
    }else{
        result.charLim={
            status:"Success",
            Message:"Great job! Your bullet points are adequately detailed, providing valuable information to customers and effectively enhancing your product's appeal.",
            HowTOSolve:""
        }
    }
    if(claims.size>0){
        result.RestictedWords={
            status:"Error",
            Message:`Your bullet points contain medical, drug, or pesticide claims that Amazon prohibits on product detail pages. Such claims can get your listing suppressed or removed. The words used are: ${[...claims].join(', ')}`,
            HowTOSolve:"Remove these claims from your bullet points. Describe what the product is and does without claiming it cures, treats, or prevents a disease, kills germs or pests, or contains a restricted substance - unless the product is registered for that claim and Amazon has approved it."
        }
    }else{
        result.RestictedWords={
            status:"Success",
            Message:"Excellent! Your bullet points contain no prohibited medical, drug, or pesticide claims.",
            HowTOSolve:""
        }
    }
    result.checkSpecialCharacters = notCheckedOutsideTitle('bullet points');

    // One per failing check. This used to be an if/else chain whose first branch
    // caught every case, so the count was stuck at 1 however many checks failed,
    // while each failing check still became its own task.
    result.NumberOfErrors = [result.charLim, result.RestictedWords]
        .filter((check) => check.status === "Error").length;
    return result;
}

// Same no-data rule as bullets: an empty or missing description produces no
// result keys and no error.
//
// The scrape splits one description into paragraphs. Each check used to run per
// paragraph, overwriting its status each time (the last paragraph won) while the
// error count added up across all of them - so the header could say 4 errors for
// a description with one visible failing check. Each check now runs once over the
// whole description and counts once.
const checkDescription = (arr) => {
    let result = {};
    const paragraphs = Array.isArray(arr)
        ? arr.filter((str) => typeof str === 'string' && str.trim())
        : [];

    if (paragraphs.length === 0) {
        result.NumberOfErrors = 0;
        return result;
    }

    const length = paragraphs.reduce((sum, str) => sum + str.length, 0);
    if (length < 1700) {
        result.charLim = {
            status: "Error",
            Message: "Your product description is under 1700 characters. This may not provide enough information to fully educate potential buyers.",
            HowTOSolve: "Expand your product description to at least 1700 characters. Include benefits, use cases, and unique features, using proper formatting and keywords."
        }
    } else {
        result.charLim = {
            status: "Success",
            Message: "Great job! Your product description is sufficiently detailed.",
            HowTOSolve: ""
        }
    }

    const claims = [...new Set(paragraphs.flatMap((str) => findProhibitedClaims(str)))];
    if (claims.length > 0) {
        result.RestictedWords = {
            status: "Error",
            Message: `Your product description contains medical, drug, or pesticide claims that Amazon prohibits on product detail pages. The words used are: ${claims.join(', ')}`,
            HowTOSolve: "Remove these claims from the description. Describe the product factually without claiming it cures, treats, or prevents a disease, kills germs or pests, or contains a restricted substance."
        }
    } else {
        result.RestictedWords = {
            status: "Success",
            Message: "Excellent! Your product description contains no prohibited medical, drug, or pesticide claims.",
            HowTOSolve: ""
        }
    }

    result.checkSpecialCharacters = notCheckedOutsideTitle('product descriptions');

    result.NumberOfErrors = [result.charLim, result.RestictedWords]
        .filter((check) => check.status === "Error").length;
    return result;
}

// Function words repeat by necessity and Amazon ignores them in search terms, so
// repeating them wastes nothing worth flagging.
const BACKEND_KEYWORD_STOP_WORDS = new Set(['for', 'and', 'the', 'with', 'of', 'in', 'to', 'a', 'an', 'or']);

/**
 * Words repeated in a backend search-terms string. Tokens keep inner apostrophes
 * ("men's" is one word): splitting on \b\w+\b turned "men's ... women's" into a
 * duplicate "s". Tokens under 2 characters and stop-words are ignored.
 * @returns {string[]} each repeated word once, in first-seen order
 */
const findDuplicateWords = (str) => {
    if (typeof str !== 'string') return [];
    const words = str.toLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) || [];
    const seen = new Set();
    const duplicates = new Set();

    for (const word of words) {
        if (word.length < 2 || BACKEND_KEYWORD_STOP_WORDS.has(word)) continue;
        if (seen.has(word)) duplicates.add(word);
        seen.add(word);
    }
    return [...duplicates];
}

const BackendKeyWordOrAttributesStatus = (str) => {
    let result = {};
    let errorCount = 0;

    // Handle null or undefined values
    if (!str || typeof str !== 'string') {
        errorCount++;
        result.charLim = {
            status: "Error",
            Message: "Backend keywords are missing or invalid.",
            HowTOSolve: "Please ensure backend keywords are properly set for this product."
        };
        result.NumberOfErrors = errorCount;
        return result;
    }

    // Calculate byte length, not character length
    const byteLength = new TextEncoder().encode(str).length;
    
    // Amazon's limit is 250 bytes, best practice is 249 or less
    if (byteLength > 250) {
        errorCount++;
        result.charLim = {
            status: "Error",
            Message: `Your backend keywords exceed Amazon's 250-byte limit (currently ${byteLength} bytes). Amazon will ignore keywords beyond this limit.`,
            HowTOSolve: "Reduce your keywords to 249 bytes or less. Remove unnecessary words, avoid repetition, and prioritize high-value search terms."
        }
    } else if (byteLength < 200) {
        // A warning, not an error: it is not counted in NumberOfErrors and never
        // becomes a task (tasks are raised on "Error" only). Counting it made the
        // header error total exceed the task list for most products.
        result.charLim = {
            status: "Warning",
            Message: `Your backend keywords use only ${byteLength} of 250 available bytes. You may be missing valuable search terms.`,
            HowTOSolve: "Add more relevant keywords like synonyms, alternate terms, misspellings, and related search phrases to maximize visibility."
        }
    } else {
        result.charLim = {
            status: "Success",
            Message: `Great job! You're using ${byteLength} of 250 bytes effectively.`,
            HowTOSolve: ""
        }
    }

    const duplicates = findDuplicateWords(str);
    if (duplicates.length > 0) {
        errorCount++;
        result.dublicateWords = {
            status: "Error",
            Message: `Your backend keywords contain duplicate words, wasting space and reducing effectiveness. The repeated words are: ${duplicates.join(', ')}`,
            HowTOSolve: "Remove duplicate words. Use synonyms, alternate terms, and other relevant keywords to increase reach."
        }
    } else {
        result.dublicateWords = {
            status: "Success",
            Message: "Excellent! Your backend keywords are unique and fully optimized.",
            HowTOSolve: ""
        }
    }

    result.NumberOfErrors = errorCount;
    return result;
}

const getRankings = (ProductDetails) => {
  const titleResult = checkTitle(ProductDetails.product_title);
  const bulletPointsResult = checkBulletPoints(ProductDetails.about_product);
  const descriptionResult = checkDescription(ProductDetails.product_description);

  const totalErrorNumbers = titleResult.NumberOfErrors + bulletPointsResult.NumberOfErrors + descriptionResult.NumberOfErrors;

  const finalResult = {
    Title: ProductDetails.product_title,
    TitleResult: titleResult,
    BulletPoints: bulletPointsResult,
    Description: descriptionResult,
    TotalErrors: totalErrorNumbers
  };

  return { finalResult };
};

export default function PreAnalysis() {
  const [form, setForm] = useState({ 
    product_title: '',
    about_product: [''], // Bullet points array
    product_description: '', // Description
    backendKeywords: '' // Backend keywords for search terms
  });
  
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [analysisResults, setAnalysisResults] = useState(null);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm({ ...form, [name]: value });
    // Clear error when user starts typing
    if (errors[name]) {
      setErrors({ ...errors, [name]: '' });
    }
  };

  const handleBulletPointChange = (index, value) => {
    const newBulletPoints = [...form.about_product];
    newBulletPoints[index] = value;
    setForm({ ...form, about_product: newBulletPoints });
  };

  const addBulletPoint = () => {
    setForm({ ...form, about_product: [...form.about_product, ''] });
  };

  const removeBulletPoint = (index) => {
    if (form.about_product.length > 1) {
      const newBulletPoints = form.about_product.filter((_, i) => i !== index);
      setForm({ ...form, about_product: newBulletPoints });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setAnalysisResults(null);
    setErrors({});
    
    // Check if at least one field is filled
    const hasBulletPoints = form.about_product.some(bp => bp.trim().length > 0);
    const hasAtLeastOneField = 
      form.product_title.trim() || 
      hasBulletPoints || 
      form.product_description.trim() || 
      form.backendKeywords.trim();
    
    if (!hasAtLeastOneField) {
      setErrors({ general: 'Please fill at least one field before analyzing.' });
      setIsSubmitting(false);
      return;
    }
    
    // Prepare data in backend format
    // Only include fields that have values
    const validBulletPoints = form.about_product.filter(bp => bp.trim().length > 0);
    const analysisData = {
      product_title: form.product_title.trim() || '',
      about_product: validBulletPoints.length > 0 ? validBulletPoints : [],
      product_description: form.product_description.trim() ? [form.product_description.trim()] : [],
      backendKeywords: form.backendKeywords.trim() || ''
    };
    
    // Run ranking analysis only if title, bullet points, or description are provided
    let rankingResults = null;
    if (analysisData.product_title || analysisData.about_product.length > 0 || analysisData.product_description.length > 0) {
      rankingResults = getRankings(analysisData);
    }
    
    // Run backend keywords analysis only if backend keywords are provided
    let backendKeywordResults = null;
    if (analysisData.backendKeywords) {
      backendKeywordResults = BackendKeyWordOrAttributesStatus(analysisData.backendKeywords);
    }
    
    // Combine results
    const rankingErrors = rankingResults?.finalResult?.TotalErrors || 0;
    const backendErrors = backendKeywordResults?.NumberOfErrors || 0;
    
    const results = {
      ranking: rankingResults?.finalResult || null,
      backendKeywords: backendKeywordResults || null,
      totalErrors: rankingErrors + backendErrors
    };
    
    setAnalysisResults(results);
    setIsSubmitting(false);
    
    // Scroll to results
    setTimeout(() => {
      document.getElementById('analysis-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  return (
    <div className="min-h-screen overflow-x-hidden w-full" style={{ background: '#1a1a1a', padding: '10px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        {/* Header Section */}
        <div style={{ background: '#161b22', padding: '10px 15px', borderRadius: '6px', border: '1px solid #30363d', marginBottom: '10px' }}>
          <div className='flex items-center gap-2'>
            <FileText className="w-4 h-4" style={{ color: '#60a5fa' }} />
            <div>
              <h1 className='text-base font-bold' style={{ color: '#f3f4f6' }}>Listing Analyzer</h1>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div>
          <div className="max-w-6xl mx-auto">
          {/* Info Banner */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            style={{ background: '#161b22', borderLeft: '3px solid #3b82f6', borderRadius: '6px', padding: '10px 12px', marginBottom: '10px', border: '1px solid #30363d' }}
          >
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#60a5fa' }} />
              <div className="flex-1">
                <h3 className="font-semibold text-xs mb-1" style={{ color: '#f3f4f6' }}>What is Listing Analyzer?</h3>
                <p className="text-[11px] leading-relaxed mb-2" style={{ color: '#9ca3af' }}>
                  Listing Analyzer helps you identify potential ranking issues before listing your product on Amazon. 
                  Fill in any product details below, and we'll instantly analyze them for common ranking errors and optimization opportunities.
                </p>
                <div className="flex items-center gap-1.5 text-[10px] font-medium" style={{ color: '#60a5fa' }}>
                  <div className="w-1 h-1 rounded-full" style={{ background: '#3b82f6' }}></div>
                  <span>Fill at least one field to get started</span>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Form Section */}
          <motion.form
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            onSubmit={handleSubmit}
            style={{ background: '#161b22', borderRadius: '6px', border: '1px solid #30363d', padding: '12px', marginBottom: '10px' }}
            className="space-y-4"
          >
        {/* Product Title */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="w-4 h-4" style={{ color: '#60a5fa' }} />
            <h2 className="text-xs font-bold uppercase tracking-wide" style={{ color: '#f3f4f6' }}>Product Title</h2>
          </div>
          <div className="space-y-1.5">
            <input
              type="text"
              name="product_title"
              value={form.product_title}
              onChange={handleChange}
              className="w-full rounded-lg px-3 py-2 text-xs transition-all duration-300"
              style={{ 
                background: '#1a1a1a', 
                border: `1px solid ${errors.product_title ? '#60a5fa' : '#30363d'}`, 
                color: '#f3f4f6',
                placeholder: '#6b7280'
              }}
              placeholder="Enter your product title here..."
              onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
              onBlur={(e) => e.target.style.borderColor = errors.product_title ? '#60a5fa' : '#30363d'}
            />
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-medium" style={{ color: '#9ca3af' }}>
                {form.product_title.length} characters
              </p>
              {errors.product_title && (
                <p className="text-[10px] font-medium flex items-center gap-1" style={{ color: '#60a5fa' }}>
                  <AlertCircle className="w-3 h-3" />
                  {errors.product_title}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Backend Keywords Section */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 mb-2">
            <Tag className="w-4 h-4" style={{ color: '#60a5fa' }} />
            <h2 className="text-xs font-bold uppercase tracking-wide" style={{ color: '#f3f4f6' }}>Backend Keywords</h2>
          </div>
          <div className="space-y-1.5">
            <textarea
              name="backendKeywords"
              value={form.backendKeywords}
              onChange={handleChange}
              rows={4}
              className="w-full rounded-lg px-3 py-2 text-xs transition-all duration-300 resize-none"
              style={{ 
                background: '#1a1a1a', 
                border: `1px solid ${errors.backendKeywords ? '#60a5fa' : '#30363d'}`, 
                color: '#f3f4f6'
              }}
              placeholder="Enter backend keywords/search terms separated by commas or spaces..."
              onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
              onBlur={(e) => e.target.style.borderColor = errors.backendKeywords ? '#60a5fa' : '#30363d'}
            />
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-medium" style={{ color: '#9ca3af' }}>
                {form.backendKeywords.length} characters
              </p>
              {errors.backendKeywords && (
                <p className="text-[10px] font-medium flex items-center gap-1" style={{ color: '#60a5fa' }}>
                  <AlertCircle className="w-3 h-3" />
                  {errors.backendKeywords}
                </p>
              )}
            </div>
            <div className="rounded-lg p-2" style={{ background: '#21262d', border: '1px solid #30363d' }}>
              <div className="flex items-start gap-1.5">
                <Info className="w-3 h-3 flex-shrink-0 mt-0.5" style={{ color: '#60a5fa' }} />
                <div>
                  <p className="text-[10px] font-semibold mb-0.5" style={{ color: '#f3f4f6' }}>Pro Tip</p>
                  <p className="text-[10px] leading-relaxed" style={{ color: '#9ca3af' }}>
                    Include synonyms, alternate terms, and relevant keywords. Each word should be unique (no duplicates) for maximum effectiveness.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bullet Points Section */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="w-4 h-4" style={{ color: '#60a5fa' }} />
            <h2 className="text-xs font-bold uppercase tracking-wide" style={{ color: '#f3f4f6' }}>Bullet Points</h2>
          </div>
          <div className="space-y-2">
            {form.about_product.map((bullet, index) => (
              <div key={index} className="relative group">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-[11px] font-semibold" style={{ color: '#f3f4f6' }}>
                    Bullet Point {index + 1}
                  </label>
                  {form.about_product.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeBulletPoint(index)}
                      className="text-[10px] font-medium px-2 py-1 rounded transition-colors"
                      style={{ color: '#60a5fa' }}
                      onMouseEnter={(e) => e.target.style.background = 'rgba(96, 165, 250, 0.2)'}
                      onMouseLeave={(e) => e.target.style.background = 'transparent'}
                    >
                      Remove
                    </button>
                  )}
                </div>
                <textarea
                  value={bullet}
                  onChange={(e) => handleBulletPointChange(index, e.target.value)}
                  rows={2}
                  className="w-full rounded-lg px-3 py-2 text-xs transition-all duration-300 resize-none"
                  style={{ 
                    background: '#1a1a1a', 
                    border: '1px solid #30363d', 
                    color: '#f3f4f6'
                  }}
                  placeholder={`Enter key feature ${index + 1}...`}
                  onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                  onBlur={(e) => e.target.style.borderColor = '#30363d'}
                />
                <p className="text-[10px] font-medium mt-1" style={{ color: '#9ca3af' }}>
                  {bullet.length} characters
                </p>
              </div>
            ))}
            <button
              type="button"
              onClick={addBulletPoint}
              className="w-full py-2 px-3 border border-dashed rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-all duration-300"
              style={{ 
                borderColor: '#30363d', 
                color: '#9ca3af',
                background: '#1a1a1a'
              }}
              onMouseEnter={(e) => {
                e.target.style.borderColor = '#60a5fa';
                e.target.style.color = '#60a5fa';
                e.target.style.background = 'rgba(96, 165, 250, 0.1)';
              }}
              onMouseLeave={(e) => {
                e.target.style.borderColor = '#30363d';
                e.target.style.color = '#9ca3af';
                e.target.style.background = '#1a1a1a';
              }}
            >
              <span className="text-sm">+</span>
              Add More Bullet Point
            </button>
          </div>
        </div>

        {/* Product Description */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="w-4 h-4" style={{ color: '#60a5fa' }} />
            <h2 className="text-xs font-bold uppercase tracking-wide" style={{ color: '#f3f4f6' }}>Product Description</h2>
          </div>
          <div className="space-y-1.5">
            <textarea
              name="product_description"
              value={form.product_description}
              onChange={handleChange}
              rows={6}
              className="w-full rounded-lg px-3 py-2 text-xs transition-all duration-300 resize-none"
              style={{ 
                background: '#1a1a1a', 
                border: `1px solid ${errors.product_description ? '#60a5fa' : '#30363d'}`, 
                color: '#f3f4f6'
              }}
              placeholder="Enter your product description. Include features, benefits, specifications, and usage instructions..."
              onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
              onBlur={(e) => e.target.style.borderColor = errors.product_description ? '#60a5fa' : '#30363d'}
            />
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-medium" style={{ color: '#9ca3af' }}>
                {form.product_description.length} characters
              </p>
              {errors.product_description && (
                <p className="text-[10px] font-medium flex items-center gap-1" style={{ color: '#60a5fa' }}>
                  <AlertCircle className="w-3 h-3" />
                  {errors.product_description}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Error Messages */}
        {errors.general && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-lg p-2"
            style={{ background: 'rgba(96, 165, 250, 0.2)', borderLeft: '3px solid #60a5fa', border: '1px solid rgba(96, 165, 250, 0.3)' }}
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#60a5fa' }} />
              <div>
                <h4 className="font-semibold text-xs mb-0.5" style={{ color: '#60a5fa' }}>Validation Error</h4>
                <p className="text-[11px]" style={{ color: '#60a5fa' }}>{errors.general}</p>
              </div>
            </div>
          </motion.div>
        )}

        {/* Submit Button */}
        <div className="flex flex-col sm:flex-row gap-2 pt-3 border-t" style={{ borderColor: '#30363d' }}>
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex-1 py-2 px-4 rounded-lg font-medium text-xs transition-all duration-300 flex items-center justify-center gap-2"
            style={{ 
              background: isSubmitting ? '#6b7280' : '#3b82f6', 
              color: 'white',
              cursor: isSubmitting ? 'not-allowed' : 'pointer'
            }}
            onMouseEnter={(e) => !isSubmitting && (e.target.style.background = '#2563eb')}
            onMouseLeave={(e) => !isSubmitting && (e.target.style.background = '#3b82f6')}
          >
            {isSubmitting ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                <span>Analyzing...</span>
              </>
            ) : (
              <>
                <BarChart3 className="w-3.5 h-3.5" />
                <span>Analyze Product</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              setForm({
                product_title: '',
                about_product: [''],
                product_description: '',
                backendKeywords: ''
              });
              setErrors({});
              setAnalysisResults(null);
            }}
            className="px-4 py-2 rounded-lg font-medium text-xs transition-all duration-300"
            style={{ background: '#1a1a1a', border: '1px solid #30363d', color: '#f3f4f6' }}
            onMouseEnter={(e) => e.target.style.borderColor = '#3b82f6'}
            onMouseLeave={(e) => e.target.style.borderColor = '#30363d'}
          >
            Clear Form
          </button>
        </div>
          </motion.form>

            {/* Analysis Results */}
            {analysisResults && <AnalysisReport analysisResults={analysisResults} />}
          </div>
        </div>
      </div>
    </div>
  );
}
