const checkSpecialCharacters = (str) => {
    const regex = /[!$?_{}^¬¦~#<>*]/g; // added 'g' for global matching
    const matches = str.match(regex);
    return matches ? [...new Set(matches)] : []; // return unique matched characters
  };
  
  const containsRestrictedWords = (str) => {
    const restrictedWords = [
      "cure", "treat", "diagnose", "prevent", "mitigate", "covid-19", "coronavirus", "pandemic",
      "cancer", "diabetes", "hiv", "arthritis", "asthma", "alzheimer's", "fda-approved", "clinically proven",
      "doctor recommended", "anti-bacterial", "anti-fungal", "antimicrobial", "antiviral", "infection",
      "virus", "germs", "bacteria", "detoxify", "detox", "cleanse", "sanitizes", "disinfects", "sterilizes",
      "kills germs", "cbd", "cannabinoid", "thc", "hemp oil", "marijuana", "full spectrum", "delta-8",
      "delta-9", "cocaine", "opioid", "methamphetamine", "bong", "one hitter", "dab rig", "weed",
      "picamilon", "phenibut", "dmt", "ayahuasca", "clenbuterol", "ephedrine", "minoxidil",
      "guarantee", "guaranteed", "100% guaranteed", "best seller", "amazon's choice", "amazon's favorite",
      "works better than", "fastest shipping", "instant fix", "magic solution", "free shipping",
      "100% quality guaranteed", "sale", "discount", "promo", "deal", "today only", "limited time",
      "last chance", "buy with confidence", "unlike other brands", "certified", "tested", "approved",
      "validated", "epa registered", "non-toxic", "hypoallergenic", "kills 99.9% of germs", "bpa-free",
      "lead-free", "eco-friendly", "biodegradable", "fda-registered facility", "kills", "eliminates",
      "destroys", "repels", "repellent", "pesticide", "insecticide", "fungicide", "mold", "mildew remover",
      "germ-free", "brightening", "whitening", "lightening", "anti-aging", "wrinkle-free", "removes wrinkles",
      "permanent results", "antimicrobial", "antibacterial", "antifungal", "sanitize", "disinfect",
      "sterilizes", "heal", "antiseptic", "germ", "fungal", "insecticide", "pesticides", "repel",
      "repelling", "viruses", "detoxification", "treatment", "fungus", "contaminants", "compostable",
      "decomposable", "proven", "recommended", "viruses", "fungicides", "toxin", "toxins", "viral",
      "remedy", "remedies", "diseases", "fda approved", "covid", "toxic", "mildew", "mould", "spores",
      "n95", "kn95", "cystic fibrosis", "sanitize", "weight loss", "chlamydia", "hepatitis", "hiv",
      "aids", "mononucleosis", "mono", "pelvic inflammatory", "scabies", "trichomoniasis", "liver",
      "multiple sclerosis", "kidney", "alzheimer's", "dementia", "stroke", "parkinson's", "parkinson",
      "flu", "influenza", "meningitis", "glaucoma", "cataract", "adhd", "concussion", "tumor",
      "depression", "lupus", "muscular dystrophy", "als", "anxiety", "stress", "clenbuterol",
      "ephedrine", "kratom", "psilocybin", "syphilis", "gonorrhea", "gout", "crohn's", "celiac",
      "epilepsy", "seizures", "seizure", "obesity", "autism",
      "covid19", "covid 19", "delta8", "delta 8", "delta9", "delta 9",
      "nontoxic", "non toxic", "bpafree", "bpa free", "leadfree", "lead free",
      "ecofriendly", "eco friendly", "germfree", "germ free", "antiaging", "anti aging",
      "wrinklefree", "wrinkle free", "fda registered facility", "anti microbial", "anti fungal", "anti bacterial"
    ];
  
    const matchedWords = restrictedWords.filter(word => {
      const regex = new RegExp(`\\b${word}\\b`, 'i');
      return regex.test(str);
    });
  
    return matchedWords.length > 0 ? matchedWords : [];
  };


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
// does not allow in titles. The medical/claim wording lives in
// containsRestrictedWords() and is checked alongside these.
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
        ...containsRestrictedWords(title),
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
}

const checkBulletPoints = (arr) => {
    let result = {};
    
    let charLimErrCount=0;
    let RestictedWordsErrCount=0;
    let SpecialCharactersErrCount=0;
    let AllRestrictedWords=[];
    let AllSpecialCharacters=[];


    arr.forEach((str) => {
        

        if (str.length < 150) {
            charLimErrCount++;
        } 
        let RestictedWords=containsRestrictedWords(str)
        
        if (RestictedWords.length>0) {
           RestictedWordsErrCount++; 
           AllRestrictedWords.push(RestictedWords[0]);
        } 

        const SpecialCharacters=checkSpecialCharacters(str)
        if (SpecialCharacters.length>0) {
          SpecialCharactersErrCount++; 
          AllSpecialCharacters.push(SpecialCharacters[0]);
        } 
    });

    if(charLimErrCount>0||RestictedWordsErrCount>0||SpecialCharactersErrCount>0){
        result.NumberOfErrors=1;
    }else if((charLimErrCount>0&&RestictedWordsErrCount>0)||(charLimErrCount>0&&SpecialCharactersErrCount>0)||(RestictedWordsErrCount>0&&SpecialCharactersErrCount>0)){
        result.NumberOfErrors=2; 
    }else if((charLimErrCount>0&&RestictedWordsErrCount>0&&SpecialCharactersErrCount>0)){
        result.NumberOfErrors=3;
    }else{
        result.NumberOfErrors=0;
    }
    
    let FinalRestrictedWords=[...new Set(AllRestrictedWords)];
    let FinalSpecialCharacters=[...new Set(AllSpecialCharacters)];

    

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
    if(RestictedWordsErrCount>0){
        result.RestictedWords={
            status:"Error",
            Message:`Your bullet points contain words that are restricted or banned by Amazon's guidelines. Using such words can lead to your product being blocked or your listing being suppressed. The words Used are: ${FinalRestrictedWords.join(', ')}`,
            HowTOSolve:"Review the bullet points and remove all restricted or banned words. Consult the most current Amazon selling policies and style guides to ensure your listing complies with all content regulations. Updating your bullet points accordingly will help avoid suppression or blocking of your listing."
        }
    }else{
        result.RestictedWords={
            status:"Success",
            Message:"Excellent! Your bullet points are in full compliance with Amazon's guidelines, free of any restricted or banned words, ensuring your listing stays active and visible.",
            HowTOSolve:""
        }
    }
    if(SpecialCharactersErrCount>0){
        result.checkSpecialCharacters={
            status:"Error",
            Message:`Your bullet points contain special characters that are restricted by Amazon's guidelines. Using these characters can lead to issues with listing compliance and may prevent your listing from being properly displayed. The special characters used are: ${FinalSpecialCharacters.join(', ')}`,
            HowTOSolve:"Review your bullet points and remove all restricted special characters. Refer to Amazon's official style guide to ensure your content adheres to their formatting requirements. This will help maintain your listing's visibility and prevent potential suppression."
        }
    }else{
        result.checkSpecialCharacters={
            status:"Success",
            Message:"Well done! Your bullet points comply with Amazon's guidelines, avoiding any restricted special characters, ensuring your listing remains clear and effective.",
            HowTOSolve:""
        }
    }
    return result;
}

const checkDescription = (arr) => {
    let result = {};
    let errorCount = 0;
    let pointCounter = 0;

    arr.forEach((str) => {
        pointCounter++;

        if (str.length < 1700) {
            errorCount++;
            result.charLim = {
                status: "Error",
                Message: "Your product description is under 1700 characters. This may not provide enough information to fully educate potential buyers.",
                HowTOSolve: "Expand your product description to at least 1700 characters. Include benefits, use cases, and unique features, using proper formatting and keywords.",
                PointNumber: pointCounter
            }
        } else {
            result.charLim = {
                status: "Success",
                Message: "Great job! Your product description is sufficiently detailed.",
                HowTOSolve: "",
                PointNumber: pointCounter
            }
        }
        let RestictedWords=containsRestrictedWords(str)
        if (RestictedWords.length>0) {
            errorCount++;
            result.RestictedWords = {
                status: "Error",
                Message: `Your product description contains restricted or banned words according to Amazon's guidelines. The words used are: ${RestictedWords.join(', ')}`,
                HowTOSolve: "Review and remove restricted words from the description. Ensure full compliance with Amazon's guidelines.",
                PointNumber: pointCounter
            }
        } else {
            result.RestictedWords = {
                status: "Success",
                Message: "Excellent! Your product description avoids all restricted words.",
                HowTOSolve: "",
                PointNumber: pointCounter
            }
        }

        const SpecialCharacters=checkSpecialCharacters(str)
        if (SpecialCharacters.length>0) {
            errorCount++;
            result.checkSpecialCharacters = {
                status: "Error",
                Message: `Your product description includes restricted special characters. The special characters used are: ${SpecialCharacters.join(', ')}`,
                HowTOSolve: "Remove all restricted characters from your product description to meet Amazon's formatting guidelines.",
                PointNumber: pointCounter
            }
        } else {
            result.checkSpecialCharacters = {
                status: "Success",
                Message: "Your product description is clean and free of restricted characters.",
                HowTOSolve: "",
                PointNumber: pointCounter
            }
        }
    });

    result.NumberOfErrors = errorCount;
    return result;
}

const findDuplicateWords = (str) => {
    const words = str.toLowerCase().match(/\b\w+\b/g);
    const wordSet = new Set();

    if (!words) return false;

    for (const word of words) {
        if (wordSet.has(word)) {
            return true;
        }
        wordSet.add(word);
    }
    return false;
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
        errorCount++;
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

    if (findDuplicateWords(str)) {
        errorCount++;
        result.dublicateWords = {
            status: "Error",
            Message: "Your backend keywords contain duplicate words, wasting space and reducing effectiveness.",
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
    // console.log(ProductDetails.product_title)
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
}

module.exports = {
    getRankings,
    BackendKeyWordOrAttributesStatus,
    checkTitle,
    checkBulletPoints,
    checkDescription,
    TITLE_MAX_LENGTH,
    TITLE_PROHIBITED_CHARACTERS,
    TITLE_CONTEXTUAL_CHARACTERS,
    TITLE_RESTRICTED_PHRASES,
    TITLE_SPELLED_OUT_NUMBERS
};
