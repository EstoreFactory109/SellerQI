import React, { useState, useEffect, useRef } from 'react';
import { useSelector } from "react-redux";
import { useParams } from 'react-router-dom';
import DropDown from '../assets/Icons/drop-down.png';
import noImage from '../assets/Icons/no-image.png';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from "framer-motion";
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { LazyLoadImage } from 'react-lazy-load-image-component';
import 'react-lazy-load-image-component/src/effects/blur.css';
import './IssuesByProduct.css';

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
    
    // Debug: Log when component renders with new ASIN
    useEffect(() => {
        console.log('Component rendered with ASIN:', asin);
        console.log('Product found:', !!product);
    }, [asin, product]);

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
        setOpenSelector(false);
        setShowDownloadOptions(false);
        
        // Scroll to top when product changes
        if (contentRef.current) {
            contentRef.current.scrollTop = 0;
        }
        window.scrollTo(0, 0);
    }, [asin]);

    if (!product) {
        return <div className="p-6">No product data found for ASIN: {asin}</div>;
    }

    const hasAnyConversionError = [
        product.conversionErrors.imageResultErrorData?.status,
        product.conversionErrors.videoResultErrorData?.status,
        product.conversionErrors.productReviewResultErrorData?.status,
        product.conversionErrors.productStarRatingResultErrorData?.status,
        product.conversionErrors.productsWithOutBuyboxErrorData?.status,
        product.conversionErrors.aplusErrorData?.status
    ].includes("Error");

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
            Message: product.asin,
            Solution: ''
        });
        exportData.push({
            Category: 'Product Information',
            Type: 'SKU',
            Issue: '',
            Message: product.sku,
            Solution: ''
        });
        exportData.push({
            Category: 'Product Information',
            Type: 'Product Name',
            Issue: '',
            Message: product.name,
            Solution: ''
        });
        exportData.push({
            Category: 'Product Information',
            Type: 'List Price',
            Issue: '',
            Message: `$${product.price || 0}`,
            Solution: ''
        });
        exportData.push({
            Category: 'Product Information',
            Type: 'Units Sold',
            Issue: '',
            Message: String(product.quantity || 0),
            Solution: ''
        });
        exportData.push({
            Category: 'Product Information',
            Type: 'Sales',
            Issue: '',
            Message: `$${product.sales || 0}`,
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
        if (product.rankingErrors.data.TitleResult.charLim?.status === "Error") {
            exportData.push({
                Category: 'Ranking Issues',
                Type: 'Title',
                Issue: 'Character Limit',
                Message: product.rankingErrors.data.TitleResult.charLim.Message,
                Solution: product.rankingErrors.data.TitleResult.charLim.HowTOSolve
            });
        }
        if (product.rankingErrors.data.TitleResult.RestictedWords?.status === "Error") {
            exportData.push({
                Category: 'Ranking Issues',
                Type: 'Title',
                Issue: 'Restricted Words',
                Message: product.rankingErrors.data.TitleResult.RestictedWords.Message,
                Solution: product.rankingErrors.data.TitleResult.RestictedWords.HowTOSolve
            });
        }
        if (product.rankingErrors.data.TitleResult.checkSpecialCharacters?.status === "Error") {
            exportData.push({
                Category: 'Ranking Issues',
                Type: 'Title',
                Issue: 'Special Characters',
                Message: product.rankingErrors.data.TitleResult.checkSpecialCharacters.Message,
                Solution: product.rankingErrors.data.TitleResult.checkSpecialCharacters.HowTOSolve
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

        return exportData;
    };

    // Download as Excel
    const downloadExcel = () => {
        const data = prepareExportData();
        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Product Issues');
        
        // Auto-size columns
        const maxWidth = 50;
        const wscols = [
            { wch: 20 }, // Category
            { wch: 20 }, // Type
            { wch: 20 }, // Issue
            { wch: maxWidth }, // Message
            { wch: maxWidth }  // Solution
        ];
        ws['!cols'] = wscols;
        
        // Generate filename with ASIN and date
        const fileName = `Product_Issues_${product.asin}_${new Date().toISOString().split('T')[0]}.xlsx`;
        XLSX.writeFile(wb, fileName);
    };

    // Download as CSV
    const downloadCSV = () => {
        const data = prepareExportData();
        const ws = XLSX.utils.json_to_sheet(data);
        const csv = XLSX.utils.sheet_to_csv(ws);
        
        // Generate filename with ASIN and date
        const fileName = `Product_Issues_${product.asin}_${new Date().toISOString().split('T')[0]}.csv`;
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

    // Download as PDF
    const downloadPDF = async () => {
        try {
            // Close all dropdowns first
            setShowDownloadOptions(false);
            setOpenSelector(false);
            
            // Wait for animations to complete
            await new Promise(resolve => setTimeout(resolve, 300));
            
            // Now start the PDF generation
            setIsGeneratingPDF(true);
            
            const element = contentRef.current;
            
            // Clone the element to avoid modifying the original
            const clonedElement = element.cloneNode(true);
            
            // Hide the download button and switch product option in the cloned element
            const buttonsContainer = clonedElement.querySelector('.flex.items-center.gap-2.relative.w-fit');
            if (buttonsContainer) {
                buttonsContainer.style.display = 'none';
            }
            
            // Hide all "How to solve" buttons and expand all solutions
            const howToSolveButtons = clonedElement.querySelectorAll('button');
            howToSolveButtons.forEach(button => {
                if (button.textContent.includes('How to solve')) {
                    button.style.display = 'none';
                }
            });
            
            // Expand all solution divs
            const solutionDivs = clonedElement.querySelectorAll('.bg-gray-200');
            solutionDivs.forEach(div => {
                div.style.opacity = '1';
                div.style.maxHeight = 'none';
                div.style.minHeight = '80px';
                div.style.display = 'flex';
                div.style.padding = '2rem';
                div.style.overflow = 'visible';
                div.style.height = 'auto';
            });
            
            // Create a temporary container
            const tempContainer = document.createElement('div');
            tempContainer.style.position = 'absolute';
            tempContainer.style.left = '-9999px';
            tempContainer.style.top = '0';
            tempContainer.style.width = '1200px';
            tempContainer.style.backgroundColor = '#f3f4f6';
            tempContainer.style.padding = '24px'; // Add padding to match original
            
            // Apply styles to cloned element
            clonedElement.style.maxHeight = 'none';
            clonedElement.style.overflow = 'visible';
            clonedElement.style.height = 'auto';
            clonedElement.style.marginBottom = '50px'; // Add margin to ensure bottom content is captured
            
            // Append to body temporarily
            document.body.appendChild(tempContainer);
            tempContainer.appendChild(clonedElement);
            
            // Force layout recalculation
            tempContainer.offsetHeight;
            
            // Wait for images to load
            const images = clonedElement.getElementsByTagName('img');
            const imagePromises = Array.from(images).map(img => {
                if (img.complete) return Promise.resolve();
                return new Promise(resolve => {
                    img.onload = resolve;
                    img.onerror = resolve;
                });
            });
            await Promise.all(imagePromises);
            
            // Wait a bit more for any dynamic content
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Capture the cloned element with extra height
            const canvas = await html2canvas(tempContainer, {
                scale: 2,
                useCORS: true,
                logging: false,
                backgroundColor: '#f3f4f6',
                width: 1200,
                height: tempContainer.scrollHeight + 100, // Add extra height
                windowWidth: 1200,
                windowHeight: tempContainer.scrollHeight + 100
            });
            
            // Remove temporary container
            document.body.removeChild(tempContainer);

            // Calculate PDF dimensions to match webpage width
            const pageWidthInPx = 1200;
            const pageWidthInMm = 297; // Use A4 landscape width for better match
            const scaleFactor = pageWidthInMm / pageWidthInPx;
            
            const imgWidth = pageWidthInMm;
            const imgHeight = (canvas.height * scaleFactor);
            
            // Create PDF with custom page size
            const pdf = new jsPDF({
                orientation: imgHeight > imgWidth ? 'portrait' : 'landscape',
                unit: 'mm',
                format: [imgWidth, imgHeight] // Custom page size to match content
            });
            
            // Add image to PDF
            const imgData = canvas.toDataURL('image/png');
            pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight);
            
            // If content is too long for single page, use standard A4 pages
            if (imgHeight > 420) { // Max reasonable height for a single page
                // Recreate PDF with standard A4 pages
                const standardPdf = new jsPDF('p', 'mm', 'a4');
                const a4Width = 210;
                const a4Height = 297;
                const contentHeight = (canvas.height * a4Width) / canvas.width;
                let heightLeft = contentHeight;
                let position = 0;
                
                // Add first page
                standardPdf.addImage(imgData, 'PNG', 0, position, a4Width, contentHeight);
                heightLeft -= a4Height;
                
                // Add additional pages if needed
                while (heightLeft >= 0) {
                    position = heightLeft - contentHeight;
                    standardPdf.addPage();
                    standardPdf.addImage(imgData, 'PNG', 0, position, a4Width, contentHeight);
                    heightLeft -= a4Height;
                }
                
                // Save the standard PDF
                const fileName = `Product_Issues_${product.asin}_${new Date().toISOString().split('T')[0]}.pdf`;
                standardPdf.save(fileName);
            } else {
                // Save the custom-sized PDF
                const fileName = `Product_Issues_${product.asin}_${new Date().toISOString().split('T')[0]}.pdf`;
                pdf.save(fileName);
            }

        } catch (error) {
            console.error('Error generating PDF:', error);
            alert('Error generating PDF. Please try again.');
        } finally {
            setIsGeneratingPDF(false);
        }
    };

    return (
        <>
            <div className="p-6 bg-gray-100 max-h-[90vh] overflow-y-auto text-gray-800 lg:mt-0 mt-[10vh]" ref={contentRef}>
                {/* Header */}
                <div className="bg-white p-6 rounded-xl shadow mb-6 flex flex-col md:flex-row md:items-center md:justify-between">
                    <div className="flex items-center space-x-4">
                        <LazyLoadImage
                            src={product.MainImage || noImage}
                            alt="Product"
                            className="w-20 h-20 rounded-md object-cover"
                            effect="blur"
                            placeholderSrc={noImage}
                            threshold={100}
                            wrapperClassName="w-20 h-20 rounded-md mr-4 product-image-wrapper"
                        />
                        <div>
                            <h2 className="text-xl font-semibold mb-4">{product.name} ...</h2>
                            <p className="text-sm">ASIN: {product.asin}</p>
                            <p className="text-sm">SKU: {product.sku}</p>
                            <p className="text-sm">List Price: ${product.price}</p>
                        </div>
                    </div>
                    <div className='flex items-center gap-2 relative w-fit'>
                        <div className="relative" ref={downloadRef}>
                            <button 
                                className="text-sm text-white bg-[#333651] rounded px-3 py-1 flex items-center gap-2"
                                onClick={() => setShowDownloadOptions(!showDownloadOptions)}
                            >
                                Download Report
                                <img src={DropDown} className="w-[7px] h-[7px] invert" />
                            </button>
                            <AnimatePresence>
                                {showDownloadOptions && (
                                    <motion.div
                                        initial={{ opacity: 0, scaleY: 0 }}
                                        animate={{ opacity: 1, scaleY: 1 }}
                                        exit={{ opacity: 0, scaleY: 0 }}
                                        transition={{ duration: 0.2, ease: "easeInOut" }}
                                        style={{ transformOrigin: "top" }}
                                        className="absolute left-0 top-10 bg-white border border-gray-300 rounded-md shadow-lg z-50 overflow-hidden"
                                    >
                                        <button
                                            className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 transition-colors"
                                            onClick={() => {
                                                downloadExcel();
                                                setShowDownloadOptions(false);
                                            }}
                                        >
                                            Download as Excel (.xlsx)
                                        </button>
                                        <button
                                            className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 transition-colors border-t border-gray-200"
                                            onClick={() => {
                                                downloadCSV();
                                                setShowDownloadOptions(false);
                                            }}
                                        >
                                            Download as CSV (.csv)
                                        </button>
                                        <button
                                            className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 transition-colors border-t border-gray-200"
                                            onClick={() => {
                                                setShowDownloadOptions(false);
                                                downloadPDF();
                                            }}
                                        >
                                            Download as PDF (.pdf)
                                        </button>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                        <div className="w-[9rem] bg-white flex justify-center items-center px-2 py-1 border-[1px] border-gray-300 rounded-md text-sm text-gray-400 gap-3 cursor-pointer" onClick={() => setOpenSelector(!openSelector)} ref={dropdownRef}><p>Switch Product</p><img src={DropDown} /></div>
                        <AnimatePresence mode="wait">
                            {openSelector && (
                                <motion.ul
                                    initial={{ opacity: 0, scaleY: 0 }}
                                    animate={{ opacity: 1, scaleY: 1 }}
                                    exit={{ opacity: 0, scaleY: 0 }}
                                    transition={{ duration: 0.3, ease: "easeInOut" }}
                                    style={{ transformOrigin: "top", pointerEvents: openSelector ? 'auto' : 'none' }}
                                    className="w-[30rem] h-[30rem] overflow-x-hidden overflow-y-auto z-[99] bg-white absolute right-0 top-12 py-2 px-2 border-[1px] border-gray-300 shadow-md origin-top"
                                >
                                    {info.productWiseError.map((item, index) => (
                                        <li
                                            key={index}
                                            className="flex justify-center items-center py-2 px-2 cursor-pointer hover:bg-[#333651] hover:text-white rounded-md text-sm"
                                            onMouseDown={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                
                                                if (item.asin === asin) {
                                                    setOpenSelector(false);
                                                    return;
                                                }
                                                
                                                // Navigate immediately
                                                navigate(`/seller-central-checker/issues/${item.asin}`);
                                                setOpenSelector(false);
                                            }}
                                        >
                                            {item.asin} | {item.name}...
                                        </li>
                                    ))}
                                </motion.ul>
                            )}
                        </AnimatePresence>
                    </div>
                </div>

                {/* Key Metrics */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    {[
                        { label: 'Unit Sold', value: product.quantity },
                        { label: 'Sales', value: `$${product.sales}` },
                        {label:'Duration', value:`${info?.startDate} - ${info?.endDate}`},
                    ].map((metric, idx) => (
                        <div key={idx} className="bg-white p-4 rounded-lg shadow">
                            <p className="text-sm text-gray-500">{metric.label}</p>
                            <p className="text-lg font-semibold">{metric.value}</p>
                        </div>
                    ))}
                </div>

                {/* Ranking Issues */}
                <div className="mb-4">
                    <div className="bg-[#333651] text-white px-4 py-2 rounded-t-md font-medium">RANKING ISSUES</div>
                    <div className="border border-t-0 rounded-b-md p-4 space-y-4">
                        {(product.rankingErrors.data.TitleResult.charLim?.status === "Error" || product.rankingErrors.data.TitleResult.RestictedWords.status === "Error" || product.rankingErrors.data.TitleResult.checkSpecialCharacters.status === "Error") && (<div>
                            <p className="font-semibold">Titles</p>
                            <ul className=" ml-5 text-sm text-gray-600 space-y-1 mt-2">
                                {
                                    product.rankingErrors.data.TitleResult.charLim?.status === "Error" && (
                                        <li className='mb-4'>
                                            <div className='flex justify-between items-center '>
                                                <p className='w-[40vw]'><b>Character Limit: </b>{product.rankingErrors.data.TitleResult.charLim?.Message}</p>
                                                <button className="px-3 py-2 bg-white border rounded-md shadow-sm flex items-center justify-center gap-2" onClick={() => openCloseSol("charLim", "Title")}>
                                                    How to solve
                                                    <img src={DropDown} className='w-[7px] h-[7px]' />
                                                </button>
                                            </div>
                                            <div className=' bg-gray-200 mt-2 flex justify-center items-center' style={TitleSolution === "charLim"
                                                ? { opacity: 1, maxHeight: "200px", minHeight: "80px", display: "flex",padding:"2rem" }
                                                : { opacity: 0, maxHeight: "0px", minHeight: "0px", overflow: "hidden", display: "flex" }
                                            }>{product.rankingErrors.data.TitleResult.charLim?.HowTOSolve}</div>
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


                {/* Conversion Issues */}
                {hasAnyConversionError && (
                    <div>
                        <div className="bg-[#333651] text-white px-4 py-2 rounded-t-md font-medium">
                            CONVERSION ISSUES
                        </div>
                        <div className="border border-t-0 rounded-b-md p-4">
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
                )}
                {/*Empty div*/}
                <div className='py-2w-full h-5'></div>
            </div>
            
            {/* Loading overlay for PDF generation */}
            {isGeneratingPDF && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100]">
                    <div className="bg-white rounded-lg p-6 flex flex-col items-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#333651] mb-4"></div>
                        <p className="text-gray-700">Generating PDF...</p>
                        <p className="text-sm text-gray-500 mt-2">Please wait, this may take a moment</p>
                    </div>
                </div>
            )}
        </>
    );
};

export default Dashboard;
