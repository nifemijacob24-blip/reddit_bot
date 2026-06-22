import { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import OpenAI from 'openai';
import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import Parser from 'rss-parser';
import 'dotenv/config';

// 🛑 Bypass SSL errors for proxy
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const discord = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const parser = new Parser(); 

const proxyUrl = process.env.DECODO_PROXY_URL;
if (!proxyUrl) {
    console.error("❌ FATAL: DECODO_PROXY_URL is missing.");
    process.exit(1); 
}

// State Management
let isScraping = true;
const processedPosts = new Set();

// --- GLOBAL CAMPAIGN CONFIGURATIONS ---
// --- GLOBAL CAMPAIGN CONFIGURATIONS ---
const CAMPAIGNS = {
    SIGNALQUB: {
        name: "SignalQub",
        color: 0x00FF00,
        // 🛑 Added negative modifiers (-hiring, -job, -"for hire") to strip out job boards and freelancers
        searchQuery: '(agency OR b2b OR "web design" OR seo OR smma) AND ("cold call" OR "no leads" OR "zero replies" OR "cold email" OR "get clients" OR prospecting) -hiring -job -"for hire" -"looking for"',
        intentKeywords: ['mettings', 'bounce rate', 'cold call', 'no leads', 'zero replies', 'struggling to close', 'exhausted', 'takes time', 'cold email', 'no conversions', 'get clients', 'giving up', 'prospecting', 'bad leads', 'spam', 'leads', 'local'],
        contextKeywords: ['agency', 'b2b', 'web design', 'seo', 'smma', 'cold outreach', 'clients', 'retainer', 'pitch'],
        // 🛑 AI now explicitly rejects job postings and freelancers
        qualifyPrompt: `You are a ruthless Chief Revenue Officer qualifying leads for a B2B tool called SignalQub. Rate 1-10. 
        1-4 (REJECT): Job postings, people hiring for cold emailers, freelancers looking for work, or software updates. 
        8-10 (PERFECT): Agency owner actively complaining about struggling to ACQUIRE clients (cold email spam, zero replies).`,
        replyPrompt: `You are a cynical, pragmatic agency owner (~$50k MRR). 1. Validate problem. 2. Root cause is generic pitching. 3. Mention "signalqub". 4. Tell them to screenshot site. Keep it short (3-4 lines).`
    },
    PINQUB: {
        name: "PinQub",
        color: 0xE74C3C,
        // 🛑 Added negative modifiers to strip out customer complaints and general dev talk
        searchQuery: '(etsy OR shopify OR dropshipping OR printondemand OR ecommerce) AND ("etsy ads" OR cpc OR "no sales" OR automate OR "too much time" OR "pinterest traffic" OR "profit margin" OR "views dropped") -scam -customers -"did not receive"',
        intentKeywords: ['etsy ads', 'cpc', 'no sales', 'automate', 'tailwind', 'too much time', 'pinterest traffic', 'profit margin', 'views dropped'],
        contextKeywords: ['etsy', 'store', 'shop', 'listing', 'traffic', 'views', 'visits', 'sales'],
        // 🛑 AI now explicitly rejects accounting/inventory automation and focuses solely on traffic/marketing
        qualifyPrompt: `You are scoring leads for PinQub (automated Pinterest SaaS). Rate 1-10. 
        1-4 (REJECT): People automating accounting/shipping/inventory, job postings, or buyers complaining about a store. 
        8-10 (PERFECT): Active e-commerce seller actively asking how to get more traffic, complaining about ad costs, or asking about Pinterest traffic.`,
        replyPrompt: `You are an experienced high-volume seller. 1. Validate Etsy ads CPCs. 2. State automation is the only way. 3. Mention "pinqub". 4. Keep it short. Keep "pinqub" lowercase.`
    }
};

async function verifyLeadWithAI(campaign, title, text) {
    try {
        const prompt = `${campaign.qualifyPrompt}\n\nTitle: ${title}\nBody: ${text.substring(0, 500)}\n\nYou must respond in JSON format. Return ONLY a raw JSON object. Example: {"score": 8, "reason": "brief 1-sentence explanation"}`;
        
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            response_format: { type: "json_object" },
            messages: [{ role: "user", content: prompt }],
            temperature: 0.1
        });
        
        const result = JSON.parse(response.choices[0].message.content.trim()); 
        console.log(`🧠 AI Scored [${result.score}] for post: ${title.substring(0, 40)}...`);
        
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
        const prompt = `You are an analytical assistant. Read this Reddit post:\nTitle: ${title}\nBody: ${text}\nTASK: Write a blunt, 2-sentence summary of the user's exact problem. Do not offer solutions.`;
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini", 
            messages: [{ role: "user", content: prompt }],
            temperature: 0.3
        });
        return response.choices[0].message.content.trim();
    } catch (error) {
        return "Error generating summary.";
    }
}

async function generateReply(campaignKey, title, text) {
    const campaign = CAMPAIGNS[campaignKey];
    try {
        const prompt = `${campaign.replyPrompt}\n\nStruggling user posted:\nTitle: ${title}\nBody: ${text}\n\nANTI-AI GLOSSARY - YOU WILL BE PENALIZED IF YOU USE THESE WORDS: tactical execution, strategic backbone, game-changer, lucrative, supercharge, dive in, landscape, crucial, paramount, elevate, delve, testament, realm, unlock, leverage, navigate, tapestry, robust.`;
        const response = await openai.chat.completions.create({
            model: "gpt-4o", 
            messages: [{ role: "user", content: prompt }],
            temperature: 0.75, 
            max_tokens: 300 
        });
        return response.choices[0].message.content.trim();
    } catch (error) {
        return "Error generating reply.";
    }
}

// --- GLOBAL Subreddit Search Processor ---
async function processCampaign(campaign, channel) {
    let postsChecked = 0;
    let leadsFound = 0;

    try {
        const freshProxyAgent = new HttpsProxyAgent(proxyUrl, { rejectUnauthorized: false });
        
        const config = {
            httpsAgent: freshProxyAgent, 
            httpAgent: freshProxyAgent, 
            timeout: 15000,
            headers: { 
                'User-Agent': 'Node:global-reddit-scanner:v4.0.0 (by /u/marketing_john_99)',
                'Connection': 'close', 
                'Accept': 'application/rss+xml, application/xml, text/xml'
            }
        };

        // Construct the global search URL
        const encodedQuery = encodeURIComponent(campaign.searchQuery);
        const url = `https://old.reddit.com/search.rss?q=${encodedQuery}&sort=new&limit=100`;

        const response = await axios.get(url, config);
        let feed = await parser.parseString(response.data);

        for (const post of feed.items) {
            const title = post.title || '';
            const selftext = post.contentSnippet || '';
            const permalink = post.link || '';
            const id = post.id || permalink;
            let author = (post.author || 'Unknown').replace('/u/', '');

            if (processedPosts.has(id)) continue;
            processedPosts.add(id);
            postsChecked++;

            const created_utc = new Date(post.isoDate || post.pubDate).getTime() / 1000;
            const postAgeMins = (Math.floor(Date.now() / 1000) - created_utc) / 60;
            
            // Limit to posts within the last 30 minutes to match the interval
            if (postAgeMins > 30) continue; 

            const textToAnalyze = `${title} ${selftext}`.toLowerCase();
            const hasIntent = campaign.intentKeywords.some(kw => textToAnalyze.includes(kw));
            const hasContext = campaign.contextKeywords.some(kw => textToAnalyze.includes(kw));

            // Even though Reddit's search engine found it, we double-check locally before spending OpenAI tokens
            if (hasIntent && hasContext) {
                const aiData = await verifyLeadWithAI(campaign, title, selftext);

                if (aiData.score >= 7) {
                    leadsFound++;
                    console.log(`   🚨 [GLOBAL LEAD] Score ${aiData.score}/10 found on Reddit!`);

                    const embed = new EmbedBuilder()
                        .setColor(campaign.color)
                        .setTitle(`🎯 [${campaign.name}] Global Target Found (Score: ${aiData.score}/10)`)
                        .setURL(permalink)
                        .setAuthor({ name: `u/${author}` })
                        .addFields(
                            { name: 'Title', value: title.substring(0, 256) },
                            { name: 'AI Reasoning', value: `*${aiData.reason}*` }
                        )
                        .setDescription(selftext ? selftext.substring(0, 300) + '...' : '*[No body text]*')
                        .setFooter({ text: `Posted ${Math.floor(postAgeMins)} mins ago` });

                    const campaignKey = Object.keys(CAMPAIGNS).find(key => CAMPAIGNS[key].name === campaign.name);
                    const shortId = Buffer.from(id).toString('base64').substring(0, 20);

                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`summary_${shortId}`)
                            .setLabel('Get Summary')
                            .setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder()
                            .setCustomId(`reply_${campaignKey}_${shortId}`)
                            .setLabel(`Draft Reply`)
                            .setStyle(ButtonStyle.Primary)
                    );

                    await channel.send({ 
                        content: `**RAW_DATA_DO_NOT_DELETE**||${title}~~~${selftext.substring(0, 800)}||`, 
                        embeds: [embed], 
                        components: [row] 
                    });
                }
            }
        }
        return { postsChecked, leadsFound };

    } catch (err) {
        console.error(`❌ [REDDIT FETCH ERROR] Global Search: ${err.message}`);
        return { postsChecked: 0, leadsFound: 0 };
    }
}

// --- Global Scraper Engine ---
async function scanReddit() {
    if (!isScraping) return;

    console.log('\n=============================================');
    console.log(`🌍 [ENGINE] Initiating 10-Min GLOBAL SEARCH cycle...`);
    console.log('=============================================\n');

    let channel;
    try {
        channel = await discord.channels.fetch(process.env.DISCORD_CHANNEL_ID);
    } catch (err) {
        return console.log("❌ [ERROR] Could not fetch Discord Channel.");
    }

    let totalNewPostsChecked = 0;
    let totalLeadsFound = 0;

    for (const [key, campaign] of Object.entries(CAMPAIGNS)) {
        console.log(`\n📦 Executing GLOBAL Campaign: ${campaign.name}`);
        console.log(`🔍 Searching entire Reddit for: ${campaign.searchQuery}`);
        
        const res = await processCampaign(campaign, channel);
        
        totalNewPostsChecked += res.postsChecked;
        totalLeadsFound += res.leadsFound;

        // Hard 3-second delay between campaign searches
        await new Promise(resolve => setTimeout(resolve, 3000));
    }

    if (processedPosts.size > 5000) processedPosts.clear();

    console.log('\n=============================================');
    console.log(`📊 [SUMMARY] 10-Min Global Cycle complete.`);
    console.log(`   - New posts analyzed globally: ${totalNewPostsChecked}`);
    console.log(`   - Qualified leads forwarded: ${totalLeadsFound}`);
    console.log(`⏳ [ENGINE] Sleeping for 10 minutes until next cycle...`);
    console.log('=============================================\n');
}

// --- Listeners ---
discord.once('ready', () => {
    console.log(`\n🤖 Discord Bot online as ${discord.user.tag}`);
    console.log(`🟢 System primed. Scanning entire Reddit every 10 minutes.\n`);
    
    setInterval(scanReddit, 30 * 60 * 1000); 
    scanReddit(); 
});

discord.on('messageCreate', async (message) => {
    if (message.author.bot || !message.content.startsWith('!')) return;

    if (message.content === '!toggle') {
        isScraping = !isScraping;
        await message.reply(`Global Reddit Engine is now **${isScraping ? 'ON 🟢' : 'OFF 🔴'}**.`);
        if (isScraping) scanReddit(); 
    }
});

discord.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    if (interaction.customId.startsWith('summary_')) {
        await interaction.deferReply(); 
        try {
            const rawData = interaction.message.content.split('||')[1];
            const [title, text] = rawData.split('~~~');
            const summary = await generateSummary(title, text);
            await interaction.editReply(`**📝 Lead Summary:**\n*${summary}*`);
        } catch (error) {
            await interaction.editReply(`❌ Error generating summary.`);
        }
    }

    if (interaction.customId.startsWith('reply_')) {
        await interaction.deferReply(); 
        const parts = interaction.customId.split('_');
        const campaignKey = parts[1]; 
        
        try {
            const rawData = interaction.message.content.split('||')[1];
            const [title, text] = rawData.split('~~~');
            const reply = await generateReply(campaignKey, title, text);
            await interaction.editReply(`**🤖 Drafted Reply:**\n${reply}`);
        } catch (error) {
            await interaction.editReply(`❌ Error generating reply.`);
        }
    }
});

discord.login(process.env.DISCORD_TOKEN);