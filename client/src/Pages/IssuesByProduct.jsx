import React, { useState,useEffect,useRef } from 'react';
import { useSelector } from "react-redux";
import { useParams } from 'react-router-dom';
import DropDown from '../assets/Icons/drop-down.png';
import noImage from '../assets/Icons/no-image.png';
import { useNavigate } from 'react-router-dom';
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
                    ? { opacity: 1, maxHeight: "200px", minHeight: "80px", display: "flex" }
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
    useEffect(()=>{
        function handleClickOutside(e){
            if(dropdownRef.current && !dropdownRef.current.contains(e.target)){
                setOpenSelector(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        }
    },[])

    const { asin } = useParams();
    const product = info.productWiseError.find(item => item.asin === asin);

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
const [openSelector,setOpenSelector] = useState(false)
const navigate=useNavigate();
    return (
        <div className="p-6 bg-gray-100 max-h-[90vh] overflow-y-auto text-gray-800 lg:mt-0 mt-[10vh]">
            {/* Header */}
            <div className="bg-white p-6 rounded-xl shadow mb-6 flex flex-col md:flex-row md:items-center md:justify-between">
                <div className="flex items-center space-x-4">
                    <img src={product.MainImage || noImage} alt="Product" className="w-20 rounded-md mr-4" />
                    <div>
                        <h2 className="text-xl font-semibold mb-4">{product.name}</h2>
                        <p className="text-sm">ASIN: {product.asin}</p>
                        <p className="text-sm">SKU: {product.sku}</p>
                        <p className="text-sm">List Price: ${product.price}</p>
                    </div>
                </div>
                <div className='flex items-center gap-2 relative w-fit' ref={dropdownRef}>
                    <button className="text-sm text-white bg-[#333651] rounded px-3 py-1">
                        Download PDF
                    </button>
                    <div className="w-[9rem] bg-white flex justify-center items-center px-2 py-1 border-[1px] border-gray-300 rounded-md text-sm text-gray-400 gap-3 cursor-pointer" onClick={() => setOpenSelector(!openSelector)} ><p>Switch Product</p><img src={DropDown} /></div>
                    {openSelector && <ul className="w-[9rem] z-[99] bg-white absolute right-0 top-12 py-1 px-1 border-[1px] border-gray-300 ">
                        {
                            info.productWiseError.map((item, index) => <li className=" flex justify-center items-center py-1 cursor-pointer hover:bg-[#333651] hover:text-white rounded-md text-sm" key={index} onClick={() => {navigate(`/seller-central-checker/issues/${item.asin}`); setOpenSelector(false)}}>{item.asin}</li>)
                        }
                    </ul>}
                </div>
            </div>

            {/* Key Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                {[
                    { label: 'Unit Sold', value: product.quantity },
                    { label: 'Sales', value: `$${product.sales}` },
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
                                            ? { opacity: 1, maxHeight: "200px", minHeight: "80px", display: "flex" }
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
                                                ? { opacity: 1, maxHeight: "200px", minHeight: "80px", display: "flex" }
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
                                        <div className=' bg-gray-200 mt-2 flex justify-center items-center  transition-all duration-700 ease-in-out' style={TitleSolution === "checkSpecialCharacters" ? { opacity: 1, maxHeight: "200px", minHeight: "80px", display: "flex" } : { opacity: 0, maxHeight: "0px", minHeight: "0px", overflow: "hidden", display: "flex" }}>{product.rankingErrors.data.TitleResult.checkSpecialCharacters?.HowTOSolve}</div>
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
                                        <div className=' bg-gray-200 mt-2 flex justify-center items-center transition-all duration-700 ease-in-out' style={BulletSoltion === "charLim" ? { opacity: 1, maxHeight: "200px", minHeight: "80px", display: "flex" } : { opacity: 0, maxHeight: "0px", minHeight: "0px", overflow: "hidden", display: "flex" }}>{product.rankingErrors.data.BulletPoints.charLim?.HowTOSolve}</div>
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
                                        <div className=' bg-gray-200 mt-2 flex justify-center items-center transition-all duration-700 ease-in-out' style={BulletSoltion === "RestictedWords" ? { opacity: 1, maxHeight: "200px", minHeight: "80px", display: "flex" } : { opacity: 0, maxHeight: "0px", minHeight: "0px", overflow: "hidden", display: "flex" }}>{product.rankingErrors.data.BulletPoints.RestictedWords?.HowTOSolve}</div>
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
                                        <div className=' bg-gray-200 mt-2 flex justify-center items-center transition-all duration-700 ease-in-out' style={BulletSoltion === "checkSpecialCharacters" ? { opacity: 1, maxHeight: "200px", minHeight: "80px", display: "flex" } : { opacity: 0, maxHeight: "0px", minHeight: "0px", overflow: "hidden", display: "flex" }}>{product.rankingErrors.data.BulletPoints.checkSpecialCharacters?.HowTOSolve}</div>
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
                                        <div className=' bg-gray-200 mt-2 flex items-center justify-center transition-all duration-700 ease-in-out' style={DescriptionSolution === "charLim" ? { opacity: 1, maxHeight: "200px", minHeight: "80px", display: "flex" } : { opacity: 0, maxHeight: "0px", minHeight: "0px", overflow: "hidden", display: "flex" }}><p className='w-[80%]'>{product.rankingErrors.data.Description.charLim?.HowTOSolve}</p></div>
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
                                        <div className=' bg-gray-200 mt-2 flex items-center justify-center transition-all duration-700 ease-in-out' style={DescriptionSolution === "RestictedWords" ? { opacity: 1, maxHeight: "200px", minHeight: "80px", display: "flex" } : { opacity: 0, maxHeight: "0px", minHeight: "0px", overflow: "hidden", display: "flex" }}><p className='w-[80%]'>{product.rankingErrors.data.Description.RestictedWords?.HowTOSolve}</p></div>
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
                                        <div className=' bg-gray-200 mt-2 flex items-center justify-center transition-all duration-700 ease-in-out' style={DescriptionSolution === "checkSpecialCharacters" ? { opacity: 1, maxHeight: "200px", minHeight: "80px", display: "flex" } : { opacity: 0, maxHeight: "0px", minHeight: "0px", overflow: "hidden", display: "flex" }}><p className='w-[80%]'>{product.rankingErrors.data.Description.checkSpecialCharacters?.HowTOSolve}</p></div>
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
                                        <div className=' bg-gray-200 mt-2 flex items-center justify-center transition-all duration-700 ease-in-out' style={BackendKeyWords === "charLim" ? { opacity: 1, maxHeight: "200px", minHeight: "80px", display: "flex" } : { opacity: 0, maxHeight: "0px", minHeight: "0px", overflow: "hidden", display: "flex" }}><p className='w-[80%]'>{product.rankingErrors.data.charLim?.HowTOSolve}</p></div>
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
        </div>
    );
};

export default Dashboard;
