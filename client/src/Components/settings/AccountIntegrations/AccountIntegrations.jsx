import React,{useState} from "react";
import { useSelector } from "react-redux";
import AmazonConnectPopup from "./AmazonConnectPopup";


export default function AccountCards() {

  const [open,setOpen]=useState(false)
  const accounts=useSelector(state=>state.AllAccounts?.AllAccounts)
  console.log(accounts)
  const handleRemove = (id) => {
    console.log("Remove account ID:", id);
    // Add your remove logic here
  };

  const handleAddAccount = (e) => {
    e.preventDefault();
    setOpen(true);
  };

  const closeAddAccount=(e)=>{
    e.preventDefault();
    setOpen(false);
  }

  return (
    <>
    {open &&<AmazonConnectPopup closeAddAccount={closeAddAccount}/>}
    <div className="max-w-full mx-auto bg-white p-6 rounded-lg shadow-md">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-lg font-semibold text-gray-700">CONNECT AN ACCOUNT</h2>
        <button
          onClick={handleAddAccount}
          className="flex items-center gap-2 px-4 py-2 bg-[#333651] text-white rounded shadow"
        >
          <span className="text-xl">+</span>
          <span>Add new account</span>
        </button>
      </div>

      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
        {accounts.map((account) => (
          <div
            key={account.id}
            className="relative border border-gray-200 p-4 rounded-lg shadow-sm hover:shadow-md transition"
          >
            {/*<button
              onClick={() => handleRemove(account.id)}
              className="absolute top-3 right-3 text-gray-400 hover:text-red-500"
            >
              ✕
            </button>*/}
            <h3 className="text-lg font-semibold text-indigo-900">{account.platform}</h3>
            <p className="text-sm text-gray-800 mt-1">{account.username}</p>
            <p className="text-sm text-gray-500 mt-2">
              <span className="font-medium">Region :</span> {account.region}
            </p>
            <p className="text-sm text-gray-500">
              <span className="font-medium">Marketplace :</span> {account.country}
            </p>
          </div>
        ))}
      </div>
    </div>
    </>
  );
}
