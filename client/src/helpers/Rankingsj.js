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

// Amazon's title requirements (21 Jan 2025): at most 200 characters for most
// categories. Same as server Rankings.js (source of truth).
const TITLE_MAX_LENGTH = 200;
// tasks-logics.xlsx: under 80 characters is a low-priority issue.
const TITLE_MIN_RECOMMENDED_LENGTH = 80;

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

    // Check for null or undefined
    if (str === null || str === undefined) {
        errorCount++;
        result.nullCheck = {
            status: "Error",
            Message: "Product title is null or undefined. A valid product title is required.",
            HowTOSolve: "Ensure that a valid product title is provided before processing."
        }
        result.NumberOfErrors = errorCount;
        return result;
    }

    const title = typeof str === 'string' ? str : '';

    // 1. Character limit - at most 200 characters (Amazon); under 80 is too short (tasks-logics.xlsx).
    if (!title.trim()) {
        errorCount++;
        result.charLim = {
            status: "Error",
            Message: "Your product title is missing. Amazon requires a title that clearly and concisely describes the product.",
            HowTOSolve: "Add a title containing the minimum information needed to identify the product, such as brand plus product type (for example, \"Sony Headphones\"), and keep it within 200 characters."
        }
    } else if (title.length > TITLE_MAX_LENGTH) {
        errorCount++;
        result.charLim = {
            status: "Error",
            Message: `Your product title is ${title.length} characters, which exceeds Amazon's ${TITLE_MAX_LENGTH}-character limit. Titles over the limit can be automatically corrected or kept out of search results.`,
            HowTOSolve: `Shorten the title to ${TITLE_MAX_LENGTH} characters or fewer, ordering the words brand, flavor or style, product type, key attribute, color, size or pack count, model number. Move the remaining detail (materials, use cases) into the bullet points.`
        }
    } else if (title.length < TITLE_MIN_RECOMMENDED_LENGTH) {
        errorCount++;
        result.charLim = {
            status: "Error",
            Message: `Your product title is only ${title.length} characters. Titles under ${TITLE_MIN_RECOMMENDED_LENGTH} characters usually leave out words shoppers search for, such as size, material, quantity or key use.`,
            HowTOSolve: `Add the details a shopper would search for - key attribute, size or pack count, material, color, main use - while staying within Amazon's ${TITLE_MAX_LENGTH}-character limit and not repeating any word more than twice.`
        }
    } else {
        result.charLim = {
            status: "Success",
            Message: `Great job! Your product title is ${title.length} characters, within Amazon's ${TITLE_MAX_LENGTH}-character limit.`,
            HowTOSolve: ""
        }
    }

    // 2. Restricted, promotional, and subjective wording.
    let RestictedWords = [...new Set([
        ...findPromotionalTerms(title),
        ...findProhibitedClaims(title),
        ...matchPhrases(title, TITLE_RESTRICTED_PHRASES)
    ])];

    // Review flag only (tasks-logics.xlsx); same as server Rankings.js.
    if (RestictedWords.length>0) {
        result.RestictedWords = {
            status: "Warning",
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

    // ~ # < > * used decoratively: review flag only (tasks-logics.xlsx).
    if (decorativeContextual.length > 0) {
        result.contextualCharacters = {
            status: "Warning",
            Message: `Please review: ${decorativeContextual.join(', ')} in your title look decorative. Amazon allows them only as identifiers ("Style #4301") or measurements ("<10 lb").`,
            HowTOSolve: "Keep these symbols only where they are part of a model number or measurement."
        }
    }

    if (prohibited.length > 0 || decorative.length > 0) {
        errorCount++;
        const details = [];
        if (prohibited.length > 0) {
            details.push(`characters that are never allowed in a title: ${prohibited.join(', ')}`);
        }
        if (decorative.length > 0) {
            details.push(`non-language or decorative symbols: ${decorative.join(', ')}`);
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
            Message: `Your product title spells out numbers instead of using numerals: ${spelledOutNumbers.join(', ')}. Numerals are quicker for customers to scan and use fewer of the 200 available characters.`,
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

// ─── Bullet points, description, getRankings ─────────────────────────────────
// COPY of checkBulletPoints, checkDescription and getRankings in server/Services/
// Calculations/Rankings.js (source of truth), so this analyzer and the tasks agree.
// The one deliberate difference: getRankings returns finalResult itself rather
// than { finalResult }, because AnalyseProduct.js reads it that way.

// Special characters are restricted in titles only; the key is kept (always
// Success) because the result pages read it unconditionally.
const notCheckedOutsideTitle = (where) => ({
    status: "Success",
    Message: `Special characters are only restricted in product titles; Amazon applies no such rule to ${where}.`,
    HowTOSolve: ""
});

// The scrape stores [] both when a listing has no bullet points and when it could
// not read them, so an empty array is NO DATA, not a failure: it produces no error
// and no task. (A non-array is treated the same way.)
const MIN_BULLET_POINTS = 5;

const checkBulletPoints = (arr) => {
    let result = {};
    const bullets = Array.isArray(arr) ? arr.filter((str) => typeof str === 'string') : [];

    let charLimErrCount = 0;
    const claims = new Set();

    bullets.forEach((str) => {
        if (str.length < 150) {
            charLimErrCount++;
        }
        // Bullets are checked for prohibited claims only; promotional terms are
        // a title rule.
        findProhibitedClaims(str).forEach((word) => claims.add(word));
    });

    // tasks-logics.xlsx: fewer than 5 bullets, or any under 150 characters.
    const tooFew = bullets.length > 0 && bullets.length < MIN_BULLET_POINTS;
    if(charLimErrCount>0 || tooFew){
        const parts = [];
        if (tooFew) parts.push(`Your listing has ${bullets.length} bullet point${bullets.length === 1 ? '' : 's'}; Amazon gives you ${MIN_BULLET_POINTS}.`);
        if (charLimErrCount > 0) parts.push(`${charLimErrCount} of your bullet points ${charLimErrCount === 1 ? 'is' : 'are'} under 150 characters.`);
        result.charLim={
            status:"Error",
            Message:`${parts.join(' ')} Short or missing bullet points may not give shoppers enough detail to decide.`,
            HowTOSolve:"Use all five bullet points, each at least 150 characters: lead with the key feature, then the benefit, then any detail (size, material, compatibility) that helps a shopper decide."
        }
    }else{
        result.charLim={
            status:"Success",
            Message:"Great job! Your bullet points are adequately detailed, providing valuable information to customers and effectively enhancing your product's appeal.",
            HowTOSolve:""
        }
    }
    // Review flag only (tasks-logics.xlsx).
    if(claims.size>0){
        result.RestictedWords={
            status:"Warning",
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

    // One per failing check.
    result.NumberOfErrors = [result.charLim, result.RestictedWords]
        .filter((check) => check.status === "Error").length;
    return result;
}

// Same no-data rule as bullets: an empty or missing description, a non-array, or
// one made only of blank paragraphs produces no result keys and no error. Each
// check runs once over the whole description and counts once.
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

    // Prohibited claims only; promotional terms are a title rule.
    const claims = [...new Set(paragraphs.flatMap((str) => findProhibitedClaims(str)))];
    // Review flag only (tasks-logics.xlsx).
    if (claims.length > 0) {
        result.RestictedWords = {
            status: "Warning",
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

const getRankings = (ProductDetails) => {
    // A product the scrape returned nothing for is no data, not three failures.
    // This used to report TotalErrors: 3, wrapped in { finalResult }, which
    // AnalyseProduct.js does not unwrap.
    if (!ProductDetails) {
        return {
            Title: null,
            TitleResult: { NumberOfErrors: 0 },
            BulletPoints: { NumberOfErrors: 0 },
            Description: { NumberOfErrors: 0 },
            TotalErrors: 0,
            TotalPossibleErrors: 9
        };
    }

    const titleResult = checkTitle(ProductDetails.product_title);
    // Empty (or missing) bullets and description are NO DATA, not failures: both
    // checks return zero errors for them, as on the server.
    const bulletPointsResult = checkBulletPoints(ProductDetails.about_product);
    const descriptionResult = checkDescription(ProductDetails.product_description);

    const totalErrorNumbers = titleResult.NumberOfErrors + bulletPointsResult.NumberOfErrors + descriptionResult.NumberOfErrors;

    const finalResult = {
        Title: ProductDetails.product_title,
        TitleResult: titleResult,
        BulletPoints: bulletPointsResult,
        Description: descriptionResult,
        TotalErrors: totalErrorNumbers,
        TotalPossibleErrors: 9
    };
    return finalResult;
}

export { getRankings, checkTitle, checkBulletPoints, checkDescription, findPromotionalTerms, findProhibitedClaims, PROMOTIONAL_TERMS, PROHIBITED_CLAIMS };





