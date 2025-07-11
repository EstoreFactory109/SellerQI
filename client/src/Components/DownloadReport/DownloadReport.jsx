import React, { useState, useRef, useEffect } from 'react';
import { AnimatePresence, motion } from "framer-motion";
import * as ExcelJS from 'exceljs';
import Papa from 'papaparse';
import { saveAs } from 'file-saver';
import Download from '../../assets/Icons/Download.png';

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
    const downloadExcel = async () => {
        try {
            const exportData = prepareExportData();
            console.log('Export data for Excel:', exportData);
            
            if (!exportData || exportData.length === 0) {
                alert('No data available for export');
                return;
            }
            
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Report');
            
            // Check if data is 2D array (like CSV format) or JSON objects
            if (Array.isArray(exportData) && Array.isArray(exportData[0])) {
                // Handle 2D array format
                exportData.forEach((row, index) => {
                    worksheet.addRow(row);
                    // Style first row as header if it's likely to be headers
                    if (index === 0) {
                        worksheet.getRow(1).font = { bold: true };
                        worksheet.getRow(1).fill = {
                            type: 'pattern',
                            pattern: 'solid',
                            fgColor: { argb: 'FFE0E0E0' }
                        };
                    }
                });
                
                // Set column widths for 2D array
                const columnCount = exportData[0] ? exportData[0].length : 0;
                worksheet.columns = Array(columnCount).fill().map(() => ({ width: 30 }));
            } else {
                // Handle JSON object format
                if (exportData.length > 0) {
                    const headers = Object.keys(exportData[0]);
                    worksheet.addRow(headers);
                    
                    exportData.forEach(row => {
                        worksheet.addRow(Object.values(row));
                    });
                    
                    // Set column widths for JSON objects
                    worksheet.columns = headers.map(() => ({ width: 30 }));
                    
                    // Style header row
                    worksheet.getRow(1).font = { bold: true };
                    worksheet.getRow(1).fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFE0E0E0' }
                    };
                }
            }
            
            const fileName = `${filename}_${new Date().toISOString().split('T')[0]}.xlsx`;
            
            // Write and download file
            const buffer = await workbook.xlsx.writeBuffer();
            const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            saveAs(blob, fileName);
            console.log('Excel download completed:', fileName);
        } catch (error) {
            console.error('Error downloading Excel:', error);
            alert('Error downloading Excel file. Please check console for details.');
        }
    };

    // Download as CSV
    const downloadCSV = () => {
        try {
            const exportData = prepareExportData();
            console.log('Export data for CSV:', exportData);
            
            if (!exportData || exportData.length === 0) {
                alert('No data available for export');
                return;
            }
            
            let csv;
            
            // Check if data is 2D array (like CSV format) or JSON objects
            if (Array.isArray(exportData) && Array.isArray(exportData[0])) {
                // Handle 2D array format - convert to CSV directly
                csv = Papa.unparse(exportData, { header: false });
            } else {
                // Handle JSON object format
                csv = Papa.unparse(exportData, { header: true });
            }
            
            if (!csv || csv.trim() === '') {
                alert('No data could be converted to CSV format');
                return;
            }
            
            const fileName = `${filename}_${new Date().toISOString().split('T')[0]}.csv`;
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            saveAs(blob, fileName);
            console.log('CSV download completed:', fileName);
        } catch (error) {
            console.error('Error downloading CSV:', error);
            alert('Error downloading CSV file. Please check console for details.');
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
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </>
    );
};

export default DownloadReport; 