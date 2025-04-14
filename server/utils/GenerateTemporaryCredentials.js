require("dotenv").config();
const { STSClient, AssumeRoleCommand } = require("@aws-sdk/client-sts");
const { v4: uuidv4 } = require("uuid");

const getTemporaryCredentials = async (Region) => {
    const sessionName = `Session-${uuidv4()}`;

    // Create STS Client with proper credentials
    const stsClient = new STSClient({ 
        region: Region,
        credentials: {
            accessKeyId: process.env.ACCESS_KEY_ID,  // Corrected variable name
            secretAccessKey: process.env.SECRETACCESSKEY,  // Corrected variable name
        }
    });

    //console.log(process.env.ACCESS_KEY_ID)
    //console.log(process.env.SECRET_ACCESS_KEY,)

    const command = new AssumeRoleCommand({
        RoleArn: process.env.ROLE_ARN,
        RoleSessionName: sessionName,
        DurationSeconds: 3600,
    });

    try {
        const response = await stsClient.send(command);

       // console.log(response);

        const data = {
            AccessKey: response.Credentials.AccessKeyId,
            SecretKey: response.Credentials.SecretAccessKey,
            SessionToken: response.Credentials.SessionToken,
            SessionName: sessionName
        };
        return data;
    } catch (error) {
        console.error("Error assuming role:", error);
    }
};

module.exports = getTemporaryCredentials;
