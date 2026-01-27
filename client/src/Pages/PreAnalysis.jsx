import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  FileText, 
  Tag, 
  AlertCircle,
  Info,
  BarChart3
} from 'lucide-react';
import AnalysisReport from '../Components/PreAnalysis/AnalysisReport.jsx';

// Ranking Analysis Functions (ported from backend)
const checkSpecialCharacters = (str) => {
  const regex = /[!$?_{}^¬¦~#<>*]/g;
  const matches = str.match(regex);
  return matches ? [...new Set(matches)] : [];
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
    "Syrian Rue", "Wild Dagga", "Yopo Seeds", "Gonorrhea", "Syphilis", "Pubic", "Alzheimer's",
    "Alzheimer", "Concussion", "Gout", "Crohn's", "Celiac", "Epilepsy", "Seizures",
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
    };
  } else {
    result.charLim = {
      status: "Success",
      Message: "Great job! Your product title is well-optimized for visibility and readability, enhancing its appeal to potential buyers.",
      HowTOSolve: ""
    };
  }

  let RestictedWords = containsRestrictedWords(str);

  if (RestictedWords.length > 0) {
    errorCount++;
    result.RestictedWords = {
      status: "Error",
      Message: `Your product title contains restricted or banned words according to Amazon's guidelines. Using such words can lead to your product listing being suppressed or removed. The Characters used are: ${RestictedWords.join(', ')}`,
      HowTOSolve: "Review your product title and remove restricted words. Refer to the latest Amazon seller policies to ensure compliance."
    };
  } else {
    result.RestictedWords = {
      status: "Success",
      Message: "Excellent! Your product title complies with Amazon's guidelines, avoiding any restricted words.",
      HowTOSolve: ""
    };
  }

  const SpecialCharacters = checkSpecialCharacters(str);

  if (SpecialCharacters.length > 0) {
    errorCount++;
    result.checkSpecialCharacters = {
      status: "Error",
      Message: `Your product title includes special characters that violate Amazon's guidelines. Using prohibited characters can lead to listing suppression or reduced search visibility. The characters which are used: ${SpecialCharacters.join(", ")} `,
      HowTOSolve: "Remove all prohibited special characters from the product title. Follow Amazon's title guidelines to maintain visibility and prevent suppression."
    };
  } else {
    result.checkSpecialCharacters = {
      status: "Success",
      Message: "Well done! Your product title adheres to Amazon's guidelines by avoiding prohibited special characters.",
      HowTOSolve: ""
    };
  }

  result.NumberOfErrors = errorCount;
  return result;
};

const checkBulletPoints = (arr) => {
  let result = {};
  
  let charLimErrCount = 0;
  let RestictedWordsErrCount = 0;
  let SpecialCharactersErrCount = 0;
  let AllRestrictedWords = [];
  let AllSpecialCharacters = [];

  arr.forEach((str) => {
    if (str.length < 150) {
      charLimErrCount++;
    }
    let RestictedWords = containsRestrictedWords(str);
    
    if (RestictedWords.length > 0) {
      RestictedWordsErrCount++;
      AllRestrictedWords.push(RestictedWords[0]);
    }

    const SpecialCharacters = checkSpecialCharacters(str);
    if (SpecialCharacters.length > 0) {
      SpecialCharactersErrCount++;
      AllSpecialCharacters.push(SpecialCharacters[0]);
    }
  });

  if (charLimErrCount > 0 || RestictedWordsErrCount > 0 || SpecialCharactersErrCount > 0) {
    result.NumberOfErrors = 1;
  } else if ((charLimErrCount > 0 && RestictedWordsErrCount > 0) || (charLimErrCount > 0 && SpecialCharactersErrCount > 0) || (RestictedWordsErrCount > 0 && SpecialCharactersErrCount > 0)) {
    result.NumberOfErrors = 2;
  } else if ((charLimErrCount > 0 && RestictedWordsErrCount > 0 && SpecialCharactersErrCount > 0)) {
    result.NumberOfErrors = 3;
  } else {
    result.NumberOfErrors = 0;
  }
  
  let FinalRestrictedWords = [...new Set(AllRestrictedWords)];
  let FinalSpecialCharacters = [...new Set(AllSpecialCharacters)];

  if (charLimErrCount > 0) {
    result.charLim = {
      status: "Error",
      Message: "Your bullet points are under 150 characters. Short bullet points may not provide enough detail to effectively communicate the features and benefits of your products, potentially affecting customer interest and conversion rates.",
      HowTOSolve: "Enhance your bullet points to be at least 150 characters long, focusing on key features, benefits, and differentiators of your product. Use this space to clearly articulate why customers should choose your product, including any unique selling propositions.."
    };
  } else {
    result.charLim = {
      status: "Success",
      Message: "Great job! Your bullet points are adequately detailed, providing valuable information to customers and effectively enhancing your product's appeal.",
      HowTOSolve: ""
    };
  }
  if (RestictedWordsErrCount > 0) {
    result.RestictedWords = {
      status: "Error",
      Message: `Your bullet points contain words that are restricted or banned by Amazon's guidelines. Using such words can lead to your product being blocked or your listing being suppressed. The words Used are: ${FinalRestrictedWords.join(', ')}`,
      HowTOSolve: "Review the bullet points and remove all restricted or banned words. Consult the most current Amazon selling policies and style guides to ensure your listing complies with all content regulations. Updating your bullet points accordingly will help avoid suppression or blocking of your listing."
    };
  } else {
    result.RestictedWords = {
      status: "Success",
      Message: "Excellent! Your bullet points are in full compliance with Amazon's guidelines, free of any restricted or banned words, ensuring your listing stays active and visible.",
      HowTOSolve: ""
    };
  }
  if (SpecialCharactersErrCount > 0) {
    result.checkSpecialCharacters = {
      status: "Error",
      Message: `Your bullet points contain special characters that are restricted by Amazon's guidelines. Using these characters can lead to issues with listing compliance and may prevent your listing from being properly displayed. The special characters used are: ${FinalSpecialCharacters.join(', ')}`,
      HowTOSolve: "Review your bullet points and remove all restricted special characters. Refer to Amazon's official style guide to ensure your content adheres to their formatting requirements. This will help maintain your listing's visibility and prevent potential suppression."
    };
  } else {
    result.checkSpecialCharacters = {
      status: "Success",
      Message: "Well done! Your bullet points comply with Amazon's guidelines, avoiding any restricted special characters, ensuring your listing remains clear and effective.",
      HowTOSolve: ""
    };
  }
  return result;
};

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
      };
    } else {
      result.charLim = {
        status: "Success",
        Message: "Great job! Your product description is sufficiently detailed.",
        HowTOSolve: "",
        PointNumber: pointCounter
      };
    }
    let RestictedWords = containsRestrictedWords(str);
    if (RestictedWords.length > 0) {
      errorCount++;
      result.RestictedWords = {
        status: "Error",
        Message: `Your product description contains restricted or banned words according to Amazon's guidelines. The words used are: ${RestictedWords.join(', ')}`,
        HowTOSolve: "Review and remove restricted words from the description. Ensure full compliance with Amazon's guidelines.",
        PointNumber: pointCounter
      };
    } else {
      result.RestictedWords = {
        status: "Success",
        Message: "Excellent! Your product description avoids all restricted words.",
        HowTOSolve: "",
        PointNumber: pointCounter
      };
    }

    const SpecialCharacters = checkSpecialCharacters(str);
    if (SpecialCharacters.length > 0) {
      errorCount++;
      result.checkSpecialCharacters = {
        status: "Error",
        Message: `Your product description includes restricted special characters. The special characters used are: ${SpecialCharacters.join(', ')}`,
        HowTOSolve: "Remove all restricted characters from your product description to meet Amazon's formatting guidelines.",
        PointNumber: pointCounter
      };
    } else {
      result.checkSpecialCharacters = {
        status: "Success",
        Message: "Your product description is clean and free of restricted characters.",
        HowTOSolve: "",
        PointNumber: pointCounter
      };
    }
  });

  result.NumberOfErrors = errorCount;
  return result;
};

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
};

const BackendKeyWordOrAttributesStatus = (str) => {
  let result = {};
  let errorCount = 0;

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
      Message: "Your backend keywords total less than 450 characters. This may limit your product's visibility by missing relevant search terms.",
      HowTOSolve: "Use at least 450 characters out of the available 500. Include relevant, diverse, and unique keywords to improve product discoverability."
    };
  } else {
    result.charLim = {
      status: "Success",
      Message: "Great job! You're utilizing the backend keyword space effectively.",
      HowTOSolve: ""
    };
  }

  if (findDuplicateWords(str)) {
    errorCount++;
    result.dublicateWords = {
      status: "Error",
      Message: "Your backend keywords contain duplicate words, wasting space and reducing effectiveness.",
      HowTOSolve: "Remove duplicate words. Use synonyms, alternate terms, and other relevant keywords to increase reach."
    };
  } else {
    result.dublicateWords = {
      status: "Success",
      Message: "Excellent! Your backend keywords are unique and fully optimized.",
      HowTOSolve: ""
    };
  }

  result.NumberOfErrors = errorCount;
  return result;
};

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
    <div className="min-h-screen bg-gray-50/50 overflow-x-hidden w-full">
      {/* Header Section */}
      <div className='bg-white border-b border-gray-200/80 sticky top-0 z-40'>
        <div className='px-4 lg:px-6 py-4'>
          <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4'>
            <div className='flex items-center gap-4'>
              <div>
                <h1 className='text-2xl font-bold text-gray-900'>Listing Analyzer</h1>
                <p className='text-sm text-gray-600 mt-1'>Analyze your product listing for ranking errors before adding to Amazon</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className='overflow-y-auto' style={{ height: 'calc(100vh - 120px)' }}>
        <div className='px-4 lg:px-6 py-6 pb-20'>
          <div className="max-w-6xl mx-auto">
            {/* Info Banner */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="bg-gradient-to-r from-blue-50 to-indigo-50 border-l-4 border-blue-500 rounded-xl p-5 shadow-sm mb-8"
            >
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Info className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900 mb-2">What is Listing Analyzer?</h3>
                  <p className="text-gray-700 text-sm leading-relaxed mb-3">
                    Listing Analyzer helps you identify potential ranking issues before listing your product on Amazon. 
                    Fill in any product details below, and we'll instantly analyze them for common ranking errors and optimization opportunities.
                  </p>
                  <div className="flex items-center gap-2 text-xs text-blue-700 font-medium">
                    <div className="w-1.5 h-1.5 bg-blue-500 rounded-full"></div>
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
              className="bg-white rounded-2xl border border-gray-200 shadow-xl p-6 lg:p-8 space-y-8"
            >
          {/* Product Title */}
          <div className="space-y-3">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-100 to-indigo-100 rounded-xl flex items-center justify-center">
                <FileText className="w-5 h-5 text-blue-600" />
              </div>
              <h2 className="text-xl font-bold text-gray-900">Product Title</h2>
            </div>
            <div className="space-y-2">
              <input
                type="text"
                name="product_title"
                value={form.product_title}
                onChange={handleChange}
                className={`w-full border-2 rounded-xl px-5 py-3.5 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-300 bg-gray-50/50 hover:bg-white ${
                  errors.product_title ? 'border-red-300 focus:ring-red-500 focus:border-red-500' : 'border-gray-200'
                }`}
                placeholder="Enter your product title here..."
              />
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500 font-medium">
                  {form.product_title.length} characters
                </p>
                {errors.product_title && (
                  <p className="text-xs text-red-600 font-medium flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    {errors.product_title}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Backend Keywords Section */}
          <div className="space-y-3">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-gradient-to-br from-purple-100 to-pink-100 rounded-xl flex items-center justify-center">
                <Tag className="w-5 h-5 text-purple-600" />
              </div>
              <h2 className="text-xl font-bold text-gray-900">Backend Keywords</h2>
            </div>
            <div className="space-y-3">
              <textarea
                name="backendKeywords"
                value={form.backendKeywords}
                onChange={handleChange}
                rows={6}
                className={`w-full border-2 rounded-xl px-5 py-3.5 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-all duration-300 resize-none bg-gray-50/50 hover:bg-white ${
                  errors.backendKeywords ? 'border-red-300 focus:ring-red-500 focus:border-red-500' : 'border-gray-200'
                }`}
                placeholder="Enter backend keywords/search terms separated by commas or spaces..."
              />
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500 font-medium">
                  {form.backendKeywords.length} characters
                </p>
                {errors.backendKeywords && (
                  <p className="text-xs text-red-600 font-medium flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    {errors.backendKeywords}
                  </p>
                )}
              </div>
              <div className="bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-200 rounded-xl p-4">
                <div className="flex items-start gap-2">
                  <div className="w-5 h-5 bg-purple-500 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Info className="w-3 h-3 text-white" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-purple-900 mb-1">Pro Tip</p>
                    <p className="text-xs text-purple-800 leading-relaxed">
                      Include synonyms, alternate terms, and relevant keywords. Each word should be unique (no duplicates) for maximum effectiveness.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Bullet Points Section */}
          <div className="space-y-3">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-gradient-to-br from-emerald-100 to-teal-100 rounded-xl flex items-center justify-center">
                <FileText className="w-5 h-5 text-emerald-600" />
              </div>
              <h2 className="text-xl font-bold text-gray-900">Bullet Points</h2>
            </div>
            <div className="space-y-4">
              {form.about_product.map((bullet, index) => (
                <div key={index} className="relative group">
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-gray-700 font-semibold text-sm">
                      Bullet Point {index + 1}
                    </label>
                    {form.about_product.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeBulletPoint(index)}
                        className="text-red-500 hover:text-red-600 text-sm font-medium px-2 py-1 rounded-lg hover:bg-red-50 transition-colors"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <textarea
                    value={bullet}
                    onChange={(e) => handleBulletPointChange(index, e.target.value)}
                    rows={3}
                    className="w-full border-2 border-gray-200 rounded-xl px-5 py-3.5 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all duration-300 resize-none bg-gray-50/50 hover:bg-white"
                    placeholder={`Enter key feature ${index + 1}...`}
                  />
                  <p className="text-xs text-gray-500 font-medium mt-1.5">
                    {bullet.length} characters
                  </p>
                </div>
              ))}
              <button
                type="button"
                onClick={addBulletPoint}
                className="w-full py-3 px-4 border-2 border-dashed border-gray-300 rounded-xl text-gray-600 hover:border-emerald-400 hover:text-emerald-600 hover:bg-emerald-50/50 transition-all duration-300 font-medium flex items-center justify-center gap-2 group"
              >
                <div className="w-5 h-5 border-2 border-current rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                  <span className="text-sm">+</span>
                </div>
                Add More Bullet Point
              </button>
            </div>
          </div>

          {/* Product Description */}
          <div className="space-y-3">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-gradient-to-br from-amber-100 to-orange-100 rounded-xl flex items-center justify-center">
                <FileText className="w-5 h-5 text-amber-600" />
              </div>
              <h2 className="text-xl font-bold text-gray-900">Product Description</h2>
            </div>
            <div className="space-y-2">
              <textarea
                name="product_description"
                value={form.product_description}
                onChange={handleChange}
                rows={10}
                className={`w-full border-2 rounded-xl px-5 py-3.5 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-all duration-300 resize-none bg-gray-50/50 hover:bg-white ${
                  errors.product_description ? 'border-red-300 focus:ring-red-500 focus:border-red-500' : 'border-gray-200'
                }`}
                placeholder="Enter your product description. Include features, benefits, specifications, and usage instructions..."
              />
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500 font-medium">
                  {form.product_description.length} characters
                </p>
                {errors.product_description && (
                  <p className="text-xs text-red-600 font-medium flex items-center gap-1">
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
              className="bg-gradient-to-r from-red-50 to-pink-50 border-l-4 border-red-500 rounded-xl p-5 shadow-sm"
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 bg-red-500 rounded-lg flex items-center justify-center flex-shrink-0">
                  <AlertCircle className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h4 className="text-red-900 font-semibold mb-1">Validation Error</h4>
                  <p className="text-red-700 text-sm">{errors.general}</p>
                </div>
              </div>
            </motion.div>
          )}

          {/* Submit Button */}
          <div className="flex flex-col sm:flex-row gap-4 pt-6 border-t border-gray-200">
            <button
              type="submit"
              disabled={isSubmitting}
              className={`flex-1 py-4 px-8 rounded-xl font-semibold text-lg transition-all duration-300 flex items-center justify-center gap-3 shadow-lg ${
                isSubmitting
                  ? 'bg-gray-400 text-gray-200 cursor-not-allowed shadow-none'
                  : 'bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 text-white hover:from-blue-700 hover:via-blue-600 hover:to-indigo-700 hover:shadow-xl hover:shadow-blue-500/30 transform hover:scale-[1.02]'
              }`}
            >
              {isSubmitting ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>Analyzing...</span>
                </>
              ) : (
                <>
                  <BarChart3 className="w-5 h-5" />
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
              className="px-8 py-4 rounded-xl font-semibold text-lg border-2 border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-all duration-300"
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
