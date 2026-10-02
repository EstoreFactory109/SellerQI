const {ApiError}=require('../../utils/ApiError');
const asyncHandler = require('../../utils/AsyncHandler');
const logger = require('../../utils/Logger');
const { ApiResponse } = require('../../utils/ApiResponse');
const {verifyLocationToken}=require('../../utils/Tokens');

const getLocation=asyncHandler(async(req,res,next)=>{
    const locationtoken=req.cookies.IBEXLocationToken;

    if(!locationtoken){
        logger.error(new ApiError(401,"Unauthorized"));
        return res.status(401).json(new ApiResponse(401,"","Unauthorized"));
    }
    const decoded=await verifyLocationToken(locationtoken);

   
    if(!decoded){
        logger.error(new ApiError(400,"Invalid location token"));
        return res.status(400).json(new ApiResponse(400,"","Invalid location token"));
    }

    if(decoded){
        req.country=decoded.country;
        req.region=decoded.region;
        next();
    }else{
        return res.status(401).json(new ApiResponse(401,"","Location token expired"));
    }
    
})

/**
 * The same marketplace lookup, but a missing cookie is not an error.
 *
 * ── WHY THIS EXISTS ──
 * `getLocation` answers 401 when there is no IBEXLocationToken, which is right for a route
 * whose data is marketplace-scoped and wrong for one that merely wants a cache key. The ESF
 * reports routes were the latter — their own comment in pageWiseData.routes.js says so — and
 * the 401 made Reports the only client-facing ESF page that hard-failed for a brand-new
 * client, who has no marketplace yet because createEsfClient never minted the cookie.
 *
 * Deleting the middleware from those routes would have been simpler and worse: analyseDataCache
 * keys on req.country/req.region, so every client would have lost a 10-minute cache over a
 * fan-out that touches eight collections. This keeps the cache for everyone who has a
 * marketplace and lets everyone else through uncached.
 *
 * A caller that genuinely NEEDS a marketplace must therefore handle both fields being
 * undefined — it can no longer assume the middleware guaranteed them.
 */
const getLocationOptional = asyncHandler(async (req, res, next) => {
    const locationtoken = req.cookies?.IBEXLocationToken;
    if (!locationtoken) return next();

    const decoded = await verifyLocationToken(locationtoken);
    // A malformed cookie is treated as an absent one rather than a 400: this middleware's
    // whole contract is that the marketplace is optional, and failing on a bad cookie would
    // reintroduce the outage it exists to prevent.
    if (!decoded) {
        logger.warn('[getLocationOptional] ignoring an unreadable location token');
        return next();
    }

    req.country = decoded.country;
    req.region = decoded.region;
    return next();
});

module.exports = { getLocation, getLocationOptional };
