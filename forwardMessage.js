import OpenAI from "openai";

const client = new OpenAI;

const systemPrompt = `You are Steve, an AI Agent built to assist staff on WalrusMC Events 
with the development and production of large-scale Minecraft events.`

const developerPrompt = `Keep your response under 2000 characters unless this is not possible or reasonably feasible.`

const prompt = [
  { role: "system", content: systemPrompt },
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