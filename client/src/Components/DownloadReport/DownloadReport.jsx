import React, { useState, useRef, useEffect } from 'react';
import { AnimatePresence, motion } from "framer-motion";
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import Download from '../../assets/Icons/download.png';

const DownloadReport = ({ 
    data, 
    filename = 'report', 
    buttonText = 'Download Report',
    buttonClass = 'flex items-center text-xs bg-[#333651] text-white gap-2 px-3 py-1 rounded-md',
    showIcon = true,
    prepareDataFunc = null
}) => {
    const [showDownloadOptions, setShowDownloadOptions] = useState(false);
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
        let ws;
        
        // Check if data is 2D array (like CSV format) or JSON objects
        if (Array.isArray(exportData) && Array.isArray(exportData[0])) {
            // Handle 2D array format
            ws = XLSX.utils.aoa_to_sheet(exportData);
        } else {
            // Handle JSON object format
            ws = XLSX.utils.json_to_sheet(exportData);
        }
        
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Report');
        
        // Auto-size columns
        const maxWidth = 50;
        if (Array.isArray(exportData[0])) {
            // For 2D array, set column width based on first row length
            const cols = exportData[0].map(() => ({ wch: maxWidth }));
            ws['!cols'] = cols;
        } else {
            // For JSON objects
            const cols = Object.keys(exportData[0] || {}).map(() => ({ wch: maxWidth }));
            ws['!cols'] = cols;
        }
        
        const fileName = `${filename}_${new Date().toISOString().split('T')[0]}.xlsx`;
        XLSX.writeFile(wb, fileName);
    };

    // Download as CSV
    const downloadCSV = () => {
        const exportData = prepareExportData();
        let ws;
        
        // Check if data is 2D array (like CSV format) or JSON objects
        if (Array.isArray(exportData) && Array.isArray(exportData[0])) {
            // Handle 2D array format
            ws = XLSX.utils.aoa_to_sheet(exportData);
        } else {
            // Handle JSON object format
            ws = XLSX.utils.json_to_sheet(exportData);
        }
        
        const csv = XLSX.utils.sheet_to_csv(ws);
        
        const fileName = `${filename}_${new Date().toISOString().split('T')[0]}.csv`;
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        saveAs(blob, fileName);
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
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </>
    );
};

export default DownloadReport; 