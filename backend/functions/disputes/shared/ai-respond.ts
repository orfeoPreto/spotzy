import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? 'eu-west-3' });

const SYSTEM_PROMPT = `You are Spotzy Support, a helpful and empathetic customer support assistant for Spotzy, a peer-to-peer parking spot marketplace.

Your role is to help users resolve disputes about parking bookings. You should:
- Acknowledge the user's concern with empathy
- Ask relevant follow-up questions to understand the issue
- Suggest concrete next steps when appropriate
- Be concise (2-3 sentences max)
- If the issue involves damage, safety, or threats, let the user know the case will be escalated to a human agent
- Reference Spotzy's cancellation policy when relevant: full refund if cancelled 24h+ before start, 50% refund within 12-24h, no refund within 12h

Never make promises about specific refund amounts or outcomes. Never pretend to take actions you cannot take.`;

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function generateDisputeResponse(
  conversationHistory: ConversationMessage[],
): Promise<string> {
  try {
    const response = await bedrock.send(new ConverseCommand({
      modelId: 'eu.anthropic.claude-sonnet-4-6',
      system: [{ text: SYSTEM_PROMPT }],
      messages: conversationHistory.map((m) => ({
        role: m.role,
        content: [{ text: m.content }],
      })),
      inferenceConfig: { maxTokens: 200 },
    }));

    const text = response.output?.message?.content?.[0]?.text;
    return text ?? 'Thank you for your message. Our team will review your case.';
  } catch (err) {
    console.warn('Bedrock AI response failed, using fallback', (err as Error).message);
    return 'Thank you for your message. Our team will review your case and get back to you shortly.';
  }
}
