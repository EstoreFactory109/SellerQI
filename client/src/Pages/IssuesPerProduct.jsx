import React, { useState, useEffect, useRef } from 'react';
import { useSelector } from "react-redux";
import { useParams } from 'react-router-dom';
import noImage from '../assets/Icons/no-image.png';
import DropDown from '../assets/Icons/drop-down.png';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from "framer-motion";
import * as ExcelJS from 'exceljs';
import Papa from 'papaparse';
import { saveAs } from 'file-saver';
import { LazyLoadImage } from 'react-lazy-load-image-component';
import 'react-lazy-load-image-component/src/effects/blur.css';
import { Box, AlertTriangle, TrendingUp, LineChart, Calendar, Download, ChevronDown, Search, Filter, HelpCircle, FileText, FileSpreadsheet, ImageOff } from 'lucide-react';
import './IssuesPerProduct.css';

// Helper function to format messages with important details highlighted on separate line
const formatMessageWithHighlight = (message) => {
    if (!message) return { mainText: '', highlightedText: '' };
    
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
    ];
    
    for (const pattern of patterns) {
        const match = message.match(pattern);
        if (match && match[2]) {
            return {
                mainText: match[1].trim(),
                highlightedText: match[2].trim()
            };
        }
    }
    
    return { mainText: message, highlightedText: '' };
};

// Component to render message with highlighted part
const FormattedMessageComponent = ({ message }) => {
    const { mainText, highlightedText } = formatMessageWithHighlight(message);
    
    return (
        <>
            {mainText && <span>{mainText}</span>}
            {highlightedText && (
                <>
                    <br />
                    <strong className="text-gray-100 mt-1 block">{highlightedText}</strong>
                </>
            )}
        </>
    );
};

// Reusable component for conversion issues
const IssueItem = ({ label, message, solutionKey, solutionContent, stateValue, toggleFunc, recommendedQty }) => (
    <li className="mb-4">
        <div className="flex justify-between items-center">
            <p className="w-[40vw]">
                <b>{label}: </b>
                <FormattedMessageComponent message={message} />
                {recommendedQty !== null && recommendedQty !== undefined && recommendedQty > 0 && (
                    <>
                        <br />
                        <strong className="text-gray-100 mt-1 block">Recommended Restock Quantity: {recommendedQty} units</strong>
                    </>
                )}
            </p>
            <button
                className="px-2 py-1 bg-[#21262d] border border-[#30363d] rounded text-xs flex items-center justify-center gap-1 text-gray-300 hover:bg-[#161b22] transition-all"
                onClick={() => toggleFunc(solutionKey)}
            >
                How to solve
                <ChevronDown className="w-[7px] h-[7px] text-gray-400" />
            </button>
        </div>
        <div
            className="bg-[#21262d] border border-[#30363d] mt-2 flex justify-center items-center transition-all duration-700 ease-in-out"
            style={
                stateValue === solutionKey
                    ? { opacity: 1, maxHeight: "200px", minHeight: "80px", display: "flex",padding:"2rem" }
                    : { opacity: 0, maxHeight: "0px", minHeight: "0px", overflow: "hidden", display: "flex" }
            }
        >
            <p className="w-[80%]">{solutionContent}</p>
        </div>
    </li>
);

const Dashboard = () => {
    const info = useSelector((state) => state.Dashboard.DashBoardInfo);
    console.log("info: ",info)
    const dropdownRef = useRef(null);
    useEffect(() => {
        function handleClickOutside(e) {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
                setOpenSelector(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        }
    }, [])

    const { asin } = useParams();
    
    // Find product from rankingProductWiseErrors array (same as Category.jsx)
    const rankingProduct = info?.rankingProductWiseErrors?.find(item => item.asin === asin);
    
    // Get product from productWiseError for error data
    const product = info?.productWiseError?.find(item => item.asin === asin);
    
    // Get profitability data (same source as profitability dashboard) for accurate sales/quantity
    // This uses EconomicsMetrics as primary source, which is more accurate
    const profitabilityProduct = info?.profitibilityData?.find(item => item.asin === asin);
    
    // Use sales and quantity from profitibilityData (same as profitability dashboard)
    // Falls back to productWiseError if profitibilityData not available
    const sales = profitabilityProduct?.sales ?? product?.sales ?? 0;
    const quantity = profitabilityProduct?.quantity ?? product?.quantity ?? 0;
    
    // Update product with ranking data and accurate sales/quantity from profitibilityData
    const updatedProduct = product ? {
        ...product,
        // Use sales and quantity from profitibilityData (same source as profitability dashboard)
        quantity: quantity,
        sales: sales,
        // Add ranking data from rankingProductWiseErrors array
        rankingErrors: rankingProduct || undefined
    } : null;

    // All state and refs (must be declared before useEffects and early returns)
    const [TitleSolution, setTitleSolution] = useState("");
    const [BulletSoltion, setBulletSolution] = useState("");
    const [DescriptionSolution, setDescriptionSolution] = useState("");
    const [BackendKeyWords, setBackendKeyWords] = useState("");
    const [imageSolution, setImageSolution] = useState("");
    const [videoSolution, setVideoSolution] = useState("");
    const [productReviewSolution, setProductReviewSolution] = useState("");
    const [productStarRatingSolution, setProductStarRatingSolution] = useState("");
    const [productsWithOutBuyboxSolution, setProductsWithOutBuyboxSolution] = useState("");
    const [aplusSolution, setAplusSolution] = useState("");
    const [brandStorySolution, setBrandStorySolution] = useState("");
    const [inventoryPlanningSolution, setInventoryPlanningSolution] = useState("");
    const [strandedInventorySolution, setStrandedInventorySolution] = useState("");
    const [inboundNonComplianceSolution, setInboundNonComplianceSolution] = useState("");
    const [replenishmentSolution, setReplenishmentSolution] = useState("");
    const [openSelector, setOpenSelector] = useState(false);
    const [showDownloadOptions, setShowDownloadOptions] = useState(false);
    const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
    const contentRef = useRef(null);
    const downloadRef = useRef(null);
    const navigate = useNavigate();
    
    // Debug: Log product data
    console.log('IssuesPerProduct - Product found:', !!product);
    console.log('IssuesPerProduct - Profitability product found:', !!profitabilityProduct);
    console.log('IssuesPerProduct - Quantity from profitibilityData:', profitabilityProduct?.quantity);
    console.log('IssuesPerProduct - Sales from profitibilityData:', profitabilityProduct?.sales);
    console.log('IssuesPerProduct - Final quantity used:', quantity);
    console.log('IssuesPerProduct - Final sales used:', sales);
    
    // Debug: Log when component renders with new ASIN
    useEffect(() => {
        console.log('Component rendered with ASIN:', asin);
        console.log('Product found:', !!product);
        console.log('Product quantity from backend:', product?.quantity);
        console.log('Product sales from backend:', product?.sales);
        console.log('Ranking product found:', !!rankingProduct);
    }, [asin, product, rankingProduct]);

    // Reset states when ASIN changes
    useEffect(() => {
        console.log('ASIN changed to:', asin);
        // Reset all solution states when navigating to a different product
        setTitleSolution("");
        setBulletSolution("");
        setDescriptionSolution("");
        setBackendKeyWords("");
        setImageSolution("");
        setVideoSolution("");
        setProductReviewSolution("");
        setProductStarRatingSolution("");
        setProductsWithOutBuyboxSolution("");
        setAplusSolution("");
        setInventoryPlanningSolution("");
        setStrandedInventorySolution("");
        setInboundNonComplianceSolution("");
        setReplenishmentSolution("");
        setOpenSelector(false);
        setShowDownloadOptions(false);
        
        // Scroll to top when product changes
        if (contentRef.current) {
            contentRef.current.scrollTop = 0;
        }
        window.scrollTo(0, 0);
    }, [asin]);

    // Early return for loading or missing data
    if (!info) {
        return (
            <div className="flex items-center justify-center h-screen">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                    <p className="text-gray-300">Loading product data...</p>
                </div>
            </div>
        );
    }

    if (!info.productWiseError || info.productWiseError.length === 0) {
        return (
            <div className="flex items-center justify-center h-screen">
                <div className="text-center p-6">
                    <h2 className="text-lg font-semibold text-gray-100 mb-1">No Product Data Available</h2>
                    <p className="text-xs text-gray-400">No product analysis data has been loaded yet.</p>
                </div>
            </div>
        );
    }

    if (!updatedProduct) {
        return (
            <div className="flex items-center justify-center h-screen">
                <div className="text-center p-6">
                    <h2 className="text-lg font-semibold text-gray-100 mb-1">Product Not Found</h2>
                    <p className="text-xs text-gray-400">No product data found for ASIN: {asin}</p>
                    <p className="text-xs text-gray-500 mt-1">Please check the ASIN and try again.</p>
                </div>
            </div>
        );
    }

    const hasAnyConversionError = [
        updatedProduct.conversionErrors?.imageResultErrorData?.status,
        updatedProduct.conversionErrors?.videoResultErrorData?.status,
        updatedProduct.conversionErrors?.productStarRatingResultErrorData?.status,
        updatedProduct.conversionErrors?.productsWithOutBuyboxErrorData?.status,
        updatedProduct.conversionErrors?.aplusErrorData?.status
    ].includes("Error");

    const hasAnyInventoryError = updatedProduct.inventoryErrors && (
        updatedProduct.inventoryErrors.inventoryPlanningErrorData ||
        updatedProduct.inventoryErrors.strandedInventoryErrorData ||
        updatedProduct.inventoryErrors.inboundNonComplianceErrorData ||
        updatedProduct.inventoryErrors.replenishmentErrorData
    );

    const openCloseSol = (val, component) => {
        if (component === "Title") {
            setTitleSolution(prev => prev === val ? "" : val);
        }
        if (component === "BulletPoints") {
            setBulletSolution(prev => prev === val ? "" : val);
        }
        if (component === "Description") {
            setDescriptionSolution(prev => prev === val ? "" : val);
        }
        if (component === "BackendKeyWords") {
            setBackendKeyWords(prev => prev === val ? "" : val);
        }
    };

    const openCloseSolutionConversion = (val, component) => {
        if (component === "Image") {
            setImageSolution(prev => prev === val ? "" : val);
        }
        if (component === "Video") {
            setVideoSolution(prev => prev === val ? "" : val);
        }
        if (component === "ProductReview") {
            setProductReviewSolution(prev => prev === val ? "" : val);
        }
        if (component === "ProductStarRating") {
            setProductStarRatingSolution(prev => prev === val ? "" : val);
        }
        if (component === "ProductsWithOutBuybox") {
            setProductsWithOutBuyboxSolution(prev => prev === val ? "" : val);
        }
        if (component === "Aplus") {
            setAplusSolution(prev => prev === val ? "" : val);
        }
        if (component === "BrandStory") {
            setBrandStorySolution(prev => prev === val ? "" : val);
        }
    };

    const openCloseSolutionInventory = (val, component) => {
        if (component === "InventoryPlanning") {
            setInventoryPlanningSolution(prev => prev === val ? "" : val);
        }
        if (component === "StrandedInventory") {
            setStrandedInventorySolution(prev => prev === val ? "" : val);
        }
        if (component === "InboundNonCompliance") {
            setInboundNonComplianceSolution(prev => prev === val ? "" : val);
        }
        if (component === "Replenishment") {
            setReplenishmentSolution(prev => prev === val ? "" : val);
        }
    };

    // Prepare data for export
    const prepareExportData = () => {
        const exportData = [];
        
        // Basic Product Information
        exportData.push({
            Category: 'Product Information',
            Type: 'ASIN',
            Issue: '',
            Message: updatedProduct.asin,
            Solution: ''
        });
        exportData.push({
            Category: 'Product Information',
            Type: 'SKU',
            Issue: '',
            Message: updatedProduct.sku,
            Solution: ''
        });
        exportData.push({
            Category: 'Product Information',
            Type: 'Product Name',
            Issue: '',
            Message: updatedProduct.name,
            Solution: ''
        });
        exportData.push({
            Category: 'Product Information',
            Type: 'List Price',
            Issue: '',
            Message: `$${updatedProduct.price || 0}`,
            Solution: ''
        });
        exportData.push({
            Category: 'Product Information',
            Type: 'Units Sold',
            Issue: '',
            Message: String(updatedProduct.quantity || 0),
            Solution: ''
        });
        exportData.push({
            Category: 'Product Information',
            Type: 'Sales',
            Issue: '',
            Message: `$${(updatedProduct.sales || 0).toFixed(2)}`,
            Solution: ''
        });
        exportData.push({
            Category: 'Product Information',
            Type: 'Duration',
            Issue: '',
            Message: `${info?.startDate} - ${info?.endDate}`,
            Solution: ''
        });

        // Ranking Issues - Title
        if (updatedProduct.rankingErrors?.data?.TitleResult?.charLim?.status === "Error") {
            exportData.push({
                Category: 'Ranking Issues',
                Type: 'Title',
                Issue: 'Character Limit',
                Message: updatedProduct.rankingErrors?.data?.TitleResult?.charLim?.Message,
                Solution: updatedProduct.rankingErrors?.data?.TitleResult?.charLim?.HowTOSolve
            });
        }
        if (updatedProduct.rankingErrors?.data?.TitleResult?.RestictedWords?.status === "Error") {
            exportData.push({
                Category: 'Ranking Issues',
                Type: 'Title',
                Issue: 'Restricted Words',
                Message: updatedProduct.rankingErrors?.data?.TitleResult?.RestictedWords?.Message,
                Solution: updatedProduct.rankingErrors?.data?.TitleResult?.RestictedWords?.HowTOSolve
            });
        }
        if (updatedProduct.rankingErrors?.data?.TitleResult?.checkSpecialCharacters?.status === "Error") {
            exportData.push({
                Category: 'Ranking Issues',
                Type: 'Title',
                Issue: 'Special Characters',
                Message: updatedProduct.rankingErrors?.data?.TitleResult?.checkSpecialCharacters?.Message,
                Solution: updatedProduct.rankingErrors?.data?.TitleResult?.checkSpecialCharacters?.HowTOSolve
            });
        }

        // Ranking Issues - Bullet Points
        if (updatedProduct.rankingErrors?.data?.BulletPoints?.charLim?.status === "Error") {
            exportData.push({
                Category: 'Ranking Issues',
                Type: 'Bullet Points',
                Issue: 'Character Limit',
                Message: updatedProduct.rankingErrors?.data?.BulletPoints?.charLim?.Message,
                Solution: updatedProduct.rankingErrors?.data?.BulletPoints?.charLim?.HowTOSolve
            });
        }
        if (updatedProduct.rankingErrors?.data?.BulletPoints?.RestictedWords?.status === "Error") {
            exportData.push({
                Category: 'Ranking Issues',
                Type: 'Bullet Points',
                Issue: 'Restricted Words',
                Message: updatedProduct.rankingErrors?.data?.BulletPoints?.RestictedWords?.Message,
                Solution: updatedProduct.rankingErrors?.data?.BulletPoints?.RestictedWords?.HowTOSolve
            });
        }
        if (updatedProduct.rankingErrors?.data?.BulletPoints?.checkSpecialCharacters?.status === "Error") {
            exportData.push({
                Category: 'Ranking Issues',
                Type: 'Bullet Points',
                Issue: 'Special Characters',
                Message: updatedProduct.rankingErrors?.data?.BulletPoints?.checkSpecialCharacters?.Message,
                Solution: updatedProduct.rankingErrors?.data?.BulletPoints?.checkSpecialCharacters?.HowTOSolve
            });
        }

        // Ranking Issues - Description
        if (updatedProduct.rankingErrors?.data?.Description?.charLim?.status === "Error") {
            exportData.push({
                Category: 'Ranking Issues',
                Type: 'Description',
                Issue: 'Character Limit',
                Message: updatedProduct.rankingErrors?.data?.Description?.charLim?.Message,
                Solution: updatedProduct.rankingErrors?.data?.Description?.charLim?.HowTOSolve
            });
        }
        if (updatedProduct.rankingErrors?.data?.Description?.RestictedWords?.status === "Error") {
            exportData.push({
                Category: 'Ranking Issues',
                Type: 'Description',
                Issue: 'Restricted Words',
                Message: updatedProduct.rankingErrors?.data?.Description?.RestictedWords?.Message,
                Solution: updatedProduct.rankingErrors?.data?.Description?.RestictedWords?.HowTOSolve
            });
        }
        if (updatedProduct.rankingErrors?.data?.Description?.checkSpecialCharacters?.status === "Error") {
            exportData.push({
                Category: 'Ranking Issues',
                Type: 'Description',
                Issue: 'Special Characters',
                Message: updatedProduct.rankingErrors?.data?.Description?.checkSpecialCharacters?.Message,
                Solution: updatedProduct.rankingErrors?.data?.Description?.checkSpecialCharacters?.HowTOSolve
            });
        }
        
        // Ranking Issues - Backend Keywords
        if (updatedProduct.rankingErrors?.data?.charLim?.status === "Error") {
            exportData.push({
                Category: 'Ranking Issues',
                Type: 'Backend Keywords',
                Issue: 'Character Limit',
                Message: updatedProduct.rankingErrors?.data?.charLim?.Message,
                Solution: updatedProduct.rankingErrors?.data?.charLim?.HowTOSolve
            });
        }

        // Conversion Issues
        if (product.conversionErrors?.imageResultErrorData?.status === "Error") {
            exportData.push({
                Category: 'Conversion Issues',
                Type: 'Images',
                Issue: 'Images Issue',
                Message: product.conversionErrors?.imageResultErrorData.Message,
                Solution: product.conversionErrors?.imageResultErrorData.HowToSolve
            });
        }
        if (product.conversionErrors?.videoResultErrorData?.status === "Error") {
            exportData.push({
                Category: 'Conversion Issues',
                Type: 'Video',
                Issue: 'Video Issue',
                Message: product.conversionErrors?.videoResultErrorData.Message,
                Solution: product.conversionErrors?.videoResultErrorData.HowToSolve
            });
        }
        if (product.conversionErrors?.productStarRatingResultErrorData?.status === "Error") {
            exportData.push({
                Category: 'Conversion Issues',
                Type: 'Star Rating',
                Issue: 'Star Rating Issue',
                Message: product.conversionErrors?.productStarRatingResultErrorData.Message,
                Solution: product.conversionErrors?.productStarRatingResultErrorData.HowToSolve
            });
        }
        if (product.conversionErrors?.productsWithOutBuyboxErrorData?.status === "Error") {
            exportData.push({
                Category: 'Conversion Issues',
                Type: 'Buy Box',
                Issue: 'Product without Buy Box',
                Message: product.conversionErrors?.productsWithOutBuyboxErrorData.Message,
                Solution: product.conversionErrors?.productsWithOutBuyboxErrorData.HowToSolve
            });
        }
        if (product.conversionErrors?.aplusErrorData?.status === "Error") {
            exportData.push({
                Category: 'Conversion Issues',
                Type: 'A+ Content',
                Issue: 'Aplus Issue',
                Message: product.conversionErrors?.aplusErrorData.Message,
                Solution: product.conversionErrors?.aplusErrorData.HowToSolve
            });
        }

        // Inventory Issues
        if (product.inventoryErrors?.inventoryPlanningErrorData) {
            const planning = product.inventoryErrors?.inventoryPlanningErrorData;
            if (planning.longTermStorageFees?.status === "Error") {
                exportData.push({
                    Category: 'Inventory Issues',
                    Type: 'Inventory Planning',
                    Issue: 'Long-Term Storage Fees',
                    Message: planning.longTermStorageFees.Message,
                    Solution: planning.longTermStorageFees.HowToSolve
                });
            }
            if (planning.unfulfillable?.status === "Error") {
                exportData.push({
                    Category: 'Inventory Issues',
                    Type: 'Inventory Planning',
                    Issue: 'Unfulfillable Inventory',
                    Message: planning.unfulfillable.Message,
                    Solution: planning.unfulfillable.HowToSolve
                });
            }
        }
        if (product.inventoryErrors?.strandedInventoryErrorData) {
            exportData.push({
                Category: 'Inventory Issues',
                Type: 'Stranded Inventory',
                Issue: 'Product Not Listed',
                Message: product.inventoryErrors?.strandedInventoryErrorData.Message,
                Solution: product.inventoryErrors?.strandedInventoryErrorData.HowToSolve
            });
        }
        if (product.inventoryErrors?.inboundNonComplianceErrorData) {
            exportData.push({
                Category: 'Inventory Issues',
                Type: 'Inbound Non-Compliance',
                Issue: 'Shipment Issue',
                Message: product.inventoryErrors?.inboundNonComplianceErrorData.Message,
                Solution: product.inventoryErrors?.inboundNonComplianceErrorData.HowToSolve
            });
        }
        if (product.inventoryErrors?.replenishmentErrorData) {
            if (Array.isArray(product.inventoryErrors.replenishmentErrorData)) {
                product.inventoryErrors.replenishmentErrorData.forEach(error => {
                    exportData.push({
                        Category: 'Inventory Issues',
                        Type: 'Replenishment',
                        Issue: `Low Inventory Risk ${error.sku ? `(SKU: ${error.sku})` : ''}`,
                        Message: error.Message,
                        Solution: error.HowToSolve
                    });
                });
            } else {
                exportData.push({
                    Category: 'Inventory Issues',
                    Type: 'Replenishment',
                    Issue: `Low Inventory Risk ${product.inventoryErrors.replenishmentErrorData.sku ? `(SKU: ${product.inventoryErrors.replenishmentErrorData.sku})` : ''}`,
                    Message: product.inventoryErrors?.replenishmentErrorData.Message,
                    Solution: product.inventoryErrors?.replenishmentErrorData.HowToSolve
                });
            }
        }

        return exportData;
    };

    // Download as Excel
    const downloadExcel = async () => {
        const data = prepareExportData();
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Product Issues');
        
        // Add header row
        if (data.length > 0) {
            const headers = Object.keys(data[0]);
            worksheet.addRow(headers);
            
            // Add data rows
            data.forEach(row => {
                worksheet.addRow(Object.values(row));
            });
            
            // Auto-size columns
            worksheet.columns = [
                { width: 20 }, // Category
                { width: 20 }, // Type
                { width: 20 }, // Issue
                { width: 50 }, // Message
                { width: 50 }  // Solution
            ];
            
            // Style header row
            worksheet.getRow(1).font = { bold: true };
            worksheet.getRow(1).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFE0E0E0' }
            };
        }
        
        // Generate filename with ASIN and date
        const fileName = `Product_Issues_${updatedProduct.asin}_${new Date().toISOString().split('T')[0]}.xlsx`;
        
        // Write and download file
        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        saveAs(blob, fileName);
    };

    // Download as CSV
    const downloadCSV = () => {
        const data = prepareExportData();
        const csv = Papa.unparse(data);
        
        // Generate filename with ASIN and date
        const fileName = `Product_Issues_${updatedProduct.asin}_${new Date().toISOString().split('T')[0]}.csv`;
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        saveAs(blob, fileName);
    };

    // Download handler - showDownloadOptions, isGeneratingPDF, downloadRef, contentRef declared at top

    useEffect(() => {
        function handleClickOutsideDownload(e) {
            if (downloadRef.current && !downloadRef.current.contains(e.target)) {
                setShowDownloadOptions(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutsideDownload);
        return () => {
            document.removeEventListener("mousedown", handleClickOutsideDownload);
        }
    }, []);



    return (
        <div className="bg-[#1a1a1a] lg:mt-0 mt-[10vh] h-screen overflow-y-auto">
            <div className="p-2">
                {/* Header Section */}
                <div className="bg-[#161b22] border border-[#30363d] rounded mb-2">
                    <div className="px-2 py-2">
                        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2">
                            <div className="text-gray-100">
                                <div className="flex items-center gap-2 mb-1">
                                    <Box className="w-4 h-4 text-blue-400" />
                                    <div className="flex items-center gap-2">
                                        <h1 className="text-lg font-bold text-gray-100">
                                            Product Issues
                                        </h1>
                                        <HelpCircle className='w-3 h-3 text-gray-400 hover:text-gray-300 cursor-pointer transition-colors' />
                                    </div>
                                </div>
                                <p className="text-xs text-gray-400 mb-2">Detailed analysis of product optimization opportunities</p>
                                <div className="flex items-center gap-3">
                                    <div className="flex items-center gap-1 text-xs text-gray-400">
                                        <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse"></div>
                                        <span>Live analysis active</span>
                                    </div>
                                    <div className="flex items-center gap-1 text-xs text-orange-400">
                                        <AlertTriangle className="w-3 h-3" />
                                        <span>Issues detected</span>
                                    </div>
                                </div>
                            </div>
                            
                            <div className="flex items-center gap-3 text-gray-100">
                                <div className="text-right">
                                    <div className="text-xl font-bold text-orange-400 mb-0.5">
                                        {updatedProduct.asin}
                                    </div>
                                    <div className="text-xs text-gray-400 font-medium uppercase">Product ASIN</div>
                                    <div className="text-xs text-orange-400 mt-0.5">Requires optimization</div>
                                </div>
                                <div className="w-10 h-10 bg-blue-500/20 rounded flex items-center justify-center border border-blue-500/30">
                                    <Box className="w-5 h-5 text-blue-400" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="space-y-2 pb-1" ref={contentRef}>
                {/* Product Information Card */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                    className="bg-[#161b22] border border-[#30363d] rounded p-2 mb-2 transition-all duration-300"
                >
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                        <div className="flex items-center space-x-2">
                                                    <div className="w-12 h-12 bg-[#21262d] border border-[#30363d] rounded overflow-hidden">
                            <LazyLoadImage
                                src={updatedProduct.MainImage || noImage}
                                alt="Product"
                                className="w-full h-full object-cover"
                                effect="blur"
                                placeholderSrc={noImage}
                                threshold={100}
                                wrapperClassName="w-full h-full"
                            />
                        </div>
                        <div className="space-y-1">
                            <h2 className="text-sm font-bold text-gray-100 leading-tight">{updatedProduct.name}</h2>
                            <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
                                <div className="flex items-center gap-1">
                                    <span className="text-gray-400 font-medium">ASIN:</span>
                                    <span className="font-mono bg-[#21262d] border border-[#30363d] px-1 py-0.5 rounded text-xs text-gray-300">{updatedProduct.asin}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <span className="text-gray-400 font-medium">SKU:</span>
                                    <span className="font-mono bg-[#21262d] border border-[#30363d] px-1 py-0.5 rounded text-xs text-gray-300">{updatedProduct.sku}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <span className="text-gray-400 font-medium">Price:</span>
                                    <span className="font-semibold text-green-400">${updatedProduct.price}</span>
                                </div>
                            </div>
                        </div>
                        </div>

                        <div className='flex items-center gap-2 relative'>
                            {/* Download Report Button */}
                            <div className="relative" ref={downloadRef}>
                                <button 
                                    className="flex items-center gap-1 px-2 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded text-xs transition-all font-medium"
                                    onClick={() => setShowDownloadOptions(!showDownloadOptions)}
                                >
                                    <Download className="w-3 h-3" />
                                    Export
                                    <ChevronDown className="w-3 h-3" />
                                </button>
                                <AnimatePresence>
                                    {showDownloadOptions && (
                                        <motion.div
                                            initial={{ opacity: 0, y: -10, scale: 0.95 }}
                                            animate={{ opacity: 1, y: 0, scale: 1 }}
                                            exit={{ opacity: 0, y: -10, scale: 0.95 }}
                                            transition={{ duration: 0.2 }}
                                            className="absolute top-full right-0 mt-1 z-50 bg-[#21262d] shadow-xl rounded border border-[#30363d] overflow-hidden min-w-[160px]"
                                        >
                                            <div className="py-1">
                                                <button
                                                    className="w-full flex items-center gap-2 px-2 py-1.5 text-gray-300 hover:bg-[#161b22] transition-colors duration-200 text-xs"
                                                    onClick={() => {
                                                        downloadCSV();
                                                        setShowDownloadOptions(false);
                                                    }}
                                                >
                                                    <FileText className="w-3 h-3 text-green-400" />
                                                    <span className="font-medium">Download as CSV</span>
                                                </button>
                                                <button
                                                    className="w-full flex items-center gap-2 px-2 py-1.5 text-gray-300 hover:bg-[#161b22] transition-colors duration-200 text-xs"
                                                    onClick={() => {
                                                        downloadExcel();
                                                        setShowDownloadOptions(false);
                                                    }}
                                                >
                                                    <FileSpreadsheet className="w-3 h-3 text-blue-400" />
                                                    <span className="font-medium">Download as Excel</span>
                                                </button>
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>

                            {/* Switch Product Button */}
                            <div className="relative" ref={dropdownRef}>
                                <button
                                    className="flex items-center justify-between gap-2 px-2 py-1 bg-[#21262d] border border-[#30363d] rounded text-xs hover:border-[#30363d] focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:ring-offset-0 transition-all text-gray-300 hover:bg-[#161b22] min-w-[120px]"
                                    onClick={() => setOpenSelector(!openSelector)}
                                >
                                    <span>Switch Product</span>
                                    <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${openSelector ? 'rotate-180' : ''}`} />
                                </button>
                                <AnimatePresence>
                                    {openSelector && (
                                        <motion.div
                                            initial={{ opacity: 0, y: -10, scale: 0.95 }}
                                            animate={{ opacity: 1, y: 0, scale: 1 }}
                                            exit={{ opacity: 0, y: -10, scale: 0.95 }}
                                            transition={{ duration: 0.2 }}
                                            className="absolute top-full right-0 mt-1 w-80 max-h-64 overflow-y-auto bg-[#21262d] border border-[#30363d] rounded shadow-xl z-50"
                                        >
                                            <div className="py-1">
                                                {(info?.productWiseError || []).map((item, index) => (
                                                    <button
                                                        key={index}
                                                        className="w-full px-2 py-1.5 text-left text-xs hover:bg-[#161b22] transition-all duration-150 text-gray-300 hover:text-blue-400 border-b border-[#30363d] last:border-b-0"
                                                        onMouseDown={(e) => {
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                            
                                                            if (item.asin === asin) {
                                                                setOpenSelector(false);
                                                                return;
                                                            }
                                                            
                                                            navigate(`/seller-central-checker/issues/${item.asin}`);
                                                            setOpenSelector(false);
                                                        }}
                                                    >
                                                        <div className="font-mono text-xs text-blue-400 mb-0.5">{item.asin}</div>
                                                        <div className="truncate">{item.name}</div>
                                                    </button>
                                                ))}
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        </div>
                    </div>
                </motion.div>

                {/* Key Metrics */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-2">
                    {[
                        { label: 'Units Sold', value: updatedProduct.quantity, icon: LineChart, color: 'blue' },
                        { label: 'Revenue', value: `$${(updatedProduct.sales || 0).toFixed(2)}`, icon: TrendingUp, color: 'green' },
                        { label: 'Analysis Period', value: `${info?.startDate} - ${info?.endDate}`, icon: Calendar, color: 'purple' },
                    ].map((metric, idx) => {
                        const Icon = metric.icon;
                        const colorMap = {
                            blue: 'bg-blue-500/20 border-blue-500/30 text-blue-400',
                            green: 'bg-green-500/20 border-green-500/30 text-green-400',
                            purple: 'bg-purple-500/20 border-purple-500/30 text-purple-400'
                        };
                        
                        return (
                            <motion.div
                                key={idx}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.5, delay: 0.1 + idx * 0.1 }}
                                className="bg-[#161b22] rounded border border-[#30363d] p-2 transition-all duration-300"
                            >
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-xs font-medium text-gray-400 mb-0.5">{metric.label}</p>
                                        <p className="text-lg font-bold text-gray-100">{metric.value}</p>
                                    </div>
                                    <div className={`w-8 h-8 ${colorMap[metric.color]} rounded flex items-center justify-center border`}>
                                        <Icon className="w-4 h-4" />
                                    </div>
                                </div>
                            </motion.div>
                        );
                    })}
                </div>

                {/* Ranking Issues */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6, delay: 0.4 }}
                    className="mb-2"
                >
                    <div className="bg-[#161b22] rounded border border-[#30363d] overflow-hidden transition-all duration-300">
                        <div className="bg-[#21262d] border-b border-[#30363d] px-2 py-2">
                            <div className="flex items-center gap-2">
                                <div className="w-8 h-8 bg-red-500/20 rounded flex items-center justify-center border border-red-500/30">
                                    <TrendingUp className="w-4 h-4 text-red-400" />
                                </div>
                                <div>
                                    <h2 className="text-sm font-bold text-gray-100">Ranking Issues</h2>
                                    <p className="text-xs text-gray-400">Optimization opportunities for better search rankings</p>
                                </div>
                            </div>
                        </div>
                        <div className="p-2 space-y-2">
                        {(updatedProduct.rankingErrors?.data?.TitleResult?.charLim?.status === "Error" || updatedProduct.rankingErrors?.data?.TitleResult?.RestictedWords?.status === "Error" || updatedProduct.rankingErrors?.data?.TitleResult?.checkSpecialCharacters?.status === "Error") && (<div>
                            <p className="font-semibold text-xs text-gray-300">Titles</p>
                            <ul className=" ml-2 text-xs text-gray-300 space-y-1 mt-1">
                                {
                                    updatedProduct.rankingErrors?.data?.TitleResult?.charLim?.status === "Error" && (
                                        <li className='mb-4'>
                                            <div className='flex justify-between items-center '>
                                                <p className='w-[40vw] text-gray-300'><b className="text-gray-200">Character Limit: </b><FormattedMessageComponent message={updatedProduct.rankingErrors?.data?.TitleResult?.charLim?.Message} /></p>
                                                <button className="px-2 py-1 bg-[#21262d] border border-[#30363d] rounded text-xs flex items-center justify-center gap-1 text-gray-300 hover:bg-[#161b22] transition-all" onClick={() => openCloseSol("charLim", "Title")}>
                                                    How to solve
                                                    <img src={DropDown} className='w-[7px] h-[7px]' />
                                                </button>
                                            </div>
                                            <div className='bg-[#21262d] border border-[#30363d] mt-2 flex justify-center items-center text-xs text-gray-300' style={TitleSolution === "charLim"
                                                ? { opacity: 1, maxHeight: "200px", minHeight: "80px", display: "flex",padding:"2rem" }
                                                : { opacity: 0, maxHeight: "0px", minHeight: "0px", overflow: "hidden", display: "flex" }
                                            }>{updatedProduct.rankingErrors?.data?.TitleResult?.charLim?.HowTOSolve}</div>
                                        </li>
                                    )
                                }
                                {
                                    updatedProduct.rankingErrors?.data?.TitleResult?.RestictedWords?.status === "Error" && (
                                        <li className='mb-4'>
                                            <div className='flex justify-between items-center '>
                                                <p className='w-[40vw] text-gray-300'><b className="text-gray-200">Restricted Words: </b><FormattedMessageComponent message={updatedProduct.rankingErrors?.data?.TitleResult?.RestictedWords?.Message} /></p>
                                                <button className="px-3 py-2 bg-[#21262d] border border-[#30363d] rounded text-xs flex items-center justify-center gap-2 text-gray-300 hover:bg-[#161b22] transition-all" onClick={() => openCloseSol("RestrictedWords", "Title")}>
                                                    How to solve
                                                    <img src={DropDown} className='w-[7px] h-[7px]' />
                                                </button>
                                            </div>
                                            <div
                                                className='bg-[#21262d] border border-[#30363d] mt-2 justify-center items-center transition-all duration-700 ease-in-out text-xs text-gray-300'
                                                style={TitleSolution === "RestrictedWords"
                                                    ? { opacity: 1, maxHeight: "200px", minHeight: "80px", display: "flex",padding:"2rem" }
                                                    : { opacity: 0, maxHeight: "0px", minHeight: "0px", overflow: "hidden", display: "flex" }
                                                }
                                            >
                                                {updatedProduct.rankingErrors?.data?.TitleResult?.RestictedWords?.HowTOSolve}
                                            </div>

                                        </li>
                                    )
                                }
                                {
                                    updatedProduct.rankingErrors?.data?.TitleResult?.checkSpecialCharacters?.status === "Error" && (
                                        <li className='mb-4'>
                                            <div className='flex justify-between items-center'>
                                                <p className='w-[40vw] text-gray-300'><b className="text-gray-200">Special Characters: </b><FormattedMessageComponent message={updatedProduct.rankingErrors?.data?.TitleResult?.checkSpecialCharacters?.Message} /></p>
                                                <button className="px-3 py-2 bg-[#21262d] border border-[#30363d] rounded text-xs flex items-center justify-center gap-2 text-gray-300 hover:bg-[#161b22] transition-all" onClick={() => openCloseSol("checkSpecialCharacters", "Title")}>
                                                    How to solve
                                                    <img src={DropDown} className='w-[7px] h-[7px]' />
                                                </button>
                                            </div>
                                            <div className='bg-[#21262d] border border-[#30363d] mt-2 flex justify-center items-center text-xs text-gray-300 transition-all duration-700 ease-in-out' style={TitleSolution === "checkSpecialCharacters" ? { opacity: 1, maxHeight: "200px", minHeight: "80px", display: "flex",padding:"2rem" } : { opacity: 0, maxHeight: "0px", minHeight: "0px", overflow: "hidden", display: "flex" }}>{updatedProduct.rankingErrors?.data?.TitleResult?.checkSpecialCharacters?.HowTOSolve}</div>
                                        </li>
                                    )
                                }
                            </ul>

                        </div>)}

                        {(updatedProduct.rankingErrors?.data?.BulletPoints?.charLim?.status === "Error" || updatedProduct.rankingErrors?.data?.BulletPoints?.RestictedWords?.status === "Error" || updatedProduct.rankingErrors?.data?.BulletPoints?.checkSpecialCharacters?.status === "Error") && (<div >
                            <p className="font-semibold text-gray-300">Bullet Points</p>
                            <ul className=" ml-5 text-sm text-gray-300 space-y-1 mt-2">
                                {
                                    updatedProduct.rankingErrors?.data?.BulletPoints?.charLim?.status === "Error" && (
                                        <li className='mb-4'>
                                            <div className='flex justify-between items-center mb-4'>
                                                <p className='w-[40vw] text-gray-300'><b className="text-gray-200">Character Limit: </b><FormattedMessageComponent message={updatedProduct.rankingErrors?.data?.BulletPoints.charLim?.Message} /></p>
                                                <button className="px-3 py-2 bg-[#21262d] border border-[#30363d] rounded text-xs flex items-center justify-center gap-2 text-gray-300 hover:bg-[#161b22] transition-all" onClick={() => openCloseSol("charLim", "BulletPoints")}>
                                                    How to solve
                                                    <img src={DropDown} className='w-[7px] h-[7px]' />
                                                </button>
                                            </div>
                                            <div className='bg-[#21262d] border border-[#30363d] mt-2 flex justify-center items-center text-xs text-gray-300 transition-all duration-700 ease-in-out' style={BulletSoltion === "charLim" ? { opacity: 1, maxHeight: "200px", minHeight: "80px", display: "flex",padding:"2rem" } : { opacity: 0, maxHeight: "0px", minHeight: "0px", overflow: "hidden", display: "flex" }}>{updatedProduct.rankingErrors?.data?.BulletPoints.charLim?.HowTOSolve}</div>
                                        </li>
                                    )
                                }
                                {
                                    updatedProduct.rankingErrors?.data?.BulletPoints?.RestictedWords?.status === "Error" && (
                                        <li className='mb-4' >
                                            <div className='flex justify-between items-center '>
                                                <p className='w-[40vw] text-gray-300'><b className="text-gray-200">Restricted Words: </b><FormattedMessageComponent message={updatedProduct.rankingErrors?.data?.BulletPoints?.RestictedWords?.Message} /></p>
                                                <button className="px-3 py-2 bg-[#21262d] border border-[#30363d] rounded text-xs flex items-center justify-center gap-2 text-gray-300 hover:bg-[#161b22] transition-all" onClick={() => openCloseSol("RestictedWords", "BulletPoints")}>
                                                    How to solve
                                                    <img src={DropDown} className='w-[7px] h-[7px]' />
                                                </button>
                                            </div>
                                            <div className='bg-[#21262d] border border-[#30363d] mt-2 flex justify-center items-center text-xs text-gray-300 transition-all duration-700 ease-in-out' style={BulletSoltion === "RestictedWords" ? { opacity: 1, maxHeight: "200px", minHeight: "80px", display: "flex",padding:"2rem" } : { opacity: 0, maxHeight: "0px", minHeight: "0px", overflow: "hidden", display: "flex" }}>{updatedProduct.rankingErrors?.data?.BulletPoints?.RestictedWords?.HowTOSolve}</div>
                                        </li>
                                    )
                                }
                                {
                                    updatedProduct.rankingErrors?.data?.BulletPoints?.checkSpecialCharacters?.status === "Error" && (
                                        <li className='mb-4'>
                                            <div className='flex justify-between items-center'>
                                                <p className='w-[40vw] text-gray-300'><b className="text-gray-200">Special Characters: </b><FormattedMessageComponent message={updatedProduct.rankingErrors?.data?.BulletPoints?.checkSpecialCharacters?.Message} /></p>
                                                <button className="px-3 py-2 bg-[#21262d] border border-[#30363d] rounded text-xs flex items-center justify-center gap-2 text-gray-300 hover:bg-[#161b22] transition-all" onClick={() => openCloseSol("checkSpecialCharacters", "BulletPoints")}>
                                                    How to solve
                                                    <img src={DropDown} className='w-[7px] h-[7px]' />
                                                </button>
                                            </div>
                                            <div className='bg-[#21262d] border border-[#30363d] mt-2 flex justify-center items-center text-xs text-gray-300 transition-all duration-700 ease-in-out' style={BulletSoltion === "checkSpecialCharacters" ? { opacity: 1, maxHeight: "200px", minHeight: "80px", display: "flex",padding:"2rem" } : { opacity: 0, maxHeight: "0px", minHeight: "0px", overflow: "hidden", display: "flex" }}>{updatedProduct.rankingErrors?.data?.BulletPoints?.checkSpecialCharacters?.HowTOSolve}</div>
                                        </li>
                                    )
                                }
                            </ul>
                        </div>)}

                        {(updatedProduct.rankingErrors?.data?.Description?.charLim?.status === "Error" || updatedProduct.rankingErrors?.data?.Description?.RestictedWords?.status === "Error" || updatedProduct.rankingErrors?.data?.Description?.checkSpecialCharacters?.status === "Error") && (<div >
                            <p className="font-semibold text-gray-300">Description</p>
                            <ul className=" ml-5 text-sm text-gray-300 space-y-1 mt-2">
                                {
                                    updatedProduct.rankingErrors?.data?.Description?.charLim?.status === "Error" && (
                                        <li className='mb-4'>
                                            <div className='flex justify-between items-center'>
                                                <p className='w-[40vw] text-gray-300'><b className="text-gray-200">Character Limit: </b><FormattedMessageComponent message={updatedProduct.rankingErrors?.data?.Description?.charLim?.Message} /></p>
                                                <button className="px-3 py-2 bg-[#21262d] border border-[#30363d] rounded text-xs flex items-center justify-center gap-2 text-gray-300 hover:bg-[#161b22] transition-all" onClick={() => openCloseSol("charLim", "Description")}>
                                                    How to solve
                                                    <img src={DropDown} className='w-[7px] h-[7px]' />
                                                </button>
                                            </div>
                                            <div className='bg-[#21262d] border border-[#30363d] mt-2 flex items-center justify-center text-xs text-gray-300 transition-all duration-700 ease-in-out' style={DescriptionSolution === "charLim" ? { opacity: 1, maxHeight: "200px", minHeight: "80px", display: "flex",padding:"2rem" } : { opacity: 0, maxHeight: "0px", minHeight: "0px", overflow: "hidden", display: "flex" }}><p className='w-[80%] text-gray-300'>{updatedProduct.rankingErrors?.data?.Description?.charLim?.HowTOSolve}</p></div>
                                        </li>
                                    )
                                }
                                {
                                    updatedProduct.rankingErrors?.data?.Description?.RestictedWords?.status === "Error" && (
                                        <li className='mb-4'>
                                            <div className='flex justify-between items-center'>
                                                <p className='w-[40vw] text-gray-300'><b className="text-gray-200">Restricted Words: </b><FormattedMessageComponent message={updatedProduct.rankingErrors?.data?.Description?.RestictedWords?.Message} /></p>
                                                <button className="px-3 py-2 bg-[#21262d] border border-[#30363d] rounded text-xs flex items-center justify-center gap-2 text-gray-300 hover:bg-[#161b22] transition-all" onClick={() => openCloseSol("RestictedWords", "Description")}>
                                                    How to solve
                                                    <img src={DropDown} className='w-[7px] h-[7px]' />
                                                </button>
                                            </div>
                                            <div className='bg-[#21262d] border border-[#30363d] mt-2 flex items-center justify-center text-xs text-gray-300 transition-all duration-700 ease-in-out' style={DescriptionSolution === "RestictedWords" ? { opacity: 1, maxHeight: "200px", minHeight: "80px", display: "flex",padding:"2rem" } : { opacity: 0, maxHeight: "0px", minHeight: "0px", overflow: "hidden", display: "flex" }}><p className='w-[80%] text-gray-300'>{updatedProduct.rankingErrors?.data?.Description?.RestictedWords?.HowTOSolve}</p></div>
                                        </li>
                                    )
                                }
                                {
                                    updatedProduct.rankingErrors?.data?.Description?.checkSpecialCharacters?.status === "Error" && (
                                        <li className='mb-4'>
                                            <div className='flex justify-between items-center'>
                                                <p className='w-[40vw] text-gray-300'><b className="text-gray-200">Special Characters: </b><FormattedMessageComponent message={updatedProduct.rankingErrors?.data?.Description?.checkSpecialCharacters?.Message} /></p>
                                                <button className="px-3 py-2 bg-[#21262d] border border-[#30363d] rounded text-xs flex items-center justify-center gap-2 text-gray-300 hover:bg-[#161b22] transition-all" onClick={() => openCloseSol("checkSpecialCharacters", "Description")}>
                                                    How to solve
                                                    <img src={DropDown} className='w-[7px] h-[7px]' />
                                                </button>
                                            </div>
                                            <div className='bg-[#21262d] border border-[#30363d] mt-2 flex items-center justify-center text-xs text-gray-300 transition-all duration-700 ease-in-out' style={DescriptionSolution === "checkSpecialCharacters" ? { opacity: 1, maxHeight: "200px", minHeight: "80px", display: "flex",padding:"2rem" } : { opacity: 0, maxHeight: "0px", minHeight: "0px", overflow: "hidden", display: "flex" }}><p className='w-[80%] text-gray-300'>{updatedProduct.rankingErrors?.data?.Description?.checkSpecialCharacters?.HowTOSolve}</p></div>
                                        </li>
                                    )
                                }

                            </ul>
                        </div>)}

                        {(updatedProduct.rankingErrors?.data?.charLim?.status === "Error") && (<div>
                            <p className="font-semibold text-gray-300">Backend Keywords</p>
                            <ul className=" ml-5 text-sm text-gray-300 space-y-1 mt-2">
                                {
                                    updatedProduct.rankingErrors?.data?.charLim?.status === "Error" && (
                                        <li className='mb-4'>
                                            <div className='flex justify-between items-center'>
                                                <p className='w-[40vw] text-gray-300'><b className="text-gray-200">Character Limit: </b><FormattedMessageComponent message={updatedProduct.rankingErrors?.data?.charLim?.Message} /></p>
                                                <button className="px-3 py-2 bg-[#21262d] border border-[#30363d] rounded text-xs flex items-center justify-center gap-2 text-gray-300 hover:bg-[#161b22] transition-all" onClick={() => openCloseSol("charLim", "BackendKeyWords")}>
                                                    How to solve
                                                    <img src={DropDown} className='w-[7px] h-[7px]' />
                                                </button>
                                            </div>
                                            <div className='bg-[#21262d] border border-[#30363d] mt-2 flex items-center justify-center text-xs text-gray-300 transition-all duration-700 ease-in-out' style={BackendKeyWords === "charLim" ? { opacity: 1, maxHeight: "200px", minHeight: "80px", display: "flex",padding:"2rem" } : { opacity: 0, maxHeight: "0px", minHeight: "0px", overflow: "hidden", display: "flex" }}><p className='w-[80%] text-gray-300'>{updatedProduct.rankingErrors?.data?.charLim?.HowTOSolve}</p></div>
                                        </li>
                                    )
                                }


                            </ul>
                        </div>)}
                        </div>
                    </div>
                </motion.div>


                {/* Conversion Issues */}
                {hasAnyConversionError && (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6, delay: 0.5 }}
                        className="mb-2"
                    >
                        <div className="bg-[#161b22] rounded border border-[#30363d] overflow-hidden transition-all duration-300">
                            <div className="bg-[#21262d] border-b border-[#30363d] px-2 py-2">
                                <div className="flex items-center gap-2">
                                    <div className="w-8 h-8 bg-blue-500/20 rounded flex items-center justify-center border border-blue-500/30">
                                        <LineChart className="w-4 h-4 text-blue-400" />
                                    </div>
                                    <div>
                                        <h2 className="text-sm font-bold text-gray-100">Conversion Issues</h2>
                                        <p className="text-xs text-gray-400">Enhance product appeal and customer conversion rates</p>
                                    </div>
                                </div>
                            </div>
                            <div className="p-2">
                            <ul className="ml-2 text-xs text-gray-300 space-y-1 mt-1 flex flex-col gap-2">
                                {product.conversionErrors?.imageResultErrorData?.status === "Error" && (
                                    <IssueItem
                                        label="Images Issue"
                                        message={product.conversionErrors?.imageResultErrorData.Message}
                                        solutionKey="Image"
                                        solutionContent={product.conversionErrors?.imageResultErrorData.HowToSolve}
                                        stateValue={imageSolution}
                                        toggleFunc={(val) => openCloseSolutionConversion(val, "Image")}
                                    />
                                )}
                                {product.conversionErrors?.videoResultErrorData?.status === "Error" && (
                                    <IssueItem
                                        label="Video Issue"
                                        message={product.conversionErrors?.videoResultErrorData.Message}
                                        solutionKey="Video"
                                        solutionContent={product.conversionErrors?.videoResultErrorData.HowToSolve}
                                        stateValue={videoSolution}
                                        toggleFunc={(val) => openCloseSolutionConversion(val, "Video")}
                                    />
                                )}
                                {product.conversionErrors?.productStarRatingResultErrorData?.status === "Error" && (
                                    <IssueItem
                                        label="Star Rating Issue"
                                        message={product.conversionErrors?.productStarRatingResultErrorData.Message}
                                        solutionKey="ProductStarRating"
                                        solutionContent={product.conversionErrors?.productStarRatingResultErrorData.HowToSolve}
                                        stateValue={productStarRatingSolution}
                                        toggleFunc={(val) => openCloseSolutionConversion(val, "ProductStarRating")}
                                    />
                                )}
                                {product.conversionErrors?.productsWithOutBuyboxErrorData?.status === "Error" && (
                                    <IssueItem
                                        label="Product without Buy Box"
                                        message={product.conversionErrors?.productsWithOutBuyboxErrorData.Message}
                                        solutionKey="ProductsWithOutBuybox"
                                        solutionContent={product.conversionErrors?.productsWithOutBuyboxErrorData.HowToSolve}
                                        stateValue={productsWithOutBuyboxSolution}
                                        toggleFunc={(val) => openCloseSolutionConversion(val, "ProductsWithOutBuybox")}
                                    />
                                )}
                                {product.conversionErrors?.aplusErrorData?.status === "Error" && (
                                    <IssueItem
                                        label="Aplus Issue"
                                        message={product.conversionErrors?.aplusErrorData.Message}
                                        solutionKey="Aplus"
                                        solutionContent={product.conversionErrors?.aplusErrorData.HowToSolve}
                                        stateValue={aplusSolution}
                                        toggleFunc={(val) => openCloseSolutionConversion(val, "Aplus")}
                                    />
                                )}
                                {product.conversionErrors?.brandStoryErrorData?.status === "Error" && (
                                    <IssueItem
                                        label="Brand Story Issue"
                                        message={product.conversionErrors?.brandStoryErrorData.Message}
                                        solutionKey="BrandStory"
                                        solutionContent={product.conversionErrors?.brandStoryErrorData.HowToSolve}
                                        stateValue={brandStorySolution}
                                        toggleFunc={(val) => openCloseSolutionConversion(val, "BrandStory")}
                                    />
                                )}
                            </ul>
                            </div>
                        </div>
                    </motion.div>
                )}

                {/* Inventory Issues */}
                {hasAnyInventoryError && (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6, delay: 0.6 }}
                        className="mb-2"
                    >
                        <div className="bg-[#161b22] rounded border border-[#30363d] overflow-hidden transition-all duration-300">
                            <div className="bg-[#21262d] border-b border-[#30363d] px-2 py-2">
                                <div className="flex items-center gap-2">
                                    <div className="w-8 h-8 bg-green-500/20 rounded flex items-center justify-center border border-green-500/30">
                                        <Box className="w-4 h-4 text-green-400" />
                                    </div>
                                    <div>
                                        <h2 className="text-sm font-bold text-gray-100">Inventory Issues</h2>
                                        <p className="text-xs text-gray-400">Manage inventory levels and warehouse operations</p>
                                    </div>
                                </div>
                            </div>
                            <div className="p-2">
                            <ul className="ml-2 text-xs text-gray-300 space-y-1 mt-1 flex flex-col gap-2">
                                {/* Inventory Planning Issues */}
                                {product.inventoryErrors?.inventoryPlanningErrorData && (
                                    <>
                                        {product.inventoryErrors?.inventoryPlanningErrorData.longTermStorageFees?.status === "Error" && (
                                            <IssueItem
                                                label="Long-Term Storage Fees"
                                                message={product.inventoryErrors?.inventoryPlanningErrorData.longTermStorageFees.Message}
                                                solutionKey="LongTermStorage"
                                                solutionContent={product.inventoryErrors?.inventoryPlanningErrorData.longTermStorageFees.HowToSolve}
                                                stateValue={inventoryPlanningSolution}
                                                toggleFunc={(val) => openCloseSolutionInventory(val, "InventoryPlanning")}
                                            />
                                        )}
                                        {product.inventoryErrors?.inventoryPlanningErrorData.unfulfillable?.status === "Error" && (
                                            <IssueItem
                                                label="Unfulfillable Inventory"
                                                message={product.inventoryErrors?.inventoryPlanningErrorData.unfulfillable.Message}
                                                solutionKey="Unfulfillable"
                                                solutionContent={product.inventoryErrors?.inventoryPlanningErrorData.unfulfillable.HowToSolve}
                                                stateValue={inventoryPlanningSolution}
                                                toggleFunc={(val) => openCloseSolutionInventory(val, "InventoryPlanning")}
                                            />
                                        )}
                                    </>
                                )}

                                {/* Stranded Inventory Issues */}
                                {product.inventoryErrors?.strandedInventoryErrorData && (
                                    <IssueItem
                                        label="Stranded Inventory"
                                        message={product.inventoryErrors?.strandedInventoryErrorData.Message}
                                        solutionKey="StrandedInventory"
                                        solutionContent={product.inventoryErrors?.strandedInventoryErrorData.HowToSolve}
                                        stateValue={strandedInventorySolution}
                                        toggleFunc={(val) => openCloseSolutionInventory(val, "StrandedInventory")}
                                    />
                                )}

                                {/* Inbound Non-Compliance Issues */}
                                {product.inventoryErrors?.inboundNonComplianceErrorData && (
                                    <IssueItem
                                        label="Inbound Non-Compliance"
                                        message={product.inventoryErrors?.inboundNonComplianceErrorData.Message}
                                        solutionKey="InboundNonCompliance"
                                        solutionContent={product.inventoryErrors?.inboundNonComplianceErrorData.HowToSolve}
                                        stateValue={inboundNonComplianceSolution}
                                        toggleFunc={(val) => openCloseSolutionInventory(val, "InboundNonCompliance")}
                                    />
                                )}

                                {/* Replenishment/Restock Issues - handles single or multiple errors */}
                                {product.inventoryErrors?.replenishmentErrorData && (
                                    Array.isArray(product.inventoryErrors.replenishmentErrorData) ? (
                                        // Multiple errors for same ASIN (different SKUs)
                                        product.inventoryErrors.replenishmentErrorData.map((error, idx) => {
                                            const recommendedQty = error.recommendedReplenishmentQty || error.data || null;
                                            const messageWithQty = recommendedQty !== null && recommendedQty !== undefined && recommendedQty > 0
                                                ? `${error.Message} <span class="font-bold">Recommended Restock Quantity: ${recommendedQty} units</span>`
                                                : error.Message;
                                            return (
                                                <IssueItem
                                                    key={`replenishment-${idx}`}
                                                    label={`Low Inventory Risk ${error.sku ? `(SKU: ${error.sku})` : ''}`}
                                                    message={error.Message}
                                                    recommendedQty={recommendedQty}
                                                    solutionKey={`Replenishment-${idx}`}
                                                    solutionContent={error.HowToSolve}
                                                    stateValue={replenishmentSolution}
                                                    toggleFunc={(val) => openCloseSolutionInventory(val, "Replenishment")}
                                                />
                                            );
                                        })
                                    ) : (
                                        // Single error
                                        (() => {
                                            const error = product.inventoryErrors.replenishmentErrorData;
                                            const recommendedQty = error.recommendedReplenishmentQty || error.data || null;
                                            return (
                                                <IssueItem
                                                    label={`Low Inventory Risk ${error.sku ? `(SKU: ${error.sku})` : ''}`}
                                                    message={error.Message}
                                                    recommendedQty={recommendedQty}
                                                    solutionKey="Replenishment"
                                                    solutionContent={error.HowToSolve}
                                                    stateValue={replenishmentSolution}
                                                    toggleFunc={(val) => openCloseSolutionInventory(val, "Replenishment")}
                                                />
                                            );
                                        })()
                                    )
                                )}
                            </ul>
                            </div>
                        </div>
                    </motion.div>
                )}
                
                {/*Empty div*/}
                <div className='py-2 w-full h-5'></div>
                </div>
            </div>
            
            {/* Loading overlay for PDF generation */}
            {isGeneratingPDF && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100]">
                    <div className="bg-[#161b22] border border-[#30363d] rounded p-4 flex flex-col items-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mb-2"></div>
                        <p className="text-xs text-gray-300">Generating PDF...</p>
                        <p className="text-xs text-gray-400 mt-1">Please wait, this may take a moment</p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Dashboard;
