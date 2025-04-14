import React, { useState } from "react";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";

const priorityColors = {
  High: "text-red-500",
  Medium: "text-yellow-500",
  Low: "text-green-500",
};

export default function ProductTable() {

  const navigate=useNavigate();

const openProductWithIssuePage=(asin)=>{
  if(asin){
    navigate(`/seller-central-checker/issues/${asin}`)
  }
}


  const info = useSelector((state) => state.Dashboard.DashBoardInfo);
  console.log(info)
  const allProducts = info.productWiseError || [];
  const itemsPerPage = 10;
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = Math.ceil(allProducts.length / itemsPerPage);

  const startIndex = (currentPage - 1) * itemsPerPage;
  const currentSlice = allProducts.slice(startIndex, startIndex + itemsPerPage);

  const sortedBySales = [...currentSlice].sort(
    (a, b) => Number(b.sales ?? 0) - Number(a.sales ?? 0)
  );
  

  const prioritizedProducts = sortedBySales.map((product, index) => ({
    ...product,
    priority: index < 3 ? "High" : index < 7 ? "Medium" : "Low",
  }));

  const getPageNumbers = () => {
    const maxPages = 5;
    const pageNumbers = [];

    if (totalPages <= maxPages) {
      for (let i = 1; i <= totalPages; i++) pageNumbers.push(i);
    } else {
      let start = Math.max(1, currentPage - 2);
      let end = start + maxPages - 1;

      if (end > totalPages) {
        end = totalPages;
        start = end - maxPages + 1;
      }

      for (let i = start; i <= end; i++) {
        pageNumbers.push(i);
      }
    }

    return pageNumbers;
  };

  const pageNumbers = getPageNumbers();

  return (
    <div className="bg-white shadow rounded-lg p-4">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-2 mb-4">
        <h2 className="text-xl font-semibold">Top Products to Optimize</h2>
        <div className="flex flex-col md:flex-row gap-2">
          <select className="border p-2 rounded-md">
            <option>Top 10 products by revenue</option>
          </select>
          <input
            type="text"
            placeholder="Search for ASIN or Product Title"
            className="border p-2 rounded-md"
          />
        </div>
      </div>
      <div className="overflow-auto">
      <div className="w-full overflow-x-auto">
  <table className="w-full min-w-[768px] text-sm text-left table-fixed">
    <thead className="bg-[#333651] text-white">
      <tr>
        <th className="pl-2 w-[128px] min-w-[100px]">ASIN</th>
        <th className="pl-2 w-[400px] min-w-[200px]">Product Name</th>
        <th className="p-2 w-[160px] min-w-[120px]">Priority</th>
        <th className="p-2 w-[8rem] min-w-[80px]">Unit Sold</th>
        <th className="p-2 w-[6rem] min-w-[60px]">Sales</th>
        <th className="p-2 min-w-[80px]">Issues</th>
      </tr>
    </thead>
    <tbody className="min-h-[450px]">
      {prioritizedProducts.map((product, index) => (
        <tr key={index} className="border-t">
          <td className="pl-2 w-[128px] break-words hover:underline cursor-pointer" onClick={()=>openProductWithIssuePage(product.asin)}>{product.asin}</td>
          <td className="p-2 w-[400px] truncate hover:underline cursor-pointer" onClick={()=>openProductWithIssuePage(product.asin)}>
            {product.name?.length > 50 ? `${product.name.slice(0, 50)}...` : product.name}
          </td>
          <td className={`p-2 w-[160px] font-bold ${priorityColors[product.priority]}`}>
            {product.priority}
          </td>
          <td className="p-2  w-[8rem]">{product.quantity ?? "-"}</td>
          <td className="p-2 w-[6rem]">{product.sales ?? "-"}</td>
          <td className="p-2 text-blue-600">{product.errors ?? 0} Issues</td>
        </tr>
      ))}
    </tbody>
  </table>
</div>

      </div>

      <div className="flex justify-center mt-4 gap-2 flex-wrap">
        <button
          className="border rounded-md px-3 py-1"
          onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
          disabled={currentPage === 1}
        >
          &lt;
        </button>

        {pageNumbers[0] > 1 && <span className="px-2">...</span>}

        {pageNumbers.map((page) => (
          <button
            key={page}
            onClick={() => setCurrentPage(page)}
            className={`rounded-md px-3 py-1 text-sm ${
              currentPage === page ? "bg-gray-900 text-white" : "border"
            }`}
          >
            {page}
          </button>
        ))}

        {pageNumbers[pageNumbers.length - 1] < totalPages && <span className="px-2">...</span>}

        <button
          className="border rounded-md px-3 py-1"
          onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
          disabled={currentPage === totalPages}
        >
          &gt;
        </button>
      </div>
    </div>
  );
}
