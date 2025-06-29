import axios from  'axios'


const GetIP = async ()=>{
    try {
        const ipResponse = await axios.get('https://api.ipify.org?format=json');
        const ip= ipResponse.data.ip;
        return ip;
    }catch(error){
        console.log(error);
        return false
    }
}

export default GetIP;