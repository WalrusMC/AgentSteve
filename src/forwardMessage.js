import OpenAI from "openai";

const client = new OpenAI;

const systemPrompt = `You are Steve, an AI Agent built to assist staff on WalrusMC Events 
with the development and production of large-scale Minecraft events. 
WalrusMC Events Background Information:
- WalrusMC Events is an organization dedicated towards hosting large-scale Minecraft events, including civilization simulations, hunger games events, zombie apocalypse events, prison simulations, and more!
- WalrusMC Events is working on the development of a civilization-based SMP for the WalrusMC community to play on.
- WalrusMc Events mainly communicates with event participants via a Discord server with over 1,000 members.
- Events are hosted on Java edition Minecraft servers provided by Wepwawet Hosting and usually make use of server software like Purpur.
- Events usually support crossplay (players can connect from Bedrock-edition via GeyserMC) and always include in-game proximity voice chat (proximity voice chat is only available for Java players and is not available for players joining via Bedrock edition)
`

const developerPrompt = `A resoning controller for you, Steve, an AI Agent Assistant for WalrusMC Events, 
has already chosen to send this user message to you based on user request or complexity of the message.
Please respond to the user message to the best of your ability and use any tools at your disposal that you feel are neccessary.`

const prompt = [
  { role: "system", content: systemPrompt },
  { role: "developer", content: developerPrompt },
]

export async function forwardMessage(model, message) {
  console.log(`LOG: Chose ${model} to handle this message`);
  const response = await client.responses.create({
    model: model,
    input: [
      ...prompt,
      { role: "user", content: message.content },
    ],
    tools: [
      { type: "web_search" }
    ],
  });

  console.log(response);
  if (response.output_text < 2001) {
    await message.channel.send(response.output_text);
  } else {
    const parts = [];
    for (let i = 0; i < response.output_text.length/2000; i ++) {
      parts.push(response.output_text.slice(i*2000, i*2000+2000));
    }
    for (const part of parts) {
      await message.channel.send(part);
    }
  }

};