import { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import OpenAI from 'openai';
import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import Parser from 'rss-parser';
import 'dotenv/config';

// 🛑 FIX THE BRIGHT DATA/DECODO SSL ERROR 🛑
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// --- Configuration ---
const discord = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const parser = new Parser(); 

// --- PROXY SETUP ---
const proxyUrl = process.env.DECODO_PROXY_URL;

if (!proxyUrl) {
    console.error("❌ FATAL: DECODO_PROXY_URL is missing from the environment variables.");
    process.exit(1); 
}

const proxyAgent = new HttpsProxyAgent(proxyUrl, {
    rejectUnauthorized: false 
});

// State Management
let isScraping = true;
const processedPosts = new Set();

// --- CAMPAIGN CONFIGURATIONS ---
const CAMPAIGNS = {
    SIGNALQUB: {
        name: "SignalQub",
        color: 0x00FF00, // Green
        subreddits: [
            "10xfreelancing", "agency", "agencygrowthhacks", "agencynewbies", "coldemail", "content_marketing", 
            "digital_marketing", "digitalmarketing", "digitalmarketinghack", "emailmarketing", "emailmarketingnow", 
            "freelance", "freelancers", "freelancing", "googlemybusiness", "growthhacking", "localseo", "marketing", 
            "microsaas", "seo", "smma", "socialmediamanagers", "socialmediamarketing", "upwork", "web_design", "webdev"
        ],
        intentKeywords: ['mettings', 'bounce rate', 'cold call', 'no leads', 'zero replies', 'struggling to close', 'exhausted', 'takes time', 'cold email', 'no conversions', 'get clients', 'giving up', 'prospecting', 'bad leads', 'spam', 'leads', 'local'],
        contextKeywords: ['agency', 'b2b', 'web design', 'seo', 'smma', 'cold outreach', 'clients', 'retainer', 'pitch'],
        qualifyPrompt: `You are a ruthless Chief Revenue Officer qualifying leads for a B2B tool called SignalQub (helps agencies find local businesses failing technical audits).
        Rate 1-10.
        1-4 (REJECT): Building their own SaaS, asking for app feedback, or managing existing clients.
        8-10 (PERFECT): Agency owner/freelancer actively struggling to ACQUIRE clients (cold email spam, zero replies, bad lists).`,
        replyPrompt: `You are a cynical, pragmatic agency owner (~$50k MRR). 
        1. THE DIRECT HIT: Validate their exact prospecting problem.
        2. THE PIVOT: Explain the root cause is pitching generic businesses without finding pain points first.
        3. THE RELUCTANT DROP: Mention you use "signalqub" to pull lists of local businesses actively failing technical checks.
        4. THE EXECUTION: Tell them to screenshot the broken site and send it.
        Keep it short (3-4 lines). No greetings. Keep "signalqub" lowercase.`
    },
    ETSY_GUIDE: {
        name: "EtsyWithoutAds",
        color: 0x3498DB, // Blue
        subreddits: ["sidehustle", "makemoney", "entrepreneurridealong", "entrepreneurs", "entrepreneurship", "passive_income", "workonline",
"OnlineIncomeHustle","thesidehustle","passiveincome","EarnExtraIncome"],
        intentKeywords: ['need cash', 'side hustle ideas', 'make money', 'broke', 'passive income', 'zero dollars', 'start online', 'first business'],
        contextKeywords: ['online', 'home', 'hustle', 'beginner', 'laptop', 'free', 'no capital'],
        qualifyPrompt: `You are scoring leads for a free guide on how to build an Etsy shop with zero ad spend.
        Rate 1-10.
        1-4 (REJECT): Looking for offline work (Uber), crypto, or requires high capital.
        8-10 (PERFECT): Looking for a realistic online side hustle, willing to work.`,
        replyPrompt: `You are a pragmatic online seller.
        1. Validate that most side hustle advice (dropshipping/crypto) is garbage.
        2. Explain the safest route is digital products/POD on Etsy because of zero inventory cost.
        3. Mention you bypassed Etsy's expensive ads using programmatic Pinterest and wrote a free roadmap on "estywithoutads.site".
        4. Keep it short, blunt, and human. No greetings.`
    },
    PINQUB: {
        name: "PinQub",
        color: 0xE74C3C, // Red
        subreddits: ["EtsySellers", "Etsy", "dropshipping", "printondemand", "ecommerce", "Pinterest","EtsyCommunity","Printify","MerchPrintOnDemand","dropship","DropShipping101","Dropshipping_Guide","DropshippingTips","DropshippingVenture","shopify","ShopifyeCommerce","ecommercemarketing","printful"
            
        ],
        intentKeywords: ['etsy ads', 'cpc', 'no sales', 'automate', 'tailwind', 'too much time', 'pinterest traffic', 'profit margin', 'views dropped'],
        contextKeywords: ['etsy', 'store', 'shop', 'listing', 'traffic', 'views', 'visits', 'sales'],
        qualifyPrompt: `You are scoring leads for PinQub (automated Pinterest SaaS for e-commerce).
        Rate 1-10.
        1-4 (REJECT): Customer complaints, shipping delays, asking to critique their art.
        8-10 (PERFECT): Active seller complaining about Etsy Ads eating margins, algorithm drops, OR asking how to automate Pinterest without burnout or need help getting traffic.`,
        replyPrompt: `You are an experienced high-volume e-commerce seller.
        1. Validate that Etsy ads are a money pit right now with crazy CPCs.
        2. State that the only way to scale is automated Pinterest traffic.
        3. Mention you stopped pinning manually and use "pinqub" to autonomously generate and drip-feed variations.
        4. Keep it short and choppy. No greetings. Keep "pinqub" lowercase.`
    }
    
};

async function verifyLeadWithAI(campaign, title, text) {
    try {
        // Ensure the prompt explicitly asks for JSON to satisfy the API requirements
        const prompt = `${campaign.qualifyPrompt}\n\nTitle: ${title}\nBody: ${text.substring(0, 500)}\n\nYou must respond in JSON format. Return ONLY a raw JSON object. Example: {"score": 8, "reason": "brief 1-sentence explanation"}`;
        
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            response_format: { type: "json_object" }, // 🛑 THIS IS THE MAGIC FIX 🛑
            messages: [{ role: "user", content: prompt }],
            temperature: 0.1
        });
        
        const rawContent = response.choices[0].message.content.trim();
        
        // Because of response_format, we know for a fact this is pure JSON. No regex needed.
        const result = JSON.parse(rawContent); 
        // INSIDE verifyLeadWithAI()

        // ❌ CHANGE THIS:
        // console.log(`🧠 AI Scored [${aiData.score}] for post: ${post.title}`);

        // ✅ TO THIS:
        console.log(`🧠 AI Scored [${result.score}] for post: ${title}`);
        
        return { 
            score: parseInt(result.score) || 0, 
            reason: result.reason || "No reason provided." 
        };
    } catch (error) {
        console.error(`❌ [AI FILTER ERROR] ${campaign.name}:`, error.message);
        return { score: 0, reason: "API Error" }; 
    }
}

async function generateSummary(title, text) {
    try {
        console.log(`🧠 [AI] Generating summary for: "${title.substring(0, 30)}..."`);
        const prompt = `You are an analytical assistant. Read this Reddit post:\nTitle: ${title}\nBody: ${text}\nTASK: Write a blunt, 2-sentence summary of the user's exact problem. Do not offer solutions.`;

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini", 
            messages: [{ role: "user", content: prompt }],
            temperature: 0.3
        });
        
        return response.choices[0].message.content.trim();
    } catch (error) {
        console.error("❌ [AI ERROR] Summary failed:", error.message);
        return "Error generating summary.";
    }
}

async function generateReply(campaignKey, title, text) {
    const campaign = CAMPAIGNS[campaignKey];
    try {
        console.log(`🧠 [AI] Generating stealth draft for [${campaign.name}]`);
        
        const prompt = `${campaign.replyPrompt}\n\nStruggling user posted:\nTitle: ${title}\nBody: ${text}\n\nANTI-AI GLOSSARY - YOU WILL BE PENALIZED IF YOU USE THESE WORDS: tactical execution, strategic backbone, game-changer, lucrative, supercharge, dive in, landscape, crucial, paramount, elevate, delve, testament, realm, unlock, leverage, navigate, tapestry, robust.`;

        const response = await openai.chat.completions.create({
            model: "gpt-4o", 
            messages: [{ role: "user", content: prompt }],
            temperature: 0.75, 
            max_tokens: 300 
        });
        
        return response.choices[0].message.content.trim();
    } catch (error) {
        console.error("❌ [AI ERROR] Reply failed:", error.message);
        return "Error generating reply.";
    }
}

// --- Concurrent Subreddit Processor ---
async function processSubreddit(sub, campaign, channel) {
    let subPostsChecked = 0;
    let subLeadsFound = 0;

    try {
        const config = {
            httpsAgent: proxyAgent, httpAgent: proxyAgent, proxy: false, timeout: 15000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36' }
        };
        // Adds the current millisecond timestamp to bypass proxy and Reddit CDN caching
        const cacheBuster = Date.now();
        const response = await axios.get(`https://old.reddit.com/r/${sub}/new.rss?limit=20&t=${cacheBuster}`, config);
        let feed = await parser.parseString(response.data);

        for (const post of feed.items) {
            const title = post.title || '';
            const selftext = post.contentSnippet || '';
            const permalink = post.link || '';
            const id = post.id || permalink;
            let author = (post.author || 'Unknown').replace('/u/', '');

            if (processedPosts.has(id)) continue;
            processedPosts.add(id);
            subPostsChecked++;

            const created_utc = new Date(post.isoDate || post.pubDate).getTime() / 1000;
            const postAgeMins = (Math.floor(Date.now() / 1000) - created_utc) / 60;
            if (postAgeMins > 15) continue; 

            const textToAnalyze = `${title} ${selftext}`.toLowerCase();
            const hasIntent = campaign.intentKeywords.some(kw => textToAnalyze.includes(kw));
            const hasContext = campaign.contextKeywords.some(kw => textToAnalyze.includes(kw));

            if (hasIntent && hasContext) {
                console.log(`   🧠 [AI FILTER] Keyword match in r/${sub} for [${campaign.name}]`);
                
                const aiData = await verifyLeadWithAI(campaign, title, selftext);

                if (aiData.score >= 7) {
                    subLeadsFound++;
                    console.log(`   🚨 [HIGH QUALITY LEAD] Score ${aiData.score}/10 in r/${sub} for ${campaign.name}`);

                    const embed = new EmbedBuilder()
                        .setColor(campaign.color)
                        .setTitle(`🎯 [${campaign.name}] Target Found: r/${sub} (Score: ${aiData.score}/10)`)
                        .setURL(permalink)
                        .setAuthor({ name: `u/${author}` })
                        .addFields(
                            { name: 'Title', value: title.substring(0, 256) },
                            { name: 'AI Reasoning', value: `*${aiData.reason}*` }
                        )
                        .setDescription(selftext ? selftext.substring(0, 300) + '...' : '*[No body text]*')
                        .setFooter({ text: `Posted ${Math.floor(postAgeMins)} mins ago` });

                    // Find the key (e.g. "SIGNALQUB") to attach to the button payload
                    const campaignKey = Object.keys(CAMPAIGNS).find(key => CAMPAIGNS[key].name === campaign.name);
                    
                    // Shorten ID to avoid Discord's 100 char limit on customIds
                    const shortId = Buffer.from(id).toString('base64').substring(0, 20);

                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`summary_${shortId}`)
                            .setLabel('Get Summary')
                            .setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder()
                            .setCustomId(`reply_${campaignKey}_${shortId}`)
                            .setLabel(`Draft ${campaign.name} Reply`)
                            .setStyle(ButtonStyle.Primary)
                    );

                    await channel.send({ 
                        content: `**RAW_DATA_DO_NOT_DELETE**||${title}~~~${selftext.substring(0, 800)}||`, 
                        embeds: [embed], 
                        components: [row] 
                    });
                } else {
                    console.log(`   🗑️ [REJECTED] Score ${aiData.score}/10. Not high enough intent.`);
                }
            }
        }
        return { subPostsChecked, subLeadsFound };
    // INSIDE processSubreddit()

    // ❌ CHANGE THIS:
    // } catch (err) {
    //     return { subPostsChecked: 0, subLeadsFound: 0 };
    // }

    // ✅ TO THIS:
    } catch (err) {
        console.error(`❌ [REDDIT FETCH ERROR] r/${sub}: ${err.message}`);
        return { subPostsChecked: 0, subLeadsFound: 0 };
    }
}

// --- Fast Scraper Engine ---
async function scanReddit() {
    if (!isScraping) {
        console.log('⏸️ [ENGINE] Scanner is paused. Awaiting !toggle command.');
        return;
    }

    console.log('\n=============================================');
    console.log('🔍 [ENGINE] Initiating Multi-Campaign BATCH scan cycle...');
    console.log(`📡 [PROXY] Routing traffic securely via Decodo`);
    console.log('=============================================\n');

    let channel;
    try {
        channel = await discord.channels.fetch(process.env.DISCORD_CHANNEL_ID);
    } catch (err) {
        return console.log("❌ [ERROR] Could not fetch Discord Channel. Check your .env ID.");
    }

    let totalNewPostsChecked = 0;
    let totalLeadsFound = 0;
    const BATCH_SIZE = 5;

    for (const [key, campaign] of Object.entries(CAMPAIGNS)) {
        console.log(`\n📦 Executing Campaign: ${campaign.name}`);
        
        for (let i = 0; i < campaign.subreddits.length; i += BATCH_SIZE) {
            const batch = campaign.subreddits.slice(i, i + BATCH_SIZE);
            console.log(`📥 [SCRAPER] Fetching batch concurrently: ${batch.join(', ')}...`);
            
            const batchResults = await Promise.all(batch.map(sub => processSubreddit(sub, campaign, channel)));

            for (const res of batchResults) {
                totalNewPostsChecked += res.subPostsChecked;
                totalLeadsFound += res.subLeadsFound;
            }
            await new Promise(resolve => setTimeout(resolve, 2500));
        }
    }

    if (processedPosts.size > 5000) processedPosts.clear();

    console.log('\n=============================================');
    console.log(`📊 [SUMMARY] Fast Cycle complete.`);
    console.log(`   - New posts analyzed: ${totalNewPostsChecked}`);
    console.log(`   - Qualified leads forwarded to Discord: ${totalLeadsFound}`);
    console.log(`⏳ [ENGINE] Sleeping for 10 minutes until next cycle...`);
    console.log('=============================================\n');
}

// --- Discord Listeners ---
discord.once('ready', () => {
    console.log(`\n🤖 Discord Bot online as ${discord.user.tag}`);
    console.log(`🟢 System is primed and ready. Scraping is currently set to: ${isScraping ? 'ON' : 'OFF'}\n`);
    
    setInterval(scanReddit, 10 * 60 * 1000); 
    scanReddit(); 
});

discord.on('messageCreate', async (message) => {
    if (message.author.bot || !message.content.startsWith('!')) return;

    if (message.content === '!toggle') {
        isScraping = !isScraping;
        console.log(`\n⚙️ [COMMAND] User toggled engine. Status is now: ${isScraping ? 'ON' : 'OFF'}`);
        await message.reply(`Reddit Engine is now **${isScraping ? 'ON 🟢' : 'OFF 🔴'}**.`);
        if (isScraping) scanReddit(); 
    }
});

// Button Click Handler for Split Logic
discord.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    if (interaction.customId.startsWith('summary_')) {
        await interaction.deferReply(); 
        console.log(`\n🖱️ [INTERACTION] User requested AI SUMMARY.`);
        try {
            const rawData = interaction.message.content.split('||')[1];
            const [title, text] = rawData.split('~~~');

            const summary = await generateSummary(title, text);
            await interaction.editReply(`**📝 Lead Summary:**\n*${summary}*`);
        } catch (error) {
            console.error("❌ [INTERACTION ERROR] Failed to process summary:", error.message);
            await interaction.editReply(`❌ Error generating summary: ${error.message}`);
        }
    }

    // Handles format: reply_CAMPAIGNKEY_shortId
    if (interaction.customId.startsWith('reply_')) {
        await interaction.deferReply(); 
        const parts = interaction.customId.split('_');
        const campaignKey = parts[1]; // Pulls out SIGNALQUB, ETSY_GUIDE, or PINQUB
        
        console.log(`\n🖱️ [INTERACTION] User requested AI DRAFT REPLY for [${campaignKey}].`);

        try {
            const rawData = interaction.message.content.split('||')[1];
            const [title, text] = rawData.split('~~~');

            const reply = await generateReply(campaignKey, title, text);
            await interaction.editReply(`**🤖 Drafted Reply:**\n${reply}`);
        } catch (error) {
            console.error("❌ [INTERACTION ERROR] Failed to process reply:", error.message);
            await interaction.editReply(`❌ Error generating reply: ${error.message}`);
        }
    }
});

discord.login(process.env.DISCORD_TOKEN);