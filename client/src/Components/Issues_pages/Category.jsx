import React from 'react';
import { useSelector } from "react-redux";

const RankingTableSection = ({ title, data }) => {
  const extractErrors = (item) => {
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
      const section = item.data[sectionKey];
      if (section) {
        Object.keys(issueLabels).forEach((checkKey) => {
          const check = section[checkKey];
          if (check?.status === 'Error') {
            errorRows.push({
              asin: item.asin,
              title:
                item.data?.Title?.length > 30
                  ? item.data.Title.slice(0, 30) + '...'
                  : item.data?.Title || 'N/A',
              issueHeading: `${sectionLabels[sectionKey]} | ${issueLabels[checkKey]}`,
              message: check.Message,
              solution: check.HowTOSolve
            });
          }
        });
      }
    });

    return errorRows;
  };

  const flattenedData = data.flatMap(extractErrors);

  return (
    <div className="mb-10">
      <h2 className="text-xl font-semibold text-gray-800 mb-4">{title}</h2>
      <div className="overflow-x-auto rounded-lg shadow">
        <table className="min-w-full bg-white border border-gray-200">
          <thead>
            <tr className="bg-[#333651] text-left text-sm font-medium text-white uppercase tracking-wider">
              <th className="px-4 py-3 border">ASIN</th>
              <th className="px-4 py-3 border">Product Title</th>
              <th className="px-4 py-3 border">Issue</th>
              <th className="px-4 py-3 border">How to solve</th>
            </tr>
          </thead>
          <tbody>
            {flattenedData.map((row, idx) => (
              <tr key={idx} className="border-t text-sm text-gray-700">
                <td className="px-4 py-3 border">{row.asin}</td>
                <td className="px-4 py-3 border">{row.title}</td>
                <td className="px-4 py-3 border">
                  <span className="font-semibold">{row.issueHeading}:</span> {row.message}
                </td>
                <td className="px-4 py-3 border">{row.solution}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};





const ConversionTableSection = ({ title, data }) => {
  const getFormattedErrors = (item) => {
    const sections = [
      ['Images', item.imageResultErrorData],
      ['Videos', item.videoResultErrorData],
      ['Reviews', item.productReviewResultErrorData],
      ['Rating', item.productStarRatingResultErrorData],
      ['Buy Box', item.productsWithOutBuyboxErrorData],
      ['A Plus', item.aplusErrorData]
    ];

    return sections
      .filter(([_, value]) => value)
      .map(([label, errorObj]) => ({
        heading: label,
        subheading: errorObj.type || 'Issue',
        message: errorObj.Message,
        solution: errorObj.HowToSolve
      }));
  };

  const flattenData = data.flatMap((item) =>
    getFormattedErrors(item).map((err) => ({
      asin: item.asin,
      title:
        item.Title?.length > 30 ? item.Title.slice(0, 30) + '...' : item.Title,
      issueHeading: `${err.heading} | ${err.subheading}`,
      message: err.message,
      solution: err.solution
    }))
  );

  return (
    <div className="mb-10">
      <h2 className="text-xl font-semibold text-gray-800 mb-4">{title}</h2>
      <div className="overflow-x-auto rounded-lg shadow">
        <table className="min-w-full bg-white border border-gray-200">
          <thead>
            <tr className="bg-[#333651] text-left text-sm font-medium text-white uppercase tracking-wider">
              <th className="px-4 py-3 border">ASIN</th>
              <th className="px-4 py-3 border">Product Title</th>
              <th className="px-4 py-3 border">Issue</th>
              <th className="px-4 py-3 border">How to solve</th>
            </tr>
          </thead>
          <tbody>
            {flattenData.map((row, idx) => (
              <tr key={idx} className="border-t text-sm text-gray-700">
                <td className="px-4 py-3 border">{row.asin}</td>
                <td className="px-4 py-3 border">{row.title}</td>
                <td className="px-4 py-3 border">
                  <span className="font-semibold">{row.issueHeading}:</span> {row.message}
                </td>
                <td className="px-4 py-3 border">{row.solution}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};


const OptimizationDashboard = () => {
  const info = useSelector((state) => state.Dashboard.DashBoardInfo);
  console.log(info.rankingProductWiseErrors)
  const productData = {
    rankingOptimization: [
      {
        asin: 'B07NKVNWRY',
        title: 'PowerPulse Resistance Bands',
        issues: ['Missing backend keywords'],
        solution: 'Fill out all backend keyword fields with relevant terms...'
      },
      {
        asin: 'B07NKVNXZR',
        title: 'FitTrack Elite - Advanced Fitness Tracker',
        issues: ['Titles not including relevant keywords', 'Exceeding character limits'],
        solution: 'Include high-traffic keywords naturally. Follow Amazon\'s character limits...'
      },
    ],
    conversionOptimization: [
      {
        asin: 'B08LMKRV C1',
        title: 'Ergonomic Office Chair with Lumbar Support',
        issues: ['Listings with less than 6 high-quality images'],
        solution: 'Upload at least 7 images, including lifestyle shots, etc...'
      },
    ],
    fulfillmentOptimization: [
      {
        asin: 'B092LJ9D93',
        title: 'Premium Silicone Baking Mats',
        issues: ['Product not linked to the storefront'],
        solution: 'Check and assign ASINs to the correct brand through the "Brand Dashboard"...'
      },
    ],
  };

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <RankingTableSection title="Ranking Optimization" data={info.rankingProductWiseErrors} />
      <ConversionTableSection title="Conversion Optimization" data={info.conversionProductWiseErrors} />
    </div>
  );
};

export default OptimizationDashboard;
