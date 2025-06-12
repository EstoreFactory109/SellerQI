import React, { useState, useRef, useEffect } from 'react';
import { AnimatePresence, motion } from "framer-motion";
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import Download from '../../assets/Icons/download.png';

const DownloadReport = ({ 
    data, 
    filename = 'report', 
    contentRef = null,
    buttonText = 'Download Report',
    buttonClass = 'flex items-center text-xs bg-[#333651] text-white gap-2 px-3 py-1 rounded-md',
    showIcon = true,
    prepareDataFunc = null
}) => {
    const [showDownloadOptions, setShowDownloadOptions] = useState(false);
    const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
    const downloadRef = useRef(null);

    useEffect(() => {
        function handleClickOutside(e) {
            if (downloadRef.current && !downloadRef.current.contains(e.target)) {
                setShowDownloadOptions(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        }
    }, []);

    // Prepare data for export
    const prepareExportData = () => {
        if (prepareDataFunc) {
            return prepareDataFunc();
        }
        return data || [];
    };

    // Download as Excel
    const downloadExcel = () => {
        const exportData = prepareExportData();
        const ws = XLSX.utils.json_to_sheet(exportData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Report');
        
        // Auto-size columns
        const maxWidth = 50;
        const cols = Object.keys(exportData[0] || {}).map(() => ({ wch: maxWidth }));
        ws['!cols'] = cols;
        
        const fileName = `${filename}_${new Date().toISOString().split('T')[0]}.xlsx`;
        XLSX.writeFile(wb, fileName);
    };

    // Download as CSV
    const downloadCSV = () => {
        const exportData = prepareExportData();
        const ws = XLSX.utils.json_to_sheet(exportData);
        const csv = XLSX.utils.sheet_to_csv(ws);
        
        const fileName = `${filename}_${new Date().toISOString().split('T')[0]}.csv`;
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        saveAs(blob, fileName);
    };

    // Download as PDF
    const downloadPDF = async () => {
        if (!contentRef || !contentRef.current) {
            alert('PDF generation requires a content reference');
            return;
        }

        try {
            console.log('Starting PDF generation...');
            setShowDownloadOptions(false);
            await new Promise(resolve => setTimeout(resolve, 300));
            setIsGeneratingPDF(true);
            
            const element = contentRef.current;
            console.log('Element to capture:', element);
            
            // Clone the element
            const clonedElement = element.cloneNode(true);
            
            try {
                // Hide download buttons in cloned element
                const downloadButtons = clonedElement.querySelectorAll('[data-download-button]');
                downloadButtons.forEach(button => {
                    button.style.display = 'none';
                });
            } catch (e) {
                console.error('Error hiding download buttons:', e);
            }
            
            try {
                // Hide calendar/date selector buttons only
                const calendarSelectors = clonedElement.querySelectorAll('.calendar-selector');
                calendarSelectors.forEach(selector => {
                    const parent = selector.closest('.relative');
                    if (parent) {
                        parent.style.display = 'none';
                    } else {
                        selector.style.display = 'none';
                    }
                });
                
                // Also hide any other date-related buttons
                const dateButtons = clonedElement.querySelectorAll('.border-gray-200');
                dateButtons.forEach(button => {
                    if (button.textContent && (button.textContent.includes('Last 30 Days') || button.textContent.includes('Days'))) {
                        const parent = button.closest('.relative');
                        if (parent) {
                            parent.style.display = 'none';
                        } else {
                            button.style.display = 'none';
                        }
                    }
                });
            } catch (e) {
                console.error('Error hiding calendar buttons:', e);
            }
            
            // Create temporary container
            const tempContainer = document.createElement('div');
            tempContainer.style.position = 'absolute';
            tempContainer.style.left = '-9999px';
            tempContainer.style.top = '0';
            tempContainer.style.width = element.offsetWidth + 'px';
            tempContainer.style.backgroundColor = window.getComputedStyle(element).backgroundColor || '#ffffff';
            
            // Preserve all styles from original element
            const originalStyles = window.getComputedStyle(element);
            clonedElement.style.cssText = element.style.cssText;
            clonedElement.style.height = 'auto';
            clonedElement.style.maxHeight = 'none';
            clonedElement.style.overflow = 'visible';
            
            // Make sure all content is visible
            const scrollableElements = clonedElement.querySelectorAll('[class*="overflow-y-auto"], [class*="overflow-auto"], [class*="h-["], [style*="overflow"]');
            scrollableElements.forEach(el => {
                if (el.style.height) {
                    el.style.height = 'auto';
                }
                if (el.style.maxHeight) {
                    el.style.maxHeight = 'none';
                }
                if (el.style.overflow) {
                    el.style.overflow = 'visible';
                }
                // Remove overflow classes
                const classes = Array.from(el.classList);
                classes.forEach(className => {
                    if (className.includes('overflow-') || className.includes('h-[') && className.includes('vh]')) {
                        el.classList.remove(className);
                    }
                });
            });
            
            document.body.appendChild(tempContainer);
            tempContainer.appendChild(clonedElement);
            
            // Wait for all images to load
            const images = clonedElement.getElementsByTagName('img');
            const imagePromises = Array.from(images).map(img => {
                if (img.complete) return Promise.resolve();
                return new Promise(resolve => {
                    img.onload = resolve;
                    img.onerror = resolve;
                    setTimeout(resolve, 3000); // Timeout after 3 seconds
                });
            });
            await Promise.all(imagePromises);
            
            // Wait for content to render
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            console.log('Starting html2canvas...');
            // Capture the element
            const canvas = await html2canvas(clonedElement, {
                scale: 2,
                useCORS: true,
                logging: false,
                backgroundColor: originalStyles.backgroundColor || '#ffffff',
                width: clonedElement.scrollWidth,
                height: clonedElement.scrollHeight,
                windowWidth: clonedElement.scrollWidth,
                windowHeight: clonedElement.scrollHeight,
                onclone: (clonedDoc) => {
                    console.log('html2canvas cloned document');
                }
            });
            
            console.log('Canvas created:', canvas.width, 'x', canvas.height);
            document.body.removeChild(tempContainer);

            // Generate PDF with A4 pages
            const imgWidth = 210; // A4 width in mm
            const pageHeight = 297; // A4 height in mm
            const imgHeight = (canvas.height * imgWidth) / canvas.width;
            let heightLeft = imgHeight;

            console.log('Creating PDF...');
            const pdf = new jsPDF('p', 'mm', 'a4');
            let position = 0;

            const imgData = canvas.toDataURL('image/png');
            
            // Add first page
            pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
            heightLeft -= pageHeight;

            // Add additional pages as needed
            while (heightLeft >= 0) {
                position = heightLeft - imgHeight;
                pdf.addPage();
                pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
                heightLeft -= pageHeight;
            }

            const fileName = `${filename}_${new Date().toISOString().split('T')[0]}.pdf`;
            console.log('Saving PDF as:', fileName);
            pdf.save(fileName);

        } catch (error) {
            console.error('Detailed error generating PDF:', error);
            console.error('Error stack:', error.stack);
            alert(`Error generating PDF: ${error.message}. Please check the console for details.`);
        } finally {
            setIsGeneratingPDF(false);
        }
    };

    return (
        <>
            <div className="relative" ref={downloadRef} data-download-button>
                <button 
                    className={buttonClass}
                    onClick={() => setShowDownloadOptions(!showDownloadOptions)}
                >
                    {buttonText}
                    {showIcon && <img src={Download} className='w-4 h-4' alt="Download" />}
                </button>
                <AnimatePresence>
                    {showDownloadOptions && (
                        <motion.div
                            initial={{ opacity: 0, scaleY: 0 }}
                            animate={{ opacity: 1, scaleY: 1 }}
                            exit={{ opacity: 0, scaleY: 0 }}
                            transition={{ duration: 0.2, ease: "easeInOut" }}
                            style={{ transformOrigin: "top" }}
                            className="absolute right-0 top-10 bg-white border border-gray-300 rounded-md shadow-lg z-50 overflow-hidden min-w-[200px]"
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
                            {contentRef && (
                                <button
                                    className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 transition-colors border-t border-gray-200"
                                    onClick={() => {
                                        setShowDownloadOptions(false);
                                        downloadPDF();
                                    }}
                                >
                                    Download as PDF (.pdf)
                                </button>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>
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

export default DownloadReport; 