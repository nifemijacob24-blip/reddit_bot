import { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import OpenAI from 'openai';
import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import 'dotenv/config';

// 🛑 ADD THIS LINE TO FIX THE BRIGHT DATA SSL ERROR 🛑
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// --- Configuration ---
const discord = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- BRIGHT DATA PROXY SETUP ---
const proxyUrl = `http://${process.env.BRD_USERNAME}:${process.env.BRD_PASSWORD}@${process.env.BRD_HOST}:${process.env.BRD_PORT}`;
const proxyAgent = new HttpsProxyAgent(proxyUrl, {
    rejectUnauthorized: false 
});

// State Management
let isScraping = true;
const processedPosts = new Set();

// SignalQub Target Subreddits (Cleaned & Deduplicated)
const subreddits = [
    "10xfreelancing", "agency", "agencygrowthhacks", "agencynewbies", 
    "coldemail", "content_marketing", "contentmarketing", "css", 
    "digital_marketing", "digitalmarketing", "digitalmarketinghack",
    "emailmarketing", "emailmarketingnow", "entrepreneur", 
    "entrepreneurridealong", "entrepreneurs", "entrepreneurship", "freelance",  "freelancers", "freelancing", "googlemybusiness", 
    "growthhacking", "instagrammarketing", "leadgeneration", 
    "localseo", "marketing", "marketinggeek", "marketinghelp", 
    "marketingmentor", "microsaas", "onlinecourses", "prowordpress", 
    "seo", "seo_digital_marketing", "sideproject", "smma", "socialmedia", 
    "socialmediamanagers", "socialmediamarketing", "upwork", "web_design", 
    "web_development", "webdesign", "webdev", "wordpress"
];

// SignalQub Filtering Keywords
const intentKeywords = ['mettings','bounce rate','cold call','no leads', 'zero replies', 'struggling to close', 'exhausted', 'takes too much time', 'cold email', 'no conversions', 'get clients', 'giving up', 'prospecting', 'bad leads', 'spam','leads', 'local'];
const contextKeywords = ['agency', 'b2b', 'web design', 'seo', 'smma', 'cold outreach', 'clients', 'retainer', 'pitch'];

// --- AI Gatekeeper Filter (Upgraded to 1-10 Scoring) ---
async function verifyLeadWithAI(title, text) {
    try {
        const prompt = `You are a ruthless, highly analytical Chief Revenue Officer qualifying leads for a B2B marketing tool called SignalQub.
        
        SignalQub helps marketing agencies find local businesses that are actively failing technical website audits (e.g., no schema, bad SEO, broken sites).
        
        Analyze this Reddit post. Rate how perfectly this matches our ideal customer profile (a digital marketing agency owner, web designer, or SMMA founder struggling to get clients, complaining about low cold email reply rates, or buying bad lead lists).
        
        Title: ${title}
        Body: ${text.substring(0, 500)}
        
        Rate the lead from 1 to 10:
        - 1-4: Junk, irrelevant, B2C, or entirely wrong industry.
        - 5-7: Somewhat relevant, but missing high intent or explicitly stating they have no budget.
        - 8-10: Perfect match. High intent agency owner/freelancer actively struggling with outreach/clients.
        
        Return ONLY a JSON object: {"score": 8, "reason": "brief 1-sentence explanation"}`;

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini", // Fixed model string
            messages: [{ role: "user", content: prompt }],
            temperature: 0.1, 
            response_format: { type: "json_object" }
        });
        
        const result = JSON.parse(response.choices[0].message.content.trim());
        return {
            score: parseInt(result.score) || 0,
            reason: result.reason || "No reason provided."
        };
    } catch (error) {
        console.error("❌ [AI FILTER ERROR] Failed to qualify lead:", error.message);
        return { score: 0, reason: "API Error" }; 
    }
}

// --- AI Function: Summary Only ---
async function generateSummary(title, text) {
    try {
        console.log(`🧠 [AI] Generating summary for: "${title.substring(0, 30)}..."`);
        const prompt = `You are an analytical assistant. Read this Reddit post:
        Title: ${title}
        Body: ${text}
        TASK: Write a blunt, 1-sentence summary of the user's exact lead generation or marketing problem. Do not offer solutions.`;

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini", 
            messages: [{ role: "user", content: prompt }],
            temperature: 0.3
        });
        
        console.log(`✅ [AI] Summary generated successfully.`);
        return response.choices[0].message.content.trim();
    } catch (error) {
        console.error("❌ [AI ERROR] Summary failed:", error.message);
        return "Error generating summary.";
    }
}

// --- AI Function: Reply Only ---
async function generateReply(title, text) {
    try {
        console.log(`🧠 [AI] Generating stealth draft for: "${title.substring(0, 30)}..."`);
        
        const prompt = `You are a cynical, pragmatic, and highly successful digital agency owner (~$50k MRR) scrolling Reddit on your phone. You despise marketing gurus and generic advice. A struggling agency owner just posted this:
        
        Title: ${title}
        Body: ${text}

        TASK: Write a highly authentic, blunt, and context-aware reply. You MUST directly address the specific problem they are talking about, while subtly dropping a stealth recommendation for "signalqub".

        THE STEALTH FRAMEWORK (Follow strictly):
        1. THE DIRECT HIT (ADAPT TO THEIR POST): Do not use greetings or agreement phrases. Start your first sentence by directly diagnosing the EXACT problem they posted about. If they can't close, give advice on sales. If they are burnt out, talk about workflow. If they get no replies, talk about their script. Give a harsh but true piece of advice relevant to their actual post.
        2. THE PIVOT (THE ROOT CAUSE): Connect their specific struggle back to poor targeting. Explain that whether it's low reply rates, ghosting, or bad meetings, the root cause is pitching businesses without knowing their pain points first.
        3. THE RELUCTANT DROP: Tell them how you fix this. Mention you either spend hours manually auditing Google Maps (looking for missing websites, broken SSLs, bad SEO) to find leverage, OR you just use "signalqub" to instantly pull a list of local businesses actively failing technical checks so you know exactly what to pitch.
        4. THE EXECUTION: End with exactly how to use that data (e.g., "Take a screenshot of their broken site and send it...").

        CRITICAL REDDIT RULES:
        - No EM DASHES
        - KEEP IT SHORT LIKE 3-4 LINES
        - CONTEXT IS KING: Adapt the first paragraph to THEIR specific post. Do not rant about generic lead lists if they are asking about sales calls.
        - NO GREETINGS, SIGN-OFFS, OR AGREEMENT PHRASES. Never start with "I agree," "You hit the nail on the head," or "Bro." Just start typing the first raw thought.
        - NEVER capitalize "signalqub". Keep it strictly lowercase.
        - Formatting: Use short, choppy paragraphs (1-3 sentences max). This is a mobile app.
        - Tone: Blunt, pragmatic, slightly informal. Write like a human typing fast.
        - DO NOT USE LISTS OR BULLET POINTS. 
        
        ANTI-AI GLOSSARY - YOU WILL BE PENALIZED IF YOU USE THESE WORDS:
        game-changer, lucrative, supercharge, dive in, landscape, crucial, paramount, elevate, delve, testament, realm, unlock, leverage, navigate, tapestry, robust.`;

        const response = await openai.chat.completions.create({
            model: "gpt-4o", 
            messages: [{ role: "user", content: prompt }],
            temperature: 0.75, 
            max_tokens: 300 
        });
        
        console.log(`✅ [AI] Stealth reply drafted successfully.`);
        return response.choices[0].message.content.trim();
    } catch (error) {
        console.error("❌ [AI ERROR] Reply failed:", error.message);
        return "Error generating reply.";
    }
}

// --- Concurrent Subreddit Processor ---
async function processSubreddit(sub, channel) {
    let subPostsChecked = 0;
    let subLeadsFound = 0;

    try {
        const config = { 
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            httpsAgent: proxyAgent,
            timeout: 15000 
        };

        const response = await axios.get(`https://www.reddit.com/r/${sub}/new.json?limit=10`, config);
        const posts = response.data.data.children;

        for (const post of posts) {
            const { title, selftext, permalink, created_utc, id, author } = post.data;

            if (processedPosts.has(id)) continue;
            processedPosts.add(id);
            subPostsChecked++;

            const postAgeMins = (Math.floor(Date.now() / 1000) - created_utc) / 60;
            if (postAgeMins > 15) continue; 

            const textToAnalyze = `${title} ${selftext}`.toLowerCase();
            
            const hasIntent = intentKeywords.some(kw => textToAnalyze.includes(kw));
            const hasContext = contextKeywords.some(kw => textToAnalyze.includes(kw));

            if (hasIntent && hasContext) {
                console.log(`   🧠 [AI FILTER] Keyword match in r/${sub}. Scoring: "${title.substring(0, 30)}..."`);
                
                // Fetch the 1-10 score and reasoning
                const aiData = await verifyLeadWithAI(title, selftext);

                // STRICT FILTER: Only accept 8 or higher
                if (aiData.score >= 8) {
                    subLeadsFound++;
                    console.log(`   🚨 [HIGH QUALITY LEAD] Score ${aiData.score}/10 in r/${sub}`);

                    const embed = new EmbedBuilder()
                        .setColor(0x00FF00) // Changed to Green for high-quality verified leads
                        .setTitle(`🎯 Target Lead Found: r/${sub} (Score: ${aiData.score}/10)`)
                        .setURL(`https://reddit.com${permalink}`)
                        .setAuthor({ name: `u/${author}` })
                        .addFields(
                            { name: 'Title', value: title.substring(0, 256) },
                            { name: 'AI Reasoning', value: `*${aiData.reason}*` } // Shows why it passed
                        )
                        .setDescription(selftext ? selftext.substring(0, 300) + '...' : '*[No body text]*')
                        .setFooter({ text: `Posted ${Math.floor(postAgeMins)} mins ago` });

                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`summary_${id}`)
                            .setLabel('Get Summary')
                            .setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder()
                            .setCustomId(`reply_${id}`)
                            .setLabel('Draft Reply')
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
        
        console.log(`   ✔️ r/${sub} complete. Found ${subLeadsFound} verified leads.`);
        return { subPostsChecked, subLeadsFound };
        
    } catch (err) {
        console.error(`   ❌ [PROXY ERROR] r/${sub}: ${err.message}`);
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
    console.log('🔍 [ENGINE] Initiating 10-minute BATCH scan cycle...');
    console.log(`📡 [PROXY] Routing traffic through Bright Data network`);
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

    for (let i = 0; i < subreddits.length; i += BATCH_SIZE) {
        const batch = subreddits.slice(i, i + BATCH_SIZE);
        console.log(`📥 [SCRAPER] Fetching batch concurrently: ${batch.join(', ')}...`);
        
        const batchResults = await Promise.all(batch.map(sub => processSubreddit(sub, channel)));

        for (const res of batchResults) {
            totalNewPostsChecked += res.subPostsChecked;
            totalLeadsFound += res.subLeadsFound;
        }

        await new Promise(resolve => setTimeout(resolve, 2500));
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
discord.once('clientReady', () => {
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

    if (interaction.customId.startsWith('reply_')) {
        await interaction.deferReply(); 
        console.log(`\n🖱️ [INTERACTION] User requested AI DRAFT REPLY.`);

        try {
            const rawData = interaction.message.content.split('||')[1];
            const [title, text] = rawData.split('~~~');

            const reply = await generateReply(title, text);
            await interaction.editReply(`**🤖 Drafted Reply:**\n${reply}`);
        } catch (error) {
            console.error("❌ [INTERACTION ERROR] Failed to process reply:", error.message);
            await interaction.editReply(`❌ Error generating reply: ${error.message}`);
        }
    }
});

discord.login(process.env.DISCORD_TOKEN);