import { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import OpenAI from 'openai';
import axios from 'axios';
import 'dotenv/config';

// --- Configuration ---
const discord = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// State Management
let isScraping = true;
const processedPosts = new Set();

// SignalQub Target Subreddits (Cleaned & Deduplicated)
const subreddits = [
    "10xfreelancing", "agency", "agencygrowthhacks", "agencynewbies", 
    "coldemail", "content_marketing", "contentmarketing", 
    "digital_marketing", "digitalmarketing", "digitalmarketinghack",
    "emailmarketing", "emailmarketingnow", "entrepreneur", 
    "entrepreneurridealong", "entrepreneurs", "entrepreneurship", "freelance",  "freelancers", "freelancing", "googlemybusiness", 
    "growthhacking", "instagrammarketing", "leadgeneration", 
    "localseo", "marketing", "marketinggeek", "marketinghelp", 
    "marketingmentor", "microsaas", "onlinecourses", "prowordpress", 
    "seo", "seo_digital_marketing", "smma", "socialmedia", 
    "socialmediamanagers", "socialmediamarketing", "upwork", "web_design", 
    "web_development", "webdesign", "webdev", "wordpress"
];

// SignalQub Filtering Keywords
const intentKeywords = ['mettings','bounce rate','cold call','no leads', 'zero replies', 'struggling to close', 'exhausted', 'takes too much time', 'cold email', 'no conversions', 'get clients', 'giving up', 'prospecting', 'bad leads', 'spam','leads', 'local'];
const contextKeywords = ['agency', 'b2b', 'web design', 'seo', 'smma', 'cold outreach', 'clients', 'retainer', 'pitch'];

async function verifyLeadWithAI(title, text) {
    try {
        const prompt = `You are a ruthless, highly analytical Chief Revenue Officer qualifying leads for a B2B marketing tool called SignalQub.
        
        SignalQub helps marketing agencies find local businesses that are actively failing technical website audits (e.g., no schema, bad SEO, broken sites) so they have an angle for their cold outreach.
        
        Analyze this Reddit post. Rate how perfectly this matches our ideal customer profile.
        
        Title: ${title}
        Body: ${text.substring(0, 500)}
        
        CRITICAL SCORING RULES:
        - 1-4 (REJECT): The poster is a developer/founder building their own SaaS tool, validating an app, asking for feedback on a product, or promoting a competitor. OR the post is about fulfillment, operations, or managing existing clients.
        - 5-7 (MAYBE): Relevant industry, but they aren't explicitly expressing pain about lead generation.
        - 8-10 (PERFECT): High intent agency owner/freelancer actively struggling to ACQUIRE clients (e.g., cold email going to spam, zero replies, bad lead lists, Apollo isn't working, cold calling sucks).
        
        Return ONLY a raw JSON object. Do not use markdown formatting or backticks.
        Example: {"score": 8, "reason": "brief 1-sentence explanation"}`;

        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.1
        });
        
        let rawContent = response.choices[0].message.content.trim();
        if (rawContent.startsWith('```json')) {
            rawContent = rawContent.replace(/^```json/, '').replace(/```$/, '').trim();
        } else if (rawContent.startsWith('```')) {
            rawContent = rawContent.replace(/^```/, '').replace(/```$/, '').trim();
        }
        
        const result = JSON.parse(rawContent);
        return {
            score: parseInt(result.score) || 0,
            reason: result.reason || "No reason provided."
        };
    } catch (error) {
        console.error("❌ [AI FILTER ERROR] Failed to qualify lead:", error.message);
        return { score: 0, reason: "API Error" }; 
    }
}

async function generateReply(title, text) {
    try {
        console.log(`🧠 [AI] Generating stealth draft for: "${title.substring(0, 30)}..."`);
        
        const prompt = `You are a cynical, pragmatic, and highly successful digital agency owner (~$50k MRR) scrolling Reddit on your phone. You despise marketing gurus, buzzwords, and generic advice. A struggling agency owner just posted this:
        
        Title: ${title}
        Body: ${text}

        TASK: Write a highly authentic, blunt, and context-aware reply. 

        THE STEALTH FRAMEWORK (Follow strictly):
        1. THE DIRECT HIT (ADAPT TO THEIR POST): Do not use greetings. Start your first sentence by directly validating their EXACT problem. If they get no replies, tell them their script sucks. If they are burnt out or overwhelmed, tell them it's because they are taking on cheap clients and using bad workflows.
        2. THE PIVOT (THE ROOT CAUSE): Connect their struggle back to poor prospecting. Explain that whether it's low reply rates, ghosting, or burnout, the root cause is pitching generic businesses without knowing their pain points first.
        3. THE RELUCTANT DROP: Tell them how you fix this. Mention you either spend hours manually auditing Google Maps (looking for missing websites, broken SSLs, bad SEO) to find leverage, OR you just use "signalqub" to instantly pull a list of local businesses actively failing technical checks so you know exactly who actually needs help.
        4. THE EXECUTION: End with exactly how to use that data (e.g., "Take a screenshot of their broken site and send it...").

        CRITICAL REDDIT RULES:
        - No EM DASHES
        - KEEP IT SHORT LIKE 3-4 LINES
        - NEVER sound preachy. Do not say things like "You're drowning because you’re stuck in a cycle of tactical execution." Speak like a normal human agency owner.
        - NO GREETINGS OR SIGN-OFFS. 
        - NEVER capitalize "signalqub". Keep it strictly lowercase.
        - Formatting: Use short, choppy paragraphs (1-3 sentences max). This is a mobile app.
        - Tone: Blunt, pragmatic, slightly informal. Write like a human typing fast. 
        
        ANTI-AI GLOSSARY - YOU WILL BE PENALIZED IF YOU USE THESE WORDS:
        tactical execution, strategic backbone, game-changer, lucrative, supercharge, dive in, landscape, crucial, paramount, elevate, delve, testament, realm, unlock, leverage, navigate, tapestry, robust.`;

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

async function generateSummary(title, text) {
    try {
        console.log(`🧠 [AI] Generating summary for: "${title.substring(0, 30)}..."`);
        const prompt = `You are an analytical assistant. Read this Reddit post:
        Title: ${title}
        Body: ${text}
        TASK: Write a blunt, 2-sentence summary of the user's exact lead generation or marketing problem. Do not offer solutions.`;

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

// --- Concurrent Subreddit Processor (SCRAPER API EDITION) ---
async function processSubreddit(sub, channel) {
    let subPostsChecked = 0;
    let subLeadsFound = 0;

    try {
        // 🚨 REDDIT BYPASS: Send the URL directly to ScraperAPI
        const targetUrl = `https://old.reddit.com/r/${sub}/new.json?limit=5`;
        const scraperApiUrl = `http://api.scraperapi.com/?api_key=${process.env.SCRAPER_API_KEY}&url=${encodeURIComponent(targetUrl)}`;

        const response = await axios.get(scraperApiUrl, {
            timeout: 30000 // ScraperAPI can take a few extra seconds to find an unblocked IP
        });
        
        if (!response.data || !response.data.data || !response.data.data.children) {
            console.log(`  ⚠️ [WARNING] r/${sub} did not return valid JSON. Skipping.`);
            return { subPostsChecked: 0, subLeadsFound: 0 };
        }

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
                
                const aiData = await verifyLeadWithAI(title, selftext);

                if (aiData.score >= 8) {
                    subLeadsFound++;
                    console.log(`   🚨 [HIGH QUALITY LEAD] Score ${aiData.score}/10 in r/${sub}`);

                    const embed = new EmbedBuilder()
                        .setColor(0x00FF00)
                        .setTitle(`🎯 Target Lead Found: r/${sub} (Score: ${aiData.score}/10)`)
                        .setURL(`https://reddit.com${permalink}`)
                        .setAuthor({ name: `u/${author}` })
                        .addFields(
                            { name: 'Title', value: title.substring(0, 256) },
                            { name: 'AI Reasoning', value: `*${aiData.reason}*` }
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
                }
            }
        }
        
        console.log(`   ✔️ r/${sub} complete. Checked posts.`);
        return { subPostsChecked, subLeadsFound };
        
    } catch (err) {
        const status = err.response ? err.response.status : err.code;
        console.error(`   ❌ [SCRAPER API ERROR] r/${sub}: Request failed with status ${status}`);
        return { subPostsChecked: 0, subLeadsFound: 0 };
    }
}

// --- Sequential Scraper Engine ---
async function scanReddit() {
    if (!isScraping) {
        console.log('⏸️ [ENGINE] Scanner is paused. Awaiting !toggle command.');
        return;
    }

    if (!process.env.SCRAPER_API_KEY) {
        console.log('🚨 [ERROR] Missing SCRAPER_API_KEY in .env file!');
        return;
    }

    console.log('\n=============================================');
    console.log('🔍 [ENGINE] Initiating Sequential Scan Cycle...');
    console.log(`📡 [API] Routing traffic securely through ScraperAPI`);
    console.log('=============================================\n');

    let channel;
    try {
        channel = await discord.channels.fetch(process.env.DISCORD_CHANNEL_ID);
    } catch (err) {
        return console.log("❌ [ERROR] Could not fetch Discord Channel. Check your .env ID.");
    }

    let totalNewPostsChecked = 0;
    let totalLeadsFound = 0;

    for (const sub of subreddits) {
        console.log(`📥 [SCRAPER] Fetching r/${sub}...`);
        
        const res = await processSubreddit(sub, channel);
        
        totalNewPostsChecked += res.subPostsChecked;
        totalLeadsFound += res.subLeadsFound;

        // ScraperAPI free tier allows 5 concurrent requests, but running sequentially 
        // with a tiny delay ensures you never hit their rate limits.
        await new Promise(resolve => setTimeout(resolve, 500));
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