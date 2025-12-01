const {addNewAccountHistory} = require("../analytics/SpApiDataController");
const dbConnect = require("../../config/dbConn");

async function test() {
    await dbConnect();
    const result = await addNewAccountHistory("68ae594913b351b03f8ae923", "US", "NA");
    console.log("result: ",result)
}

test();