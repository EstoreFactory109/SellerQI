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
