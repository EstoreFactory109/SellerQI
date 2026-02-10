const checkSpecialCharacters = (str) => {
    const regex = /[!$?_{}^¬¦~#<>*]/g; // added 'g' for global matching
    const matches = str.match(regex);
    return matches ? [...new Set(matches)] : []; // return unique matched characters
  };
  
  const containsRestrictedWords = (str) => {
    const restrictedWords = [
        "anti-microbial", "Airborne microbial", "anti-bacterial", "bacterial", "pesticides",
        "anti-fungal", "fungal", "kill", "antimicrobial", "virus", "antifungal", "antibacterial",
        "heal", "sexy", "insect", "insecticide", "pesticide", "pest", "safe", "non-poisonous",
        "non-injurious", "harmless", "infection", "risk", "disease", "non-toxic", "natural",
        "repellent", "repelling", "repel", "antiseptic", "germ", "cbd", "compliance", "heart",
        "covid", "coronavirus", "arthritis", "diabetes", "Ethanol", "toxic", "non", "weed",
        "mold", "resistant", "kn", "fda approved", "bacteria", "biodegradable", "biological",
        "contaminants", "cancer", "certified", "compostable", "cure", "decomposable", "degradable",
        "filter", "flawless", "fungus", "acupuncture", "green", "guarantee", "home", "marine",
        "mildew", "mould", "spores", "native", "N95", "KN95", "american indian tribes",
        "fibrosis", "cystic fibrosis", "non-toxi", "noncorrosive", "peal", "platinum", "proven",
        "recommended", "sanitize", "sanitizes", "tested", "treat", "validated", "viruses",
        "fungicides", "fungicide", "detoxify", "detoxification", "weight loss", "treatment",
        "toxin", "toxins", "viral", "parasitic", "remedy", "remedies", "diseases", "cancroid",
        "chlamydia", "cytomegalovirus", "cmv", "human papiloma", "hpv", "gororrhea", "clap",
        "hepatitis", "herpes simplex", "hsv", "immunodeficiency", "hiv", "aids", "acquired immune deficiency syndrome",
        "lymphogranuloma venereum", "lgv", "mononucleosis", "mono", "mycoplasma genitalium",
        "nongonococcal urethritis", "ngu", "pelvic inflammatory", "pid", "public lice", "crabs",
        "scabies", "trichomoniasis", "trich", "liver", "multiple sclerosis", "kidney",
        "alzheimer's", "dementia", "stroke", "parkinson's", "parkinson", "diabetic neuropathy",
        "flu", "influenza", "meningitis", "glaucoma", "cataract", "attention deficit disorder",
        "drug", "add", "adhd", "concussion", "traumatic brain injuries", "tbis", "nano silver",
        "tumor", "seasonal affective", "sad", "depression", "crystic fibrosis",
        "hodgkin's lymphoma", "lupus", "muscular dystrophy", "als", "infrared", "mental", "anxiety",
        "stress", "pearl", "Amanita muscaria", "Clenbuterol", "Coca Leaves", "Codeine",
        "Damiana", "Dimethyltryptamine (DMT)", "Drotebanol", "Ephedrine", "Ergotamine",
        "Hawaiian Baby Woodrose or Argyreia Nervosa seeds", "Jimson Weed", "Kanna", "Ketamine",
        "Klip Dagga", "Kratom", "Marshmallow Leaf", "Panther amanitas", "Peyote or mescaline",
        "Phenylpropanalomine", "Poppers amyl nitrite", "Poppy", "Pseudoephedrine",
        "Psilocybe Cubensis", "Psilocybin", "Salvia Divinorum", "Sonoran Song", "Mimosa Hostilis",
        "Syrian Rue", "Wild Dagga", "Yopo Seeds", "Gonorrhea", "Syphilis", "Pubic", "Alzheimer’s",
        "Alzheimer", "Concussion", "Gout", "Crohn’s", "Celiac", "Epilepsy", "Seizures",
        "Seizure", "Obesity", "Autism", "macula", "macular"
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
            HowTOSolve: "Remove all prohibited special characters from the product title. Follow Amazon’s title guidelines to maintain visibility and prevent suppression."
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
            Message:"Great job! Your bullet points are adequately detailed, providing valuable information to customers and effectively enhancing your product’s appeal.",
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
            HowTOSolve:"Review your bullet points and remove all restricted special characters. Refer to Amazon’s official style guide to ensure your content adheres to their formatting requirements. This will help maintain your listing's visibility and prevent potential suppression."
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
                HowTOSolve: "Remove all restricted characters from your product description to meet Amazon’s formatting guidelines.",
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

    if (str.length < 450) {
        errorCount++;
        result.charLim = {
            status: "Error",
            Message: "Your backend keywords total less than 450 characters. This may limit your product’s visibility by missing relevant search terms.",
            HowTOSolve: "Use at least 450 characters out of the available 500. Include relevant, diverse, and unique keywords to improve product discoverability."
        }
    } else {
        result.charLim = {
            status: "Success",
            Message: "Great job! You're utilizing the backend keyword space effectively.",
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

module.exports = { getRankings, BackendKeyWordOrAttributesStatus, checkTitle, checkBulletPoints };





