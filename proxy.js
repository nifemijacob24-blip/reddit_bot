import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';

const proxyUrl = `http://d1d24c034f1c1f44:7VjUCbvNyhtEqMKJ@res.proxy-seller.com:10000`;
const proxyAgent = new HttpsProxyAgent(proxyUrl, { rejectUnauthorized: false });

async function checkProxy() {
    try {
        // 1. Check what IP and ASN the proxy is actually showing to the world
        const ipCheck = await axios.get('https://ipinfo.io/json', {
            httpsAgent: proxyAgent,
            httpAgent: proxyAgent,
            proxy: false
        });
        console.log("🌍 Proxy Live IP Info:");
        console.log(`   - IP: ${ipCheck.data.ip}`);
        console.log(`   - Org/ASN: ${ipCheck.data.org}`); // If this says a data center company instead of a residential ISP, it's fake residential.
        console.log(`   - Country: ${ipCheck.data.country}\n`);

        // 2. Test a direct call to a single subreddit
        console.log("📡 Testing connection to Reddit...");
        const redditCheck = await axios.get('https://old.reddit.com/r/freelance/new.json?limit=1', {
            httpsAgent: proxyAgent,
            httpAgent: proxyAgent,
            proxy: false,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
            }
        });
        
        if(redditCheck.status === 200) {
            console.log("✅ SUCCESS! The proxy successfully read Reddit.");
        }
    } catch (err) {
        console.log(`❌ PROXY FAILED: Status ${err.response?.status || err.code}`);
        if (err.response?.status === 403) {
            console.log("🚨 Verdict: The IP is burned. Reddit's firewall has completely blacklisted this proxy provider.");
        }
    }
}

checkProxy();