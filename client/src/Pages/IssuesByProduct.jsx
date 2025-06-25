import React, { useState, useEffect } from 'react';
import { useSelector } from "react-redux";
import { useNavigate } from 'react-router-dom';
import { LazyLoadImage } from 'react-lazy-load-image-component';
import 'react-lazy-load-image-component/src/effects/blur.css';
import { AnimatePresence, motion } from "framer-motion";
import DropDown from '../assets/Icons/drop-down.png';
import noImage from '../assets/Icons/no-image.png';

// Table component for ranking issues
const RankingIssuesTable = ({ product }) => {
    const [page, setPage] = useState(1);
    const itemsPerPage = 5;
    
    const extractRankingErrors = (product) => {
        const rankingErrors = product.rankingErrors?.data;
        if (!rankingErrors) return [];
        
        const errorRows = [];
        const sections = ['TitleResult', 'BulletPoints', 'Description'];
        const sectionLabels = {
            TitleResult: 'Title',
            BulletPoints: 'Bullet Points', 
            Description: 'Description'
        };
        
        const issueLabels = {
            RestictedWords: 'Restricted Words',
            checkSpecialCharacters: 'Special Characters',
            charLim: 'Character Limit'
        };
        
        sections.forEach((sectionKey) => {
            const section = rankingErrors[sectionKey];
            if (section) {
                Object.keys(issueLabels).forEach((checkKey) => {
                    const check = section[checkKey];
                    if (check?.status === 'Error') {
                        errorRows.push({
                            issueHeading: `${sectionLabels[sectionKey]} | ${issueLabels[checkKey]}`,
                            message: check.Message,
                            solution: check.HowTOSolve
                        });
                    }
                });
            }
        });
        
        // Backend Keywords
        if (rankingErrors.charLim?.status === "Error") {
            errorRows.push({
                issueHeading: 'Backend Keywords | Character Limit',
                message: rankingErrors.charLim.Message,
                solution: rankingErrors.charLim.HowTOSolve
            });
        }
        
        return errorRows;
    };
    
    const errors = extractRankingErrors(product);
    const displayedErrors = errors.slice(0, page * itemsPerPage);
    const hasMore = errors.length > displayedErrors.length;
    
    if (errors.length === 0) {
        return (
            <div className="text-center py-8">
                <p className="text-gray-500">No ranking issues found for this product.</p>
            </div>
        );
    }
    
    return (
        <div>
            <div className="overflow-x-auto rounded-lg shadow">
                <table className="min-w-full bg-white border border-gray-200">
                    <thead>
                        <tr className="bg-[#333651] text-left text-sm font-medium text-white uppercase tracking-wider">
                            <th className="px-4 py-3 border">Issue Type</th>
                            <th className="px-4 py-3 border">Description</th>
                            <th className="px-4 py-3 border">How to Solve</th>
                        </tr>
                    </thead>
                    <tbody>
                        {displayedErrors.map((error, idx) => (
                            <tr key={idx} className="border-t text-sm text-gray-700">
                                <td className="px-4 py-3 border">{error.issueHeading}</td>
                                <td className="px-4 py-3 border">{error.message}</td>
                                <td className="px-4 py-3 border">{error.solution}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {hasMore && (
                <div className="mt-4 text-center">
                    <button
                        className="bg-[#333651] text-white px-4 py-2 rounded hover:bg-[#2a2d47] transition"
                        onClick={() => setPage((prev) => prev + 1)}
                    >
                        View More
                    </button>
                </div>
            )}
        </div>
    );
};

// Table component for conversion issues
const ConversionIssuesTable = ({ product }) => {
    const [page, setPage] = useState(1);
    const itemsPerPage = 5;
    
    const extractConversionErrors = (product) => {
        const conversionErrors = product.conversionErrors;
        if (!conversionErrors) return [];
        
        const errorRows = [];
        const issueMap = [
            ['Images', conversionErrors.imageResultErrorData],
            ['Video', conversionErrors.videoResultErrorData],
            ['Product Review', conversionErrors.productReviewResultErrorData],
            ['Star Rating', conversionErrors.productStarRatingResultErrorData],
            ['Buy Box', conversionErrors.productsWithOutBuyboxErrorData],
            ['A+ Content', conversionErrors.aplusErrorData]
        ];
        
        issueMap.forEach(([label, errorData]) => {
            if (errorData?.status === 'Error') {
                errorRows.push({
                    issueHeading: `${label} Issue`,
                    message: errorData.Message,
                    solution: errorData.HowToSolve
                });
            }
        });
        
        return errorRows;
    };
    
    const errors = extractConversionErrors(product);
    const displayedErrors = errors.slice(0, page * itemsPerPage);
    const hasMore = errors.length > displayedErrors.length;
    
    if (errors.length === 0) {
        return (
            <div className="text-center py-8">
                <p className="text-gray-500">No conversion issues found for this product.</p>
            </div>
        );
    }
    
    return (
        <div>
            <div className="overflow-x-auto rounded-lg shadow">
                <table className="min-w-full bg-white border border-gray-200">
                    <thead>
                        <tr className="bg-[#333651] text-left text-sm font-medium text-white uppercase tracking-wider">
                            <th className="px-4 py-3 border">Issue Type</th>
                            <th className="px-4 py-3 border">Description</th>
                            <th className="px-4 py-3 border">How to Solve</th>
                        </tr>
                    </thead>
                    <tbody>
                        {displayedErrors.map((error, idx) => (
                            <tr key={idx} className="border-t text-sm text-gray-700">
                                <td className="px-4 py-3 border">{error.issueHeading}</td>
                                <td className="px-4 py-3 border">{error.message}</td>
                                <td className="px-4 py-3 border">{error.solution}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {hasMore && (
                <div className="mt-4 text-center">
                    <button
                        className="bg-[#333651] text-white px-4 py-2 rounded hover:bg-[#2a2d47] transition"
                        onClick={() => setPage((prev) => prev + 1)}
                    >
                        View More
                    </button>
                </div>
            )}
        </div>
    );
};

// Table component for inventory issues
const InventoryIssuesTable = ({ product }) => {
    const [page, setPage] = useState(1);
    const itemsPerPage = 5;
    
    const extractInventoryErrors = (product) => {
        const inventoryErrors = product.inventoryErrors;
        if (!inventoryErrors) return [];
        
        const errorRows = [];
        
        // Inventory Planning Issues
        if (inventoryErrors.inventoryPlanningErrorData) {
            const planning = inventoryErrors.inventoryPlanningErrorData;
            if (planning.longTermStorageFees?.status === "Error") {
                errorRows.push({
                    issueHeading: 'Inventory Planning | Long-Term Storage Fees',
                    message: planning.longTermStorageFees.Message,
                    solution: planning.longTermStorageFees.HowToSolve
                });
            }
            if (planning.unfulfillable?.status === "Error") {
                errorRows.push({
                    issueHeading: 'Inventory Planning | Unfulfillable Inventory',
                    message: planning.unfulfillable.Message,
                    solution: planning.unfulfillable.HowToSolve
                });
            }
        }
        
        // Stranded Inventory
        if (inventoryErrors.strandedInventoryErrorData) {
            errorRows.push({
                issueHeading: 'Stranded Inventory | Product Not Listed',
                message: inventoryErrors.strandedInventoryErrorData.Message,
                solution: inventoryErrors.strandedInventoryErrorData.HowToSolve
            });
        }
        
        // Inbound Non-Compliance
        if (inventoryErrors.inboundNonComplianceErrorData) {
            errorRows.push({
                issueHeading: 'Inbound Non-Compliance | Shipment Issue',
                message: inventoryErrors.inboundNonComplianceErrorData.Message,
                solution: inventoryErrors.inboundNonComplianceErrorData.HowToSolve
            });
        }
        
        // Replenishment
        if (inventoryErrors.replenishmentErrorData) {
            errorRows.push({
                issueHeading: 'Replenishment | Low Inventory Risk',
                message: inventoryErrors.replenishmentErrorData.Message,
                solution: inventoryErrors.replenishmentErrorData.HowToSolve
            });
        }
        
        return errorRows;
    };
    
    const errors = extractInventoryErrors(product);
    const displayedErrors = errors.slice(0, page * itemsPerPage);
    const hasMore = errors.length > displayedErrors.length;
    
    if (errors.length === 0) {
        return (
            <div className="text-center py-8">
                <p className="text-gray-500">No inventory issues found for this product.</p>
            </div>
        );
    }
    
    return (
        <div>
            <div className="overflow-x-auto rounded-lg shadow">
                <table className="min-w-full bg-white border border-gray-200">
                    <thead>
                        <tr className="bg-[#333651] text-left text-sm font-medium text-white uppercase tracking-wider">
                            <th className="px-4 py-3 border">Issue Type</th>
                            <th className="px-4 py-3 border">Description</th>
                            <th className="px-4 py-3 border">How to Solve</th>
                        </tr>
                    </thead>
                    <tbody>
                        {displayedErrors.map((error, idx) => (
                            <tr key={idx} className="border-t text-sm text-gray-700">
                                <td className="px-4 py-3 border">{error.issueHeading}</td>
                                <td className="px-4 py-3 border">{error.message}</td>
                                <td className="px-4 py-3 border">{error.solution}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {hasMore && (
                <div className="mt-4 text-center">
                    <button
                        className="bg-[#333651] text-white px-4 py-2 rounded hover:bg-[#2a2d47] transition"
                        onClick={() => setPage((prev) => prev + 1)}
                    >
                        View More
                    </button>
                </div>
            )}
        </div>
    );
};

const IssuesByProduct = () => {
    const info = useSelector((state) => state.Dashboard.DashBoardInfo);
    const navigate = useNavigate();
    
    // Pagination state
    const [currentPage, setCurrentPage] = useState(0);
    
    // Active tabs for each product (productId -> activeTab)
    const [productTabs, setProductTabs] = useState({});
    
    // Previous tabs for animation direction (productId -> prevTab)
    const [prevProductTabs, setPrevProductTabs] = useState({});
    
    // Track if user has interacted with tabs for each product
    const [hasInteracted, setHasInteracted] = useState({});
    
    // Solution visibility states
    const [visibleSolutions, setVisibleSolutions] = useState({});
    
    const ITEMS_PER_PAGE = 5;
    
    // Get products that have any issues
    const getProductsWithIssues = () => {
        if (!info?.productWiseError) return [];
        return info.productWiseError.filter(product => {
            const hasRankingIssues = hasAnyRankingIssues(product);
            const hasConversionIssues = hasAnyConversionIssues(product);
            const hasInventoryIssues = hasAnyInventoryIssues(product);
            return hasRankingIssues || hasConversionIssues || hasInventoryIssues;
        });
    };
    
    // Check if product has any ranking issues
    const hasAnyRankingIssues = (product) => {
        const rankingErrors = product.rankingErrors?.data;
        if (!rankingErrors) return false;
        
        return (
            rankingErrors.TitleResult?.charLim?.status === "Error" ||
            rankingErrors.TitleResult?.RestictedWords?.status === "Error" ||
            rankingErrors.TitleResult?.checkSpecialCharacters?.status === "Error" ||
            rankingErrors.BulletPoints?.charLim?.status === "Error" ||
            rankingErrors.BulletPoints?.RestictedWords?.status === "Error" ||
            rankingErrors.BulletPoints?.checkSpecialCharacters?.status === "Error" ||
            rankingErrors.Description?.charLim?.status === "Error" ||
            rankingErrors.Description?.RestictedWords?.status === "Error" ||
            rankingErrors.Description?.checkSpecialCharacters?.status === "Error" ||
            rankingErrors.charLim?.status === "Error"
        );
    };
    
    // Check if product has any conversion issues
    const hasAnyConversionIssues = (product) => {
        const conversionErrors = product.conversionErrors;
        if (!conversionErrors) return false;
        
        return (
            conversionErrors.imageResultErrorData?.status === "Error" ||
            conversionErrors.videoResultErrorData?.status === "Error" ||
            conversionErrors.productReviewResultErrorData?.status === "Error" ||
            conversionErrors.productStarRatingResultErrorData?.status === "Error" ||
            conversionErrors.productsWithOutBuyboxErrorData?.status === "Error" ||
            conversionErrors.aplusErrorData?.status === "Error"
        );
    };
    
    // Check if product has any inventory issues
    const hasAnyInventoryIssues = (product) => {
        const inventoryErrors = product.inventoryErrors;
        if (!inventoryErrors) return false;
        
        return (
            inventoryErrors.inventoryPlanningErrorData ||
            inventoryErrors.strandedInventoryErrorData ||
            inventoryErrors.inboundNonComplianceErrorData ||
            inventoryErrors.replenishmentErrorData
        );
    };
    
    // Get paginated products
    const getPaginatedProducts = () => {
        const products = getProductsWithIssues();
        const endIndex = (currentPage + 1) * ITEMS_PER_PAGE;
        const paginatedProducts = products.slice(0, endIndex);
        const hasMore = endIndex < products.length;
        
        return { products: paginatedProducts, hasMore, total: products.length };
    };
    
    // Handle view more
    const handleViewMore = () => {
        setCurrentPage(prev => prev + 1);
    };
    
    // Get active tab for a product
    const getActiveTab = (productId) => {
        return productTabs[productId] || 'ranking';
    };
    
    // Set active tab for a product
    const setActiveTab = (productId, tab) => {
        const currentTab = getActiveTab(productId);
        if (tab === currentTab) return;
        
        setPrevProductTabs(prev => ({
            ...prev,
            [productId]: currentTab
        }));
        
        setProductTabs(prev => ({
            ...prev,
            [productId]: tab
        }));
        
        setHasInteracted(prev => ({
            ...prev,
            [productId]: true
        }));
    };
    
    // Get animation direction for a product
    const getDirection = (productId) => {
        const tabs = ['ranking', 'conversion', 'inventory'];
        const currentIndex = tabs.indexOf(getActiveTab(productId));
        const prevIndex = tabs.indexOf(prevProductTabs[productId] || 'ranking');
        return currentIndex > prevIndex ? 1 : -1;
    };
    
    // Animation variants for page transitions
    const pageVariants = {
        enter: (direction) => ({
            x: direction > 0 ? "100%" : "-100%",
            opacity: 0,
            position: "absolute",
            width: "100%",
        }),
        center: {
            x: 0,
            opacity: 1,
            position: "relative",
            width: "100%",
            transition: { duration: 0.4, ease: "easeInOut" },
        },
        exit: (direction) => ({
            x: direction > 0 ? "-100%" : "100%",
            opacity: 0,
            position: "absolute",
            width: "100%",
            transition: { duration: 0.4, ease: "easeInOut" },
        }),
    };
    
    // Toggle solution visibility
    const toggleSolution = (productId, issueKey) => {
        const key = `${productId}-${issueKey}`;
        setVisibleSolutions(prev => ({
            ...prev,
            [key]: !prev[key]
        }));
    };
    
    // Navigate to detailed product issues page
    const viewProductDetails = (asin) => {
        navigate(`/seller-central-checker/issues/${asin}`);
    };
    
    // Count issues for each category
    const countRankingIssues = (product) => {
        const rankingErrors = product.rankingErrors?.data;
        if (!rankingErrors) return 0;
        
        let count = 0;
        const sections = ['TitleResult', 'BulletPoints', 'Description'];
        const checks = ['RestictedWords', 'checkSpecialCharacters', 'charLim'];
        
        sections.forEach(section => {
            if (rankingErrors[section]) {
                checks.forEach(check => {
                    if (rankingErrors[section][check]?.status === 'Error') count++;
                });
            }
        });
        
        if (rankingErrors.charLim?.status === "Error") count++;
        return count;
    };
    
    const countConversionIssues = (product) => {
        const conversionErrors = product.conversionErrors;
        if (!conversionErrors) return 0;
        
        let count = 0;
        const checks = [
            conversionErrors.imageResultErrorData,
            conversionErrors.videoResultErrorData,
            conversionErrors.productReviewResultErrorData,
            conversionErrors.productStarRatingResultErrorData,
            conversionErrors.productsWithOutBuyboxErrorData,
            conversionErrors.aplusErrorData
        ];
        
        checks.forEach(check => {
            if (check?.status === 'Error') count++;
        });
        
        return count;
    };
    
    const countInventoryIssues = (product) => {
        const inventoryErrors = product.inventoryErrors;
        if (!inventoryErrors) return 0;
        
        let count = 0;
        
        if (inventoryErrors.inventoryPlanningErrorData) {
            const planning = inventoryErrors.inventoryPlanningErrorData;
            if (planning.longTermStorageFees?.status === "Error") count++;
            if (planning.unfulfillable?.status === "Error") count++;
        }
        
        if (inventoryErrors.strandedInventoryErrorData) count++;
        if (inventoryErrors.inboundNonComplianceErrorData) count++;
        if (inventoryErrors.replenishmentErrorData) count++;
        
        return count;
    };
    
    const { products, hasMore, total } = getPaginatedProducts();
    
    if (!info?.productWiseError || info.productWiseError.length === 0) {
        return (
            <div className="p-6 bg-gray-100 text-gray-800 lg:mt-0 mt-[10vh] min-h-screen overflow-y-auto">
                <motion.div 
                    className="bg-white p-6 rounded-xl shadow"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                        duration: 0.5,
                        ease: "easeOut"
                    }}
                >
                    <h1 className="text-2xl font-bold mb-4">Issues by Product</h1>
                    <p className="text-gray-600">No product data available.</p>
                </motion.div>
            </div>
        );
    }
    
    return (
        <div className="p-6 bg-gray-100 text-gray-800 lg:mt-0 mt-[10vh] h-[90vh] overflow-y-auto">
            {/* Header */}
            <motion.div 
                className="bg-white p-6 rounded-xl shadow mb-6"
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                    duration: 0.5,
                    ease: "easeOut"
                }}
            >
                <h1 className="text-2xl font-bold mb-4">Issues by Product</h1>
                <p className="text-gray-600">Review and manage issues for each product individually</p>
            </motion.div>
            
            {/* Products List */}
            <div className="space-y-6">
                {products.length === 0 ? (
                    <motion.div 
                        className="bg-white rounded-xl shadow p-6 text-center"
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{
                            duration: 0.4,
                            ease: "easeOut"
                        }}
                    >
                        <p className="text-gray-500">No products found with issues.</p>
                    </motion.div>
                ) : (
                    <>
                        {products.map((product, index) => {
                            const activeTab = getActiveTab(product.asin);
                            const rankingCount = countRankingIssues(product);
                            const conversionCount = countConversionIssues(product);
                            const inventoryCount = countInventoryIssues(product);

    return (
                                <motion.div 
                                    key={product.asin} 
                                    className="bg-white rounded-xl shadow"
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{
                                        duration: 0.4,
                                        delay: index * 0.1,
                                        ease: "easeOut"
                                    }}
                                >
                                    {/* Product Header */}
                                    <div className="p-6 border-b border-gray-200">
                                        <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                        <LazyLoadImage
                            src={product.MainImage || noImage}
                            alt="Product"
                            className="w-20 h-20 rounded-md object-cover"
                            effect="blur"
                            placeholderSrc={noImage}
                        />
                        <div>
                                                    <h3 className="font-semibold text-xl mb-2 truncate max-w-md">
                                                        {product.name}
                                                    </h3>
                                                    <div className="flex gap-4 text-sm text-gray-600">
                                                        <span>ASIN: {product.asin}</span>
                                                        <span>SKU: {product.sku}</span>
                                                        <span>Price: ${product.price}</span>
                        </div>
                    </div>
                                            </div>
                            <button 
                                                className="px-4 py-2 bg-[#333651] text-white rounded-md hover:bg-[#2a2d47] transition-colors"
                                                onClick={() => viewProductDetails(product.asin)}
                            >
                                                View Full Details
                            </button>
                                        </div>
                                    </div>
                                    
                                    {/* Product Tabs */}
                                    <div className="flex border-b border-gray-200">
                                        <button
                                            className={`px-6 py-4 font-medium ${
                                                activeTab === 'ranking'
                                                    ? 'border-b-2 border-[#333651] text-[#333651] bg-gray-50'
                                                    : 'text-gray-500 hover:text-gray-700'
                                            }`}
                                            onClick={() => setActiveTab(product.asin, 'ranking')}
                                        >
                                            Ranking Issues ({rankingCount})
                                        </button>
                                        <button
                                            className={`px-6 py-4 font-medium ${
                                                activeTab === 'conversion'
                                                    ? 'border-b-2 border-[#333651] text-[#333651] bg-gray-50'
                                                    : 'text-gray-500 hover:text-gray-700'
                                            }`}
                                            onClick={() => setActiveTab(product.asin, 'conversion')}
                                        >
                                            Conversion Issues ({conversionCount})
                                        </button>
                                        <button
                                            className={`px-6 py-4 font-medium ${
                                                activeTab === 'inventory'
                                                    ? 'border-b-2 border-[#333651] text-[#333651] bg-gray-50'
                                                    : 'text-gray-500 hover:text-gray-700'
                                            }`}
                                            onClick={() => setActiveTab(product.asin, 'inventory')}
                                        >
                                            Inventory Issues ({inventoryCount})
                                        </button>
                        </div>
                                    
                                    {/* Tab Content */}
                                    <div className="p-6 relative overflow-hidden" style={{ minHeight: '400px' }}>
                                        <AnimatePresence custom={getDirection(product.asin)} mode="sync">
                                            <motion.div
                                                key={activeTab}
                                                custom={getDirection(product.asin)}
                                                variants={pageVariants}
                                                initial={hasInteracted[product.asin] ? "enter" : false}
                                                animate="center"
                                                exit="exit"
                                                className="w-full"
                                            >
                                                {activeTab === 'ranking' && (
                                                    <RankingIssuesTable product={product} />
                                                )}
                                                {activeTab === 'conversion' && (
                                                    <ConversionIssuesTable product={product} />
                                                )}
                                                {activeTab === 'inventory' && (
                                                    <InventoryIssuesTable product={product} />
                                                )}
                                            </motion.div>
                        </AnimatePresence>
                    </div>
                                </motion.div>
                            );
                        })}
                        
                        {/* View More Button */}
                        {hasMore && (
                            <motion.div 
                                className="text-center pt-6"
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{
                                    duration: 0.3,
                                    delay: 0.2,
                                    ease: "easeOut"
                                }}
                            >
                                <button
                                    className="px-8 py-3 bg-[#333651] text-white rounded-md hover:bg-[#2a2d47] transition-colors text-lg"
                                    onClick={handleViewMore}
                                >
                                    View More Products
                                                </button>
                            </motion.div>
                        )}
                        
                        {/* Pagination Info */}
                        <motion.div 
                            className="text-center text-sm text-gray-500 pb-6"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{
                                duration: 0.3,
                                delay: 0.4,
                                ease: "easeOut"
                            }}
                        >
                            Showing {products.length} of {total} products with issues
                        </motion.div>
                                    </>
                                )}
                        </div>
                    </div>
    );
};

export default IssuesByProduct;
