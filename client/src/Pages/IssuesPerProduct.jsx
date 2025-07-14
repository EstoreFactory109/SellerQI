import React, { useState, useEffect, useRef } from 'react';
import { useSelector } from "react-redux";
import { useParams } from 'react-router-dom';
import DropDown from '../assets/Icons/drop-down.png';
import noImage from '../assets/Icons/no-image.png';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from "framer-motion";
import * as ExcelJS from 'exceljs';
import Papa from 'papaparse';
import { saveAs } from 'file-saver';
import { LazyLoadImage } from 'react-lazy-load-image-component';
import 'react-lazy-load-image-component/src/effects/blur.css';
import { Package, AlertTriangle, TrendingUp, BarChart3, Calendar, Download, ChevronDown, Search, Filter, HelpCircle, FileText, FileSpreadsheet } from 'lucide-react';
import './IssuesPerProduct.css';

// Reusable component for conversion issues
const IssueItem = ({ label, message, solutionKey, solutionContent, stateValue, toggleFunc }) => (
    <li className="mb-4">
        <div className="flex justify-between items-center">
            <p className="w-[40vw]">
                <b>{label}: </b>{message}
            </p>
            <button
                className="px-3 py-2 bg-white border rounded-md shadow-sm flex items-center justify-center gap-2"
                onClick={() => toggleFunc(solutionKey)}
            >
                How to solve
                <img src={DropDown} className="w-[7px] h-[7px]" />
            </button>
        </div>
        <div
            className="bg-gray-200 mt-2 flex justify-center items-center transition-all duration-700 ease-in-out"
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
    const product = info.productWiseError.find(item => item.asin === asin);
    
    // Get GetOrderData array for calculating quantities and revenue
    const getOrderData = Array.isArray(info?.GetOrderData) ? info.GetOrderData : [];
    
    // Function to calculate total quantities ASIN-wise from GetOrderData
    const calculateAsinQuantities = (orderData) => {
        const asinQuantities = {};
        
        // Only consider shipped, unshipped, and partially shipped orders
        const validStatuses = ['Shipped', 'Unshipped', 'PartiallyShipped'];
        
        orderData.forEach(order => {
            if (!order || !order.asin || !validStatuses.includes(order.orderStatus)) {
                return;
            }
            
            const asinName = order.asin;
            const quantity = Number(order.quantity) || 0;
            
            if (asinQuantities[asinName]) {
                asinQuantities[asinName] += quantity;
            } else {
                asinQuantities[asinName] = quantity;
            }
        });
        
        return asinQuantities;
    };

    // Function to calculate total revenue ASIN-wise from GetOrderData
    const calculateAsinRevenue = (orderData) => {
        const asinRevenue = {};
        
        // Only consider shipped, unshipped, and partially shipped orders
        const validStatuses = ['Shipped', 'Unshipped', 'PartiallyShipped'];
        
        orderData.forEach(order => {
            if (!order || !order.asin || !validStatuses.includes(order.orderStatus)) {
                return;
            }
            
            const asinName = order.asin;
            const itemPrice = Number(order.itemPrice) || 0;
            
            if (asinRevenue[asinName]) {
                asinRevenue[asinName] += itemPrice;
            } else {
                asinRevenue[asinName] = itemPrice;
            }
        });
        
        return asinRevenue;
    };
    
    // Calculate quantities and revenue from GetOrderData
    const asinQuantities = calculateAsinQuantities(getOrderData);
    const asinRevenue = calculateAsinRevenue(getOrderData);
    
    // Debug: Log calculations
    console.log('IssuesPerProduct - GetOrderData length:', getOrderData.length);
    console.log('IssuesPerProduct - Calculated ASIN quantities:', asinQuantities);
    console.log('IssuesPerProduct - Calculated ASIN revenue:', asinRevenue);
    
    // Update product with calculated quantities and revenue from GetOrderData
    const updatedProduct = product ? {
        ...product,
        quantity: asinQuantities[product.asin] || 0,
        sales: asinRevenue[product.asin] || 0
    } : null;
    
    // Debug: Log when component renders with new ASIN
    useEffect(() => {
        console.log('Component rendered with ASIN:', asin);
        console.log('Product found:', !!product);
        console.log('Updated product units:', updatedProduct?.quantity);
        console.log('Updated product revenue:', updatedProduct?.sales);
    }, [asin, product, updatedProduct]);

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

    if (!updatedProduct) {
        return <div className="p-6">No product data found for ASIN: {asin}</div>;
    }

    const hasAnyConversionError = [
        updatedProduct.conversionErrors.imageResultErrorData?.status,
        updatedProduct.conversionErrors.videoResultErrorData?.status,
        updatedProduct.conversionErrors.productReviewResultErrorData?.status,
        updatedProduct.conversionErrors.productStarRatingResultErrorData?.status,
        updatedProduct.conversionErrors.productsWithOutBuyboxErrorData?.status,
        updatedProduct.conversionErrors.aplusErrorData?.status
    ].includes("Error");

    const hasAnyInventoryError = updatedProduct.inventoryErrors && (
        updatedProduct.inventoryErrors.inventoryPlanningErrorData ||
        updatedProduct.inventoryErrors.strandedInventoryErrorData ||
        updatedProduct.inventoryErrors.inboundNonComplianceErrorData ||
        updatedProduct.inventoryErrors.replenishmentErrorData
    );

    // Ranking issue states
    const [TitleSolution, setTitleSolution] = useState("");
    const [BulletSoltion, setBulletSolution] = useState("");
    const [DescriptionSolution, setDescriptionSolution] = useState("");
    const [BackendKeyWords, setBackendKeyWords] = useState("");

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

    // Conversion issue states (independent toggles)
    const [imageSolution, setImageSolution] = useState("");
    const [videoSolution, setVideoSolution] = useState("");
    const [productReviewSolution, setProductReviewSolution] = useState("");
    const [productStarRatingSolution, setProductStarRatingSolution] = useState("");
    const [productsWithOutBuyboxSolution, setProductsWithOutBuyboxSolution] = useState("");
    const [aplusSolution, setAplusSolution] = useState("");

    // Inventory issue states (independent toggles)
    const [inventoryPlanningSolution, setInventoryPlanningSolution] = useState("");
    const [strandedInventorySolution, setStrandedInventorySolution] = useState("");
    const [inboundNonComplianceSolution, setInboundNonComplianceSolution] = useState("");
    const [replenishmentSolution, setReplenishmentSolution] = useState("");

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
    const [openSelector, setOpenSelector] = useState(false)
    const navigate = useNavigate();

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
        if (updatedProduct.rankingErrors.data.TitleResult.charLim?.status === "Error") {
            exportData.push({
                Category: 'Ranking Issues',
                Type: 'Title',
                Issue: 'Character Limit',
                Message: updatedProduct.rankingErrors.data.TitleResult.charLim.Message,
                Solution: updatedProduct.rankingErrors.data.TitleResult.charLim.HowTOSolve
            });
        }
        if (updatedProduct.rankingErrors.data.TitleResult.RestictedWords?.status === "Error") {
            exportData.push({
                Category: 'Ranking Issues',
                Type: 'Title',
                Issue: 'Restricted Words',
                Message: updatedProduct.rankingErrors.data.TitleResult.RestictedWords.Message,
                Solution: updatedProduct.rankingErrors.data.TitleResult.RestictedWords.HowTOSolve
            });
        }
        if (updatedProduct.rankingErrors.data.TitleResult.checkSpecialCharacters?.status === "Error") {
            exportData.push({
                Category: 'Ranking Issues',
                Type: 'Title',
                Issue: 'Special Characters',
                Message: updatedProduct.rankingErrors.data.TitleResult.checkSpecialCharacters.Message,
                Solution: updatedProduct.rankingErrors.data.TitleResult.checkSpecialCharacters.HowTOSolve
            });
        }

        // Ranking Issues - Bullet Points
        if (product.rankingErrors.data.BulletPoints.charLim?.status === "Error") {
            exportData.push({
                Category: 'Ranking Issues',
                Type: 'Bullet Points',
                Issue: 'Character Limit',
                Message: product.rankingErrors.data.BulletPoints.charLim.Message,
                Solution: product.rankingErrors.data.BulletPoints.charLim.HowTOSolve
            });
        }
        if (product.rankingErrors.data.BulletPoints.RestictedWords?.status === "Error") {
            exportData.push({
                Category: 'Ranking Issues',
                Type: 'Bullet Points',
                Issue: 'Restricted Words',
                Message: product.rankingErrors.data.BulletPoints.RestictedWords.Message,
                Solution: product.rankingErrors.data.BulletPoints.RestictedWords.HowTOSolve
            });
        }
        if (product.rankingErrors.data.BulletPoints.checkSpecialCharacters?.status === "Error") {
            exportData.push({
                Category: 'Ranking Issues',
                Type: 'Bullet Points',
                Issue: 'Special Characters',
                Message: product.rankingErrors.data.BulletPoints.checkSpecialCharacters.Message,
                Solution: product.rankingErrors.data.BulletPoints.checkSpecialCharacters.HowTOSolve
            });
        }

        // Ranking Issues - Description
        if (product.rankingErrors.data.Description.charLim?.status === "Error") {
            exportData.push({
                Category: 'Ranking Issues',
                Type: 'Description',
                Issue: 'Character Limit',
                Message: product.rankingErrors.data.Description.charLim.Message,
                Solution: product.rankingErrors.data.Description.charLim.HowTOSolve
            });
        }
        if (product.rankingErrors.data.Description.RestictedWords?.status === "Error") {
            exportData.push({
                Category: 'Ranking Issues',
                Type: 'Description',
                Issue: 'Restricted Words',
                Message: product.rankingErrors.data.Description.RestictedWords.Message,
                Solution: product.rankingErrors.data.Description.RestictedWords.HowTOSolve
            });
        }
        if (product.rankingErrors.data.Description.checkSpecialCharacters?.status === "Error") {
            exportData.push({
                Category: 'Ranking Issues',
                Type: 'Description',
                Issue: 'Special Characters',
                Message: product.rankingErrors.data.Description.checkSpecialCharacters.Message,
                Solution: product.rankingErrors.data.Description.checkSpecialCharacters.HowTOSolve
            });
        }

        // Ranking Issues - Backend Keywords
        if (product.rankingErrors.data.charLim?.status === "Error") {
            exportData.push({
                Category: 'Ranking Issues',
                Type: 'Backend Keywords',
                Issue: 'Character Limit',
                Message: product.rankingErrors.data.charLim.Message,
                Solution: product.rankingErrors.data.charLim.HowTOSolve
            });
        }

        // Conversion Issues
        if (product.conversionErrors.imageResultErrorData?.status === "Error") {
            exportData.push({
                Category: 'Conversion Issues',
                Type: 'Images',
                Issue: 'Images Issue',
                Message: product.conversionErrors.imageResultErrorData.Message,
                Solution: product.conversionErrors.imageResultErrorData.HowToSolve
            });
        }
        if (product.conversionErrors.videoResultErrorData?.status === "Error") {
            exportData.push({
                Category: 'Conversion Issues',
                Type: 'Video',
                Issue: 'Video Issue',
                Message: product.conversionErrors.videoResultErrorData.Message,
                Solution: product.conversionErrors.videoResultErrorData.HowToSolve
            });
        }
        if (product.conversionErrors.productReviewResultErrorData?.status === "Error") {
            exportData.push({
                Category: 'Conversion Issues',
                Type: 'Product Review',
                Issue: 'Product Review Issue',
                Message: product.conversionErrors.productReviewResultErrorData.Message,
                Solution: product.conversionErrors.productReviewResultErrorData.HowToSolve
            });
        }
        if (product.conversionErrors.productStarRatingResultErrorData?.status === "Error") {
            exportData.push({
                Category: 'Conversion Issues',
                Type: 'Star Rating',
                Issue: 'Star Rating Issue',
                Message: product.conversionErrors.productStarRatingResultErrorData.Message,
                Solution: product.conversionErrors.productStarRatingResultErrorData.HowToSolve
            });
        }
        if (product.conversionErrors.productsWithOutBuyboxErrorData?.status === "Error") {
            exportData.push({
                Category: 'Conversion Issues',
                Type: 'Buy Box',
                Issue: 'Product without Buy Box',
                Message: product.conversionErrors.productsWithOutBuyboxErrorData.Message,
                Solution: product.conversionErrors.productsWithOutBuyboxErrorData.HowToSolve
            });
        }
        if (product.conversionErrors.aplusErrorData?.status === "Error") {
            exportData.push({
                Category: 'Conversion Issues',
                Type: 'A+ Content',
                Issue: 'Aplus Issue',
                Message: product.conversionErrors.aplusErrorData.Message,
                Solution: product.conversionErrors.aplusErrorData.HowToSolve
            });
        }

        // Inventory Issues
        if (product.inventoryErrors?.inventoryPlanningErrorData) {
            const planning = product.inventoryErrors.inventoryPlanningErrorData;
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
                Message: product.inventoryErrors.strandedInventoryErrorData.Message,
                Solution: product.inventoryErrors.strandedInventoryErrorData.HowToSolve
            });
        }
        if (product.inventoryErrors?.inboundNonComplianceErrorData) {
            exportData.push({
                Category: 'Inventory Issues',
                Type: 'Inbound Non-Compliance',
                Issue: 'Shipment Issue',
                Message: product.inventoryErrors.inboundNonComplianceErrorData.Message,
                Solution: product.inventoryErrors.inboundNonComplianceErrorData.HowToSolve
            });
        }
        if (product.inventoryErrors?.replenishmentErrorData) {
            exportData.push({
                Category: 'Inventory Issues',
                Type: 'Replenishment',
                Issue: 'Low Inventory Risk',
                Message: product.inventoryErrors.replenishmentErrorData.Message,
                Solution: product.inventoryErrors.replenishmentErrorData.HowToSolve
            });
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

    // Download handler with format selection
    const [showDownloadOptions, setShowDownloadOptions] = useState(false);
    const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
    const downloadRef = useRef(null);
    const contentRef = useRef(null);

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
        <div className="bg-gray-50/50 lg:mt-0 mt-[10vh] h-screen overflow-y-auto">
            <div className="p-6">
                {/* Header Section */}
                <div className="bg-gradient-to-r from-slate-800 via-gray-900 to-slate-900 rounded-2xl shadow-lg mb-8">
                    <div className="px-6 py-8">
                        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                            <div className="text-white">
                                <div className="flex items-center gap-3 mb-2">
                                    <div className="w-2 h-8 bg-gradient-to-b from-blue-400 to-purple-500 rounded-full"></div>
                                    <div className="flex items-center gap-3">
                                        <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                                            Product Issues
                                        </h1>
                                        <HelpCircle className='w-5 h-5 text-gray-300 hover:text-white cursor-pointer transition-colors' />
                                    </div>
                                </div>
                                <p className="text-gray-300 text-lg mb-4">Detailed analysis of product optimization opportunities</p>
                                <div className="flex items-center gap-4">
                                    <div className="flex items-center gap-2 text-sm text-gray-400">
                                        <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                                        <span>Live analysis active</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-sm text-orange-300">
                                        <AlertTriangle className="w-4 h-4" />
                                        <span>Issues detected</span>
                                    </div>
                                </div>
                            </div>
                            
                            <div className="flex items-center gap-6 text-white">
                                <div className="text-center lg:text-right">
                                    <div className="text-4xl lg:text-5xl font-bold bg-gradient-to-r from-orange-400 to-red-500 bg-clip-text text-transparent mb-1">
                                        {updatedProduct.asin}
                                    </div>
                                    <div className="text-sm text-gray-300 font-medium tracking-wide uppercase">Product ASIN</div>
                                    <div className="text-xs text-orange-300 mt-1">Requires optimization</div>
                                </div>
                                <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg">
                                    <Package className="w-8 h-8 text-white" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="space-y-8 pb-8" ref={contentRef}>
                {/* Product Information Card */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                    className="bg-white rounded-2xl shadow-lg border-0 p-6 mb-8 hover:shadow-xl transition-all duration-300"
                >
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
                        <div className="flex items-center space-x-6">
                                                    <div className="w-24 h-24 bg-gradient-to-br from-gray-100 to-gray-200 rounded-xl overflow-hidden shadow-md">
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
                        <div className="space-y-3">
                            <h2 className="text-xl font-bold text-gray-900 leading-tight">{updatedProduct.name}</h2>
                            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                                <div className="flex items-center gap-2">
                                    <span className="text-gray-500 font-medium">ASIN:</span>
                                    <span className="font-mono bg-gray-100 px-2 py-1 rounded text-xs">{updatedProduct.asin}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-gray-500 font-medium">SKU:</span>
                                    <span className="font-mono bg-gray-100 px-2 py-1 rounded text-xs">{updatedProduct.sku}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-gray-500 font-medium">Price:</span>
                                    <span className="font-semibold text-green-600">${updatedProduct.price}</span>
                                </div>
                            </div>
                        </div>
                        </div>

                        <div className='flex items-center gap-3 relative'>
                            {/* Download Report Button */}
                            <div className="relative" ref={downloadRef}>
                                <button 
                                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-all duration-200 shadow-sm hover:shadow text-sm font-medium"
                                    onClick={() => setShowDownloadOptions(!showDownloadOptions)}
                                >
                                    <Download className="w-4 h-4" />
                                    Export
                                    <ChevronDown className="w-4 h-4" />
                                </button>
                                <AnimatePresence>
                                    {showDownloadOptions && (
                                        <motion.div
                                            initial={{ opacity: 0, y: -10, scale: 0.95 }}
                                            animate={{ opacity: 1, y: 0, scale: 1 }}
                                            exit={{ opacity: 0, y: -10, scale: 0.95 }}
                                            transition={{ duration: 0.2 }}
                                            className="absolute top-full right-0 mt-2 z-50 bg-white shadow-xl rounded-xl border border-gray-200 overflow-hidden min-w-[180px]"
                                        >
                                            <div className="py-1">
                                                <button
                                                    className="w-full flex items-center gap-2 px-3 py-2 text-gray-700 hover:bg-gray-50 transition-colors duration-200"
                                                    onClick={() => {
                                                        downloadCSV();
                                                        setShowDownloadOptions(false);
                                                    }}
                                                >
                                                    <FileText className="w-4 h-4 text-green-600" />
                                                    <span className="text-sm font-medium">Download as CSV</span>
                                                </button>
                                                <button
                                                    className="w-full flex items-center gap-2 px-3 py-2 text-gray-700 hover:bg-gray-50 transition-colors duration-200"
                                                    onClick={() => {
                                                        downloadExcel();
                                                        setShowDownloadOptions(false);
                                                    }}
                                                >
                                                    <FileSpreadsheet className="w-4 h-4 text-blue-600" />
                                                    <span className="text-sm font-medium">Download as Excel</span>
                                                </button>
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>

                            {/* Switch Product Button */}
                            <div className="relative" ref={dropdownRef}>
                                <button
                                    className="flex items-center justify-between gap-3 px-4 py-2 bg-white border border-gray-300 rounded-xl hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-200 shadow-sm hover:shadow text-sm font-medium text-gray-700 min-w-[160px]"
                                    onClick={() => setOpenSelector(!openSelector)}
                                >
                                    <span>Switch Product</span>
                                    <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${openSelector ? 'rotate-180' : ''}`} />
                                </button>
                                <AnimatePresence>
                                    {openSelector && (
                                        <motion.div
                                            initial={{ opacity: 0, y: -10, scale: 0.95 }}
                                            animate={{ opacity: 1, y: 0, scale: 1 }}
                                            exit={{ opacity: 0, y: -10, scale: 0.95 }}
                                            transition={{ duration: 0.2 }}
                                            className="absolute top-full right-0 mt-2 w-96 max-h-80 overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-xl z-50"
                                        >
                                            <div className="py-2">
                                                {info.productWiseError.map((item, index) => (
                                                    <button
                                                        key={index}
                                                        className="w-full px-4 py-3 text-left text-sm hover:bg-blue-50 transition-all duration-150 text-gray-700 hover:text-blue-600 border-b border-gray-100 last:border-b-0"
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
                                                        <div className="font-mono text-xs text-blue-600 mb-1">{item.asin}</div>
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
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    {[
                        { label: 'Units Sold', value: updatedProduct.quantity, icon: BarChart3, color: 'blue' },
                        { label: 'Revenue', value: `$${(updatedProduct.sales || 0).toFixed(2)}`, icon: TrendingUp, color: 'green' },
                        { label: 'Analysis Period', value: `${info?.startDate} - ${info?.endDate}`, icon: Calendar, color: 'purple' },
                    ].map((metric, idx) => {
                        const Icon = metric.icon;
                        const colorMap = {
                            blue: 'from-blue-500 to-blue-600',
                            green: 'from-green-500 to-green-600',
                            purple: 'from-purple-500 to-purple-600'
                        };
                        
                        return (
                            <motion.div
                                key={idx}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.5, delay: 0.1 + idx * 0.1 }}
                                className="bg-white rounded-xl p-6 border border-gray-200/80 hover:border-gray-300 transition-all duration-300 hover:shadow-lg"
                            >
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-gray-600 mb-1">{metric.label}</p>
                                        <p className="text-2xl font-bold text-gray-900">{metric.value}</p>
                                    </div>
                                    <div className={`w-12 h-12 bg-gradient-to-br ${colorMap[metric.color]} rounded-lg flex items-center justify-center shadow-lg`}>
                                        <Icon className="w-6 h-6 text-white" />
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
                    className="mb-8"
                >
                    <div className="bg-white rounded-2xl shadow-lg border-0 overflow-hidden hover:shadow-xl transition-all duration-300">
                        <div className="bg-gradient-to-r from-red-50 via-red-50 to-orange-50 px-6 py-4 border-b border-red-100">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-gradient-to-br from-red-500 to-red-600 rounded-xl flex items-center justify-center shadow-md">
                                    <TrendingUp className="w-5 h-5 text-white" />
                                </div>
                                <div>
                                    <h2 className="text-xl font-bold text-gray-900">Ranking Issues</h2>
                                    <p className="text-sm text-gray-600">Optimization opportunities for better search rankings</p>
                                </div>
                            </div>
                        </div>
                        <div className="p-6 space-y-6">
                        {(updatedProduct.rankingErrors.data.TitleResult.charLim?.status === "Error" || updatedProduct.rankingErrors.data.TitleResult.RestictedWords.status === "Error" || updatedProduct.rankingErrors.data.TitleResult.checkSpecialCharacters.status === "Error") && (<div>
                            <p className="font-semibold">Titles</p>
                            <ul className=" ml-5 text-sm text-gray-600 space-y-1 mt-2">
                                {
                                    updatedProduct.rankingErrors.data.TitleResult.charLim?.status === "Error" && (
                                        <li className='mb-4'>
                                            <div className='flex justify-between items-center '>
                                                <p className='w-[40vw]'><b>Character Limit: </b>{updatedProduct.rankingErrors.data.TitleResult.charLim?.Message}</p>
                                                <button className="px-3 py-2 bg-white border rounded-md shadow-sm flex items-center justify-center gap-2" onClick={() => openCloseSol("charLim", "Title")}>
                                                    How to solve
                                                    <img src={DropDown} className='w-[7px] h-[7px]' />
                                                </button>
                                            </div>
                                            <div className=' bg-gray-200 mt-2 flex justify-center items-center' style={TitleSolution === "charLim"
                                                ? { opacity: 1, maxHeight: "200px", minHeight: "80px", display: "flex",padding:"2rem" }
                                                : { opacity: 0, maxHeight: "0px", minHeight: "0px", overflow: "hidden", display: "flex" }
                                            }>{updatedProduct.rankingErrors.data.TitleResult.charLim?.HowTOSolve}</div>
                                        </li>
                                    )
                                }
                                {
                                    product.rankingErrors.data.TitleResult.RestictedWords?.status === "Error" && (
                                        <li className='mb-4'>
                                            <div className='flex justify-between items-center '>
                                                <p className='w-[40vw]'><b>Restricted Words: </b>{product.rankingErrors.data.TitleResult.RestictedWords?.Message}</p>
                                                <button className="px-3 py-2 bg-white border rounded-md shadow-sm flex items-center justify-center gap-2" onClick={() => openCloseSol("RestrictedWords", "Title")}>
                                                    How to solve
                                                    <img src={DropDown} className='w-[7px] h-[7px]' />
                                                </button>
                                            </div>
                                            <div
                                                className='bg-gray-200 mt-2 justify-center items-center transition-all duration-700 ease-in-out'
                                                style={TitleSolution === "RestrictedWords"
                                                    ? { opacity: 1, maxHeight: "200px", minHeight: "80px", display: "flex",padding:"2rem" }
                                                    : { opacity: 0, maxHeight: "0px", minHeight: "0px", overflow: "hidden", display: "flex" }
                                                }
                                            >
                                                {product.rankingErrors.data.TitleResult.RestictedWords?.HowTOSolve}
                                            </div>

                                        </li>
                                    )
                                }
                                {
                                    product.rankingErrors.data.TitleResult.checkSpecialCharacters?.status === "Error" && (
                                        <li className='mb-4'>
                                            <div className='flex justify-between items-center'>
                                                <p className='w-[40vw]'><b>Special Characters: </b>{product.rankingErrors.data.TitleResult.checkSpecialCharacters?.Message}</p>
                                                <button className="px-3 py-2 bg-white border rounded-md shadow-sm flex items-center justify-center gap-2" onClick={() => openCloseSol("checkSpecialCharacters", "Title")}>
                                                    How to solve
                                                    <img src={DropDown} className='w-[7px] h-[7px]' />
                                                </button>
                                            </div>
                                            <div className=' bg-gray-200 mt-2 flex justify-center items-center  transition-all duration-700 ease-in-out' style={TitleSolution === "checkSpecialCharacters" ? { opacity: 1, maxHeight: "200px", minHeight: "80px", display: "flex",padding:"2rem" } : { opacity: 0, maxHeight: "0px", minHeight: "0px", overflow: "hidden", display: "flex" }}>{product.rankingErrors.data.TitleResult.checkSpecialCharacters?.HowTOSolve}</div>
                                        </li>
                                    )
                                }
                            </ul>

                        </div>)}

                        {(product.rankingErrors.data.BulletPoints.charLim?.status === "Error" || product.rankingErrors.data.BulletPoints.RestictedWords?.status === "Error" || product.rankingErrors.data.BulletPoints.checkSpecialCharacters?.status === "Error") && (<div >
                            <p className="font-semibold">Bullet Points</p>
                            <ul className=" ml-5 text-sm text-gray-600 space-y-1 mt-2">
                                {
                                    product.rankingErrors.data.BulletPoints.charLim?.status === "Error" && (
                                        <li className='mb-4'>
                                            <div className='flex justify-between items-center mb-4'>
                                                <p className='w-[40vw]'><b>Character Limit: </b>{product.rankingErrors.data.BulletPoints.charLim?.Message}</p>
                                                <button className="px-3 py-2 bg-white border rounded-md shadow-sm flex items-center justify-center gap-2" onClick={() => openCloseSol("charLim", "BulletPoints")}>
                                                    How to solve
                                                    <img src={DropDown} className='w-[7px] h-[7px]' />
                                                </button>
                                            </div>
                                            <div className=' bg-gray-200 mt-2 flex justify-center items-center transition-all duration-700 ease-in-out' style={BulletSoltion === "charLim" ? { opacity: 1, maxHeight: "200px", minHeight: "80px", display: "flex",padding:"2rem" } : { opacity: 0, maxHeight: "0px", minHeight: "0px", overflow: "hidden", display: "flex" }}>{product.rankingErrors.data.BulletPoints.charLim?.HowTOSolve}</div>
                                        </li>
                                    )
                                }
                                {
                                    product.rankingErrors.data.BulletPoints.RestictedWords?.status === "Error" && (
                                        <li className='mb-4' >
                                            <div className='flex justify-between items-center '>
                                                <p className='w-[40vw]'><b>Restricted Words: </b>{product.rankingErrors.data.BulletPoints.RestictedWords?.Message}</p>
                                                <button className="px-3 py-2 bg-white border rounded-md shadow-sm flex items-center justify-center gap-2" onClick={() => openCloseSol("RestictedWords", "BulletPoints")}>
                                                    How to solve
                                                    <img src={DropDown} className='w-[7px] h-[7px]' />
                                                </button>
                                            </div>
                                            <div className=' bg-gray-200 mt-2 flex justify-center items-center transition-all duration-700 ease-in-out' style={BulletSoltion === "RestictedWords" ? { opacity: 1, maxHeight: "200px", minHeight: "80px", display: "flex",padding:"2rem" } : { opacity: 0, maxHeight: "0px", minHeight: "0px", overflow: "hidden", display: "flex" }}>{product.rankingErrors.data.BulletPoints.RestictedWords?.HowTOSolve}</div>
                                        </li>
                                    )
                                }
                                {
                                    product.rankingErrors.data.BulletPoints.checkSpecialCharacters?.status === "Error" && (
                                        <li className='mb-4'>
                                            <div className='flex justify-between items-center'>
                                                <p className='w-[40vw]'><b>Special Characters: </b>{product.rankingErrors.data.BulletPoints.checkSpecialCharacters?.Message}</p>
                                                <button className="px-3 py-2 bg-white border rounded-md shadow-sm flex items-center justify-center gap-2" onClick={() => openCloseSol("checkSpecialCharacters", "BulletPoints")}>
                                                    How to solve
                                                    <img src={DropDown} className='w-[7px] h-[7px]' />
                                                </button>
                                            </div>
                                            <div className=' bg-gray-200 mt-2 flex justify-center items-center transition-all duration-700 ease-in-out' style={BulletSoltion === "checkSpecialCharacters" ? { opacity: 1, maxHeight: "200px", minHeight: "80px", display: "flex",padding:"2rem" } : { opacity: 0, maxHeight: "0px", minHeight: "0px", overflow: "hidden", display: "flex" }}>{product.rankingErrors.data.BulletPoints.checkSpecialCharacters?.HowTOSolve}</div>
                                        </li>
                                    )
                                }
                            </ul>
                        </div>)}

                        {(product.rankingErrors.data.Description.charLim?.status === "Error" || product.rankingErrors.data.Description.RestictedWords?.status === "Error" || product.rankingErrors.data.Description.checkSpecialCharacters?.status === "Error") && (<div >
                            <p className="font-semibold">Description</p>
                            <ul className=" ml-5 text-sm text-gray-600 space-y-1 mt-2">
                                {
                                    product.rankingErrors.data.Description.charLim?.status === "Error" && (
                                        <li className='mb-4'>
                                            <div className='flex justify-between items-center'>
                                                <p className='w-[40vw]'><b>Character Limit: </b>{product.rankingErrors.data.Description.charLim?.Message}</p>
                                                <button className="px-3 py-2 bg-white border rounded-md shadow-sm flex items-center justify-center gap-2" onClick={() => openCloseSol("charLim", "Description")}>
                                                    How to solve
                                                    <img src={DropDown} className='w-[7px] h-[7px]' />
                                                </button>
                                            </div>
                                            <div className=' bg-gray-200 mt-2 flex items-center justify-center transition-all duration-700 ease-in-out' style={DescriptionSolution === "charLim" ? { opacity: 1, maxHeight: "200px", minHeight: "80px", display: "flex",padding:"2rem" } : { opacity: 0, maxHeight: "0px", minHeight: "0px", overflow: "hidden", display: "flex" }}><p className='w-[80%]'>{product.rankingErrors.data.Description.charLim?.HowTOSolve}</p></div>
                                        </li>
                                    )
                                }
                                {
                                    product.rankingErrors.data.Description.RestictedWords?.status === "Error" && (
                                        <li className='mb-4'>
                                            <div className='flex justify-between items-center'>
                                                <p className='w-[40vw]'><b>Restricted Words: </b>{product.rankingErrors.data.Description.RestictedWords?.Message}</p>
                                                <button className="px-3 py-2 bg-white border rounded-md shadow-sm flex items-center justify-center gap-2 " onClick={() => openCloseSol("RestictedWords", "Description")}>
                                                    How to solve
                                                    <img src={DropDown} className='w-[7px] h-[7px]' />
                                                </button>
                                            </div>
                                            <div className=' bg-gray-200 mt-2 flex items-center justify-center transition-all duration-700 ease-in-out' style={DescriptionSolution === "RestictedWords" ? { opacity: 1, maxHeight: "200px", minHeight: "80px", display: "flex",padding:"2rem" } : { opacity: 0, maxHeight: "0px", minHeight: "0px", overflow: "hidden", display: "flex" }}><p className='w-[80%]'>{product.rankingErrors.data.Description.RestictedWords?.HowTOSolve}</p></div>
                                        </li>
                                    )
                                }
                                {
                                    product.rankingErrors.data.Description.checkSpecialCharacters?.status === "Error" && (
                                        <li className='mb-4'>
                                            <div className='flex justify-between items-center'>
                                                <p className='w-[40vw]'><b>Special Characters: </b>{product.rankingErrors.data.Description.checkSpecialCharacters?.Message}</p>
                                                <button className="px-3 py-2 bg-white border rounded-md shadow-sm flex items-center justify-center gap-2" onClick={() => openCloseSol("checkSpecialCharacters", "Description")}>
                                                    How to solve
                                                    <img src={DropDown} className='w-[7px] h-[7px]' />
                                                </button>
                                            </div>
                                            <div className=' bg-gray-200 mt-2 flex items-center justify-center transition-all duration-700 ease-in-out' style={DescriptionSolution === "checkSpecialCharacters" ? { opacity: 1, maxHeight: "200px", minHeight: "80px", display: "flex",padding:"2rem" } : { opacity: 0, maxHeight: "0px", minHeight: "0px", overflow: "hidden", display: "flex" }}><p className='w-[80%]'>{product.rankingErrors.data.Description.checkSpecialCharacters?.HowTOSolve}</p></div>
                                        </li>
                                    )
                                }

                            </ul>
                        </div>)}

                        {(product.rankingErrors.data.charLim?.status === "Error") && (<div>
                            <p className="font-semibold">Backend Keywords</p>
                            <ul className=" ml-5 text-sm text-gray-600 space-y-1 mt-2">
                                {
                                    product.rankingErrors.data.charLim?.status === "Error" && (
                                        <li className='mb-4'>
                                            <div className='flex justify-between items-center'>
                                                <p className='w-[40vw]'><b>Character Limit: </b>{product.rankingErrors.data.charLim?.Message}</p>
                                                <button className="px-3 py-2 bg-white border rounded-md shadow-sm flex items-center justify-center gap-2" onClick={() => openCloseSol("charLim", "BackendKeyWords")}>
                                                    How to solve
                                                    <img src={DropDown} className='w-[7px] h-[7px]' />
                                                </button>
                                            </div>
                                            <div className=' bg-gray-200 mt-2 flex items-center justify-center transition-all duration-700 ease-in-out' style={BackendKeyWords === "charLim" ? { opacity: 1, maxHeight: "200px", minHeight: "80px", display: "flex",padding:"2rem" } : { opacity: 0, maxHeight: "0px", minHeight: "0px", overflow: "hidden", display: "flex" }}><p className='w-[80%]'>{product.rankingErrors.data.charLim?.HowTOSolve}</p></div>
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
                        className="mb-8"
                    >
                        <div className="bg-white rounded-2xl shadow-lg border-0 overflow-hidden hover:shadow-xl transition-all duration-300">
                            <div className="bg-gradient-to-r from-blue-50 via-blue-50 to-indigo-50 px-6 py-4 border-b border-blue-100">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center shadow-md">
                                        <BarChart3 className="w-5 h-5 text-white" />
                                    </div>
                                    <div>
                                        <h2 className="text-xl font-bold text-gray-900">Conversion Issues</h2>
                                        <p className="text-sm text-gray-600">Enhance product appeal and customer conversion rates</p>
                                    </div>
                                </div>
                            </div>
                            <div className="p-6">
                            <ul className="ml-5 text-sm text-gray-600 space-y-1 mt-2 flex flex-col gap-4">
                                {product.conversionErrors.imageResultErrorData?.status === "Error" && (
                                    <IssueItem
                                        label="Images Issue"
                                        message={product.conversionErrors.imageResultErrorData.Message}
                                        solutionKey="Image"
                                        solutionContent={product.conversionErrors.imageResultErrorData.HowToSolve}
                                        stateValue={imageSolution}
                                        toggleFunc={(val) => openCloseSolutionConversion(val, "Image")}
                                    />
                                )}
                                {product.conversionErrors.videoResultErrorData?.status === "Error" && (
                                    <IssueItem
                                        label="Video Issue"
                                        message={product.conversionErrors.videoResultErrorData.Message}
                                        solutionKey="Video"
                                        solutionContent={product.conversionErrors.videoResultErrorData.HowToSolve}
                                        stateValue={videoSolution}
                                        toggleFunc={(val) => openCloseSolutionConversion(val, "Video")}
                                    />
                                )}
                                {product.conversionErrors.productReviewResultErrorData?.status === "Error" && (
                                    <IssueItem
                                        label="Product Review Issue"
                                        message={product.conversionErrors.productReviewResultErrorData.Message}
                                        solutionKey="ProductReview"
                                        solutionContent={product.conversionErrors.productReviewResultErrorData.HowToSolve}
                                        stateValue={productReviewSolution}
                                        toggleFunc={(val) => openCloseSolutionConversion(val, "ProductReview")}
                                    />
                                )}
                                {product.conversionErrors.productStarRatingResultErrorData?.status === "Error" && (
                                    <IssueItem
                                        label="Star Rating Issue"
                                        message={product.conversionErrors.productStarRatingResultErrorData.Message}
                                        solutionKey="ProductStarRating"
                                        solutionContent={product.conversionErrors.productStarRatingResultErrorData.HowToSolve}
                                        stateValue={productStarRatingSolution}
                                        toggleFunc={(val) => openCloseSolutionConversion(val, "ProductStarRating")}
                                    />
                                )}
                                {product.conversionErrors.productsWithOutBuyboxErrorData?.status === "Error" && (
                                    <IssueItem
                                        label="Product without Buy Box"
                                        message={product.conversionErrors.productsWithOutBuyboxErrorData.Message}
                                        solutionKey="ProductsWithOutBuybox"
                                        solutionContent={product.conversionErrors.productsWithOutBuyboxErrorData.HowToSolve}
                                        stateValue={productsWithOutBuyboxSolution}
                                        toggleFunc={(val) => openCloseSolutionConversion(val, "ProductsWithOutBuybox")}
                                    />
                                )}
                                {product.conversionErrors.aplusErrorData?.status === "Error" && (
                                    <IssueItem
                                        label="Aplus Issue"
                                        message={product.conversionErrors.aplusErrorData.Message}
                                        solutionKey="Aplus"
                                        solutionContent={product.conversionErrors.aplusErrorData.HowToSolve}
                                        stateValue={aplusSolution}
                                        toggleFunc={(val) => openCloseSolutionConversion(val, "Aplus")}
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
                        className="mb-8"
                    >
                        <div className="bg-white rounded-2xl shadow-lg border-0 overflow-hidden hover:shadow-xl transition-all duration-300">
                            <div className="bg-gradient-to-r from-green-50 via-green-50 to-emerald-50 px-6 py-4 border-b border-green-100">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-green-600 rounded-xl flex items-center justify-center shadow-md">
                                        <Package className="w-5 h-5 text-white" />
                                    </div>
                                    <div>
                                        <h2 className="text-xl font-bold text-gray-900">Inventory Issues</h2>
                                        <p className="text-sm text-gray-600">Manage inventory levels and warehouse operations</p>
                                    </div>
                                </div>
                            </div>
                            <div className="p-6">
                            <ul className="ml-5 text-sm text-gray-600 space-y-1 mt-2 flex flex-col gap-4">
                                {/* Inventory Planning Issues */}
                                {product.inventoryErrors?.inventoryPlanningErrorData && (
                                    <>
                                        {product.inventoryErrors.inventoryPlanningErrorData.longTermStorageFees?.status === "Error" && (
                                            <IssueItem
                                                label="Long-Term Storage Fees"
                                                message={product.inventoryErrors.inventoryPlanningErrorData.longTermStorageFees.Message}
                                                solutionKey="LongTermStorage"
                                                solutionContent={product.inventoryErrors.inventoryPlanningErrorData.longTermStorageFees.HowToSolve}
                                                stateValue={inventoryPlanningSolution}
                                                toggleFunc={(val) => openCloseSolutionInventory(val, "InventoryPlanning")}
                                            />
                                        )}
                                        {product.inventoryErrors.inventoryPlanningErrorData.unfulfillable?.status === "Error" && (
                                            <IssueItem
                                                label="Unfulfillable Inventory"
                                                message={product.inventoryErrors.inventoryPlanningErrorData.unfulfillable.Message}
                                                solutionKey="Unfulfillable"
                                                solutionContent={product.inventoryErrors.inventoryPlanningErrorData.unfulfillable.HowToSolve}
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
                                        message={product.inventoryErrors.strandedInventoryErrorData.Message}
                                        solutionKey="StrandedInventory"
                                        solutionContent={product.inventoryErrors.strandedInventoryErrorData.HowToSolve}
                                        stateValue={strandedInventorySolution}
                                        toggleFunc={(val) => openCloseSolutionInventory(val, "StrandedInventory")}
                                    />
                                )}

                                {/* Inbound Non-Compliance Issues */}
                                {product.inventoryErrors?.inboundNonComplianceErrorData && (
                                    <IssueItem
                                        label="Inbound Non-Compliance"
                                        message={product.inventoryErrors.inboundNonComplianceErrorData.Message}
                                        solutionKey="InboundNonCompliance"
                                        solutionContent={product.inventoryErrors.inboundNonComplianceErrorData.HowToSolve}
                                        stateValue={inboundNonComplianceSolution}
                                        toggleFunc={(val) => openCloseSolutionInventory(val, "InboundNonCompliance")}
                                    />
                                )}

                                {/* Replenishment/Restock Issues */}
                                {product.inventoryErrors?.replenishmentErrorData && (
                                    <IssueItem
                                        label="Low Inventory Risk"
                                        message={product.inventoryErrors.replenishmentErrorData.Message}
                                        solutionKey="Replenishment"
                                        solutionContent={product.inventoryErrors.replenishmentErrorData.HowToSolve}
                                        stateValue={replenishmentSolution}
                                        toggleFunc={(val) => openCloseSolutionInventory(val, "Replenishment")}
                                    />
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
                    <div className="bg-white rounded-lg p-6 flex flex-col items-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
                        <p className="text-gray-700">Generating PDF...</p>
                        <p className="text-sm text-gray-500 mt-2">Please wait, this may take a moment</p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Dashboard;
