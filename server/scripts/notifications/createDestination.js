/**
 * Creates SellerQI's notification destination for one SP-API region (a WRITE to
 * Amazon; run by the team once per region, after creating the SQS queue and
 * allowing Amazon to send to it - see Amazon's "Notifications API" setup guide).
 *
 *   node server/scripts/notifications/createDestination.js --region NA --arn arn:aws:sqs:us-east-1:123456789012:sellerqi-sp-notifications [--dry-run]
 *
 * Stores the destination in NotificationDestination, where the subscribe change
 * (notifications.create_subscription) looks it up.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env') });
const mongoose = require('mongoose');

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : null; };

(async () => {
    const region = String(arg('region') || '').toUpperCase();
    const arn = arg('arn');
    if (!['NA', 'EU', 'FE'].includes(region) || !/^arn:aws:sqs:/.test(arn || '')) {
        console.error('Usage: --region NA|EU|FE --arn arn:aws:sqs:<aws-region>:<account>:<queue> [--dry-run]');
        process.exit(1);
    }
    const db = require('../../config/config.js');
    await mongoose.connect(`${db.dbUri}/${db.dbName}`);
    const Destination = require('../../models/MCP/NotificationDestinationModel.js');
    const N = require('../../Services/Sp_API/NotificationsService.js');
    const existing = (await N.listDestinations({ region })).find((d) => d.resource?.sqs?.arn === arn);
    if (process.argv.includes('--dry-run')) {
        console.log(existing ? `Amazon already has this destination: ${existing.destinationId}` : 'Would create a destination for this queue.');
        await mongoose.disconnect();
        return;
    }
    const d = existing || await N.createDestination({ region, name: `sellerqi-${region.toLowerCase()}`, sqsArn: arn });
    await Destination.updateOne({ region }, { $set: { destinationId: d.destinationId, name: d.name, arn, type: 'SQS' } }, { upsert: true });
    console.log(`Destination for ${region}: ${d.destinationId}`);
    await mongoose.disconnect();
})().catch((e) => { console.error('Failed:', e.response?.status, JSON.stringify(e.response?.data || e.message)); process.exit(1); });
