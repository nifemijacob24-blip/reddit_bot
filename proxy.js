import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import Parser from 'rss-parser';

const parser = new Parser();

// Drop your Decodo proxy string here
const proxyUrl = `http://spy91wmg1u:m5j9OzYox8pIv0Jn+w@gate.decodo.com:7000`; 
const proxyAgent = new HttpsProxyAgent(proxyUrl, { rejectUnauthorized: false });

async function testRedditRSS() {
    try {
        console.log("📡 Bypassing API: Fetching Reddit RSS Feed via Proxy...");
        
        const response = await axios.get('https://old.reddit.com/r/freelance/new.rss', {
            httpsAgent: proxyAgent,
            httpAgent: proxyAgent,
            proxy: false, // Prevents Axios conflicts
            timeout: 15000,
            headers: {
                // Mimic a standard Chrome browser for RSS fetching
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'application/rss+xml, application/xml, text/xml'
            }
        });

        // Convert the raw XML into a clean JSON object
        const feed = await parser.parseString(response.data);
        
        console.log(`✅ FIREWALL BYPASSED. RSS SUCCESS!`);
        console.log(`   Sample Post Title: "${feed.items[0].title}"`);
        console.log(`   Sample Content: "${feed.items[0].contentSnippet.substring(0, 50)}..."`);
        
    } catch (err) {
        console.error(`❌ RSS FAILED: ${err.response ? err.response.status : err.message}`);
    }
}

testRedditRSS();