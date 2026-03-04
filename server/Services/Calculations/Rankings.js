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





const checkTitle = (str) => {
    let result = {};
    let errorCount = 0;

    if (str.length < 80) {
        errorCount++;
        result.charLim = {
            status: "Error",
            Message: "The product title is under 80 characters, which can limit its visibility and effectiveness in search results, potentially reducing click-through rates.",
            HowTOSolve: "Extend the product title to between 80 to 200 characters. Include attributes such as brand, size, color, and unique features. Use keyword research tools like MerchantWords or Helium 10 to ensure optimization."
        }
    } else {
        result.charLim = {
            status: "Success",
            Message: "Great job! Your product title is well-optimized for visibility and readability, enhancing its appeal to potential buyers.",
            HowTOSolve: ""
        }
    }

    let RestictedWords=containsRestrictedWords(str)
    

    if (RestictedWords.length>0) {
        errorCount++;
        result.RestictedWords = {
            status: "Error",
            Message: `Your product title contains restricted or banned words according to Amazon's guidelines. Using such words can lead to your product listing being suppressed or removed. The Characters used are: ${RestictedWords.join(', ')}`,
            HowTOSolve: "Review your product title and remove restricted words. Refer to the latest Amazon seller policies to ensure compliance."
        }
    } else {
        result.RestictedWords = {
            status: "Success",
            Message: "Excellent! Your product title complies with Amazon's guidelines, avoiding any restricted words.",
            HowTOSolve: ""
        }
    }

    const SpecialCharacters=checkSpecialCharacters(str)
          // console.log(SpecialCharacters)

    if (SpecialCharacters.length>0) {
        errorCount++;
        result.checkSpecialCharacters = {
            status: "Error",
            Message: `Your product title includes special characters that violate Amazon's guidelines. Using prohibited characters can lead to listing suppression or reduced search visibility. The characters which are used: ${SpecialCharacters.join(", ")} `,
            HowTOSolve: "Remove all prohibited special characters from the product title. Follow Amazon's title guidelines to maintain visibility and prevent suppression."
        }
    } else {
        result.checkSpecialCharacters = {
            status: "Success",
            Message: "Well done! Your product title adheres to Amazon's guidelines by avoiding prohibited special characters.",
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
    checkDescription
};
