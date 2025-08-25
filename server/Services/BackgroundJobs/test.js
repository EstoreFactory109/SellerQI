const { getAnalysisData,sendMail } = require('./sendEmailWeekly.js');
const {sendTrialReminderEmails} = require('../BackgroundJobs/ReminderEmailToUpgrade.js');
const seller ={
    User:{
        _id:"689b9d9cfc29576b59e7f46c",
        firstName:"John",
        email:"Ankan@estorefactory.net"
    },
    brand:"John's Brand",
    sellerAccount:[
        {
            country:"US",
            region:"NA"
        }
    ]
      
}

//getAnalysisData(seller);
//sendMail();

sendTrialReminderEmails()