const { addAccountHistory } = require('./addAccountHistory.js');

async function test(){
    const addAccountHistoryData = await addAccountHistory("689b9d9cfc29576b59e7f46c","US","NA",1,1,1,1);

    console.log(addAccountHistoryData);
}


test();

